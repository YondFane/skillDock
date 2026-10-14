import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Anchor, Blocks, FileText, FolderKanban, History, Settings2, Plus, Upload, Search, RefreshCw,
  ArrowUpRight, ChevronRight, X, Layers2, FolderOpen, Check, LoaderCircle, TriangleAlert, CircleCheck,
} from 'lucide-react';
import { api, desktopAvailable } from './lib/api';
import {
  compatibilityLabel, errorMessage, formatDate,
  type ChangePreview, type Compatibility, type CreateInput, type EditInput, type Kind,
  type Operation, type Overview, type Page, type Resource, type ResourceDetail, type Settings,
} from './lib/types';
import { CreateModal } from './components/CreateModal';
import { ImportModal } from './components/ImportModal';
import { ReviewModal } from './components/ReviewModal';
import { ResourceEditor } from './components/ResourceEditor';
import { Modal } from './components/Modal';
import { HistoryPage, ProjectsPage, SettingsPage } from './components/WorkspacePages';

const navigation = [
  { id: 'library' as Page, label: '资源库', icon: Layers2 },
  { id: 'local' as Page, label: '本地配置', icon: Blocks },
  { id: 'projects' as Page, label: '项目', icon: FolderKanban },
  { id: 'history' as Page, label: '变更记录', icon: History },
];

export default function App() {
  const [page, setPage] = useState<Page>('library');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [tool, setTool] = useState<'all' | Compatibility>('all');
  const [environment, setEnvironment] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const detailRequest = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setOverview(await api.overview()); setError(null); }
    catch (error) { setError(errorMessage(error)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!desktopAvailable) { setLoading(false); setError('请通过桌面版本使用本地文件功能。开发时运行 npm run tauri dev。'); return; }
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (page !== 'history') return;
    setHistoryLoading(true);
    api.history().then(setOperations).catch((error) => setError(errorMessage(error))).finally(() => setHistoryLoading(false));
  }, [page, overview]);

  const navigateSafely = (action: () => void) => {
    if (dirty) setLeaveAction(() => action); else action();
  };
  const clearEditor = () => {
    detailRequest.current += 1; setSelectedId(null); setDetail(null); setDirty(false); setLoadingDetail(false);
  };
  const navigate = (destination: Page) => navigateSafely(() => {
    clearEditor(); setPage(destination); setSearch(''); setKind('all'); setTool('all'); setEnvironment('all');
  });
  const loadDetail = async (id: string, relativePath?: string) => {
    const request = ++detailRequest.current;
    setSelectedId(id); setLoadingDetail(true);
    try {
      const result = await api.detail(id, relativePath);
      if (detailRequest.current === request) { setDetail(result); setDirty(false); setError(null); }
    } catch (error) {
      if (detailRequest.current === request) { setDetail(null); setError(errorMessage(error)); }
    } finally { if (detailRequest.current === request) setLoadingDetail(false); }
  };
  const selectResource = (resource: Resource) => navigateSafely(() => { clearEditor(); void loadDetail(resource.id); });
  const openCreate = () => navigateSafely(() => { setFormError(null); setCreateOpen(true); });
  const prepare = async (request: () => Promise<ChangePreview>, form = false) => {
    setBusy(true); setPreviewError(null); setFormError(null);
    try { setPreview(await request()); }
    catch (error) { if (form) setFormError(errorMessage(error)); else setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const submitCreate = (input: CreateInput) => { void prepare(() => api.create(input), true); };
  const submitImport = (path: string, compatibility: Compatibility) => { void prepare(() => api.import(path, compatibility), true); };
  const submitEdit = (input: EditInput) => { void prepare(() => api.edit(input)); };
  const applyReview = async () => {
    if (!preview) return;
    setBusy(true); setPreviewError(null);
    try {
      const result = await api.apply(preview.id);
      setPreview(null); setCreateOpen(false); setImportOpen(false); setDirty(false);
      setToast(result.message);
      const fresh = await api.overview();
      setOverview(fresh); setError(null);
      if (result.resourceId) {
        const resource = fresh.resources.find((item) => item.id === result.resourceId);
        if (resource) {
          setPage(resource.origin === 'library' ? 'library' : 'local');
          setSearch(''); setKind('all'); setTool('all'); setEnvironment('all');
          const relative = result.resourceId === selectedId ? detail?.relativePath : undefined;
          await loadDetail(result.resourceId, relative);
        } else clearEditor();
      } else clearEditor();
    } catch (error) { setPreviewError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const changeProject = async (path: string) => {
    setBusy(true);
    try { setOverview(await api.addProject(path)); setToast('项目已登记，可查看它的本地配置。'); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const removeProject = async (id: string) => {
    setBusy(true);
    try { setOverview(await api.removeProject(id)); setToast('已取消项目登记，项目文件已保留。'); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const saveSettings = async (settings: Settings) => {
    setBusy(true);
    try { setOverview(await api.settings(settings)); setToast('目录已更新并重新扫描。'); setError(null); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const all = overview?.resources ?? [];
  const library = all.filter((resource) => resource.origin === 'library');
  const local = all.filter((resource) => resource.origin === 'local');
  const base = page === 'library' ? library : local;
  const list = base.filter((resource) =>
    (kind === 'all' || resource.kind === kind)
    && (tool === 'all' || resource.compatibility === tool || resource.compatibility === 'both')
    && (environment === 'all' || resource.environmentId === environment)
    && [resource.name, resource.description, resource.path, resource.source].join(' ').toLowerCase().includes(search.toLowerCase()));
  const isResourcePage = page === 'library' || page === 'local';
  const selectedEnvironment = overview?.environments.find((item) => item.id === environment);
  const newTarget = page === 'local' ? selectedEnvironment?.id ?? 'claude:global' : 'library';
  const actionDisabled = busy || loading || !overview;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Anchor size={26} strokeWidth={1.8} /></div><div><strong>SkillDock<span>技能坞</span></strong><small>SKILLS & RULES</small></div></div>
      <div className="workspace-label">工作空间</div>
      <nav aria-label="主导航">{navigation.map((item) => <button key={item.id} className={'nav-item ' + (page === item.id ? 'active' : '')} onClick={() => navigate(item.id)} disabled={busy}>
        <item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
        {item.id === 'library' && <small>{library.length}</small>}{item.id === 'local' && <small>{local.length}</small>}
      </button>)}</nav>
      <div className="sidebar-context"><span className="eyebrow">CONNECTED TOOLS</span><div><span className="tool-dot claude-dot" />Claude Code<span className="muted">本地配置</span></div><div><span className="tool-dot codex-dot" />Codex<span className="muted">本地配置</span></div></div>
      <div className="sidebar-bottom"><button className={'nav-item ' + (page === 'settings' ? 'active' : '')} onClick={() => navigate('settings')} disabled={busy}><Settings2 size={18} /><span>设置</span></button><div className="local-status"><span className="status-dot" /><span>本地优先</span><small>v0.1.0</small></div></div>
    </aside>
    <main className="main-workspace">
      <div className="topbar"><div className="breadcrumb">工作空间 <ChevronRight size={13} /><span>{page === 'settings' ? '设置' : navigation.find((item) => item.id === page)?.label}</span></div><div className="topbar-right"><span className="tiny-status">桌面应用</span><button className="icon-button" onClick={() => navigateSafely(() => { void refresh(); })} aria-label="重新扫描所有资源" disabled={busy || loading || !desktopAvailable}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div></div>
      {error && <div className="app-error" role="alert"><TriangleAlert size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError(null)} aria-label="关闭错误提示"><X size={15} /></button></div>}
      {overview && overview.warnings.length > 0 && <details className="scan-warnings"><summary><TriangleAlert size={14} /> {overview.warnings.length} 项扫描提示</summary>{overview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
      {isResourcePage && <>
        <header className="page-heading"><div><span className="eyebrow">{page === 'library' ? 'YOUR KNOWLEDGE, ORGANIZED' : 'LOCAL TOOL CONFIGURATION'}</span><h1>{page === 'library' ? '资源库' : '本地配置'}<span className="heading-count">{base.length}</span></h1><p>{page === 'library' ? '把技能与工作约定整理到一起，为下一次工作做好准备。' : '管理 Claude Code 与 Codex 的全局和项目技能、行为规则。'}</p></div><div className="heading-actions">
          {page === 'library' && <button className="button secondary" onClick={() => navigateSafely(() => { setFormError(null); setImportOpen(true); })} disabled={actionDisabled}><Upload size={16} /> 本地导入</button>}
          <button className="button primary" onClick={openCreate} disabled={actionDisabled}><Plus size={17} /> 新建资源</button>
        </div></header>
        <section className="summary-row" aria-label="资源统计">
          <div className="summary-card"><div className="summary-icon teal"><Blocks size={20} /></div><div><span>技能</span><strong>{base.filter((resource) => resource.kind === 'skill').length}<small>按需调用</small></strong></div></div>
          <div className="summary-card"><div className="summary-icon violet"><FileText size={20} /></div><div><span>规则</span><strong>{base.filter((resource) => resource.kind === 'rule').length}<small>工作约定</small></strong></div></div>
          <div className="summary-card"><div className="summary-icon warm"><FolderKanban size={20} /></div><div><span>项目</span><strong>{overview?.projects.length ?? 0}<small>独立配置</small></strong></div></div>
          <div className="summary-note"><CircleCheck size={18} /><div><strong>所有资源，保存在本机</strong><span>修改前预览 · 写入前备份</span></div></div>
        </section>
        <div className={'resource-workspace ' + (selectedId ? 'with-editor' : '')}>
          <section className="resource-list-panel">
            <div className="list-toolbar"><div className="filter-tabs" role="tablist" aria-label="资源类型">
              {(['all', 'skill', 'rule'] as const).map((value) => <button key={value} role="tab" aria-selected={kind === value} className={kind === value ? 'selected' : ''} onClick={() => setKind(value)}>{value === 'all' ? '全部' : value === 'skill' ? '技能' : '规则'}<span>{value === 'all' ? base.length : base.filter((resource) => resource.kind === value).length}</span></button>)}
            </div><label className="search-input"><Search size={15} /><input aria-label="搜索资源" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、内容说明…" /></label></div>
            <div className="list-subtoolbar"><label className="compact-select"><span>工具</span><select aria-label="筛选工具" value={tool} onChange={(event) => setTool(event.target.value as typeof tool)}><option value="all">全部工具</option><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="both">通用资源</option></select></label>
              {page === 'local' && <label className="compact-select"><span>位置</span><select aria-label="筛选配置环境" value={environment} onChange={(event) => setEnvironment(event.target.value)}><option value="all">全部位置</option>{overview?.environments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              <span className="result-count">{list.length} 项资源</span>
            </div>
            {loading ? <div className="empty-state"><LoaderCircle size={23} className="spin" /><p>正在发现本地资源…</p></div>
              : list.length === 0 ? <div className="empty-state">
                <div className="empty-icon"><Layers2 size={30} /></div><span className="eyebrow">{base.length ? 'NO MATCHES' : 'A CLEAN START'}</span>
                <h3>{base.length ? '没有找到匹配的资源' : page === 'library' ? '让好用的工作方式，随时就绪' : '还没有发现本地配置'}</h3>
                <p>{base.length ? '试试其他关键词，或调整筛选条件。' : page === 'library' ? '创建你的第一个技能或规则，也可以从已有目录导入。' : '可以创建全局配置、添加项目，或在设置中指定目录。'}</p>
                {!base.length && <button className="button secondary" onClick={openCreate} disabled={actionDisabled}><Plus size={16} /> 创建第一个资源</button>}
              </div>
              : <div className="resource-list">{list.map((resource) => <button key={resource.id} className={'resource-row ' + (selectedId === resource.id ? 'selected' : '')} onClick={() => selectResource(resource)} disabled={busy}>
                <div className={'resource-type-icon ' + (resource.kind === 'rule' ? 'rule-icon' : '')}>{resource.kind === 'skill' ? <Blocks size={21} strokeWidth={1.7} /> : <FileText size={21} strokeWidth={1.7} />}</div>
                <div className="resource-row-body"><div className="resource-row-heading"><strong>{resource.name}</strong>{resource.readOnly && <span className="badge badge-neutral">只读</span>}{resource.warnings.length > 0 && <TriangleAlert size={13} className="resource-warning-icon" />}</div>
                  <p>{resource.description || '尚未填写说明，打开资源查看内容。'}</p>
                  <div className="resource-row-meta"><span className={'kind-tag ' + (resource.kind === 'rule' ? 'kind-rule' : '')}>{resource.kind === 'skill' ? 'SKILL' : 'RULE'}</span><span>{compatibilityLabel[resource.compatibility]}</span><i />
                    <span>{page === 'local' ? overview?.environments.find((item) => item.id === resource.environmentId)?.name : resource.source.startsWith('本地导入') ? '本地导入' : '新建'}</span>
                  </div>
                </div><div className="resource-row-end"><span>{formatDate(resource.updatedAt)}</span><ArrowUpRight size={15} /></div>
              </button>)}</div>}
            <footer className="list-footer"><span>{page === 'library' ? '技能与规则，集中维护' : '写入后请在目标工具确认加载'}</span><span>UTF-8</span></footer>
          </section>
          {selectedId && <ResourceEditor detail={detail} busy={busy} loading={loadingDetail} onDirty={setDirty} onSave={submitEdit}
            onDelete={() => { if (detail) void prepare(() => api.delete(detail.resource.id, detail.fingerprint)); }}
            onFile={(path) => navigateSafely(() => { void loadDetail(selectedId, path); })}
            onReload={() => navigateSafely(() => { void loadDetail(selectedId, detail?.relativePath); })}
            onClose={() => navigateSafely(clearEditor)}
            onAdopt={() => { if (detail) void prepare(() => api.adopt(detail.resource.id)); }} onMessage={setToast} />}
        </div>
      </>}
      {page === 'projects' && <ProjectsPage projects={overview?.projects ?? []} busy={busy} onAdd={(path) => void changeProject(path)} onRemove={(id) => void removeProject(id)} onError={setError} onOpen={(id) => { clearEditor(); setPage('local'); setEnvironment('claude:project:' + id); setTool('all'); setSearch(''); setKind('all'); }} />}
      {page === 'history' && <HistoryPage operations={operations} loading={historyLoading} busy={busy} onRestore={(id) => void prepare(() => api.restore(id))} />}
      {page === 'settings' && overview && <SettingsPage settings={overview.settings} dataDir={overview.dataDir} busy={busy} onSave={(settings) => void saveSettings(settings)} onError={setError} />}
      <footer className="workspace-footer"><Anchor size={12} /> SkillDock · 给技能一个停靠的地方<span><FolderOpen size={12} /> macOS / Windows</span></footer>
    </main>
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button className="icon-button" onClick={() => setToast(null)} aria-label="关闭通知"><X size={14} /></button></div>}
    {createOpen && <CreateModal environments={overview?.environments ?? []} initialTarget={newTarget} initialKind={kind === 'rule' ? 'rule' : 'skill'} busy={busy} error={formError} onSubmit={submitCreate} onClose={() => setCreateOpen(false)} />}
    {importOpen && <ImportModal busy={busy} error={formError} onSubmit={submitImport} onClose={() => setImportOpen(false)} />}
    {preview && <ReviewModal preview={preview} busy={busy} error={previewError} onApply={() => void applyReview()} onClose={() => { setPreview(null); setPreviewError(null); }} />}
    {leaveAction && <Modal title="当前修改尚未保存" subtitle="离开后，编辑器中的修改会被放弃。" onClose={() => setLeaveAction(null)}>
      <footer className="modal-footer"><button className="button secondary" onClick={() => setLeaveAction(null)}>继续编辑</button><button className="button danger" onClick={() => { const action = leaveAction; setLeaveAction(null); setDirty(false); action(); }}>放弃修改并继续</button></footer>
    </Modal>}
  </div>;
}
