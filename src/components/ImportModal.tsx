import { useState } from 'react';
import { FolderOpen, FileText, LoaderCircle, ArrowRight } from 'lucide-react';
import { Modal } from './Modal';
import { chooseFolder, chooseMarkdown } from '../lib/api';
import type { Compatibility } from '../lib/types';
import { compatibilityLabel, errorMessage } from '../lib/types';

export function ImportModal({ busy, error, onSubmit, onClose }: {
  busy: boolean; error: string | null; onSubmit: (path: string, compatibility: Compatibility) => void; onClose: () => void;
}) {
  const [path, setPath] = useState('');
  const [kind, setKind] = useState<'skill' | 'rule'>('skill');
  const [compatibility, setCompatibility] = useState<Compatibility>('both');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const browse = async () => {
    try {
      setPickerError(null);
      const selected = kind === 'skill' ? await chooseFolder('选择包含 SKILL.md 的技能目录') : await chooseMarkdown();
      if (selected) setPath(selected);
    } catch (error) { setPickerError(errorMessage(error)); }
  };
  return <Modal title="收录本地资源" subtitle="完整复制到资源库，不修改原文件，不执行脚本。" onClose={onClose} busy={busy}>
    <div className="modal-body">
      <div className="kind-picker">
        <button className={kind === 'skill' ? 'selected' : ''} onClick={() => { setKind('skill'); setPath(''); }} disabled={busy}><FolderOpen size={21} /><span><strong>技能目录</strong><small>SKILL.md 与全部附属文件</small></span></button>
        <button className={kind === 'rule' ? 'selected' : ''} onClick={() => { setKind('rule'); setPath(''); }} disabled={busy}><FileText size={21} /><span><strong>规则文件</strong><small>Markdown 行为与编码指令</small></span></button>
      </div>
      <label className="field">本地路径
        <div className="path-picker"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder={kind === 'skill' ? '选择包含 SKILL.md 的目录' : '选择 .md 文件'} disabled={busy} /><button className="button secondary" onClick={() => void browse()} disabled={busy}>浏览</button></div>
      </label>
      <label className="field">适用工具
        <select value={compatibility} onChange={(event) => setCompatibility(event.target.value as Compatibility)} disabled={busy}>
          {Object.entries(compatibilityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="form-hint">导入后保存到 SkillDock 资源库，原始文件保持原样。工具专有字段也会完整保留。</p>
      {(error || pickerError) && <div className="inline-error" role="alert">{error || pickerError}</div>}
    </div>
    <footer className="modal-footer"><button className="button secondary" onClick={onClose} disabled={busy}>取消</button>
      <button className="button primary" onClick={() => onSubmit(path, compatibility)} disabled={busy || !path.trim()}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} 收录到资源库
      </button>
    </footer>
  </Modal>;
}
