import { useEffect, useState } from 'react';
import { FolderOpen, Plus, ArrowUpRight, Trash2, History, RotateCcw, Check, FolderKanban, LoaderCircle } from 'lucide-react';
import { chooseFolder } from '../lib/api';
import type { Operation, Project, Settings } from '../lib/types';
import { actionLabel, errorMessage, formatDate, statusLabel } from '../lib/types';

export function ProjectsPage({ projects, busy, onAdd, onRemove, onOpen, onError }: {
  projects: Project[]; busy: boolean; onAdd: (path: string) => void; onRemove: (id: string) => void;
  onOpen: (id: string) => void; onError: (message: string) => void;
}) {
  const add = async () => {
    try { const path = await chooseFolder('选择需要管理技能与规则的项目目录'); if (path) onAdd(path); }
    catch (error) { onError(errorMessage(error)); }
  };
  return <>
    <header className="page-heading"><div><span className="eyebrow">PROJECT WORKSPACES</span><h1>项目</h1><p>为每个项目保留自己的技能与工作约定。</p></div><button className="button primary" onClick={() => void add()} disabled={busy}><Plus size={16} /> 添加项目</button></header>
    <div className="page-content">
      <div className="info-strip"><FolderKanban size={18} /><p>添加项目后，即可管理该目录中的 Claude Code 与 Codex 配置。移除登记会保留项目文件。</p></div>
      {projects.length === 0 ? <div className="empty-state large-empty"><div className="empty-icon"><FolderOpen size={29} /></div><h3>从一个项目开始</h3><p>选择你正在开发的项目，发现它的技能和规则。</p><button className="button secondary" onClick={() => void add()} disabled={busy}><Plus size={15} /> 选择项目目录</button></div>
        : <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}>
          <div className="project-icon"><FolderOpen size={24} /></div><h3>{project.name}</h3><code>{project.path}</code>
          <div className="project-tools"><span className="badge badge-neutral">Claude Code</span><span className="badge badge-neutral">Codex</span></div>
          <footer><button className="button small secondary" onClick={() => onOpen(project.id)}>查看配置 <ArrowUpRight size={14} /></button><button className="icon-button danger-hover" aria-label={'移除项目 ' + project.name} onClick={() => onRemove(project.id)} disabled={busy}><Trash2 size={16} /></button></footer>
        </article>)}</div>}
    </div>
  </>;
}

export function HistoryPage({ operations, loading, busy, onRestore }: {
  operations: Operation[]; loading: boolean; busy: boolean; onRestore: (id: string) => void;
}) {
  return <>
    <header className="page-heading"><div><span className="eyebrow">LOCAL CHANGELOG</span><h1>变更记录</h1><p>每次写入都有迹可循，修改前的完整文件可随时预览恢复。</p></div><span className="quiet-pill"><History size={15} /> 最近 200 条</span></header>
    <div className="page-content">
      {loading ? <div className="empty-state"><LoaderCircle size={22} className="spin" /><p>读取变更记录…</p></div>
        : operations.length === 0 ? <div className="empty-state large-empty"><div className="empty-icon"><History size={29} /></div><h3>这里会记录每一次变更</h3><p>创建、编辑、导入和删除资源后，即可在此查看记录。</p></div>
        : <div className="history-list">{operations.map((operation) => <article className="history-row" key={operation.id}>
          <div className={'history-dot ' + (operation.status !== 'completed' ? 'history-warning' : '')}>{operation.status === 'completed' ? <Check size={16} /> : <History size={16} />}</div>
          <div className="history-body"><div><strong>{actionLabel[operation.action] ?? operation.action} · {operation.name}</strong><span className={'badge ' + (operation.status === 'completed' ? 'badge-teal' : 'badge-red')}>{statusLabel[operation.status] ?? operation.status}</span></div>
            <code>{operation.targetPath}</code>{operation.error && <p className="warning-text">{operation.error}</p>}
            <small>{formatDate(operation.createdAt)} · {operation.origin === 'library' ? '资源库' : '本地配置'}</small>
          </div>
          {operation.canRestore && <button className="button small secondary" disabled={busy} onClick={() => onRestore(operation.id)}><RotateCcw size={14} /> 预览恢复</button>}
        </article>)}</div>}
    </div>
  </>;
}

export function SettingsPage({ settings, dataDir, busy, onSave, onError }: {
  settings: Settings; dataDir: string; busy: boolean; onSave: (settings: Settings) => void; onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => { setDraft(settings); }, [settings]);
  const fields: { key: keyof Settings; title: string; hint: string }[] = [
    { key: 'claudeRoot', title: 'Claude Code 配置目录', hint: '默认是用户目录下的 .claude；包含 skills、rules 和 CLAUDE.md。' },
    { key: 'codexRoot', title: 'Codex 配置目录', hint: '默认是 .codex；识别 CODEX_HOME。行为指令存放在 AGENTS.md。' },
    { key: 'codexSkillsRoot', title: 'Codex 全局技能目录', hint: '默认是用户目录下的 .agents/skills，独立于 Codex 配置目录。' },
  ];
  const browse = async (key: keyof Settings) => {
    try { const path = await chooseFolder('选择配置目录'); if (path) setDraft((current) => ({ ...current, [key]: path })); }
    catch (error) { onError(errorMessage(error)); }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  return <>
    <header className="page-heading"><div><span className="eyebrow">APPLICATION SETTINGS</span><h1>设置</h1><p>让 SkillDock 找到你正在使用的工具配置。</p></div><span className="quiet-pill">v0.1.0</span></header>
    <div className="page-content settings-content">
      <section className="settings-card"><div className="section-heading"><h3>工具目录</h3><p>支持标准用户目录与自定义位置；保存后会重新扫描。</p></div>
        {fields.map((field) => <label className="field" key={field.key}>{field.title}
          <div className="path-picker"><input value={draft[field.key]} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} disabled={busy} /><button className="button secondary" onClick={() => void browse(field.key)} disabled={busy}><FolderOpen size={15} /> 浏览</button></div><small>{field.hint}</small>
        </label>)}
        <footer><button className="button primary" disabled={busy || !dirty} onClick={() => onSave(draft)}><Check size={16} /> 保存并重新扫描</button></footer>
      </section>
      <section className="settings-card"><div className="section-heading"><h3>本地数据与备份</h3><p>资源文件、索引和变更备份保存在此目录。</p></div><code className="data-path">{dataDir}</code><div className="settings-note"><span className="status-dot" /> 无需登录 · 文件保存在本机 · 不上传资源内容</div></section>
    </div>
  </>;
}
