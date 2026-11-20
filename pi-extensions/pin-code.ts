import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {promisify} from 'node:util';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import {CODE_PIN_TOOL,codeReferenceLabel,referencePath,type CodeReference} from '../shared/codePins';
import {codeLineCount,decodeCodeText,isCodeEncoding,isKnownBinaryCodePath} from '../shared/codeSource';

const exec=promisify(execFile);
const maxBytes=8*1024*1024;
const sizeError='File exceeds the 8 MiB limit.';
const maxReferences=32;
const maxNoteLength=500;
const fullCommitId=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const binaryError='Binary file. Code references require text.';
const ReferenceInput=Type.Object({
  path:Type.String({description:'Project-relative file path.'}),
  startLine:Type.Integer({minimum:1,description:'First line, one-based and inclusive.'}),
  endLine:Type.Integer({minimum:1,description:'Last line, one-based and inclusive.'}),
  revision:Type.Optional(Type.String({pattern:fullCommitId.source,description:'Exact Git commit ID for old code. Omit for current working-tree code.'})),
  encoding:Type.Optional(Type.Union([Type.Literal('utf-8'),Type.Literal('gb18030')],{
    description:'Defaults to UTF-8. Set gb18030 explicitly for GBK/GB18030 source; opens as a read-only snapshot.',
  })),
  note:Type.Optional(Type.String({maxLength:maxNoteLength,description:`Optional read-only remark below the code preview; at most ${maxNoteLength} characters.`})),
});
const Parameters=Type.Object({
  references:Type.Array(Type.Union([ReferenceInput,Type.Unknown()]),{
    minItems:1,maxItems:maxReferences,description:`From 1 to ${maxReferences} code ranges per call. Split larger batches into multiple calls in the same user turn. Entries are processed in input order; invalid entries are reported individually.`,
  }),
});

type PinResult={index:number;ok:true;href:string}|{index:number;ok:false;field:string;error:string;path?:string};
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const errorCode=(error:unknown)=>isRecord(error)?error.code:undefined;

function batchArguments(input:unknown){
  const references=isRecord(input)?input.references:undefined;
  if(!Array.isArray(references)||!references.length||references.length>maxReferences)
    throw new Error(`references: expected an array of 1–${maxReferences} entries.`);
  return {references};
}

class PinError extends Error {
  constructor(readonly field:string,message:string){super(message);}
}

class PinInputError extends PinError {
  constructor(field:string,expectation:string){super(field,`expected ${expectation}.`);}
}

function parseReferencePath(path:unknown){
  if(typeof path!=='string')throw new PinInputError('path','a project-relative file path');
  try{return referencePath(path);}catch{throw new PinInputError('path','a project-relative file path');}
}

function parseReferenceFields(input:Record<string,unknown>){
  const {startLine,endLine,revision,encoding,note}=input;
  if(typeof startLine!=='number'||!Number.isSafeInteger(startLine)||startLine<1)
    throw new PinInputError('startLine','a positive integer');
  if(typeof endLine!=='number'||!Number.isSafeInteger(endLine)||endLine<startLine)
    throw new PinInputError('endLine','an integer at least startLine');
  if(revision!==undefined&&(typeof revision!=='string'||!fullCommitId.test(revision)))
    throw new PinInputError('revision','a full 40- or 64-character Git commit ID');
  if(encoding!==undefined&&!isCodeEncoding(encoding))
    throw new PinInputError('encoding','utf-8 or gb18030');
  if(note!==undefined&&(typeof note!=='string'||[...note].length>maxNoteLength))
    throw new PinInputError('note',`a string of at most ${maxNoteLength} characters`);
  return {startLine,endLine,revision,encoding,note:note?.trim()||undefined};
}

async function sourceBytes(cwd:string,path:string,revision?:string,signal?:AbortSignal){
  if(revision){
    const git=(args:string[])=>exec('git',['--literal-pathspecs',...args],{cwd,encoding:'buffer',maxBuffer:maxBytes,windowsHide:true,signal});
    const commit=revision+'^{commit}';
    let listing:string;
    try{listing=(await git(['ls-tree','-z',commit,'--',path])).stdout.toString();}
    catch(error){
      signal?.throwIfAborted();
      if(typeof errorCode(error)!=='number')throw new PinError('revision','Could not access the Git repository.');
      try{await git(['rev-parse','--verify','--quiet',commit]);}
      catch(verificationError){
        signal?.throwIfAborted();
        throw new PinError('revision',errorCode(verificationError)===1
          ?'Commit not found in this repository.':'Could not verify the commit in this repository.');
      }
      throw new PinError('path','Could not list the file at that revision.');
    }
    if(!listing.length)throw new PinError('path','File does not exist at that revision.');
    if(/^040000 tree /.test(listing))throw new PinError('path','Path is a directory at that revision.');
    const blob=/^100(?:644|755) blob ([a-f0-9]+)\t/.exec(listing);
    if(!blob)throw new PinError('path','No regular file at that revision.');
    if(isKnownBinaryCodePath(path))throw new PinError('path',binaryError);
    try{return (await git(['cat-file','blob',blob[1]])).stdout;}
    catch(error){
      signal?.throwIfAborted();
      throw new PinError('path',errorCode(error)==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        ?sizeError:'Could not read the file at that revision.');
    }
  }
  try{
    const root=await realpath(cwd);
    const target=await realpath(resolve(root,path));
    const child=relative(root,target);
    if(isAbsolute(child)||child==='..'||child.startsWith('..'+sep)||child.split(sep).some(part=>part.toLowerCase()==='.git'))
      throw new PinError('path','File is outside the project or private Git metadata.');
    const info=await stat(target);
    if(info.isDirectory())throw new PinError('path','Path is a directory.');
    if(!info.isFile())throw new PinError('path','Expected a regular source file.');
    if(isKnownBinaryCodePath(path)||isKnownBinaryCodePath(target))throw new PinError('path',binaryError);
    if(info.size>maxBytes)throw new PinError('path',sizeError);
    return await readFile(target,{signal});
  }catch(error){
    if(error instanceof PinError)throw error;
    signal?.throwIfAborted();
    if(errorCode(error)==='ENOENT')throw new PinError('path','File does not exist (ENOENT).');
    throw new PinError('path','Could not read source file.');
  }
}

export default function pinCode(pi:ExtensionAPI){
  pi.registerTool({
    name:CODE_PIN_TOOL,label:'Pin Code',defaultActive:true,
    description:'Create clickable references to exact source line ranges in Revu. Does not edit files.',
    promptSnippet:'Cite source code with clickable line-range references.',
    promptGuidelines:[
      `Use up to ${maxReferences} references per pin_code call; split larger batches into multiple calls in the same user turn.`,
      'When citing a source range, call pin_code in the current user turn and copy the complete returned Markdown link verbatim. Never construct a revu-code link, reuse an ID from an earlier turn, or change the link label. Group references and use the exact revision of old code; omit revision only for current working-tree code.',
    ],
    parameters:Parameters,
    prepareArguments:batchArguments,
    async execute(_toolCallId,params,signal,_onUpdate,ctx){
      const references:CodeReference[]=[];
      const batchId=randomUUID();
      const results:PinResult[]=[];
      const lines:string[]=[];
      const batch=batchArguments(params).references;
      for(const [index,input] of batch.entries()){
        let sourcePath:string|undefined;
        try{
          signal?.throwIfAborted();
          if(!isRecord(input))throw new PinInputError('reference','an object');
          const path=parseReferencePath(input.path);
          sourcePath=path;
          const {startLine,endLine,revision,encoding,note}=parseReferenceFields(input);
          const bytes=await sourceBytes(ctx.cwd,path,revision,signal);
          const {text,issue}=decodeCodeText(bytes,encoding);
          if(issue==='binary')throw new PinError('path',binaryError);
          if(issue==='bare-cr')throw new PinError('path','Unsupported line endings: bare CR.');
          if(issue==='invalid-encoding')throw new PinError('encoding',encoding==='gb18030'?'Invalid GB18030 text.'
            :'Invalid UTF-8 text. For GBK/GB18030 source, set encoding to gb18030.');
          const lineCount=codeLineCount(text);
          if(endLine>lineCount)throw new PinInputError(startLine>lineCount?'startLine':'endLine',`a line number from 1 to ${lineCount}`);
          const href=`revu-code:${batchId}-${references.length}`;
          const reference={href,path,startLine,endLine,revision,hash:createHash('sha256').update(bytes).digest('hex'),note,...(encoding?{encoding}:{})};
          references.push(reference);
          const label=codeReferenceLabel(reference).replace(/[\\\[\]<>*_~`&]/g,'\\$&');
          results.push({index,ok:true,href});
          lines.push(`#${index+1} [${label}](${href})${encoding==='gb18030'?' (GB18030)':''}`);
        }catch(error){
          signal?.throwIfAborted();
          const field=error instanceof PinError?error.field:'path';
          const message=error instanceof PinError?error.message:'Could not read source file.';
          const path=sourcePath;
          results.push({index,ok:false,field,error:message,...(path?{path}:{})});
          const label=path?(field==='path'?path:`${field} (${path})`):field;
          lines.push(`#${index+1} ${label}: ${message}`);
        }
      }
      const summary={total:batch.length,succeeded:references.length,failed:batch.length-references.length};
      lines.push(`${summary.succeeded}/${summary.total} references created, ${summary.failed} failed`);
      return {content:[{type:'text' as const,text:lines.join('\n')}],details:{references,results,summary},isError:!references.length};
    },
  });
}
