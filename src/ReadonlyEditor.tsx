import Editor from '@monaco-editor/react';
import { useEffect, type MutableRefObject } from 'react';
import { monaco } from './editor';

const EDITOR_FONT="'Cascadia Code', Consolas, 'Courier New', monospace";

export default function ReadonlyEditor({model,dark,editorRef,fontSize}:{
  model:monaco.editor.ITextModel;dark:boolean;
  editorRef:MutableRefObject<monaco.editor.IStandaloneCodeEditor|null>;fontSize:number;
}){
  const lineHeight=Math.round(fontSize*12/7);
  useEffect(()=>()=>{editorRef.current=null;},[editorRef]);
  return <Editor path={model.uri.toString()} theme={dark?'revu-dark':'revu-light'} keepCurrentModel saveViewState
    onMount={instance=>{editorRef.current=instance;}}
    loading={<div className="editor-loading">Opening editor…</div>}
    options={{
      automaticLayout:true,readOnly:true,readOnlyMessage:{value:'Tool details are read-only.'},
      fontFamily:EDITOR_FONT,fontSize,lineHeight,padding:{top:0,bottom:24},minimap:{enabled:false},
      scrollBeyondLastLine:false,smoothScrolling:true,renderLineHighlight:'line',
      overviewRulerLanes:0,hideCursorInOverviewRuler:true,lineNumbersMinChars:4,
      wordWrap:'off',tabSize:2,insertSpaces:true,renderWhitespace:'selection',
    }}/>
}
