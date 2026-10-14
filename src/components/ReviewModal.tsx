import { diffLines } from 'diff';
import { ArrowRight, Check, FileText, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import type { ChangePreview } from '../lib/types';
import { actionLabel } from '../lib/types';

export function ReviewModal({ preview, busy, error, onApply, onClose }: {
  preview: ChangePreview; busy: boolean; error: string | null; onApply: () => void; onClose: () => void;
}) {
  const diff = diffLines(preview.beforeContent, preview.afterContent);
  const destructive = preview.removesResource;
  return <Modal title="确认本次变更" subtitle="查看差异后再写入。操作前会保存完整备份。" onClose={onClose} wide busy={busy}>
    <div className="review-meta">
      <span className={'badge ' + (destructive ? 'badge-red' : 'badge-teal')}>{actionLabel[preview.action] ?? preview.action}</span>
      <strong>{preview.name}</strong>
      <span className="muted">{preview.changedFiles.length} 个文件变更</span>
    </div>
    <div className="target-path"><FileText size={15} /><code>{preview.targetPath}</code></div>
    <div className="diff-heading"><span>操作前</span><ArrowRight size={15} /><span>操作后</span></div>
    <div className="diff-view" aria-label="变更差异">
      {diff.length === 0 && <p className="muted diff-empty">主文件内容未变化；本次更新元数据或附属文件。</p>}
      {diff.map((part, index) => <div key={index} className={'diff-part ' + (part.added ? 'diff-added' : part.removed ? 'diff-removed' : '')}>
        {part.value.split('\n').filter((line, row, lines) => row < lines.length - 1 || line !== '').map((line, row) =>
          <div className="diff-line" key={row}><span>{part.added ? '+' : part.removed ? '−' : ' '}</span><code>{line || ' '}</code></div>)}
      </div>)}
    </div>
    {preview.changedFiles.length > 1 && <div className="changed-files"><span className="eyebrow">完整文件清单</span><p>{preview.changedFiles.join(' · ')}</p></div>}
    <div className="review-notes">
      <p><ShieldCheck size={15} /> 校验文件状态 · 保存备份 · 写入并回读验证</p>
      {preview.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
      {preview.action === 'restore' && preview.removesResource && <p className="warning-text">此恢复会撤销创建，并移除当前资源及附属文件。</p>}
    </div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <footer className="modal-footer">
      <button className="button secondary" disabled={busy} onClick={onClose}>返回编辑</button>
      <button className={'button ' + (destructive ? 'danger' : 'primary')} disabled={busy || !!error} onClick={onApply}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
        {busy ? '正在应用…' : '确认' + (actionLabel[preview.action] ?? '应用')}
      </button>
    </footer>
  </Modal>;
}
