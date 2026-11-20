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
const mix=(base:string,target:number,amount:number)=>{
  const values=[1,3,5].map(index=>Number.parseInt(base.slice(index,index+2),16));
  return '#'+values.map(value=>Math.round(value*(1-amount)+target*amount).toString(16).padStart(2,'0')).join('');
};
export function defineRevuThemes(lightBackground='#FFFFFF',darkBackground='#191919'){
  monaco.editor.defineTheme('revu-light',{
    base:'vs',inherit:true,rules:[],colors:{
      'editor.background':lightBackground,
      'editorLineNumber.foreground':'#b0b0b0',
      'editorLineNumber.activeForeground':'#333333',
      'editor.lineHighlightBackground':mix(lightBackground,0,.0314),
      'editor.selectionBackground':mix(lightBackground,0,.1176),
    },
  });
  monaco.editor.defineTheme('revu-dark',{
    base:'vs-dark',inherit:true,rules:[],colors:{
      'editor.background':darkBackground,
      'editorLineNumber.foreground':'#606060',
      'editorLineNumber.activeForeground':'#dddddd',
      'editor.lineHighlightBackground':mix(darkBackground,255,.0304),
      'editor.selectionBackground':mix(darkBackground,255,.1565),
    },
  });
}
defineRevuThemes();
export { monaco };
export type { Project } from '../shared/types';
import type { Project, Snapshot, Chunk, ReviewRecord } from '../shared/types';
export interface OpenFile {
  id: string;
  project: Project;
  path: string;
  name: string;
  model: monaco.editor.ITextModel;
  subscription: monaco.IDisposable;
  synced: Snapshot;
  draftExists: boolean;
  baseline: string;
  baselineHash?: string;
  baselineExists: boolean;
  dirty: boolean;
  version: number;
  reviewText: string;
  chunks: Chunk[];
  records: ReviewRecord[];
  computing: boolean;
  syncing: boolean;
  saving: boolean;
  diffError: string;
  syncError?: string;
  reason?: string;
  notice: string;
}
