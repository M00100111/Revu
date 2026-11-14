import type { PiQueueState } from './piTypes';

export type PiQueueKind=keyof PiQueueState;

export const emptyPiQueue=():PiQueueState=>({steering:[],followUp:[]});

export const cleanPiQueue=(queue:PiQueueState):PiQueueState=>({
  steering:queue.steering.filter(item=>typeof item==='string'&&!!item.trim()),
  followUp:queue.followUp.filter(item=>typeof item==='string'&&!!item.trim()),
});

export const mergePiQueues=(left:PiQueueState,right:PiQueueState):PiQueueState=>({
  steering:[...left.steering,...right.steering],followUp:[...left.followUp,...right.followUp],
});

export function updatePiQueueItem(queue:PiQueueState,kind:PiQueueKind,index:number,value?:string):PiQueueState{
  const next={steering:[...queue.steering],followUp:[...queue.followUp]};
  if(value===undefined)next[kind].splice(index,1);else next[kind][index]=value;
  return next;
}

export function acceptPiQueueHead(queue:PiQueueState,kind:PiQueueKind):PiQueueState{
  const next={steering:[...queue.steering],followUp:[...queue.followUp]};next[kind].shift();return next;
}
