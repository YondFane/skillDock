import { beforeEach, expect, it } from 'vitest';
import { editFilesInput, emptyView, fromDetail, isDirty, mergeDetail, readPreferences, WORKSPACE_KEY, writePreferences } from './workspace';
import type { ResourceDetail } from './types';
const detail: ResourceDetail = {
  resource: { id: 'asset:test', origin: 'library', kind: 'rule', name: 'test', description: '', compatibility: 'both', environmentId: null, tool: null, scope: 'library', path: '/test', mainFile: 'rule.md', source: '新建', updatedAt: 0, revision: 1, fileCount: 2, readOnly: false, warnings: [] },
  content: 'original', relativePath: 'rule.md', fingerprint: 'baseline', files: [{ path: 'rule.md', editable: true, size: 8 }, { path: 'notes.md', editable: true, size: 4 }],
};
beforeEach(() => window.localStorage.clear());
it('stores navigation preferences without search, scroll positions, drafts or new-resource ids', () => {
  writePreferences({ workspaceId: 'company', workspaceLocations: { company: 'project:one' }, location: 'library', views: { library: { ...emptyView(), search: 'private search', scrollTop: 300, selectedId: 'new:temporary', tool: 'codex' } } });
  const stored = window.localStorage.getItem(WORKSPACE_KEY)!;
  expect(stored).not.toContain('private search'); expect(stored).not.toContain('300'); expect(stored).not.toContain('new:temporary');
  expect(readPreferences().workspaceId).toBe('company'); expect(readPreferences().workspaceLocations.company).toBe('project:one');
  expect(readPreferences().views.library).toMatchObject({ tool: 'codex', search: '', scrollTop: 0, selectedId: null });
});
it('falls back safely for corrupt or malformed preferences', () => {
  window.localStorage.setItem(WORKSPACE_KEY, '{'); expect(readPreferences().location).toBe('global');
  window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ location: '../../invalid', views: { global: { tool: 'bad', kind: 'bad', selectedId: 12 } } }));
  expect(readPreferences()).toEqual({ workspaceId: 'default', workspaceLocations: {}, location: 'global', views: { global: { ...emptyView(), relativePath: undefined } } });
});
it('preserves edits when loading a supporting file with the same baseline', () => {
  const draft = fromDetail(detail, 'library'); draft.files['rule.md'].content = 'edited';
  const merged = mergeDetail(draft, { ...detail, relativePath: 'notes.md', content: 'notes' }, 'library');
  expect(merged.files['rule.md'].content).toBe('edited'); expect(merged.files['notes.md'].content).toBe('notes'); expect(merged.activeFile).toBe('notes.md');
});
it('does not mix different disk snapshots or silently rebase dirty content', () => {
  const draft = fromDetail(detail, 'library'); draft.files['rule.md'].content = 'edited';
  const merged = mergeDetail(draft, { ...detail, fingerprint: 'external', content: 'external version', relativePath: 'notes.md' }, 'library');
  expect(merged.conflict).toBe(true); expect(merged.fingerprint).toBe('baseline'); expect(merged.files['rule.md'].content).toBe('edited'); expect(merged.files['notes.md']).toBeUndefined();
});
it('builds one resource edit with changed files only and allows metadata-only changes', () => {
  const draft = fromDetail(detail, 'library'); draft.files['notes.md'] = { base: 'notes', content: 'changed notes' };
  expect(editFilesInput(draft).files).toEqual([{ relativePath: 'notes.md', content: 'changed notes' }]);
  draft.files['notes.md'].content = 'notes'; draft.compatibility = 'codex';
  expect(isDirty(draft)).toBe(true); expect(editFilesInput(draft).files).toEqual([]);
});
it('replaces clean cached contents after a disk refresh', () => {
  const merged = mergeDetail(fromDetail(detail, 'library'), { ...detail, content: 'fresh', fingerprint: 'fresh' }, 'library');
  expect(merged.files['rule.md'].content).toBe('fresh'); expect(isDirty(merged)).toBe(false);
});
