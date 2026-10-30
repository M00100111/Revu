import type { ReactNode } from 'react';
import type { OpenFile } from './editor';
import Icon from './Icon';
export default function TabBar({ files, activeId, onSelect, onClose, onSave, saving, mixed, modeButton }: {
  files: OpenFile[]; activeId: string | null; onSelect: (file: OpenFile) => void;
  onClose: (file: OpenFile) => void; onSave: () => void; saving: boolean;
  mixed: boolean; modeButton?: ReactNode;
}) {
  return <div className="tab-bar">
    <div className="tabs" aria-label="Open files">
      {files.map(file => <div key={file.id} className={'tab ' + (file.id === activeId ? 'active' : '')}>
        <button className="tab-select" title={file.project.name + '/' + file.path}
          aria-pressed={file.id === activeId} onClick={() => onSelect(file)}>
          <Icon name="file" size={14} /><span>{file.name}</span>
          {mixed && <small className="tab-project">{file.project.name}</small>}
        </button>
        <button className={'tab-close ' + (file.dirty ? 'dirty' : '')}
          aria-label={'Close ' + file.project.name + '/' + file.path + (file.dirty ? ' (unsaved)' : '')}
          title={file.dirty ? 'Unsaved · Close file' : 'Close file'} onClick={() => onClose(file)}>
          {file.dirty && <span className="dirty-dot" />}<Icon name="close" size={12} />
        </button>
      </div>)}
    </div>
    <button className="save-button" aria-label="Save file" title="Save file · Ctrl+S"
      disabled={saving || !activeId} onClick={onSave}>
      <Icon name="save" size={16} /><span>{saving ? 'Saving' : 'Save'}</span>
    </button>
    {modeButton}
  </div>;
}
