export type CodeEncoding='utf-8'|'gb18030';
export const isCodeEncoding=(value:unknown):value is CodeEncoding=>value==='utf-8'||value==='gb18030';
export const isKnownBinaryCodePath=(path:string)=>/\.pyc$/i.test(path);

type SourceIssue='binary'|'invalid-encoding'|'bare-cr'|'mixed-line-endings';

export function decodeCodeText(bytes:Uint8Array,encoding:CodeEncoding='utf-8',knownBinary=false):{text:string;issue?:SourceIssue}{
  if(knownBinary||bytes.includes(0))return {text:'',issue:'binary'};
  let text:string;
  try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
  catch{return {text:'',issue:'invalid-encoding'};}
  if(/\r(?!\n)/.test(text))return {text,issue:'bare-cr'};
  if(/\r\n/.test(text)&&/(?<!\r)\n/.test(text))return {text,issue:'mixed-line-endings'};
  return {text};
}

export function codeLineCount(text:string,bufferLineCount=text.split('\n').length){
  return bufferLineCount-(text.endsWith('\n')?1:0);
}
