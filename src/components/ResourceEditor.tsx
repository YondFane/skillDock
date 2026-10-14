import { useEffect, useState } from 'react';
import { FileText, Blocks, RefreshCw, PanelRightClose, Save, Trash2, Copy, Upload, CircleCheck, LockKeyhole, LoaderCircle, ChevronDown } from 'lucide-react';
import { Editor } from './Editor';
import type { Compatibility, EditInput, ResourceDetail } from '../lib/types';
import { compatibilityLabel, formatDate } from '../lib/types';

export function ResourceEditor({ detail, busy, loading, onDirty, onSave, onDelete, onFile, onReload, onClose, onAdopt, onMessage }: {
  detail: ResourceDetail | null; busy: boolean; loading: boolean; onDirty: (dirty: boolean) => void;
  onSave: (input: EditInput) => void; onDelete: () => void; onFile: (path: string) => void; onReload: () => void;
  onClose: () => void; onAdopt: () => void; onMessage: (message: string) => void;
}) {
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [compatibility, setCompatibility] = useState<Compatibility>('both');
  useEffect(() => {
    if (detail) {
      setContent(detail.content); setName(detail.resource.name); setCompatibility(detail.resource.compatibility);
    }
  }, [detail]);
  const dirty = !!detail && (content !== detail.content || name !== detail.resource.name || compatibility !== detail.resource.compatibility);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const readonly = detail?.resource.readOnly ?? true;
  const resource = detail?.resource;
  const copyPath = async () => {
    if (!resource) return;
    try { await navigator.clipboard.writeText(resource.path); onMessage('路径已复制'); }
    catch { onMessage('当前系统无法复制，请从下方路径文本选择复制。'); }
  };
  return <aside className="resource-editor" aria-label="资源编辑器">
    <header className="editor-header">
      <div className={'resource-type-icon ' + (resource?.kind === 'rule' ? 'rule-icon' : '')}>
        {resource?.kind === 'rule' ? <FileText size={20} /> : <Blocks size={20} />}
      </div>
      <div className="editor-heading"><strong>{resource?.name ?? '正在读取资源'}</strong><span>{resource?.origin === 'library' ? '资源库文件' : '本地配置文件'}</span></div>
      <button className="icon-button" onClick={onClose} aria-label="关闭编辑器" disabled={busy}><PanelRightClose size={18} /></button>
    </header>
    {loading && <div className="editor-loading"><LoaderCircle size={22} className="spin" /><span>正在读取文件…</span></div>}
    {!loading && !detail && <div className="editor-loading"><span>文件读取失败，请重新扫描或打开其他资源。</span><button className="button secondary" onClick={onReload}>重新读取</button></div>}
    {detail && !loading && <>
      <div className="editor-meta">
        <div className="editor-labels">
          <span className={'badge ' + (resource!.kind === 'skill' ? 'badge-teal' : 'badge-violet')}>{resource!.kind === 'skill' ? 'SKILL' : 'RULE'}</span>
          <span className="badge badge-neutral">{compatibilityLabel[resource!.compatibility]}</span>
          {readonly ? <span className="badge badge-neutral"><LockKeyhole size={11} /> 只读</span> : dirty ? <span className="dirty-badge">● 未保存</span> : <span className="saved-badge"><CircleCheck size={12} /> 已读取</span>}
        </div>
        {resource!.origin === 'library' && <div className="form-grid editor-fields">
          <label className="field">名称<input aria-label="资源名称" value={name} onChange={(event) => setName(event.target.value)} disabled={readonly || resource!.kind === 'skill' || busy} /></label>
          <label className="field">适用工具<select aria-label="资源适用工具" value={compatibility} onChange={(event) => setCompatibility(event.target.value as Compatibility)} disabled={readonly || busy}>
            {Object.entries(compatibilityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>}
        <div className="editor-path"><code title={resource!.path}>{resource!.path}</code><button className="icon-button" onClick={() => void copyPath()} aria-label="复制资源路径"><Copy size={13} /></button></div>
        {resource!.warnings.map((warning) => <p className="editor-warning" key={warning}>{warning}</p>)}
      </div>
      <div className="file-toolbar">
        <FileText size={14} />
        <label className="file-select"><span className="sr-only">当前资源文件</span><select value={detail.relativePath} onChange={(event) => onFile(event.target.value)} disabled={busy}>
          {detail.files.map((file) => <option key={file.path} value={file.path} disabled={!file.editable && file.path !== detail.relativePath}>{file.path + (!file.editable ? ' · 不可编辑' : '')}</option>)}
        </select><ChevronDown size={13} /></label>
        <span className="muted">{detail.files.length} 个文件</span>
        <button className="icon-button" onClick={onReload} aria-label="重新读取当前文件" disabled={busy}><RefreshCw size={14} /></button>
      </div>
      <Editor value={content} onChange={setContent} readOnly={readonly || busy} filename={detail.relativePath} />
      <div className="editor-status"><span>UTF-8 · {content.length.toLocaleString()} 字符</span><span>{resource!.revision ? 'r' + resource!.revision + ' · ' : ''}{formatDate(resource!.updatedAt)}</span></div>
      <footer className="editor-footer">
        {resource!.origin === 'local' && <button className="button small secondary" onClick={onAdopt} disabled={busy || dirty || readonly}><Upload size={14} /> 导入资源库</button>}
        <button className="button small text-danger" onClick={onDelete} disabled={busy || readonly || dirty} title={dirty ? '请先保存或放弃当前修改' : '预览删除并保留备份'}><Trash2 size={14} /> 删除</button>
        <button className="button small primary push-right" disabled={busy || readonly || !dirty}
          onClick={() => onSave({ id: resource!.id, name, compatibility, relativePath: detail.relativePath, content, expectedFingerprint: detail.fingerprint })}>
          <Save size={14} /> 预览保存
        </button>
      </footer>
    </>}
  </aside>;
}
