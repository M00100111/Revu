import type { OpenFile } from './editor';
export default function ConflictPanel({file,onFinish}:{file:OpenFile;onFinish:()=>void}){
  if(!file.conflict)return null;
  return <section className="conflict-panel">
    <header><strong>External conflict</strong>
      <button onClick={onFinish} disabled={file.syncing||!file.conflict.exists||!!file.conflict.reason}>Complete Merge</button></header>
    <p>The latest disk content is shown below. Resolve the draft in the editor, then complete the merge and save.</p>
    {!file.conflict.exists?<p>The external file was deleted. The draft is preserved and cannot be written back.</p>
      :file.conflict.reason?<p>{file.conflict.reason}</p>:<pre>{file.conflict.text}</pre>}
  </section>;
}
