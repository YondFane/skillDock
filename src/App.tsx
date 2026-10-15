import { useEffect, useRef, useState } from 'react';
import { Anchor, Blocks, FileText, FolderOpen, Globe2, History, Layers2, Settings2, Search, Plus, Upload, RefreshCw, X, LoaderCircle, MoreHorizontal, ChevronDown, PanelLeft, PencilLine } from 'lucide-react';
import { AppearanceProvider } from './lib/appearance';
import { useWorkspace } from './lib/useWorkspace';
import { locationLabel, creationDirty } from './lib/workspace';
import { compatibilityLabel, errorMessage, formatDate, type Operation, type ProjectImportFailure } from './lib/types';
import { api, chooseFolders } from './lib/api';
import { ResourceEditor } from './components/ResourceEditor';
import { CreatePanel } from './components/CreatePanel';
import { ImportModal } from './components/ImportModal';
import { Modal } from './components/Modal';
import { ReviewModal } from './components/ReviewModal';
import { HistoryPage, SettingsPage } from './components/WorkspacePages';
import { version } from '../package.json';

type Confirmation = { title: string; description: string; label: string; action: () => void | Promise<void> };
export default function App() { return <AppearanceProvider><Workspace /></AppearanceProvider>; }

function Workspace() {
  const ws = useWorkspace();
  const [projectSearch, setProjectSearch] = useState('');
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 1100);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => window.innerWidth > 1100);
  const [workspaceForm, setWorkspaceForm] = useState<{ id?: string; name: string; error: string } | null>(null);
  const [projectFailures, setProjectFailures] = useState<ProjectImportFailure[]>([]);
  const [pickingProjects, setPickingProjects] = useState(false);
  const closeSidebar = () => { if (narrow) setSidebarExpanded(false); };
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 1100px)');
    if (!query) return;
    const change = () => { setNarrow(query.matches); setSidebarExpanded(!query.matches); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!narrow || !sidebarExpanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarExpanded(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [narrow, sidebarExpanded]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  useEffect(() => setConfirmationError(''), [confirmation]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const blocked = ws.updateBusy || ws.exitBusy;
  const busy = blocked || pickingProjects || ws.writes.length > 0;
  const label = locationLabel(ws.location, ws.overview);
  const project = ws.overview?.projects.find((item) => `project:${item.id}` === ws.location);
  const selected = ws.resource;
  const outsideFilter = selected && !ws.list.some((item) => item.id === selected.resource.id);

  useEffect(() => {
    const closeMenus = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document.querySelectorAll<HTMLDetailsElement>('details.action-menu[open]').forEach((menu) => {
        if (!menu.contains(target) || (target instanceof Element && target.closest('button'))) menu.open = false;
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') document.querySelectorAll<HTMLDetailsElement>('details.action-menu[open]').forEach((menu) => { menu.open = false; });
    };
    document.addEventListener('click', closeMenus); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', closeMenus); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => {
    if (ws.page !== 'history') return;
    let active = true; setHistoryLoading(true);
    api.history().then((items) => { if (active) setOperations(items); }).catch((failure) => { if (active) ws.setError(errorMessage(failure)); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [ws.page, ws.overview]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = ws.view.scrollTop; }, [ws.location, ws.page, ws.loading]);
  useEffect(() => {
    if (!ws.toast) return;
    const timer = setTimeout(() => ws.setToast(null), ws.toast.resourceId ? 8000 : 4500);
    return () => clearTimeout(timer);
  }, [ws.toast]);
  const confirm = async () => {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true); setConfirmationError('');
    try { await confirmation.action(); setConfirmation(null); }
    catch (failure) { setConfirmationError(errorMessage(failure)); }
    finally { setConfirmBusy(false); }
  };
  const askDiscard = (id: string, reload = false) => {
    const dirty = ws.dirtyDrafts.some((draft) => draft.resource.id === id) || !!(ws.creations[id] && creationDirty(ws.creations[id]));
    if (!dirty) { if (reload) void ws.reload(id); else ws.discard(id); return; }
    setConfirmation({ title: reload ? '重新加载并放弃草稿？' : '放弃未保存修改？', description: '这只会丢弃当前资源的临时草稿，不会修改磁盘中的文件。', label: reload ? '放弃并重新加载' : '放弃修改', action: () => { ws.discard(id); } });
  };
  const addProject = async () => {
    const workspaceId = ws.workspaceId;
    setPickingProjects(true);
    try {
      const paths = await chooseFolders('添加项目（可多选目录）');
      if (paths.length) {
        const result = await ws.addProjects(paths, workspaceId);
        if (result?.failures.length) setProjectFailures(result.failures);
      }
    } catch (failure) { ws.setError(errorMessage(failure)); }
    finally { setPickingProjects(false); }
  };
  const saveWorkspace = async () => {
    if (!workspaceForm) return;
    try {
      const saved = await ws.manageWorkspace(workspaceForm.id ? 'rename' : 'create', workspaceForm.id ?? '', workspaceForm.name);
      if (saved) { setWorkspaceForm(null); setProjectSearch(''); }
    } catch (failure) { setWorkspaceForm({ ...workspaceForm, error: errorMessage(failure) }); }
  };
  const projects = ws.workspaceProjects.filter((item) => [item.name, item.path].join(' ').toLowerCase().includes(projectSearch.toLowerCase()));
  const projectItems = <>{projects.map((item) => <div className="project-nav-row" key={item.id}>
    <button className={'nav-item ' + (ws.page === 'workspace' && ws.location === `project:${item.id}` ? 'active' : '')} title={item.path} disabled={blocked}
      onClick={() => { ws.navigate(`project:${item.id}`); closeSidebar(); }}><FolderOpen size={16} /><span title={item.name}>{item.name}</span></button>
    <details className="action-menu"><summary aria-label={'管理项目 ' + item.name}><MoreHorizontal size={16} /></summary><div><button disabled={busy} onClick={() => setConfirmation({ title: '从当前工作区移除项目？', description: item.name + '（' + item.path + '）的磁盘文件和其他工作区关联会保留。未保存草稿需先处理。', label: '从工作区移除', action: () => ws.removeProject(item.id, ws.workspaceId) })}>从工作区移除</button></div></details>
  </div>)}</>;
  return <div className={'app-shell streamlined ' + (sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed') + (narrow && sidebarExpanded ? ' sidebar-overlay' : '')}>
    {narrow && sidebarExpanded && <button className="sidebar-backdrop" aria-label="收起侧栏遮罩" onClick={() => setSidebarExpanded(false)} />}
    <div className="sidebar-slot"><aside className="sidebar">
      <div className="brand"><button className="brand-mark" aria-label={sidebarExpanded ? "收起侧栏" : "展开侧栏"} title={sidebarExpanded ? "收起侧栏" : "展开侧栏"} aria-expanded={sidebarExpanded} aria-controls="sidebar-navigation" onClick={() => setSidebarExpanded(!sidebarExpanded)}><Anchor size={23} /></button><div className="brand-copy"><strong>SkillDock</strong><small>技能坞</small></div></div>
      <nav id="sidebar-navigation" aria-label="主导航">
        <button className="nav-item location-switcher" title="切换位置" aria-label="切换位置" disabled={blocked} onClick={() => setSidebarExpanded(true)}><PanelLeft size={18} /><span>选择位置</span></button>
        <button className={'nav-item ' + (ws.page === 'workspace' && ws.location === 'global' ? 'active' : '')} title="全局配置" disabled={blocked} onClick={() => { ws.navigate('global'); closeSidebar(); }}><Globe2 size={18} /><span>全局配置</span></button>
        <div className="workspace-navigation">
          <div className="sidebar-section-label"><span>工作区</span><details className="action-menu"><summary aria-label="管理工作区"><MoreHorizontal size={16} /></summary><div>
            <button disabled={busy} onClick={() => setWorkspaceForm({ name: '', error: '' })}>新建工作区</button>
            <button disabled={busy || !ws.activeWorkspace} onClick={() => setWorkspaceForm({ id: ws.workspaceId, name: ws.activeWorkspace?.name ?? '', error: '' })}>重命名工作区</button>
            <button disabled={busy || ws.workspaceId === 'default'} onClick={() => setConfirmation({ title: '删除工作区？', description: `删除“${ws.activeWorkspace?.name}”分组。项目文件不会删除，仅属于该工作区的项目会移入默认工作区。`, label: '删除工作区', action: async () => { await ws.manageWorkspace('delete', ws.workspaceId); } })}>删除工作区</button>
          </div></details></div>
          <select aria-label="切换工作区" title={ws.activeWorkspace?.name} value={ws.workspaceId} disabled={busy || !ws.overview} onChange={(event) => { ws.switchWorkspace(event.target.value); setProjectSearch(''); }}>
            {ws.overview?.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="project-navigation"><div className="sidebar-section-label"><span>项目</span><button className="icon-button" aria-label="添加项目" disabled={busy} onClick={() => void addProject()}><Plus size={15} /></button></div>
          <label className="project-search"><Search size={13} /><input aria-label="搜索项目" placeholder="搜索项目…" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} /></label>
          <div className="project-nav-list">{projectItems}{projects.length === 0 && <p className="sidebar-empty">{projectSearch ? '未找到项目' : '添加项目即可管理配置'}</p>}</div>
        </div>
        <div className="sidebar-divider" />
        <button className={'nav-item ' + (ws.page === 'workspace' && ws.location === 'library' ? 'active' : '')} title="资源库" disabled={blocked} onClick={() => { ws.navigate('library'); closeSidebar(); }}><Layers2 size={18} /><span>资源库</span></button>
        <button className={'nav-item ' + (ws.page === 'history' ? 'active' : '')} title="变更记录" disabled={blocked} onClick={() => { ws.setPage('history'); closeSidebar(); }}><History size={18} /><span>变更记录</span></button>
        <button className="nav-item" title={'草稿 ' + ws.dirtyCount} disabled={blocked} onClick={() => { closeSidebar(); setDraftsOpen(true); }}><PencilLine size={18} /><span>草稿</span><small>{ws.dirtyCount}</small></button>
      </nav>
      <div className="sidebar-bottom"><button className={'nav-item ' + (ws.page === 'settings' ? 'active' : '')} title="设置" disabled={blocked} onClick={() => { ws.setPage('settings'); closeSidebar(); }}><Settings2 size={18} /><span>设置</span></button><div className="local-status"><span className="status-dot" /><span>本地保存</span><small>v{version}</small></div></div>
    </aside></div>
    <main className="main-workspace" inert={narrow && sidebarExpanded}>
      <div className="topbar"><div className="workspace-context"><strong>{ws.page === 'workspace' ? label : ws.page === 'history' ? '变更记录' : '设置'}</strong>{ws.page === 'workspace' && <span title={project?.path}>{project?.path ?? (ws.location === 'library' ? '收录与维护可复用的技能和规则' : 'Claude Code 与 Codex')}</span>}</div>
        <div className="topbar-right"><button className="icon-button" aria-label="重新扫描所有资源" title="重新扫描" disabled={busy || ws.loading} onClick={() => void ws.refresh()}><RefreshCw size={16} className={ws.loading ? 'spin' : ''} /></button></div>
      </div>
      {ws.error && <div className="app-error" role="alert"><span>{ws.error}</span><button className="icon-button" onClick={() => ws.setError(null)} aria-label="关闭错误提示"><X size={15} /></button></div>}
      {ws.preferenceError && <p className="compact-warning" role="status">{ws.preferenceError}</p>}
      {!!ws.overview?.warnings.length && <details className="scan-warnings"><summary>{ws.overview.warnings.length} 项扫描提示</summary>{ws.overview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
      {ws.page === 'workspace' && <>
        <div className="workspace-actions"><div className="tool-segments" aria-label="工具筛选">{(['all', 'claude', 'codex'] as const).map((tool) => <button key={tool} aria-pressed={ws.view.tool === tool} className={ws.view.tool === tool ? 'selected' : ''} onClick={() => ws.patchView({ tool })}>{tool === 'all' ? '全部工具' : tool === 'claude' ? 'Claude' : 'Codex'}</button>)}</div>
          <div className="workspace-primary-actions">{ws.location === 'library' && <button className="button secondary small" disabled={busy || !ws.overview} onClick={() => { setImportError(null); setImportOpen(true); }}><Upload size={14} /> 本地收录</button>}
            <details className="action-menu new-menu"><summary className="button primary small" aria-label="新建资源"><Plus size={15} /> 新建 <ChevronDown size={13} /></summary><div>
              <button disabled={blocked || !ws.overview} onClick={(event) => { ws.newResource('skill'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Blocks size={15} /> 新建技能</button>
              <button disabled={blocked || !ws.overview} onClick={(event) => { ws.newResource('rule'); event.currentTarget.closest('details')?.removeAttribute('open'); }}><FileText size={15} /> 新建规则</button>
            </div></details>
          </div>
        </div>
        <div className={'resource-workspace ' + (ws.selectedId ? 'with-editor' : '')}>
          <section className="resource-list-panel" aria-label="资源列表">
            <div className="list-toolbar"><label className="search-input"><Search size={15} /><input aria-label="搜索资源" placeholder="搜索技能、规则…" value={ws.view.search} onChange={(event) => ws.patchView({ search: event.target.value })} /></label>
              <div className="filter-tabs" role="tablist" aria-label="资源类型">{(['all', 'skill', 'rule'] as const).map((kind) => <button key={kind} role="tab" aria-selected={ws.view.kind === kind} className={ws.view.kind === kind ? 'selected' : ''} onClick={() => ws.patchView({ kind })}>{kind === 'all' ? '全部' : kind === 'skill' ? '技能' : '规则'}</button>)}</div><span className="result-count">{ws.list.length} 项</span>
            </div>
            <div className="resource-list" ref={listRef} onScroll={(event) => ws.patchView({ scrollTop: event.currentTarget.scrollTop })}>
              {ws.loading && !ws.overview ? <div className="empty-state"><LoaderCircle className="spin" size={23} /><p>正在扫描配置…</p></div>
                : ws.list.length === 0 ? <div className="empty-state"><Layers2 size={27} /><h3>{ws.base.length ? '没有匹配的资源' : '这里还没有技能或规则'}</h3><p>{ws.base.length ? '调整搜索或筛选条件。' : '点击上方“新建”，直接在当前位置创建。'}</p></div>
                  : ws.list.map((resource) => <button key={resource.id} className={'resource-row ' + (ws.selectedId === resource.id ? 'selected' : '')} onClick={() => ws.selectResource(resource.id)}>
                    <div className="resource-type-icon">{resource.kind === 'skill' ? <Blocks size={18} /> : <FileText size={18} />}</div>
                    <div className="resource-row-body"><div className="resource-row-heading"><strong>{resource.name}</strong>{ws.dirtyDrafts.some((draft) => draft.resource.id === resource.id) && <span className="draft-dot" title="未保存">●</span>}</div><p>{resource.description || '暂无说明'}</p>
                      <div className="resource-row-meta"><span>{resource.tool ? compatibilityLabel[resource.tool] : compatibilityLabel[resource.compatibility]}</span>{resource.readOnly && <span>只读</span>}<span>{formatDate(resource.updatedAt)}</span></div>
                    </div></button>)}
            </div>
            <footer className="list-footer"><span>{ws.dirtyDrafts.filter((draft) => draft.location === ws.location).length} 个资源待保存</span><span>本机文件</span></footer>
          </section>
          {ws.creation ? <CreatePanel key={ws.creation.id} draft={ws.creation} environments={ws.overview?.environments ?? []} location={label} busy={blocked || ws.writes.includes(ws.creation.id)} onChange={ws.updateCreation}
            onCreate={() => void ws.createResource(ws.creation!.id)} onClose={() => ws.patchView({ selectedId: null })} onDiscard={() => askDiscard(ws.creation!.id)} onOpenExisting={ws.jumpTo} />
            : selected ? <div className="viewer-column">{outsideFilter && <div className="outside-filter" role="status">当前资源不在筛选结果中，仍可继续编辑。<button onClick={() => ws.patchView({ search: '', tool: 'all', kind: 'all' })}>清除筛选</button></div>}
              <ResourceEditor key={selected.resource.id} draft={selected} disabled={blocked} loading={ws.loadingFiles.includes(selected.resource.id)} location={locationLabel(selected.location, ws.overview)} onChange={ws.updateDraft} onSave={() => void ws.saveResource(selected.resource.id)}
                onDelete={() => void ws.prepareDelete(selected.resource.id)} onFile={(relativePath) => ws.patchView({ relativePath })} onReload={() => askDiscard(selected.resource.id, true)} onDiscard={() => askDiscard(selected.resource.id)} onClose={() => ws.patchView({ selectedId: null })}
                onAdopt={() => void ws.immediate('adopt:' + selected.resource.id, () => api.adopt(selected.resource.id)).catch((failure) => ws.setError(errorMessage(failure)))} onMessage={(message) => ws.setToast({ message })} positions={ws.positions} />
            </div> : ws.selectedId && <aside className="resource-editor"><div className="editor-loading"><LoaderCircle size={23} className="spin" /><span>正在读取资源…</span><button className="button secondary" onClick={() => ws.patchView({ selectedId: null })}>关闭</button></div></aside>}
        </div>
      </>}
      {ws.page === 'history' && <HistoryPage operations={operations} loading={historyLoading} busy={busy} onRestore={(id) => void ws.prepareRestore(id)} />}
      {ws.page === 'settings' && ws.overview && <SettingsPage settings={ws.overview.settings} draft={ws.settingsDraft ?? ws.overview.settings} dataDir={ws.overview.dataDir} busy={busy} hasDrafts={ws.dirtyCount > 0} hasResourceDrafts={ws.dirtyDrafts.length + ws.dirtyCreations.length > 0}
        onDraftChange={(value) => ws.setSettingsDraft(JSON.stringify(value) === JSON.stringify(ws.overview!.settings) ? null : value)} onSave={() => void ws.saveSettings()} onError={ws.setError} onUpdateBusyChange={ws.setUpdateBusy} />}
    </main>
    {ws.toast && <div className="toast" role="status"><span>{ws.toast.message}</span>{ws.toast.resourceId && <button className="button small secondary" onClick={() => { ws.jumpTo(ws.toast!.resourceId!); ws.setToast(null); }}>查看资源</button>}<button className="icon-button" aria-label="关闭消息" onClick={() => ws.setToast(null)}><X size={14} /></button></div>}
    {importOpen && <ImportModal busy={ws.writes.includes('import')} error={importError} onClose={() => setImportOpen(false)} onSubmit={(path, compatibility) => {
      setImportError(null); void ws.immediate('import', () => api.import(path, compatibility)).then((ok) => { if (ok) setImportOpen(false); }).catch((failure) => setImportError(errorMessage(failure)));
    }} />}
    {ws.preview && (ws.preview.action === 'delete' ? <Modal title="删除这个资源？" onClose={() => ws.setPreview(null)} busy={ws.writes.includes('review')}>
      <div className="modal-body"><strong>{ws.preview.name}</strong><code className="data-path">{ws.preview.targetPath}</code><p>将删除 {ws.preview.totalFiles} 个文件。删除前保存完整备份，可从变更记录恢复。</p>{ws.previewError && <p className="inline-error" role="alert">{ws.previewError}</p>}</div>
      <footer className="modal-footer"><button className="button secondary" disabled={ws.writes.includes('review')} onClick={() => ws.setPreview(null)}>取消</button><button className="button danger" disabled={ws.writes.includes('review') || !!ws.previewError} onClick={() => void ws.applyReview()}>确认删除</button></footer>
    </Modal> : <ReviewModal preview={ws.preview} busy={ws.writes.includes('review')} error={ws.previewError} onClose={() => ws.setPreview(null)} onApply={() => void ws.applyReview()} />)}
    {confirmation && <Modal title={confirmation.title} onClose={() => setConfirmation(null)} busy={confirmBusy}><div className="modal-body"><p>{confirmation.description}</p>{confirmationError && <p className="inline-error" role="alert">{confirmationError}</p>}</div><footer className="modal-footer"><button className="button secondary" disabled={confirmBusy} onClick={() => setConfirmation(null)}>取消</button><button className="button danger" disabled={confirmBusy} onClick={() => void confirm()}>{confirmation.label}</button></footer></Modal>}
    {draftsOpen && <Modal title={'未保存草稿 · ' + ws.dirtyCount} onClose={() => setDraftsOpen(false)}><div className="modal-body draft-picker">
      {ws.dirtyCount === 0 && <p className="muted">当前没有未保存修改。</p>}
      {ws.dirtyDrafts.map((draft) => <button key={draft.resource.id} className="draft-picker-row" onClick={() => { ws.jumpTo(draft.resource.id); setDraftsOpen(false); }}><strong>{draft.resource.name}</strong><span>{locationLabel(draft.location, ws.overview)} · {compatibilityLabel[draft.compatibility]}</span></button>)}
      {ws.dirtyCreations.map((draft) => <button key={draft.id} className="draft-picker-row" onClick={() => { ws.jumpTo(draft.id); setDraftsOpen(false); }}><strong>{draft.name || '未命名资源'} · 新建</strong><span>{locationLabel(draft.location, ws.overview)}</span></button>)}
      {ws.settingsDraft && <button className="draft-picker-row" onClick={() => { ws.setPage('settings'); setDraftsOpen(false); }}>工具目录设置</button>}
    </div><footer className="modal-footer"><button className="button primary" disabled={busy || !ws.dirtyCount} onClick={() => { setDraftsOpen(false); void ws.saveAll(); }}>保存全部</button></footer></Modal>}
    {workspaceForm && <Modal title={workspaceForm.id ? '重命名工作区' : '新建工作区'} onClose={() => setWorkspaceForm(null)} busy={busy}>
      <form onSubmit={(event) => { event.preventDefault(); void saveWorkspace(); }}>
        <div className="modal-body"><label className="form-label">工作区名称<input autoFocus aria-label="工作区名称" maxLength={80} value={workspaceForm.name} disabled={busy} placeholder="例如：个人项目、公司项目" onChange={(event) => setWorkspaceForm({ ...workspaceForm, name: event.target.value, error: '' })} /></label>
          <p className="muted">按自定义分组管理项目；同一项目可加入多个工作区。</p>{workspaceForm.error && <p className="inline-error" role="alert">{workspaceForm.error}</p>}</div>
        <footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setWorkspaceForm(null)}>取消</button><button className="button primary" disabled={busy || !workspaceForm.name.trim()}>{busy ? '保存中…' : '保存工作区'}</button></footer>
      </form></Modal>}
    {projectFailures.length > 0 && <Modal title="部分项目未能添加" onClose={() => setProjectFailures([])}><div className="modal-body"><p>有效项目已添加，以下目录需要处理后重试：</p>{projectFailures.map((failure, index) => <div key={index}><code className="data-path">{failure.path}</code><p className="inline-error">{failure.message}</p></div>)}</div><footer className="modal-footer"><button className="button primary" onClick={() => setProjectFailures([])}>知道了</button></footer></Modal>}
    {ws.exitOpen && <Modal title="退出前处理未保存修改" subtitle="草稿仅在本次会话保留，退出后会丢失。" onClose={() => ws.setExitOpen(false)} busy={ws.exitBusy}>
      <div className="modal-body"><p>还有 {ws.dirtyCount} 项未保存修改。保存失败时会保留应用和草稿。</p></div><footer className="modal-footer">
        <button className="button secondary" disabled={ws.exitBusy} onClick={() => ws.setExitOpen(false)}>取消</button>
        <button className="button secondary" disabled={ws.exitBusy} onClick={() => void ws.finishExit(false)}>放弃并退出</button>
        <button className="button primary" disabled={ws.exitBusy} onClick={() => void ws.finishExit(true)}>{ws.exitBusy ? '保存中…' : '保存全部并退出'}</button>
      </footer></Modal>}
  </div>;
}
