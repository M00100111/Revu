import { useCallback, useEffect, useRef, useState } from 'react';
import { monaco, type OpenFile } from './editor';
import { errorMessage, writeFile } from './files';
import EditorArea from './EditorArea';
import FileTree from './FileTree';
import Icon from './Icon';
import Sidebar from './Sidebar';
import TabBar from './TabBar';

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('revu-theme') === 'dark');
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const filesRef = useRef(files);
  const generation = useRef(0);
  const opening = useRef(new Set<string>());
  const savingRef = useRef(false);
  filesRef.current = files;
  const activeFile = files.find(file => file.path === activePath);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('revu-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (filesRef.current.some(file => file.dirty)) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const save = useCallback(async () => {
    if (!activeFile || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const text = activeFile.model.getValue();
    const version = activeFile.model.getAlternativeVersionId();
    try {
      await writeFile(activeFile.handle, text);
      if (!activeFile.model.isDisposed()) {
        activeFile.savedVersion = version;
        activeFile.dirty = activeFile.model.getAlternativeVersionId() !== version;
        setFiles(current => [...current]);
      }
    } catch (error) {
      setError('保存失败：' + errorMessage(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [activeFile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [save]);

  async function openFolder() {
    if (savingRef.current) return;
    try {
      const selected = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (filesRef.current.some(file => file.dirty) &&
          !window.confirm('存在未保存的修改。放弃修改并打开其他文件夹？')) return;
      generation.current += 1;
      opening.current.clear();
      editorRef.current?.setModel(null);
      for (const file of filesRef.current) {
        file.subscription.dispose();
        file.model.dispose();
      }
      filesRef.current = [];
      setFiles([]);
      setActivePath(null);
      setDirectory(selected);
      setExplorerVisible(true);
      setError('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setError('打开文件夹失败：' + errorMessage(error));
    }
  }

  async function openFile(handle: FileSystemFileHandle, path: string) {
    if (filesRef.current.some(file => file.path === path)) {
      setActivePath(path);
      return;
    }
    if (opening.current.has(path)) return;
    opening.current.add(path);
    const currentGeneration = generation.current;
    try {
      const text = await (await handle.getFile()).text();
      if (currentGeneration !== generation.current) return;
      const uri = monaco.Uri.from({ scheme: 'file', path: '/workspace-' + currentGeneration + '/' + path });
      const model = monaco.editor.createModel(text, undefined, uri);
      const file: OpenFile = {
        path, handle, model, savedVersion: model.getAlternativeVersionId(), dirty: false,
        subscription: model.onDidChangeContent(() => {
          const dirty = model.getAlternativeVersionId() !== file.savedVersion;
          if (dirty !== file.dirty) {
            file.dirty = dirty;
            setFiles(current => [...current]);
          }
        }),
      };
      filesRef.current = [...filesRef.current, file];
      setFiles(filesRef.current);
      setActivePath(path);
      setError('');
    } catch (error) {
      if (currentGeneration === generation.current) setError('打开文件失败：' + errorMessage(error));
    } finally {
      if (currentGeneration === generation.current) opening.current.delete(path);
    }
  }

  function closeFile(file: OpenFile) {
    if (savingRef.current) return;
    if (file.dirty && !window.confirm(file.handle.name + ' 有未保存的修改，确定放弃并关闭？')) return;
    const remaining = files.filter(item => item !== file);
    if (activePath === file.path) {
      editorRef.current?.setModel(null);
      const index = files.indexOf(file);
      setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null);
    }
    file.subscription.dispose();
    file.model.dispose();
    filesRef.current = remaining;
    setFiles(remaining);
  }

  return <div className="app">
    <Sidebar explorerVisible={explorerVisible} toggleExplorer={() => setExplorerVisible(!explorerVisible)}
      dark={dark} toggleTheme={() => setDark(!dark)} />
    {explorerVisible && <aside className="explorer">
      <header className="explorer-header"><span>文件</span>
        <button className="icon-button" onClick={openFolder} disabled={saving}
          title="打开文件夹" aria-label="打开文件夹"><Icon name="folder" size={17} /></button>
      </header>
      {directory ? <>
        <div className="workspace-name" title={directory.name}>{directory.name}</div>
        <div className="tree-scroll"><FileTree key={generation.current} directory={directory}
          activePath={activePath} onOpen={openFile} onError={setError} /></div>
      </> : <div className="explorer-empty">尚未打开文件夹</div>}
      <footer className="explorer-footer">REVU <span>轻量编辑器</span></footer>
    </aside>}
    <main className="main">
      {error && <div className="error-banner" role="alert"><span>{error}</span>
        <button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>
          <Icon name="close" size={14} /></button></div>}
      {activeFile ? <>
        <TabBar files={files} activePath={activeFile.path} onSelect={setActivePath}
          onClose={closeFile} onSave={save} saving={saving} />
        <div className="breadcrumb"><span>{directory?.name}</span><span>/</span><span>{activeFile.path}</span></div>
        <div className="editor-container"><EditorArea file={activeFile} dark={dark} editorRef={editorRef} /></div>
        <footer className="status-bar"><span>{activeFile.dirty ? '未保存' : '已保存'}</span>
          <span>{activeFile.model.getLanguageId()}<span className="status-divider">UTF-8</span></span></footer>
      </> : <div className="empty-state">
        <button className="open-folder-button" onClick={openFolder}><Icon name="folder" size={19} />打开文件夹</button>
        <div className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>S</kbd><span>保存</span><i />
          <kbd>Ctrl</kbd> + <kbd>F</kbd><span>查找</span></div>
      </div>}
    </main>
  </div>;
}