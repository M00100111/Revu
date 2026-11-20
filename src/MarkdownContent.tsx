import { useMemo } from 'react';
import { Marked, Renderer, type Token, type Tokens } from 'marked';
import {codeReferenceLabel,type CodeReference} from '../shared/codePins';

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[character]!));
const safeHref=(value:string)=>{
  try{const url=new URL(value);return url.protocol==='http:'||url.protocol==='https:'||url.protocol==='mailto:'?value:undefined;}
  catch{return undefined;}
};
function linkLabelText(tokens:Token[]):string|undefined{
  let label='';
  for(const token of tokens){
    if(token.type==='text'||token.type==='escape'||token.type==='codespan')label+=token.text;
    else if(token.type==='strong'||token.type==='em'||token.type==='del'){
      const nested=token.tokens&&linkLabelText(token.tokens);if(nested===undefined)return undefined;
      label+=nested;
    }else return undefined;
  }
  return label;
}
function matchCodeReference({href,tokens}:Tokens.Link,available:ReadonlyMap<string,CodeReference>){
  const reference=available.get(href);
  if(reference&&linkLabelText(tokens)===codeReferenceLabel(reference))return reference;
  return undefined;
}
const markdownFor=(references?:CodeReference[])=>{
  const byHref=new Map(references?.map(reference=>[reference.href,reference]));
  const renderer=new Renderer();
  renderer.html=({text})=>escapeHtml(text);
  renderer.link=function(link){
    const {href,title,tokens}=link;
    const ref=matchCodeReference(link,byHref);
    if(ref){
      const location=`${ref.path}#L${ref.startLine}${ref.endLine===ref.startLine?'':'-L'+ref.endLine}${ref.revision?' · '+ref.revision.slice(0,7):''}`;
      return `<a class="agent-code-reference" href="${escapeHtml(href)}" title="${escapeHtml(location)}">${escapeHtml(codeReferenceLabel(ref))}</a>`;
    }
    const label=this.parser.parseInline(tokens);
    if(references&&/^revu-code:/i.test(href))return `<span>${label} (Invalid code reference)</span>`;
    const safe=safeHref(href);
    if(!safe)return `<span>${label}</span>`;
    return `<a href="${escapeHtml(safe)}"${title?` title="${escapeHtml(title)}"`:''} target="_blank" rel="noreferrer">${label}</a>`;
  };
  renderer.image=({text})=>`<span class="agent-markdown-image">[Image: ${escapeHtml(text)}]</span>`;
  return new Marked({gfm:true,breaks:true,renderer});
};
const markdown=markdownFor();
const markdownWithoutReferences=markdownFor([]);

export const renderMarkdown=(value:string,references?:CodeReference[])=>
  (references?.length?markdownFor(references):references?markdownWithoutReferences:markdown).parse(value,{async:false});
export function linkedCodeReferences(text:string,available:ReadonlyMap<string,CodeReference>){
  const found=new Map<string,CodeReference>();
  if(available.size&&text.includes('revu-code:'))markdown.walkTokens(markdown.lexer(text),token=>{
    if(token.type==='link'){
      const reference=matchCodeReference(token as Tokens.Link,available);if(reference)found.set(reference.href,reference);
    }
  });
  return [...found.values()];
}

export default function MarkdownContent({text,references,onCodeReference}:{text:string;references?:CodeReference[];onCodeReference?:(reference:CodeReference)=>void}){
  const html=useMemo(()=>renderMarkdown(text,references),[text,references]);
  return <div className="agent-answer agent-markdown" dangerouslySetInnerHTML={{__html:html}} onClick={event=>{
    const target=event.target as Element;const link=target.closest('a');if(!link||!event.currentTarget.contains(link))return;
    event.preventDefault();
    if(link.classList.contains('agent-code-reference')){
      const reference=references?.find(ref=>ref.href===link.getAttribute('href'));
      if(reference)onCodeReference?.(reference);
    }else void window.revu.openExternal(link.href);
  }}/>
}
