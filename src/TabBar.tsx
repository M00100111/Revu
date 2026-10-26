import type { OpenFile } from './editor';
import Icon from './Icon';
export default function TabBar({ files, activePath, onSelect, onClose, onSave, saving }: {
  files: OpenFile[]; activePath: string; onSelect: (path: string) => void;
  onClose: (file: OpenFile) => void; onSave: () => void; saving: boolean;
}) {
  return <div className="tab-bar">
    <div className="tabs" aria-label="已打开的文件">
      {files.map(file => <div key={file.path} className={'tab ' + (file.path === activePath ? 'active' : '')}>
        <button className="tab-select" title={file.path} aria-pressed={file.path === activePath}
          onClick={() => onSelect(file.path)}>
          <Icon name="file" size={14} /><span>{file.handle.name}</span>
        </button>
        <button className={'tab-close ' + (file.dirty ? 'dirty' : '')}
          aria-label={'关闭 ' + file.handle.name + (file.dirty ? '（未保存）' : '')}
          title={file.dirty ? '未保存 · 关闭文件' : '关闭文件'} onClick={() => onClose(file)}>
          {file.dirty && <span className="dirty-dot" />}<Icon name="close" size={12} />
        </button>
      </div>)}
    </div>
    <button className="save-button" aria-label="保存文件" title="保存文件 · Ctrl+S"
      disabled={saving} onClick={onSave}><Icon name="save" size={16} /><span>{saving ? '保存中' : '保存'}</span></button>
  </div>;
}