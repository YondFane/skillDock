import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { FileText, Blocks, RefreshCw, PanelRightClose, Save, Trash2, Copy, Upload, LockKeyhole, LoaderCircle, MoreHorizontal, GitCompareArrows } from 'lucide-react';
import { Editor, type EditorPosition } from './Editor';
import { DiffView } from './DiffView';
import { api } from '../lib/api';
import { compatibilityLabel, errorMessage, formatDate } from '../lib/types';
import type { Compatibility } from '../lib/types';
import { isDirty, type Draft } from '../lib/workspace';

export function ResourceEditor({ draft, disabled, loading, location, onChange, onSave, onDelete, onFile, onReload, onClose, onAdopt, onDiscard, onMessage, positions }: {
  draft: Draft; disabled: boolean; loading: boolean; location: string; onChange: (patch: Partial<Draft>) => void;
  onSave: () => void; onDelete: () => void; onFile: (path: string) => void; onReload: () => void;
  onClose: () => void; onAdopt: () => void; onDiscard: () => void; onMessage: (message: string) => void;
  positions: MutableRefObject<Record<string, EditorPosition>>;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [disk, setDisk] = useState<string | null>(null);
  const [diskError, setDiskError] = useState('');
  const [diskLoading, setDiskLoading] = useState(false);
  const request = useRef(0);
  const resource = draft.resource;
  const file = draft.files[draft.activeFile];
  const dirty = isDirty(draft);
  const saving = draft.status === 'saving';
  const locked = disabled || saving || !!draft.needsReload || loading;
  const readOnly = resource.readOnly || locked;
  const positionKey = `${resource.id}\0${draft.activeFile}`;
  const changed = Object.entries(draft.files).filter(([, file]) => file.base !== file.content);
  useEffect(() => {
    request.current += 1; setDisk(null); setDiskError(''); setDiskLoading(false);
    return () => { request.current += 1; };
  }, [resource.id, draft.activeFile, draft.fingerprint]);
  const compareDisk = async () => {
    const token = ++request.current; setDiskLoading(true); setDiskError('');
    try {
      const current = await api.detail(resource.id, draft.activeFile);
      if (token === request.current) setDisk(current.content);
    } catch (failure) { if (token === request.current) setDiskError(errorMessage(failure)); }
    finally { if (token === request.current) setDiskLoading(false); }
  };
  const copyPath = async () => {
    try { await navigator.clipboard.writeText(resource.path); onMessage('路径已复制'); }
    catch { onMessage('无法自动复制，请从资源详情中选择路径复制。'); }
  };
  return <aside className="resource-editor" aria-label="资源编辑器">
    <header className="editor-header">
      <div className="resource-type-icon">{resource.kind === 'skill' ? <Blocks size={20} /> : <FileText size={20} />}</div>
      <div className="editor-heading"><strong>{resource.name}</strong><span>{location} · {compatibilityLabel[resource.compatibility]}</span></div>
      <details className="action-menu"><summary aria-label="资源更多操作"><MoreHorizontal size={19} /></summary><div>
        <button disabled={locked} onClick={onReload}><RefreshCw size={14} /> 重新加载</button>
        {resource.origin === 'local' && <button disabled={locked || dirty} onClick={onAdopt}><Upload size={14} /> 收录到资源库</button>}
        {dirty && <button disabled={locked} onClick={onDiscard}>放弃修改</button>}
        <button className="text-danger" disabled={locked || dirty || resource.readOnly} onClick={onDelete}><Trash2 size={14} /> 删除资源</button>
      </div></details>
      <button className="icon-button" onClick={onClose} aria-label="关闭编辑器"><PanelRightClose size={18} /></button>
    </header>
    <div className="editor-context"><details className="resource-details"><summary>资源详情 {resource.readOnly && <span><LockKeyhole size={12} /> 只读</span>}</summary>
      <div className="editor-path"><code>{resource.path}</code><button className="icon-button" onClick={() => void copyPath()} aria-label="复制资源路径"><Copy size={13} /></button></div>
      <small>{draft.fileList.length} 个文件 · {formatDate(resource.updatedAt)}</small>
      {resource.origin === 'library' && <div className="form-grid editor-fields">
        <label className="field">名称<input aria-label="资源名称" value={draft.name} onChange={(event) => onChange({ name: event.target.value })} disabled={readOnly || resource.kind === 'skill'} /></label>
        <label className="field">适用工具<select aria-label="资源适用工具" value={draft.compatibility} onChange={(event) => onChange({ compatibility: event.target.value as Compatibility })} disabled={readOnly}>
          {Object.entries(compatibilityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>}
    </details>
    {resource.warnings.map((warning) => <p className="editor-warning compact-warning" key={warning}>{warning}</p>)}
    {draft.error && <div className="inline-error editor-error" role="alert">{draft.error}{draft.conflict && <button className="button small secondary" onClick={() => { setDiffOpen(true); void compareDisk(); }}>与磁盘比较</button>}</div>}
    </div>
    <div className="file-toolbar"><FileText size={14} /><label className="file-select"><span className="sr-only">当前资源文件</span>
      <select value={draft.activeFile} onChange={(event) => onFile(event.target.value)} disabled={disabled || saving || loading}>
        {draft.fileList.map((item) => <option key={item.path} value={item.path} disabled={!item.editable}>{item.path}{draft.files[item.path]?.base !== draft.files[item.path]?.content ? ' ●' : ''}</option>)}
      </select></label><button className={'button small ' + (diffOpen ? 'secondary' : 'quiet-button')} onClick={() => setDiffOpen(!diffOpen)}><GitCompareArrows size={14} />{diffOpen ? '继续编辑' : '查看差异'}</button>
    </div>
    {loading && <div className="file-loading" role="status"><LoaderCircle size={14} className="spin" /> 正在读取文件…</div>}
    {diffOpen ? <div className="resource-diff">
      <div className="diff-controls"><span>{disk === null ? '打开时内容 → 当前草稿' : '磁盘当前内容 → 当前草稿'}</span><button className="button small secondary" disabled={diskLoading} onClick={() => void compareDisk()}>与磁盘比较</button></div>
      {changed.length > 0 && <div className="draft-file-tabs">{changed.map(([path]) => <button className={path === draft.activeFile ? 'selected' : ''} key={path} onClick={() => onFile(path)}>{path}</button>)}</div>}
      {diskError && <p className="inline-error" role="alert">{diskError}</p>}
      {file && <DiffView before={disk ?? file.base} after={file.content} />}
      {(draft.name !== resource.name || draft.compatibility !== resource.compatibility) && <p className="metadata-diff">元数据：{resource.name} → {draft.name}；适用工具：{compatibilityLabel[resource.compatibility]} → {compatibilityLabel[draft.compatibility]}</p>}
    </div> : file && <Editor key={positionKey} value={file.content} filename={draft.activeFile} readOnly={readOnly}
      position={positions.current[positionKey]} onPosition={(position) => { positions.current[positionKey] = position; }}
      onChange={(content) => onChange({ files: { ...draft.files, [draft.activeFile]: { ...file, content } } })} />}
    <footer className="editor-footer"><div className="save-status" role="status">
      {saving ? '保存中…' : draft.needsReload ? '已保存，需重新加载' : draft.status === 'error' ? '保存失败' : draft.conflict ? '存在外部修改' : dirty ? '未保存' : '已保存'}
      <small>{resource.readOnly ? '只读文件' : dirty ? `${changed.length} 个文件待保存` : '修改前自动备份'}</small>
    </div><button className="button primary push-right" disabled={readOnly || !dirty || draft.conflict} onClick={onSave}>
      {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} 保存
    </button></footer>
  </aside>;
}
