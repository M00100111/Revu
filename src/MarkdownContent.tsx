import { useMemo } from 'react';
import { Marked, Renderer } from 'marked';

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[character]!));
const safeHref=(value:string)=>{
  try{const url=new URL(value);return url.protocol==='http:'||url.protocol==='https:'||url.protocol==='mailto:'?value:undefined;}
  catch{return undefined;}
};
const renderer=new Renderer();
renderer.html=({text})=>escapeHtml(text);
renderer.link=function({href,title,tokens}){
  const label=this.parser.parseInline(tokens);const safe=safeHref(href);
  if(!safe)return `<span>${label}</span>`;
  return `<a href="${escapeHtml(safe)}"${title?` title="${escapeHtml(title)}"`:''} target="_blank" rel="noreferrer">${label}</a>`;
};
renderer.image=({text})=>`<span class="agent-markdown-image">[Image: ${escapeHtml(text)}]</span>`;
const markdown=new Marked({gfm:true,breaks:true,renderer});

export const renderMarkdown=(value:string)=>markdown.parse(value,{async:false});

export default function MarkdownContent({text}:{text:string}){
  const html=useMemo(()=>renderMarkdown(text),[text]);
  return <div className="agent-answer agent-markdown" dangerouslySetInnerHTML={{__html:html}} onClick={event=>{
    const target=event.target as Element;const link=target.closest('a');if(!link||!event.currentTarget.contains(link))return;
    event.preventDefault();void window.revu.openExternal(link.href);
  }}/>
}
