import Editor from '@monaco-editor/react';
import { useEffect, type MutableRefObject } from 'react';
import { monaco, type OpenFile } from './editor';
export default function EditorArea({ file, dark, editorRef }: {
  file: OpenFile; dark: boolean;
  editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>;
}) {
  useEffect(() => () => { editorRef.current = null; }, [editorRef]);
  return <Editor path={file.model.uri.toString()} theme={dark ? 'revu-dark' : 'revu-light'}
    keepCurrentModel saveViewState
    onMount={editor => { editorRef.current = editor; }}
    loading={<div className="editor-loading">正在打开编辑器…</div>}
    options={{
      automaticLayout: true,
      fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: 14, lineHeight: 24, padding: { top: 0, bottom: 24 },
      minimap: { enabled: false }, scrollBeyondLastLine: false, smoothScrolling: true,
      renderLineHighlight: 'line', overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
      lineNumbersMinChars: 4, glyphMargin: false, folding: true, tabSize: 2,
      stickyScroll: { enabled: false },
      wordWrap: file.model.getLanguageId() === 'markdown' ? 'on' : 'off',
    }}
  />;
}