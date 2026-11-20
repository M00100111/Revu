/** Adapted from Pi 1.5.0 examples/extensions/question.ts and questionnaire.ts (MIT). */
import type {ExtensionAPI,ExtensionToolContext} from '@earendil-works/pi-coding-agent';
import {Type,type Static} from 'typebox';

const Option=Type.Object({
  label:Type.String({minLength:1,description:'Text shown to the user.'}),
  value:Type.Optional(Type.String({description:'Stable answer value; defaults to label.'})),
  description:Type.Optional(Type.String({description:'Additional explanation shown with the option.'})),
});
const Question=Type.Object({
  id:Type.String({minLength:1,description:'Unique question ID, used to identify the answer.'}),
  prompt:Type.String({minLength:1,description:'The full question shown to the user.'}),
  type:Type.Optional(Type.Union([Type.Literal('select'),Type.Literal('confirm'),Type.Literal('input'),Type.Literal('editor')],{description:'Defaults to select when options are provided, otherwise input.'})),
  options:Type.Optional(Type.Array(Option,{description:'Choices for a select question. Custom answers are also allowed.'})),
  placeholder:Type.Optional(Type.String({description:'Hint for a single-line input.'})),
  prefill:Type.Optional(Type.String({description:'Initial text for the multi-line editor.'})),
});
const Parameters=Type.Object({
  questions:Type.Array(Question,{minItems:1,description:'One question or a group of related questions, shown in order.'}),
  timeout:Type.Optional(Type.Integer({minimum:1,maximum:2147483647,description:'Optional timeout for the entire questionnaire, in milliseconds. Omit to wait for the user.'})),
});
type QuestionInput=Static<typeof Question>;
type QuestionType='select'|'confirm'|'input'|'editor';
type NormalizedQuestion=QuestionInput&{type:QuestionType};
interface Answer {id:string;type:QuestionType;value:string|boolean;label:string;wasCustom:boolean}
type Reply={cancelled:true}|{value:string}|{confirmed:boolean};
interface Request {method:QuestionType;title:string;options?:string[];message?:string;placeholder?:string;prefill?:string;group?:{id:string;index:number;total:number}}
interface RevuUI {revuAskUser:(request:Request,options:{signal:AbortSignal;timeout?:number})=>Promise<Reply>}

function normalize(questions:QuestionInput[]):NormalizedQuestion[]{
  if(!questions.length)throw new Error('At least one question is required.');
  const ids=new Set<string>();
  return questions.map(question=>{
    if(!question.id.trim()||ids.has(question.id)||!question.prompt.trim())throw new Error('Question IDs must be unique and prompts must not be empty.');
    ids.add(question.id);const type=question.type??(question.options?.length?'select':'input');
    if(!['select','confirm','input','editor'].includes(type))throw new Error('Unsupported question type.');
    if(type==='select'){
      if(!question.options?.length)throw new Error(`Question ${question.id} requires options.`);
      const labels=new Set<string>();const values=new Set<string>();
      for(const option of question.options){
        const label=optionText(option);const value=option.value??option.label;
        if(!option.label.trim()||labels.has(label)||values.has(value))throw new Error(`Question ${question.id} requires distinct options.`);
        labels.add(label);values.add(value);
      }
    }else if(question.options?.length)throw new Error(`Only select questions accept options (${question.id}).`);
    return {...question,type:type as QuestionType};
  });
}
function optionText(option:Static<typeof Option>){return option.description?`${option.label}\n${option.description}`:option.label;}
function requestFor(question:NormalizedQuestion,index:number,count:number):Request{
  const title=count>1?`${index+1}/${count} · ${question.prompt}`:question.prompt;
  return {method:question.type,title,...(question.type==='select'?{options:question.options!.map(optionText)}
    :question.type==='confirm'?{message:question.prompt}:question.type==='editor'?{prefill:question.prefill}:{placeholder:question.placeholder})};
}

export default function askUser(pi:ExtensionAPI){
  pi.registerTool({
    name:'ask_user',label:'Ask User',executionMode:'sequential',defaultActive:true,
    description:'Ask the user one or more questions when clarification or a decision is needed before proceeding. Group related questions in one call. Supports choices with custom answers, yes/no confirmation, single-line input and multi-line editing.',
    promptSnippet:'Ask the user for clarification or a decision.',
    promptGuidelines:['Use ask_user when user input is needed to continue. Group related questions in one call. Cancellation is not approval.'],
    parameters:Parameters,
    async execute(_toolCallId,params,signal,onUpdate,ctx){
      const questions=normalize(params.questions);const answers:Answer[]=[];
      const ui=ctx.ui as ExtensionToolContext['ui']&RevuUI;
      if(!ctx.hasUI||typeof ui.revuAskUser!=='function')return {isError:true,content:[{type:'text' as const,text:'Revu user interaction is unavailable.'}],details:{questions,answers,cancelled:true,reason:'unavailable'}};
      const controller=new AbortController();const abort=()=>controller.abort();
      if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
      const deadline=params.timeout===undefined?undefined:Date.now()+params.timeout;
      let cancelled=false;let reason:string|undefined;
      try{
        // Queue the whole group at once, keeping Question and draft state continuous between answers.
        const pending=questions.map((question,index)=>ui.revuAskUser({
          ...requestFor(question,index,questions.length),
          group:questions.length>1?{id:_toolCallId,index,total:questions.length}:undefined,
        },{signal:controller.signal,timeout:deadline===undefined?undefined:Math.max(1,deadline-Date.now())}));
        // Attach handlers immediately so a later queued request cannot become an unhandled rejection.
        const settled=pending.map(request=>request.then(reply=>({reply}),error=>({error})));
        for(let index=0;index<questions.length;index++){
          const outcome=await settled[index];if('error' in outcome)throw outcome.error;
          const reply=outcome.reply;const question=questions[index];
          if('cancelled' in reply){cancelled=true;reason=signal?.aborted?'aborted':deadline!==undefined&&Date.now()>=deadline?'timeout':'cancelled';break;}
          let answer:Answer;
          if(question.type==='confirm'){
            if(!('confirmed' in reply))throw new Error('Invalid confirmation response.');
            answer={id:question.id,type:question.type,value:reply.confirmed,label:reply.confirmed?'Yes':'No',wasCustom:false};
          }else{
            if(!('value' in reply))throw new Error('Invalid answer response.');
            const option=question.type==='select'?question.options!.find(option=>optionText(option)===reply.value):undefined;
            answer={id:question.id,type:question.type,value:option?.value??option?.label??reply.value,label:option?.label??reply.value,wasCustom:question.type==='select'&&!option};
          }
          answers.push(answer);
          onUpdate?.({content:[{type:'text',text:`Answered ${answers.length}/${questions.length} questions.`}],details:{questions,answers:[...answers],cancelled:false}});
        }
      }finally{controller.abort();signal?.removeEventListener('abort',abort);}
      const text=answers.map(answer=>`${answer.id}: ${JSON.stringify(answer.value)}`).join('\n');
      return {content:[{type:'text' as const,text:[cancelled?`Questionnaire ${reason}. Unanswered questions have no answer; cancellation is not approval.`:'User answers:',text].filter(Boolean).join('\n')}],details:{questions,answers,cancelled,...(reason?{reason}:{})}};
    },
  });
}
