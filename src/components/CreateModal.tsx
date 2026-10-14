import { useState } from 'react';
import { Blocks, FileText, LoaderCircle, ArrowRight } from 'lucide-react';
import { Modal } from './Modal';
import type { Compatibility, CreateInput, Environment, Kind } from '../lib/types';
import { compatibilityLabel } from '../lib/types';

export function CreateModal({ environments, initialTarget, initialKind, busy, error, onSubmit, onClose }: {
  environments: Environment[]; initialTarget: string; initialKind: Kind; busy: boolean; error: string | null;
  onSubmit: (input: CreateInput) => void; onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [target, setTarget] = useState(initialTarget);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [compatibility, setCompatibility] = useState<Compatibility>('both');
  const environment = environments.find((item) => item.id === target);
  const codexRule = kind === 'rule' && environment?.tool === 'codex';
  const submit = () => {
    const content = kind === 'skill'
      ? ['---', 'name: ' + name.trim(), 'description: ' + JSON.stringify(description.trim()), '---', '', body].join('\n')
      : body;
    onSubmit({ target, kind, name: name.trim(), compatibility, content });
  };
  return <Modal title="创建新资源" subtitle="为常用任务建立技能，或为工作方式写一条规则。" onClose={onClose} busy={busy}>
    <div className="modal-body">
      <div className="kind-picker">
        <button type="button" className={kind === 'skill' ? 'selected' : ''} onClick={() => setKind('skill')} disabled={busy}>
          <Blocks size={21} /><span><strong>技能</strong><small>按需调用的流程与知识</small></span>
        </button>
        <button type="button" className={kind === 'rule' ? 'selected' : ''} onClick={() => setKind('rule')} disabled={busy}>
          <FileText size={21} /><span><strong>规则</strong><small>持续生效的行为与编码约定</small></span>
        </button>
      </div>
      <label className="field">创建位置
        <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}>
          <option value="library">SkillDock 资源库</option>
          {environments.filter((item) => !item.readOnly).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="form-grid">
        <label className="field">{kind === 'skill' ? '技能标识' : '规则名称'}
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'skill' ? '例如 code-review' : '例如 编码规范'} disabled={busy} />
        </label>
        {target === 'library' && <label className="field">适用工具
          <select value={compatibility} onChange={(event) => setCompatibility(event.target.value as Compatibility)} disabled={busy}>
            {Object.entries(compatibilityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
      </div>
      {kind === 'skill' && <label className="field">触发说明
        <input aria-label="触发说明" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="描述何时使用此技能，例如：审查代码时使用" disabled={busy} />
        <small>标识使用小写字母、数字和连字符；将生成带 YAML 元数据的 SKILL.md。</small>
      </label>}
      {codexRule && <p className="form-hint">Codex 的行为规则写入 AGENTS.md；已有文件请从本地配置列表打开编辑。</p>}
      <label className="field">{kind === 'skill' ? '技能指令' : '规则内容'}
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={9}
          placeholder={kind === 'skill' ? '# 执行步骤\n\n1. 阅读相关代码\n2. 找出问题并说明原因' : '# 工作约定\n\n- 修改代码后运行相关测试\n- 优先使用项目已有的工具'} disabled={busy} />
      </label>
      {target !== 'library' && <p className="form-hint">本地配置会直接写入所选工具的目录；下一步会显示确切路径和差异。</p>}
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
    <footer className="modal-footer">
      <button className="button secondary" onClick={onClose} disabled={busy}>取消</button>
      <button className="button primary" onClick={submit} disabled={busy || !name.trim() || (kind === 'skill' && !description.trim()) || !body.trim()}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} 预览创建
      </button>
    </footer>
  </Modal>;
}
