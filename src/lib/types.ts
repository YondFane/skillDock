export type Kind = 'skill' | 'rule';
export type Compatibility = 'both' | 'claude' | 'codex';
export type Tool = 'claude' | 'codex';
export type Origin = 'library' | 'local';
export type Page = 'library' | 'local' | 'projects' | 'history' | 'settings';

export interface Settings { claudeRoot: string; codexRoot: string; codexSkillsRoot: string }
export interface Project { id: string; name: string; path: string }
export interface Environment {
  id: string; name: string; tool: Tool; scope: string; projectId: string | null;
  root: string; skillsRoot: string; rulesRoot: string | null; instructionFiles: string[]; readOnly: boolean;
}
export interface Resource {
  id: string; origin: Origin; kind: Kind; name: string; description: string;
  compatibility: Compatibility; environmentId: string | null; tool: Tool | null;
  scope: string; path: string; mainFile: string; source: string; updatedAt: number; revision: number;
  fileCount: number; readOnly: boolean; warnings: string[];
}
export interface ResourceFile { path: string; size: number; editable: boolean }
export interface ResourceDetail {
  resource: Resource; content: string; relativePath: string; fingerprint: string; files: ResourceFile[];
}
export interface Overview {
  resources: Resource[]; environments: Environment[]; projects: Project[];
  settings: Settings; dataDir: string; warnings: string[];
}
export interface CreateInput {
  target: string; kind: Kind; name: string; compatibility: Compatibility; content: string;
}
export interface EditInput {
  id: string; name: string; compatibility: Compatibility; relativePath: string;
  content: string; expectedFingerprint: string;
}
export interface ChangePreview {
  id: string; action: string; name: string; targetPath: string; beforeContent: string; afterContent: string;
  changedFiles: string[]; totalFiles: number; removesResource: boolean; warnings: string[];
}
export interface Operation {
  id: string; action: string; name: string; origin: Origin; targetPath: string;
  status: string; createdAt: number; canRestore: boolean; error: string | null;
}
export interface ApplyResult { resourceId: string | null; operationId: string; message: string }
export interface AppError { code: string; message: string }

export const compatibilityLabel: Record<Compatibility, string> = { both: 'Claude + Codex', claude: 'Claude Code', codex: 'Codex' };
export const actionLabel: Record<string, string> = { create: '新建', edit: '编辑', delete: '删除', import: '导入', restore: '恢复' };
export const statusLabel: Record<string, string> = { completed: '已完成', failed: '失败 · 已回退', pending: '进行中', interrupted: '中断 · 已回退', needsRecovery: '需要恢复' };
export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String(error.message);
  return typeof error === 'string' ? error : '操作未完成，请重试。';
}
export function formatDate(time: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(time || Date.now());
}
