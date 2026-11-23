import BooleanSetting from './BooleanSetting';
import {useState} from 'react';

const buttons=[
  {id:'commands',label:'Commands',description:'Show the button for slash commands.'},
  {id:'mention',label:'Mention File or Folder',description:'Show the button for browsing @ references.'},
  {id:'choose-file',label:'Choose File',description:'Show the file picker button in the chat input.'},
  {id:'direct-bash',label:'Direct Bash',description:'Show the button for switching Bash modes.'},
] as const;
export type ChatToolbarButton=typeof buttons[number]['id'];
const storageKey=(id:ChatToolbarButton)=>'revu-show-chat-'+id;

export function useChatToolbarSettings(){
  const [hidden,setHidden]=useState(()=>new Set(buttons.filter(({id})=>localStorage.getItem(storageKey(id))==='false').map(({id})=>id)));
  const setVisible=(id:ChatToolbarButton,visible:boolean)=>{
    localStorage.setItem(storageKey(id),String(visible));
    setHidden(previous=>{
      const next=new Set(previous);
      if(visible)next.delete(id);else next.add(id);
      return next;
    });
  };
  return {hidden,setVisible};
}

export function ChatToolbarSettings({hidden,setVisible}:ReturnType<typeof useChatToolbarSettings>){
  return <section className="chat-toolbar-settings" aria-label="Input toolbar">
    <h2>Input toolbar</h2>
    {buttons.map(({id,label,description})=><BooleanSetting key={id} label={label} description={description}
      value={!hidden.has(id)} onChange={visible=>setVisible(id,visible)}/>)}
  </section>;
}
