import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { AddProjectsResult, ApplyResult, ChangePreview, Compatibility, CreateInput, EditFilesInput, EditInput, Operation, Overview, ResourceDetail, Settings } from './types';

export const desktopAvailable = isTauri();

export const api = {
  overview: () => invoke<Overview>('get_overview'),
  detail: (id: string, relativePath?: string) => invoke<ResourceDetail>('get_resource', { id, relativePath: relativePath ?? null }),
  create: (input: CreateInput) => invoke<ChangePreview>('preview_create', { input }),
  edit: (input: EditInput) => invoke<ChangePreview>('preview_edit', { input }),
  editFiles: (input: EditFilesInput) => invoke<ChangePreview>('preview_edit_files', { input }),
  delete: (id: string, expectedFingerprint: string) => invoke<ChangePreview>('preview_delete', { id, expectedFingerprint }),
  import: (path: string, compatibility: Compatibility) => invoke<ChangePreview>('preview_import', { path, compatibility }),
  adopt: (id: string) => invoke<ChangePreview>('preview_adopt', { id }),
  apply: (previewId: string) => invoke<ApplyResult>('apply_changes', { previewId }),
  history: () => invoke<Operation[]>('get_history'),
  restore: (operationId: string) => invoke<ChangePreview>('preview_restore', { operationId }),
  addProject: (path: string) => invoke<Overview>('add_project', { path }),
  removeProject: (id: string) => invoke<Overview>('remove_project', { id }),
  createWorkspace: (name: string) => invoke<Overview>('create_workspace', { name }),
  renameWorkspace: (id: string, name: string) => invoke<Overview>('rename_workspace', { id, name }),
  deleteWorkspace: (id: string) => invoke<Overview>('delete_workspace', { id }),
  addProjects: (workspaceId: string, paths: string[]) => invoke<AddProjectsResult>('add_projects_to_workspace', { workspaceId, paths }),
  removeProjectFromWorkspace: (workspaceId: string, projectId: string) => invoke<Overview>('remove_project_from_workspace', { workspaceId, projectId }),
  settings: (settings: Settings) => invoke<Overview>('save_settings', { settings }),
};

export async function chooseFolder(title: string): Promise<string | null> {
  const result = await open({ title, directory: true, multiple: false });
  return typeof result === 'string' ? result : null;
}
export async function chooseFolders(title: string): Promise<string[]> {
  const result = await open({ title, directory: true, multiple: true });
  return Array.isArray(result) ? result : typeof result === 'string' ? [result] : [];
}
export async function chooseMarkdown(): Promise<string | null> {
  const result = await open({ title: '选择 Markdown 规则文件', multiple: false, filters: [{ name: 'Markdown', extensions: ['md'] }] });
  return typeof result === 'string' ? result : null;
}
