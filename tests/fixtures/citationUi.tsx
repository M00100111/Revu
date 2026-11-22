import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CitationBubble,CitationPreviews} from '../../src/CitationView';
import {CitationComposer} from '../../src/CitationComposer';

const message='<skill name="demo" location="/SKILL.md">\nselectable skill body\n</skill>\nReview @"price.ts"#L2';
const selections=[{path:'price.ts',offset:message.indexOf('@"'),text:'selected code',language:'typescript',startLine:2,endLine:2,startColumn:1,endColumn:14}];
function Fixture(){
  const [value,change]=useState('Review @"price.ts"#L2 and @"src/"'),[epoch,reset]=useState('1');
  const [copied,copy]=useState('');
  return <CitationPreviews epoch={epoch} tokenize={async()=>[[{offset:0,type:'keyword.ts'}]]}><CitationComposer ref={null} value={value} onValue={change} disabled={false} onCaret={()=>{}} onKeyDown={()=>{}} onBlur={()=>{}} onPaste={()=>{}} onGoto={()=>{}} onEdit={()=>{}} onDelete={ref=>change(value.slice(0,ref.offset)+value.slice(ref.raw.length+ref.offset))}/><output>{value}</output>
    <CitationBubble text={message} selections={selections} epoch={epoch} onGoto={()=>{}} onCopy={copy}/>
    <CitationBubble text={'@"price.ts"#L2-L3'} selections={[{...selections[0],offset:0,endLine:3,text:'    if (ok) {\n      run();',wholeLines:true}]} epoch={epoch} onGoto={()=>{}} onCopy={copy}/>
    <span id="copied">{copied}</span><button id="next" onClick={()=>reset('2')}>Next user message</button></CitationPreviews>;
}
createRoot(document.querySelector('main')!).render(<Fixture/>);
