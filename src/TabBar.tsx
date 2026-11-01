import type { OpenFile } from './editor';
import Icon from './Icon';
export type TabContextAction='close'|'closeOthers'|'closeAll';
export default function TabBar({ files, activeId, onSelect, onClose, onContextAction, mixed }: {
  files: OpenFile[]; activeId: string | null; onSelect: (file: OpenFile) => void;
  onClose: (file: OpenFile) => void;onContextAction:(file:OpenFile,action:TabContextAction)=>void;
  mixed: boolean;
}) {
  return <div className="tab-bar">
    <div className="tabs" aria-label="Open files">
      {files.map(file => <div key={file.id} className={'tab ' + (file.id === activeId ? 'active' : '')}
        onContextMenu={async event=>{event.preventDefault();const action=await window.revu.contextMenu('tab');if(action)onContextAction(file,action);}}>
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
  </div>;
}
