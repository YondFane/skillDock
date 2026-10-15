import { useCallback, useEffect, useRef, useState } from 'react';
import { api, desktopAvailable } from './api';
import { exitWorkspace, listenForExit } from './lifecycle';
import type { ChangePreview, Overview, Settings } from './types';
import { errorMessage } from './types';
import { creationDirty, editFilesInput, emptyView, filterResources, fromDetail, isDirty, mergeDetail, readPreferences, reconcilePreferences, workspaceLocation, resourceLocation, resourcesAt, writePreferences,
  type Creation, type Draft, type ListView, type Location } from './workspace';

export function useWorkspace() {
  const [preferences, setPreferences] = useState(readPreferences);
  const preferencesRef = useRef(preferences); preferencesRef.current = preferences;
  const [page, setPage] = useState<'workspace' | 'history' | 'settings'>('workspace');
  const [overview, setOverview] = useState<Overview | null>(null);
  const overviewRef = useRef(overview); overviewRef.current = overview;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftsRef = useRef(drafts);
  const [creations, setCreations] = useState<Record<string, Creation>>({});
  const creationsRef = useRef(creations);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const settingsRef = useRef(settingsDraft); settingsRef.current = settingsDraft;
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState<string[]>([]);
  const [writes, setWrites] = useState<string[]>([]);
  const writeLocks = useRef(new Set<string>());
  const requests = useRef<Record<string, number>>({});
  const scan = useRef<Promise<Overview | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; resourceId?: string } | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const exiting = useRef(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const updateBusyRef = useRef(updateBusy); updateBusyRef.current = updateBusy;
  const [preferenceError, setPreferenceError] = useState('');
  const positions = useRef<Record<string, { anchor: number; head: number; scrollTop: number }>>({});

  const putDraft = useCallback((id: string, next?: Draft) => {
    const result = { ...draftsRef.current };
    if (next) result[id] = next; else delete result[id];
    draftsRef.current = result; setDrafts(result);
  }, []);
  const putCreation = (id: string, next?: Creation) => {
    const result = { ...creationsRef.current };
    if (next) result[id] = next; else delete result[id];
    creationsRef.current = result; setCreations(result);
  };
  const patchView = useCallback((patch: Partial<ListView>, location = preferencesRef.current.location) => {
    const current = preferencesRef.current;
    const next = { ...current, views: { ...current.views, [location]: { ...(current.views[location] ?? emptyView()), ...patch } } };
    preferencesRef.current = next; setPreferences(next);
  }, []);
  const navigate = (location: Location) => {
    const current = preferencesRef.current;
    const next = { ...current, location, workspaceLocations: { ...current.workspaceLocations, [current.workspaceId]: location } };
    preferencesRef.current = next; setPreferences(next); setPage('workspace');
  };
  const switchWorkspace = (workspaceId: string, fresh = overviewRef.current) => {
    if (!fresh?.workspaces.some((item) => item.id === workspaceId)) return;
    const current = preferencesRef.current;
    const location = workspaceLocation(fresh, workspaceId, current.workspaceLocations[workspaceId] ?? 'global');
    const next = { ...current, workspaceId, location, workspaceLocations: { ...current.workspaceLocations, [current.workspaceId]: current.location } };
    preferencesRef.current = next; setPreferences(next); setPage('workspace');
  };
  const beginWrite = (key: string) => {
    if (writeLocks.current.has(key) || updateBusyRef.current) return false;
    writeLocks.current.add(key); setWrites([...writeLocks.current]); return true;
  };
  const endWrite = (key: string) => { writeLocks.current.delete(key); setWrites([...writeLocks.current]); };

  const loadResource = useCallback(async (id: string, relativePath?: string, force = false) => {
    const existing = draftsRef.current[id];
    if (!force && existing && isDirty(existing) && (!relativePath || existing.files[relativePath])) {
      if (relativePath) putDraft(id, { ...existing, activeFile: relativePath });
      return;
    }
    const request = (requests.current[id] ?? 0) + 1; requests.current[id] = request;
    setLoadingFiles((current) => [...current.filter((key) => key !== id), id]);
    try {
      const detail = await api.detail(id, relativePath);
      if (requests.current[id] !== request) return;
      const current = draftsRef.current[id];
      const location = overviewRef.current ? resourceLocation(detail.resource, overviewRef.current) : 'global';
      putDraft(id, mergeDetail(current, detail, location));
    } catch (failure) {
      if (requests.current[id] !== request) return;
      const current = draftsRef.current[id];
      if (current) putDraft(id, { ...current, status: 'error', conflict: isDirty(current), error: errorMessage(failure) });
      else setError(errorMessage(failure));
    } finally {
      if (requests.current[id] === request) setLoadingFiles((current) => current.filter((key) => key !== id));
    }
  }, [putDraft]);

  const refresh = useCallback((checkDrafts = true): Promise<Overview | null> => {
    if (scan.current) return scan.current;
    setLoading(true);
    const task = (async () => {
      try {
        const fresh = await api.overview(); overviewRef.current = fresh; setOverview(fresh); setError(null);
        const next = reconcilePreferences(preferencesRef.current, fresh);
        preferencesRef.current = next; setPreferences(next);
        if (checkDrafts) {
          await Promise.all(Object.values(draftsRef.current).filter((draft) => isDirty(draft) && draft.status !== 'saving').map(async (draft) => {
            try {
              const detail = await api.detail(draft.resource.id, draft.activeFile);
              const current = draftsRef.current[draft.resource.id];
              if (current && isDirty(current) && current.status !== 'saving' && current.fingerprint !== detail.fingerprint)
                putDraft(draft.resource.id, { ...current, conflict: true, error: '文件已在应用外修改，草稿已保留。请查看差异或重新加载。' });
            } catch (failure) {
              const current = draftsRef.current[draft.resource.id];
              if (current && isDirty(current)) putDraft(draft.resource.id, { ...current, conflict: true, error: errorMessage(failure) });
            }
          }));
        }
        return fresh;
      } catch (failure) { setError(errorMessage(failure)); return null; }
      finally { setLoading(false); scan.current = null; }
    })();
    scan.current = task; return task;
  }, [putDraft]);
  const refreshAfterWrite = async () => {
    if (scan.current) await scan.current;
    return refresh(false);
  };

  useEffect(() => {
    if (!desktopAvailable) { setLoading(false); setError('请通过桌面版本使用本地文件功能。开发时运行 npm run tauri dev。'); return; }
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  useEffect(() => {
    try { writePreferences(preferences); setPreferenceError(''); }
    catch { setPreferenceError('工作区偏好未能保存，本次导航仍然有效。'); }
  }, [preferences]);

  const view = preferences.views[preferences.location] ?? emptyView();
  const selectedId = view.selectedId;
  useEffect(() => {
    if (page !== 'workspace' || !overview || !selectedId || selectedId.startsWith('new:')) return;
    if (!overview.resources.some((resource) => resource.id === selectedId) && !draftsRef.current[selectedId]) { patchView({ selectedId: null }); return; }
    if (draftsRef.current[selectedId]?.status !== 'saving') void loadResource(selectedId, view.relativePath);
  }, [selectedId, preferences.location, page, overview, loadResource, patchView, view.relativePath]);

  const selectResource = (id: string, relativePath?: string) => {
    patchView({ selectedId: id, relativePath: relativePath ?? draftsRef.current[id]?.activeFile });
  };
  const jumpTo = (id: string) => {
    const draft = draftsRef.current[id]; const creation = creationsRef.current[id];
    const resource = overviewRef.current?.resources.find((item) => item.id === id);
    const location = creation?.location ?? draft?.location ?? (resource && overviewRef.current ? resourceLocation(resource, overviewRef.current) : id.startsWith('asset:') ? 'library' : 'global');
    if (location.startsWith('project:') && overviewRef.current) {
      const groups = overviewRef.current.workspaces;
      const current = preferencesRef.current.workspaceId;
      const group = groups.find((item) => item.id === current && item.projectIds.includes(location.slice(8)))
        ?? groups.find((item) => item.projectIds.includes(location.slice(8)));
      if (group && group.id !== current) switchWorkspace(group.id);
    }
    navigate(location);
    if (!creation && !draft && !resource) {
      // A write can succeed even when the following overview refresh fails.
      void loadResource(id).then(() => { if (draftsRef.current[id]) patchView({ selectedId: id }, location); });
    } else patchView({ selectedId: id, relativePath: draft?.activeFile }, location);
  };
  const updateDraft = (patch: Partial<Draft>) => {
    const current = selectedId ? draftsRef.current[selectedId] : null;
    if (!current || current.status === 'saving' || current.needsReload) return;
    putDraft(current.resource.id, { ...current, ...patch, status: 'idle', error: current.conflict ? current.error : '' });
  };
  const saveResource = async (id: string): Promise<boolean> => {
    const draft = draftsRef.current[id];
    if (!draft || !isDirty(draft)) return true;
    if (draft.conflict || draft.resource.readOnly || draft.needsReload || !beginWrite(id)) return false;
    requests.current[id] = (requests.current[id] ?? 0) + 1;
    setLoadingFiles((current) => current.filter((key) => key !== id));
    putDraft(id, { ...draft, status: 'saving', error: '' });
    let committed = false;
    try {
      const change = await api.editFiles(editFilesInput(draft));
      await api.apply(change.id); committed = true;
      const clean: Draft = { ...draft, resource: { ...draft.resource, name: draft.name, compatibility: draft.compatibility },
        files: Object.fromEntries(Object.entries(draft.files).map(([path, file]) => [path, { base: file.content, content: file.content }])),
        status: 'saved', error: '', needsReload: true };
      putDraft(id, clean);
      const detail = await api.detail(id, draft.activeFile);
      putDraft(id, { ...fromDetail(detail, draft.location), status: 'saved' });
      const fresh = await refreshAfterWrite();
      setToast({ message: fresh ? '已保存，修改前的完整文件已备份。' : '已保存，刷新失败，请重新扫描。' });
      return true;
    } catch (failure) {
      const current = draftsRef.current[id] ?? draft;
      const conflict = typeof failure === 'object' && failure && 'code' in failure && (failure.code === 'conflict' || failure.code === 'notFound' || failure.code === 'readOnly');
      putDraft(id, { ...current, status: committed ? 'saved' : 'error', conflict: !!conflict,
        needsReload: committed, error: committed ? '已保存，重新读取失败。请重新加载后继续编辑。' : errorMessage(failure) });
      return committed;
    } finally { endWrite(id); }
  };

  const newResource = (kind: Creation['kind']) => {
    if (!overviewRef.current || updateBusyRef.current) return;
    const location = preferencesRef.current.location;
    const currentView = preferencesRef.current.views[location] ?? emptyView();
    const environment = overviewRef.current.environments.find((item) => !item.readOnly && item.tool === currentView.tool
      && (location === 'global' ? !item.projectId && item.scope === 'global' : `project:${item.projectId}` === location));
    const id = `new:${crypto.randomUUID()}`;
    putCreation(id, { id, location, kind, target: location === 'library' ? 'library' : environment?.id ?? '',
      name: '', description: '', body: '', compatibility: 'both', error: '' });
    patchView({ selectedId: id });
  };
  const updateCreation = (patch: Partial<Creation>) => {
    const current = selectedId ? creationsRef.current[selectedId] : null;
    if (current && !writeLocks.current.has(current.id)) putCreation(current.id, { ...current, ...patch, error: '', existingId: undefined });
  };
  const createResource = async (id: string): Promise<boolean> => {
    const draft = creationsRef.current[id];
    if (!draft) return true;
    if (!draft.target || !draft.name.trim() || !draft.body.trim() || (draft.kind === 'skill' && !draft.description.trim())) {
      putCreation(id, { ...draft, error: '请填写名称、内容，并明确选择目标工具；技能还需要触发说明。' }); jumpTo(id); return false;
    }
    if (!beginWrite(id)) return false;
    try {
      const content = draft.kind === 'skill' ? ['---', 'name: ' + draft.name.trim(), 'description: ' + JSON.stringify(draft.description.trim()), '---', '', draft.body].join('\n') : draft.body;
      const change = await api.create({ target: draft.target, kind: draft.kind, name: draft.name.trim(), compatibility: draft.compatibility, content });
      const result = await api.apply(change.id);
      putCreation(id);
      const fresh = await refreshAfterWrite();
      if (preferencesRef.current.views[draft.location]?.selectedId === id) patchView({ selectedId: fresh ? result.resourceId : null, relativePath: undefined }, draft.location);
      setToast({ message: fresh ? '资源已创建。' : '资源已创建，刷新失败，请重新扫描。' });
      return true;
    } catch (failure) {
      const fresh = await refreshAfterWrite();
      const candidates = fresh?.resources.filter((resource) => resource.environmentId === draft.target && resource.kind === draft.kind) ?? [];
      const exactId = typeof failure === 'object' && failure && 'existingResourceId' in failure && typeof failure.existingResourceId === 'string' ? failure.existingResourceId : undefined;
      const existing = fresh?.resources.find((resource) => resource.id === exactId) ?? candidates.find((resource) => resource.name.toLowerCase() === draft.name.trim().toLowerCase())
        ?? (draft.kind === 'rule' && fresh?.environments.find((item) => item.id === draft.target)?.tool === 'codex'
          ? candidates.find((resource) => resource.mainFile === 'AGENTS.override.md') ?? candidates.find((resource) => resource.mainFile === 'AGENTS.md') : undefined);
      putCreation(id, { ...draft, error: errorMessage(failure), existingId: existing?.id });
      return false;
    } finally { endWrite(id); }
  };
  const immediate = async (key: string, request: () => Promise<ChangePreview>): Promise<boolean> => {
    if (!beginWrite(key)) return false;
    try {
      const change = await request(); const result = await api.apply(change.id);
      const fresh = await refreshAfterWrite();
      setToast({ message: fresh ? '已收录到资源库。' : '已收录，刷新失败，请重新扫描。', resourceId: result.resourceId ?? undefined });
      return true;
    } catch (failure) { throw failure; }
    finally { endWrite(key); }
  };
  const prepareDelete = async (id: string) => {
    const draft = draftsRef.current[id];
    if (!draft || isDirty(draft) || !beginWrite(id)) return;
    try { setPreview(await api.delete(id, draft.fingerprint)); setPreviewError(null); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { endWrite(id); }
  };
  const prepareRestore = async (id: string) => {
    if (Object.values(draftsRef.current).some(isDirty)) { setError('请先保存或放弃资源草稿，再恢复历史版本。'); return; }
    if (!beginWrite('restore')) return;
    try { setPreview(await api.restore(id)); setPreviewError(null); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { endWrite('restore'); }
  };
  const applyReview = async () => {
    if (!preview || !beginWrite('review')) return;
    try {
      const result = await api.apply(preview.id);
      const target = Object.values(draftsRef.current).find((draft) => draft.resource.path === preview.targetPath);
      if (target) {
        putDraft(target.resource.id); delete positions.current[target.resource.id];
        if (!result.resourceId) patchView({ selectedId: null, relativePath: undefined }, target.location);
      }
      setPreview(null); setToast({ message: result.message });
      const fresh = await refreshAfterWrite();
      if (!fresh) setToast({ message: '操作已完成，刷新失败，请重新扫描。' });
    } catch (failure) { setPreviewError(errorMessage(failure)); }
    finally { endWrite('review'); }
  };
  const reload = async (id: string) => {
    const draft = draftsRef.current[id];
    putDraft(id); await loadResource(id, draft?.activeFile, true);
  };
  const discard = (id: string) => {
    if (creationsRef.current[id]) { putCreation(id); if (selectedId === id) patchView({ selectedId: null }); }
    else { void reload(id); }
  };
  const updateOverview = (fresh: Overview) => {
    overviewRef.current = fresh; setOverview(fresh);
    const next = reconcilePreferences(preferencesRef.current, fresh);
    preferencesRef.current = next; setPreferences(next);
  };
  const manageWorkspace = async (action: 'create' | 'rename' | 'delete', id: string, name = '') => {
    if (!beginWrite('project')) return false;
    try {
      if (scan.current) await scan.current;
      const knownIds = new Set(overviewRef.current?.workspaces.map((item) => item.id));
      const fresh = action === 'create' ? await api.createWorkspace(name)
        : action === 'rename' ? await api.renameWorkspace(id, name) : await api.deleteWorkspace(id);
      updateOverview(fresh);
      const created = action === 'create' && fresh.workspaces.find((item) => !knownIds.has(item.id));
      if (created) switchWorkspace(created.id, fresh);
      setToast({ message: action === 'create' ? '工作区已创建，可添加项目。' : action === 'rename' ? '工作区已重命名。' : '工作区已删除，项目文件已保留。' });
      return true;
    } finally { endWrite('project'); }
  };
  const addProjects = async (paths: string[], workspaceId: string) => {
    if (!paths.length || !beginWrite('project')) return null;
    try {
      if (scan.current) await scan.current;
      const result = await api.addProjects(workspaceId, paths);
      updateOverview(result.overview);
      if (paths.length === 1 && result.addedProjectIds.length === 1 && preferencesRef.current.workspaceId === workspaceId)
        navigate(`project:${result.addedProjectIds[0]}`);
      setToast({ message: `已添加 ${result.addedProjectIds.length} 个项目` + (result.alreadyPresent ? `，${result.alreadyPresent} 个已在工作区中` : '') + '。' });
      return result;
    } finally { endWrite('project'); }
  };
  const removeProject = async (id: string, workspaceId = preferencesRef.current.workspaceId) => {
    const location: Location = `project:${id}`;
    if (Object.values(draftsRef.current).some((draft) => draft.location === location && isDirty(draft)) || Object.values(creationsRef.current).some((draft) => draft.location === location && creationDirty(draft))) {
      throw new Error('该项目有未保存草稿，请先保存或放弃，再从工作区移除。');
    }
    if (!beginWrite('project')) return;
    try {
      if (scan.current) await scan.current;
      const fresh = await api.removeProjectFromWorkspace(workspaceId, id); updateOverview(fresh);
      if (!fresh.projects.some((item) => item.id === id)) {
        Object.values(draftsRef.current).filter((draft) => draft.location === location).forEach((draft) => putDraft(draft.resource.id));
        Object.values(creationsRef.current).filter((draft) => draft.location === location).forEach((draft) => putCreation(draft.id));
      }
      setToast({ message: '已从工作区移除，项目文件已保留。' });
    } finally { endWrite('project'); }
  };
  const saveSettings = async (): Promise<boolean> => {
    const settings = settingsRef.current;
    if (!settings) return true;
    if (!beginWrite('settings')) return false;
    try {
      if (scan.current) await scan.current;
      const fresh = await api.settings(settings); overviewRef.current = fresh; setOverview(fresh);
      settingsRef.current = null; setSettingsDraft(null); setToast({ message: '工具目录已保存并重新扫描。' }); return true;
    } catch (failure) { setError(errorMessage(failure)); return false; }
    finally { endWrite('settings'); }
  };
  const saveAll = async () => {
    for (const draft of Object.values(draftsRef.current).filter(isDirty)) {
      if (!await saveResource(draft.resource.id)) { jumpTo(draft.resource.id); return false; }
    }
    for (const draft of Object.values(creationsRef.current).filter(creationDirty)) {
      if (!await createResource(draft.id)) { jumpTo(draft.id); return false; }
    }
    const saved = await saveSettings();
    if (!saved) setPage('settings');
    return saved;
  };
  const hasChanges = () => Object.values(draftsRef.current).some(isDirty) || Object.values(creationsRef.current).some(creationDirty) || !!settingsRef.current;
  const requestExitRef = useRef(() => {});
  requestExitRef.current = () => {
    if (writeLocks.current.size || updateBusyRef.current) { setError('当前操作尚未完成，请稍后退出。'); return; }
    if (hasChanges()) setExitOpen(true); else void exitWorkspace().catch((failure) => setError(errorMessage(failure)));
  };
  useEffect(() => {
    let active = true; let cleanup: (() => void) | undefined;
    void listenForExit(() => requestExitRef.current()).then((unlisten) => { if (active) cleanup = unlisten; else unlisten(); }).catch((failure) => setError('退出保护初始化失败：' + errorMessage(failure)));
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!exiting.current && (hasChanges() || writeLocks.current.size)) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { active = false; cleanup?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  const finishExit = async (save: boolean) => {
    if (writeLocks.current.size || updateBusyRef.current) return;
    setExitBusy(true);
    try {
      if (!save || await saveAll()) { exiting.current = true; await exitWorkspace(); }
      else setExitOpen(false);
    }
    catch (failure) { exiting.current = false; setError(errorMessage(failure)); }
    finally { setExitBusy(false); }
  };
  const saveShortcutRef = useRef(() => {});
  saveShortcutRef.current = () => {
    if (updateBusyRef.current || page !== 'workspace' || !selectedId) return;
    if (selectedId.startsWith('new:')) void createResource(selectedId); else void saveResource(selectedId);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveShortcutRef.current(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  const base = overview ? resourcesAt(overview, preferences.location) : [];
  const dirtyDrafts = Object.values(drafts).filter(isDirty);
  const dirtyCreations = Object.values(creations).filter(creationDirty);
  const dirtyCount = dirtyDrafts.length + dirtyCreations.length + Number(!!settingsDraft);
  const resource = selectedId ? drafts[selectedId] : undefined;
  const creation = selectedId ? creations[selectedId] : undefined;
  const activeWorkspace = overview?.workspaces.find((item) => item.id === preferences.workspaceId);
  const workspaceProjects = overview?.projects.filter((item) => activeWorkspace?.projectIds.includes(item.id)) ?? [];
  return { workspaceId: preferences.workspaceId, activeWorkspace, workspaceProjects, switchWorkspace, manageWorkspace, overview, page, setPage, location: preferences.location, navigate, view, patchView, base,
    list: filterResources(base, view), selectedId, resource, creation, drafts, creations, dirtyDrafts, dirtyCreations, dirtyCount,
    loading, loadingFiles, writes, updateBusy, setUpdateBusy, error, setError, toast, setToast, preferenceError,
    preview, previewError, setPreview, refresh, selectResource, jumpTo, updateDraft, saveResource, newResource, updateCreation, createResource,
    immediate, prepareDelete, prepareRestore, applyReview, discard, reload, addProjects, removeProject,
    settingsDraft, setSettingsDraft, saveSettings, saveAll, exitOpen, setExitOpen, exitBusy, finishExit, positions };
}
