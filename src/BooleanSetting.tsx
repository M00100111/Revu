export default function BooleanSetting({label,description,value,onChange,disabled=false}:{
  label:string;description:string;value:boolean;onChange:(value:boolean)=>void;disabled?:boolean;
}){
  return <div className={'setting-row'+(disabled?' disabled':'')}>
    <span><strong>{label}</strong><small>{description}</small></span>
    <div className="setting-options" role="group" aria-label={label}>
      {[false,true].map(option=><button key={String(option)} type="button" disabled={disabled}
        data-option={option?'on':'off'} aria-pressed={value===option} className={value===option?'active':''} onClick={()=>onChange(option)}>
        {option?'On':'Off'}
      </button>)}
    </div>
  </div>;
}
