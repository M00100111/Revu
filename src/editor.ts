import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new JsonWorker();
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
    if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
    if (['typescript', 'javascript'].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });
monaco.editor.defineTheme('revu-light', {
  base: 'vs', inherit: true, rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editorLineNumber.foreground': '#b0b0b0',
    'editorLineNumber.activeForeground': '#333333',
    'editor.lineHighlightBackground': '#f7f7f7',
    'editor.selectionBackground': '#e1e1e1',
  },
});
monaco.editor.defineTheme('revu-dark', {
  base: 'vs-dark', inherit: true, rules: [],
  colors: {
    'editor.background': '#191919',
    'editorLineNumber.foreground': '#606060',
    'editorLineNumber.activeForeground': '#dddddd',
    'editor.lineHighlightBackground': '#202020',
    'editor.selectionBackground': '#3d3d3d',
  },
});
export { monaco };
export interface OpenFile {
  path: string;
  handle: FileSystemFileHandle;
  model: monaco.editor.ITextModel;
  savedVersion: number;
  dirty: boolean;
  subscription: monaco.IDisposable;
}