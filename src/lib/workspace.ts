import type { Compatibility, EditFilesInput, Kind, Overview, Resource, ResourceDetail, Tool } from './types';

export const WORKSPACE_KEY = 'skilldock.workspace.v1';
export type Location = 'global' | 'library' | `project:${string}`;
export interface ListView {
  search: string; tool: 'all' | Tool; kind: 'all' | Kind;
  selectedId: string | null; relativePath?: string; scrollTop: number;
}
export interface WorkspacePreferences {
  location: Location; views: Record<string, ListView>; workspaceId: string;
  workspaceLocations: Record<string, Location>;
}
const validLocation = (value: unknown): value is Location => typeof value === 'string'
  && (value === 'global' || value === 'library' || value.startsWith('project:'));
export function workspaceLocation(overview: Overview, workspaceId: string, location: Location): Location {
  return !location.startsWith('project:') || overview.workspaces.find((item) => item.id === workspaceId)?.projectIds
    .some((id) => location === `project:${id}` && overview.projects.some((project) => project.id === id)) ? location : 'global';
}
export function reconcilePreferences(preferences: WorkspacePreferences, overview: Overview): WorkspacePreferences {
  const workspaceId = overview.workspaces.some((item) => item.id === preferences.workspaceId) ? preferences.workspaceId : 'default';
  const location = workspaceLocation(overview, workspaceId, preferences.location);
  return { ...preferences, workspaceId, location };
}
export const emptyView = (): ListView => ({ search: '', tool: 'all', kind: 'all', selectedId: null, scrollTop: 0 });
export interface DraftFile { base: string; content: string }
export interface Draft {
  resource: Resource; location: Location; name: string; compatibility: Compatibility;
  fingerprint: string; files: Record<string, DraftFile>; fileList: ResourceDetail['files'];
  activeFile: string; conflict: boolean; status: 'idle' | 'saving' | 'saved' | 'error'; error: string;
  needsReload?: boolean;
}
export interface Creation {
  id: string; location: Location; kind: Kind; target: string; name: string;
  description: string; body: string; compatibility: Compatibility; error: string; existingId?: string;
}
export const creationDirty = (draft: Creation) => !!(draft.name || draft.description || draft.body);
export function isDirty(draft: Draft) {
  return draft.name !== draft.resource.name || draft.compatibility !== draft.resource.compatibility
    || Object.values(draft.files).some((file) => file.content !== file.base);
}
export function readPreferences(): WorkspacePreferences {
  const result: WorkspacePreferences = { location: 'global', views: {}, workspaceId: 'default', workspaceLocations: {} };
  try {
    const stored = JSON.parse(window.localStorage.getItem(WORKSPACE_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object') return result;
    if (validLocation(stored.location)) result.location = stored.location;
    if (typeof stored.workspaceId === 'string') result.workspaceId = stored.workspaceId;
    if (stored.workspaceLocations && typeof stored.workspaceLocations === 'object') {
      for (const [id, location] of Object.entries(stored.workspaceLocations)) if (validLocation(location)) result.workspaceLocations[id] = location;
    }
    if (stored.views && typeof stored.views === 'object') {
      for (const [key, value] of Object.entries(stored.views)) {
        if (key !== 'global' && key !== 'library' && !key.startsWith('project:')) continue;
        const view = value as Partial<ListView> | null;
        if (!view || typeof view !== 'object') continue;
        result.views[key] = { ...emptyView(),
          tool: view.tool === 'claude' || view.tool === 'codex' ? view.tool : 'all',
          kind: view.kind === 'skill' || view.kind === 'rule' ? view.kind : 'all',
          selectedId: typeof view.selectedId === 'string' && !view.selectedId.startsWith('new:') ? view.selectedId : null,
          relativePath: typeof view.relativePath === 'string' ? view.relativePath : undefined,
        };
      }
    }
  } catch { /* Corrupt or inaccessible preferences never prevent opening the workspace. */ }
  return result;
}
export function writePreferences(preferences: WorkspacePreferences) {
  const views = Object.fromEntries(Object.entries(preferences.views).map(([key, view]) => [key, {
    tool: view.tool, kind: view.kind,
    selectedId: view.selectedId?.startsWith('new:') ? null : view.selectedId, relativePath: view.relativePath,
  }]));
  window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ location: preferences.location, workspaceId: preferences.workspaceId, workspaceLocations: preferences.workspaceLocations, views }));
}
export function resourceLocation(resource: Resource, overview: Overview): Location {
  if (resource.origin === 'library') return 'library';
  const environment = overview.environments.find((item) => item.id === resource.environmentId);
  return environment?.projectId ? `project:${environment.projectId}` : 'global';
}
export function resourcesAt(overview: Overview, location: Location) {
  return overview.resources.filter((resource) => resourceLocation(resource, overview) === location);
}
export function filterResources(resources: Resource[], view: ListView) {
  const search = view.search.trim().toLowerCase();
  return resources.filter((resource) => (view.kind === 'all' || resource.kind === view.kind)
    && (view.tool === 'all' || resource.tool === view.tool || resource.compatibility === 'both' || resource.compatibility === view.tool)
    && [resource.name, resource.description, resource.path].join(' ').toLowerCase().includes(search));
}
export function fromDetail(detail: ResourceDetail, location: Location): Draft {
  return { resource: detail.resource, location, name: detail.resource.name, compatibility: detail.resource.compatibility,
    fingerprint: detail.fingerprint, files: { [detail.relativePath]: { base: detail.content, content: detail.content } },
    fileList: detail.files, activeFile: detail.relativePath, conflict: false, status: 'idle', error: '' };
}
export function mergeDetail(draft: Draft | undefined, detail: ResourceDetail, location: Location): Draft {
  if (!draft || !isDirty(draft)) return fromDetail(detail, location);
  // Keep a single baseline for every file in a resource; never silently rebase a dirty draft.
  if (draft.fingerprint !== detail.fingerprint) return { ...draft, conflict: true, error: '文件已在应用外修改，草稿已保留。请查看差异或重新加载。' };
  return { ...draft, activeFile: detail.relativePath, files: { ...draft.files,
    [detail.relativePath]: draft.files[detail.relativePath] ?? { base: detail.content, content: detail.content } } };
}
export function editFilesInput(draft: Draft): EditFilesInput {
  return { id: draft.resource.id, name: draft.name, compatibility: draft.compatibility, expectedFingerprint: draft.fingerprint,
    files: Object.entries(draft.files).filter(([, file]) => file.base !== file.content).map(([relativePath, file]) => ({ relativePath, content: file.content })) };
}
export function locationLabel(location: Location, overview: Overview | null) {
  if (location === 'global') return '全局配置';
  if (location === 'library') return '资源库';
  return overview?.projects.find((project) => `project:${project.id}` === location)?.name ?? '项目配置';
}
