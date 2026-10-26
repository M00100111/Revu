import { useCallback, useEffect, useRef, useState } from 'react';
import { monaco, type OpenFile, type Project } from './editor';
import { errorMessage, writeFile } from './files';
import EditorArea from './EditorArea';
import FileTree from './FileTree';
import Icon from './Icon';
import Sidebar from './Sidebar';
import TabBar from './TabBar';

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('revu-theme') === 'dark');
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mixed, setMixed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const filesRef = useRef(files);
  const lastFile = useRef(new Map<string, string>());
  const opening = useRef(new Set<string>());
  const savingRef = useRef(false);
  filesRef.current = files;
  const activeFile = files.find(file => file.id === activeId);
  const visibleFiles = mixed ? files : files.filter(file => file.project.id === projectId);

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

  function selectFile(file: OpenFile) {
    lastFile.current.set(file.project.id, file.id);
    setProjectId(file.project.id);
    setActiveId(file.id);
  }

  function selectProject(id: string) {
    setProjectId(id);
    const remembered = lastFile.current.get(id);
    const file = filesRef.current.find(file => file.id === remembered)
      ?? filesRef.current.find(file => file.project.id === id);
    setActiveId(file?.id ?? null);
  }

  function toggleMode() {
    if (!mixed && !activeFile && files.length) selectFile(files[0]);
    setMixed(!mixed);
  }

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

  async function addFolder() {
    if (picking) return;
    setPicking(true);
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const project of projects) {
        if (await project.handle.isSameEntry(handle)) {
          selectProject(project.id);
          setExplorerVisible(true);
          setError('');
          return;
        }
      }
      const names = new Set(projects.map(project => project.name));
      let name = handle.name;
      for (let suffix = 2; names.has(name); suffix++) name = handle.name + ' (' + suffix + ')';
      const project: Project = { id: crypto.randomUUID(), name, handle };
      setProjects(current => [...current, project]);
      // Adding a project must not discard existing documents or their undo history.
      if (!mixed || !activeFile) {
        setProjectId(project.id);
        setActiveId(null);
      }
      setExplorerVisible(true);
      setError('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setError('添加文件夹失败：' + errorMessage(error));
    } finally {
      setPicking(false);
    }
  }

  async function openFile(project: Project, handle: FileSystemFileHandle, path: string) {
    const id = project.id + '/' + path;
    const existing = filesRef.current.find(file => file.id === id);
    if (existing) {
      selectFile(existing);
      return;
    }
    if (opening.current.has(id)) return;
    opening.current.add(id);
    try {
      const text = await (await handle.getFile()).text();
      const uri = monaco.Uri.from({ scheme: 'file', path: '/' + id });
      const model = monaco.editor.createModel(text, undefined, uri);
      const file: OpenFile = {
        id, project, path, handle, model, savedVersion: model.getAlternativeVersionId(), dirty: false,
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
      selectFile(file);
      setError('');
    } catch (error) {
      setError('打开文件失败：' + errorMessage(error));
    } finally {
      opening.current.delete(id);
    }
  }

  function closeFile(file: OpenFile) {
    if (savingRef.current) return;
    if (file.dirty && !window.confirm(file.project.name + '/' + file.path + ' 有未保存的修改，确定放弃并关闭？')) return;
    const remaining = files.filter(item => item !== file);
    if (lastFile.current.get(file.project.id) === file.id) {
      const sibling = remaining.find(item => item.project.id === file.project.id);
      if (sibling) lastFile.current.set(file.project.id, sibling.id);
      else lastFile.current.delete(file.project.id);
    }
    if (activeId === file.id) {
      editorRef.current?.setModel(null);
      const candidates = visibleFiles.filter(item => item !== file);
      const next = candidates[Math.min(visibleFiles.indexOf(file), candidates.length - 1)];
      if (next) selectFile(next);
      else setActiveId(null);
    }
    file.subscription.dispose();
    file.model.dispose();
    filesRef.current = remaining;
    setFiles(remaining);
  }

  const modeButton = <button className="mode-button" onClick={toggleMode}
    aria-label={mixed ? '切换为隔离模式' : '切换为混合模式'}
    title={mixed ? '切换为隔离模式：按项目显示标签' : '切换为混合模式：显示所有文件标签'}>
    {mixed ? '混合' : '隔离'}
  </button>;

  return <div className="app">
    <Sidebar explorerVisible={explorerVisible} toggleExplorer={() => setExplorerVisible(!explorerVisible)}
      dark={dark} toggleTheme={() => setDark(!dark)} />
    {explorerVisible && <aside className="explorer">
      <header className="explorer-header"><span>文件</span>
        <button className="icon-button" onClick={addFolder} disabled={picking}
          title="添加文件夹" aria-label="添加文件夹"><Icon name="folder" size={17} /></button>
      </header>
      {projects.length ? <div className="tree-scroll">
        {projects.map(project => <details className="project-tree" key={project.id} open>
          <summary className="workspace-name" title={project.name}>
            <Icon name="chevron" size={12} /><Icon name="folder" size={15} /><span>{project.name}</span>
          </summary>
          <FileTree directory={project.handle}
            activePath={activeFile?.project.id === project.id ? activeFile.path : null}
            onOpen={(handle, path) => openFile(project, handle, path)} onError={setError} />
        </details>)}
      </div> : <div className="explorer-empty">尚未打开文件夹</div>}
      <footer className="explorer-footer">REVU <span>轻量编辑器</span></footer>
    </aside>}
    <main className="main">
      {error && <div className="error-banner" role="alert"><span>{error}</span>
        <button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>
          <Icon name="close" size={14} /></button></div>}
      {projects.length > 0 && <>
        {!mixed && <div className="project-bar">
          <div className="project-tabs" aria-label="项目标签">
            {projects.map(project => <button key={project.id}
              className={'project-tab ' + (project.id === projectId ? 'active' : '')}
              aria-pressed={project.id === projectId} onClick={() => selectProject(project.id)}>
              <Icon name="folder" size={14} /><span>{project.name}</span>
              {files.some(file => file.project.id === project.id && file.dirty) && <span className="dirty-dot" />}
            </button>)}
          </div>
          {modeButton}
        </div>}
        <TabBar files={visibleFiles} activeId={activeId} onSelect={selectFile}
          onClose={closeFile} onSave={save} saving={saving} mixed={mixed}
          modeButton={mixed ? modeButton : undefined} />
      </>}
      {activeFile ? <>
        <div className="breadcrumb"><span>{activeFile.project.name}</span><span>/</span><span>{activeFile.path}</span></div>
        <div className="editor-container"><EditorArea file={activeFile} dark={dark} editorRef={editorRef} /></div>
        <footer className="status-bar"><span>{activeFile.dirty ? '未保存' : '已保存'}</span>
          <span>{activeFile.model.getLanguageId()}<span className="status-divider">UTF-8</span></span></footer>
      </> : <div className="empty-state">
        {projects.length ? <span className="empty-project-hint">从左侧选择文件开始编辑</span>
          : <button className="open-folder-button" onClick={addFolder} disabled={picking}>
              <Icon name="folder" size={19} />打开文件夹</button>}
        <div className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>S</kbd><span>保存</span><i />
          <kbd>Ctrl</kbd> + <kbd>F</kbd><span>查找</span></div>
      </div>}
    </main>
  </div>;
}