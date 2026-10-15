import { FileText, Blocks, PanelRightClose, Save, Trash2, LoaderCircle } from 'lucide-react';
import { Editor } from './Editor';
import type { Environment, Compatibility } from '../lib/types';
import { compatibilityLabel } from '../lib/types';
import type { Creation } from '../lib/workspace';

export function CreatePanel({ draft, environments, location, busy, onChange, onCreate, onClose, onDiscard, onOpenExisting }: {
  draft: Creation; environments: Environment[]; location: string; busy: boolean;
  onChange: (patch: Partial<Creation>) => void; onCreate: () => void; onClose: () => void;
  onDiscard: () => void; onOpenExisting: (id: string) => void;
}) {
  const environment = environments.find((item) => item.id === draft.target);
  const targets = environments.filter((item) => !item.readOnly && (draft.location === 'global' ? item.scope === 'global' : `project:${item.projectId}` === draft.location));
  return <aside className="resource-editor create-panel" aria-label="新建资源编辑器">
    <header className="editor-header"><div className="resource-type-icon">{draft.kind === 'skill' ? <Blocks size={20} /> : <FileText size={20} />}</div>
      <div className="editor-heading"><strong>新建{draft.kind === 'skill' ? '技能' : '规则'}</strong><span>{location}</span></div>
      <button className="icon-button" aria-label="关闭新建面板" onClick={onClose}><PanelRightClose size={18} /></button>
    </header>
    <div className="create-fields">
      {draft.location !== 'library' ? <label className="field">目标工具<select value={draft.target} disabled={busy} onChange={(event) => onChange({ target: event.target.value })}>
        <option value="" disabled>请选择 Claude 或 Codex</option>{targets.map((item) => <option key={item.id} value={item.id}>{compatibilityLabel[item.tool]}</option>)}
      </select></label> : <label className="field">适用工具<select value={draft.compatibility} disabled={busy} onChange={(event) => onChange({ compatibility: event.target.value as Compatibility })}>
        {Object.entries(compatibilityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
      <div className="creation-target"><span>写入位置</span><code>{draft.location === 'library' ? 'SkillDock 资源库' : environment ? draft.kind === 'skill' ? environment.skillsRoot : environment.rulesRoot ?? environment.instructionFiles.join(' / ') : '选择目标工具后显示目录'}</code></div>
      <label className="field">{draft.kind === 'skill' ? '技能标识' : '规则名称'}<input value={draft.name} disabled={busy} onChange={(event) => onChange({ name: event.target.value })} placeholder={draft.kind === 'skill' ? '例如 code-review' : '例如 编码规范'} /></label>
      {draft.kind === 'skill' && <label className="field">触发说明<input aria-label="触发说明" value={draft.description} disabled={busy} onChange={(event) => onChange({ description: event.target.value })} placeholder="何时使用这个技能" /><small>标识使用小写字母、数字与连字符；自动生成 SKILL.md 元数据。</small></label>}
      {draft.kind === 'rule' && environment?.tool === 'codex' && <p className="form-hint">写入 AGENTS.md；已有非空 AGENTS.override.md 时按现有规则处理。同名文件不会覆盖。</p>}
      {draft.error && <div className="inline-error" role="alert">{draft.error}{draft.existingId && <button className="button small secondary" onClick={() => onOpenExisting(draft.existingId!)}>打开已有资源</button>}</div>}
    </div>
    <div className="file-toolbar"><span>{draft.kind === 'skill' ? '技能指令' : '规则内容'}</span></div>
    <Editor value={draft.body} onChange={(body) => onChange({ body })} readOnly={busy} label={draft.kind === 'skill' ? '技能指令' : '规则内容'} />
    <footer className="editor-footer"><button className="button small quiet-button" onClick={onDiscard} disabled={busy}><Trash2 size={14} /> 放弃新建</button>
      <button className="button primary push-right" onClick={onCreate} disabled={busy || !draft.target || !draft.name.trim() || !draft.body.trim() || (draft.kind === 'skill' && !draft.description.trim())}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} 创建
      </button></footer>
  </aside>;
}
