const attachments=new WeakMap();
export function decodeInput(wire){if(wire===undefined)return;const prefix='\u001eRevuInput/1:';if(typeof wire!=='string'||!wire.startsWith(prefix))throw new Error('Invalid citation envelope');return {...JSON.parse(wire.slice(prefix.length)),wire};}

export function bindCitation(user,input){
  if(!input?.selections.length)return user;
  user.revuDeliveryId=input.deliveryId;
  const expanded=user.content[0].text,original=input.text;let suffix=0;
  while(suffix<Math.min(original.length,expanded.length)&&original[original.length-1-suffix]===expanded[expanded.length-1-suffix])suffix++;
  const content=[];const selections=input.selections.map(({text,...selection})=>{
    const offset=selection.offset>=original.length-suffix?selection.offset+expanded.length-original.length:selection.offset;
    content.push({type:'text',text:`Editor selection from ${JSON.stringify(selection.path)} (start ${selection.startLine}:${selection.startColumn}, end exclusive ${selection.endLine}:${selection.endColumn}; ${selection.language}):`},{type:'text',text});
    return {...selection,offset,contentIndex:content.length-1};
  });
  attachments.set(user,{wire:input.wire,cite:{role:'custom',customType:'cite',display:false,content,details:{version:1,deliveryId:input.deliveryId,selections},timestamp:user.timestamp}});
  return user;
}
export function expandCitations(messages){return messages.flatMap(user=>{const attachment=attachments.get(user);return attachment?[user,attachment.cite]:[user];});}
export function citationQueueKey(user){return attachments.get(user)?.wire;}
export function withdrawInput(session,kind,index,expected){
  if(kind!=='steering'&&kind!=='followUp')return false;
  const visible=kind==='steering'?session._steeringMessages:session._followUpMessages;
  const pending=(kind==='steering'?session.agent.steeringQueue:session.agent.followUpQueue).messages;
  if(!Number.isInteger(index)||visible[index]!==expected)return false;
  const users=pending.filter(message=>message.role==='user');const position=index-(visible.length-users.length),message=users[position];
  if(!message||(citationQueueKey(message)??message.content?.[0]?.text)!==expected)return false;
  pending.splice(pending.indexOf(message),1);visible.splice(index,1);session._emitQueueUpdate();return true;
}
export function linkCitation(user,entryId){const attachment=attachments.get(user);if(attachment){attachment.cite.details.userEntryId=entryId;attachments.delete(user);}}
