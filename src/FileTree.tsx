import { useEffect, useState } from 'react';
import { errorMessage, readDirectory } from './files';
import Icon from './Icon';
type Props = {
  directory: FileSystemDirectoryHandle;
  activePath: string | null;
  onOpen: (handle: FileSystemFileHandle, path: string) => void;
  onError: (message: string) => void;
  path?: string;
  depth?: number;
};
export default function FileTree({ directory, activePath, onOpen, onError, path = '', depth = 0 }: Props) {
  const [entries, setEntries] = useState<FileSystemHandle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readDirectory(directory).then(items => {
      if (!cancelled) { setEntries(items); setLoaded(true); }
    }).catch(error => {
      if (!cancelled) { setFailed(true); onError('读取目录失败：' + errorMessage(error)); }
    });
    return () => { cancelled = true; };
  }, [directory, onError]);
  return <ul className="file-tree">
    {!loaded && !failed && <li className="tree-note">读取中…</li>}
    {failed && <li className="tree-note">读取失败</li>}
    {loaded && !entries.length && <li className="tree-note">空文件夹</li>}
    {entries.map(entry => {
      const entryPath = path ? path + '/' + entry.name : entry.name;
      return entry.kind === 'directory'
        ? <Directory key={entry.name} directory={entry as FileSystemDirectoryHandle}
            path={entryPath} depth={depth} activePath={activePath} onOpen={onOpen} onError={onError} />
        : <li key={entry.name}>
            <button className={'tree-row ' + (activePath === entryPath ? 'active' : '')}
              style={{ paddingLeft: 16 + depth * 14 }} title={entryPath}
              onClick={() => onOpen(entry as FileSystemFileHandle, entryPath)}>
              <Icon name="file" size={15} /><span>{entry.name}</span>
            </button>
          </li>;
    })}
  </ul>;
}
function Directory(props: Props & { path: string; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  return <li>
    <button className="tree-row directory-row" style={{ paddingLeft: 8 + props.depth * 14 }}
      aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <Icon name="chevron" size={12} style={{ transform: expanded ? 'rotate(90deg)' : undefined }} />
      <Icon name="folder" size={15} /><span>{props.directory.name}</span>
    </button>
    {expanded && <FileTree {...props} depth={props.depth + 1} />}
  </li>;
}