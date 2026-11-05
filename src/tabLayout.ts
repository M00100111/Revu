export type FileTabOverflow='scroll'|'wrap';
export type FileTabExpansion='single'|'limited'|'all';

export const defaultTabExpansion=(overflow:FileTabOverflow):FileTabExpansion=>
  overflow==='wrap'?'limited':'single';

export function countTabRows(widths:readonly number[],available:number){
  if(!widths.length||available<=0)return 1;
  let rows=1,rowWidth=0;
  for(const width of widths){
    const itemWidth=Math.min(width,available);
    if(rowWidth>0&&rowWidth+itemWidth>available){rows++;rowWidth=itemWidth;}
    else rowWidth+=itemWidth;
  }
  return rows;
}

export function nextTabExpansion(overflow:FileTabOverflow,current:FileTabExpansion,rows:number):FileTabExpansion{
  if(overflow==='wrap')return current==='all'?'limited':'all';
  if(current==='single')return 'limited';
  if(current==='limited')return rows>4?'all':'single';
  return 'single';
}
