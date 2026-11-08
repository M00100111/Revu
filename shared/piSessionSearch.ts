import type { PiSessionSearchResult, PiSessionSort, PiSessionSummary } from './piTypes';

export interface PiSessionSearchDocument {
  summary:PiSessionSummary;
  allMessagesText:string;
}

interface Match {score:number;snippet?:string}

const normalize=(value:string)=>value.toLocaleLowerCase().replace(/\s+/g,' ').trim();

const fuzzyScore=(query:string,value:string)=>{
  const needle=normalize(query);const haystack=normalize(value);if(!needle||!haystack)return undefined;
  let at=-1;let score=0;
  for(const character of needle){const next=haystack.indexOf(character,at+1);if(next<0)return undefined;score+=next-at-1;at=next;}
  return score+Math.max(0,at-needle.length+1);
};

const tokensFor=(query:string)=>{
  const tokens:string[]=[];const matcher=/"([^"]+)"|(\S+)/g;let match:RegExpExecArray|null;
  while((match=matcher.exec(query)))tokens.push(match[1]??match[2]);
  return tokens;
};

const snippetFor=(text:string,query:string)=>{
  const normalized=text.replace(/\s+/g,' ').trim();if(!normalized)return undefined;
  const at=normalized.toLocaleLowerCase().indexOf(normalize(query));
  const start=Math.max(0,(at<0?0:at)-42);const end=Math.min(normalized.length,(at<0?0:at)+query.length+72);
  return `${start?'…':''}${normalized.slice(start,end)}${end<normalized.length?'…':''}`;
};

const matchDocument=(document:PiSessionSearchDocument,query:string):Match|undefined=>{
  const tokens=tokensFor(query);if(!tokens.length)return {score:0};
  const name=normalize(document.summary.name);const first=normalize(document.summary.firstMessage);
  const messages=normalize(document.allMessagesText);const id=document.summary.id.toLocaleLowerCase();
  if(name===normalize(query))return {score:0};
  let score=0;let snippet:string|undefined;
  for(const raw of tokens){const token=normalize(raw);if(!token)continue;
    const firstAt=first.indexOf(token);if(firstAt>=0){score+=1_000_000+firstAt;snippet??=snippetFor(document.summary.firstMessage,raw);continue;}
    const messageAt=messages.indexOf(token);if(messageAt>=0){score+=1_000_000+messageAt;snippet??=snippetFor(document.allMessagesText,raw);continue;}
    const idAt=id.indexOf(token);if(idAt>=0){score+=1_000_000+idAt;continue;}
    const fuzzy=fuzzyScore(token,name);if(fuzzy!==undefined){score+=2_000_000+fuzzy;continue;}
    return undefined;
  }
  return {score,snippet};
};

export const searchPiSessions=(documents:PiSessionSearchDocument[],query:string,sort:PiSessionSort):PiSessionSearchResult[]=>{
  const matched=documents.flatMap(document=>{
    const match=matchDocument(document,query);return match?[{document,match}]:[];
  });
  matched.sort((left,right)=>sort==='recent'
    ?right.document.summary.modifiedAt-left.document.summary.modifiedAt
    :left.match.score-right.match.score||right.document.summary.modifiedAt-left.document.summary.modifiedAt);
  return matched.map(({document,match})=>({...document.summary,...(match.snippet?{matchSnippet:match.snippet}:{})}));
};
