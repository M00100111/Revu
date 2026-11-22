export function patchPiCite(source,replaceOnce){
  const change=(oldText,newText)=>{source=replaceOnce(source,oldText,newText,'citation delivery');};
  change('async getLastAssistantText(){','async withdrawInput(kind,index,expected){return this.getData(await this.send({type:"revu_withdraw",kind,index,expected}))}async revuInput(type,input,wire){const response=await this.send({type,message:input.text,revuCite:wire});return this.getData(response).disposition}async getLastAssistantText(){');
  change('case"clear_queue":','case"revu_withdraw":return success(id,"revu_withdraw",revuWithdraw(session,command.kind,command.index,command.expected));case"clear_queue":');
  change('session.prompt(command.message,{images:command.images','session.prompt(command.message,{revuCite:revuDecode(command.revuCite),images:command.images');
  for(const method of ['steer','followUp']){
    change(`session.${method}(command.message,command.images,{source:"rpc"})`,`session.${method}(command.message,command.images,{source:"rpc",revuCite:revuDecode(command.revuCite)})`);
    const behavior=method==='steer'?'steer':'followUp';
    change(`this._queueUserInput(text,images,"${behavior}",options?.source??"interactive")`,`this._queueUserInput(text,images,"${behavior}",options?.source??"interactive",options?.revuCite)`);
    const queueMethod=method==='steer'?'_queueSteer':'_queueFollowUp',queue=method==='steer'?'_steeringMessages':'_followUpMessages';
    change(`async ${queueMethod}(text,images){this.${queue}.push(text)`,`async ${queueMethod}(text,images,cite){this.${queue}.push(cite?.wire??text)`);
    change(`this.agent.${method}({role:"user",content,timestamp:Date.now()})`,`this.agent.${method}(revuBind({role:"user",content,timestamp:Date.now()},cite))`);
    change(`this.${queueMethod}(expandedText,processedInput.images)`,`this.${queueMethod}(expandedText,processedInput.images,cite)`);
    change(`this.${queueMethod}(expandedText,currentImages)`,`this.${queueMethod}(expandedText,currentImages,options?.revuCite)`);
    const drain=`this.${method==='steer'?'steering':'followUp'}Queue.drain()`;
    if(source.split(drain).length!==3)throw new Error('Unexpected Pi queue drain layout');
    source=source.replaceAll(drain,`revuExpand(${drain})`);
  }
  change('async _queueUserInput(text,images,behavior,source){','async _queueUserInput(text,images,behavior,source,cite){');
  change('prompt:expandedText,images:currentImages},()=>preflightResult','prompt:expandedText,images:currentImages,revuCite:options?.revuCite},()=>preflightResult');
  change('messages.push({role:"user",content:[{type:"text",text},...normalized.images],timestamp:Date.now()})','messages.push(...revuExpand([revuBind({role:"user",content:[{type:"text",text},...normalized.images],timestamp:Date.now()},trigger.revuCite)]))');
  change('let messageText=contentText(event.message.content,"");if(messageText)','let messageText=revuQueueKey(event.message)??contentText(event.message.content,"");if(messageText)');
  change('entryId&&this._entryIdsByMessage.set(event.message,entryId)','entryId&&(revuLink(event.message,entryId),this._entryIdsByMessage.set(event.message,entryId))');
  return 'import {bindCitation as revuBind,expandCitations as revuExpand,citationQueueKey as revuQueueKey,linkCitation as revuLink,withdrawInput as revuWithdraw,decodeInput as revuDecode} from "../../revu-cite.mjs";\n'+source;
}
