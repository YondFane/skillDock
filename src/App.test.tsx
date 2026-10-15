import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { chooseFolders } from './lib/api';
import type { ChangePreview, Overview, Resource, ResourceDetail } from './lib/types';

const service = vi.hoisted(() => ({ overview: vi.fn(), detail: vi.fn(), create: vi.fn(), editFiles: vi.fn(), delete: vi.fn(), import: vi.fn(), adopt: vi.fn(), apply: vi.fn(), history: vi.fn(), restore: vi.fn(), addProjects: vi.fn(), removeProjectFromWorkspace: vi.fn(), createWorkspace: vi.fn(), renameWorkspace: vi.fn(), deleteWorkspace: vi.fn(), settings: vi.fn() }));
const lifecycle = vi.hoisted(() => ({ handler: (() => {}) as () => void, exit: vi.fn() }));
vi.mock('./lib/api', () => ({ api: service, desktopAvailable: true, chooseFolder: vi.fn(), chooseFolders: vi.fn(), chooseMarkdown: vi.fn() }));
vi.mock('./lib/lifecycle', () => ({ listenForExit: async (handler: () => void) => { lifecycle.handler = handler; return () => {}; }, exitWorkspace: lifecycle.exit }));
vi.mock('@uiw/react-codemirror', () => ({ default: ({ value, onChange, readOnly, editable }: { value: string; onChange: (value: string) => void; readOnly?: boolean; editable?: boolean }) => <textarea aria-label="资源内容" value={value} readOnly={readOnly || editable === false} onChange={(event) => onChange(event.target.value)} /> }));

const resource: Resource = { id: 'local:review', origin: 'local', kind: 'skill', name: 'review-skill', description: '审查代码时使用', compatibility: 'codex', environmentId: 'codex:global', tool: 'codex', scope: 'global', path: '/test/home/.agents/skills/review-skill', mainFile: 'SKILL.md', source: '本地', updatedAt: 1791973710000, revision: 0, fileCount: 2, readOnly: false, warnings: [] };
const content = '---\nname: review-skill\ndescription: 审查代码时使用\n---\n\n# 原始步骤';
const second: Resource = { ...resource, id: 'local:second', name: 'second-skill', path: '/test/home/.agents/skills/second-skill' };
const empty: Overview = { resources: [], environments: [
  { id: 'claude:global', name: 'Claude Code · 全局', tool: 'claude', scope: 'global', projectId: null, root: '/test/home/.claude', skillsRoot: '/test/home/.claude/skills', rulesRoot: '/test/home/.claude/rules', instructionFiles: [], readOnly: false },
  { id: 'codex:global', name: 'Codex · 全局', tool: 'codex', scope: 'global', projectId: null, root: '/test/home/.codex', skillsRoot: '/test/home/.agents/skills', rulesRoot: null, instructionFiles: ['/test/home/.codex/AGENTS.md'], readOnly: false },
], projects: [], workspaces: [{ id: 'default', name: '默认工作区', projectIds: [] }], settings: { claudeRoot: '/test/home/.claude', codexRoot: '/test/home/.codex', codexSkillsRoot: '/test/home/.agents/skills' }, dataDir: '/test/data', warnings: [] };
const preview: ChangePreview = { id: 'preview-1', action: 'edit', name: resource.name, targetPath: resource.path, beforeContent: content, afterContent: content + '\n- 新步骤', changedFiles: ['SKILL.md'], totalFiles: 2, removesResource: false, warnings: [] };
let data: Record<string, { resource: Resource; files: Record<string, string>; fingerprint: string }>;
let overview: Overview;
let sequence: number;
function seed(item: Resource, main = content) { data[item.id] = { resource: item, files: { [item.mainFile]: main, 'references/guide.md': 'original guide' }, fingerprint: 'baseline-' + item.id }; }
function detail(id: string, path?: string): ResourceDetail {
  const entry = data[id]; if (!entry) throw { code: 'notFound', message: '资源已被移除' };
  const relativePath = path ?? entry.resource.mainFile;
  return { resource: entry.resource, content: entry.files[relativePath], fingerprint: entry.fingerprint, relativePath, files: Object.keys(entry.files).map((path) => ({ path, size: 100, editable: true })) };
}
beforeEach(() => {
  vi.resetAllMocks(); window.localStorage.clear(); Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true }); data = {}; sequence = 0; overview = structuredClone(empty);
  seed({ ...resource }); seed({ ...second });
  service.overview.mockImplementation(async () => ({ ...overview, resources: Object.values(data).map((entry) => entry.resource) }));
  service.detail.mockImplementation(async (id, path) => detail(id, path));
  service.editFiles.mockResolvedValue(preview); service.create.mockResolvedValue({ ...preview, action: 'create' });
  service.import.mockResolvedValue({ ...preview, action: 'import' }); service.adopt.mockResolvedValue({ ...preview, action: 'import' });
  service.history.mockResolvedValue([]);
  service.apply.mockImplementation(async () => {
    const input = service.editFiles.mock.calls.at(-1)?.[0];
    if (input && data[input.id]) {
      for (const file of input.files) data[input.id].files[file.relativePath] = file.content;
      data[input.id].fingerprint = 'saved-' + ++sequence;
    }
    return { resourceId: input?.id ?? resource.id, operationId: 'operation-' + ++sequence, message: '操作完成' };
  });
});
afterEach(cleanup);
async function openEditor() {
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: /review-skill/ }));
  await screen.findByRole('textbox', { name: '资源内容' }); return user;
}
const editor = () => screen.getByRole('textbox', { name: '资源内容' });
async function more(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByLabelText('资源更多操作')); }

describe('project-first workspace', () => {
  it('directly saves with the baseline fingerprint and one apply, without a review dialog', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- 新步骤');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(service.apply).toHaveBeenCalledTimes(1));
    expect(service.editFiles).toHaveBeenCalledWith({ id: resource.id, name: resource.name, compatibility: 'codex', expectedFingerprint: 'baseline-' + resource.id, files: [{ relativePath: 'SKILL.md', content: content + '\n- 新步骤' }] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
  });
  it('keeps drafts across resources, pages, and closing the viewer', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- 未保存');
    await user.click(screen.getByRole('button', { name: /second-skill/ })); await waitFor(() => expect(editor()).toHaveValue(content));
    await user.click(screen.getByRole('button', { name: /review-skill/ })); await waitFor(() => expect(editor()).toHaveValue(content + '\n- 未保存'));
    await user.click(screen.getByRole('button', { name: '关闭编辑器' }));
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: /草稿/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /review-skill/ }));
    await waitFor(() => expect(editor()).toHaveValue(content + '\n- 未保存'));
    await user.click(screen.getByRole('button', { name: '设置' }));
    await user.click(screen.getByRole('button', { name: '全局配置' }));
    await waitFor(() => expect(editor()).toHaveValue(content + '\n- 未保存'));
    expect(service.apply).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('saves drafts in multiple supporting files as one operation', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- main edit');
    await user.selectOptions(screen.getByLabelText('当前资源文件'), 'references/guide.md');
    await waitFor(() => expect(editor()).toHaveValue('original guide'));
    await user.type(editor(), '\nreference edit');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(service.apply).toHaveBeenCalledTimes(1));
    expect(service.editFiles.mock.calls[0][0].files).toEqual([{ relativePath: 'SKILL.md', content: content + '\n- main edit' }, { relativePath: 'references/guide.md', content: 'original guide\nreference edit' }]);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
  });
  it('preserves project-specific filters and selection when switching locations', async () => {
    overview.projects = [{ id: 'one', name: 'Project One', path: '/project/one' }, { id: 'two', name: 'Project Two', path: '/project/two' }];
    overview.workspaces[0].projectIds = ['one', 'two'];
    for (const project of overview.projects) overview.environments.push({ ...empty.environments[1], id: 'codex:project:' + project.id, projectId: project.id, scope: 'project' });
    seed({ ...resource, id: 'project:one-resource', environmentId: 'codex:project:one', name: 'project-review' });
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Project One' }));
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    await user.type(screen.getByLabelText('搜索资源'), 'project');
    await user.click(await screen.findByRole('button', { name: /project-review/ }));
    await user.click(screen.getByRole('button', { name: 'Project Two' }));
    expect(screen.getByLabelText('搜索资源')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Project One' }));
    expect(screen.getByLabelText('搜索资源')).toHaveValue('project');
    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('textbox', { name: '资源内容' })).toHaveValue(content);
  });
  it('preserves the draft and blocks saves when another program changes the resource', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- local');
    data[resource.id].files['SKILL.md'] = content + '\n- external'; data[resource.id].fingerprint = 'external';
    fireEvent.focus(window);
    expect(await screen.findByRole('alert')).toHaveTextContent('草稿已保留');
    expect(editor()).toHaveValue(content + '\n- local'); expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    await more(user); await user.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('重新加载并放弃草稿');
    await user.click(screen.getByRole('button', { name: '取消' })); expect(editor()).toHaveValue(content + '\n- local');
    await user.click(screen.getByRole('button', { name: '重新加载' }));
    await user.click(screen.getByRole('button', { name: '放弃并重新加载' }));
    await waitFor(() => expect(editor()).toHaveValue(content + '\n- external'));
  });
  it('does not lose drafts when save validation fails', async () => {
    const user = await openEditor(); service.editFiles.mockRejectedValue({ code: 'validation', message: '技能内容无效' });
    await user.type(editor(), '\ninvalid'); await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('技能内容无效'); expect(editor()).toHaveValue(content + '\ninvalid');
    expect(service.apply).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });
  it('distinguishes successful writes from refresh failures and never reapplies a clean save', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- saved'); service.overview.mockRejectedValueOnce('scan failed');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('已保存，刷新失败，请重新扫描。')).toBeVisible();
    fireEvent.keyDown(window, { key: 's', metaKey: true }); await act(async () => {});
    expect(service.apply).toHaveBeenCalledTimes(1); expect(editor()).toHaveValue(content + '\n- saved');
  });
  it('allows navigating to another resource during a save and prevents double submission', async () => {
    let resolve!: (value: ChangePreview) => void;
    const user = await openEditor(); service.editFiles.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await user.type(editor(), '\n- saving'); await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true }); expect(service.editFiles).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /second-skill/ })); await waitFor(() => expect(editor()).toHaveValue(content));
    await act(async () => { resolve(preview); });
    expect(screen.getByRole('complementary', { name: '资源编辑器' })).toHaveTextContent('second-skill');
  });
  it('creates directly in the selected location and requires an explicit tool with the all-tools filter', async () => {
    const user = await openEditor();
    service.apply.mockImplementation(async () => { seed({ ...resource, id: 'local:new', name: 'new-skill' }); return { resourceId: 'local:new', operationId: 'create', message: '已创建' }; });
    await user.click(screen.getByLabelText('新建资源')); await user.click(screen.getByRole('button', { name: '新建技能' }));
    await user.type(screen.getByLabelText('技能标识'), 'new-skill'); await user.type(screen.getByLabelText('触发说明'), '新技能');
    await user.type(within(screen.getByRole('group', { name: '技能指令' })).getByRole('textbox'), '# steps');
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('目标工具'), 'codex:global');
    await user.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(service.apply).toHaveBeenCalledTimes(1));
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ target: 'codex:global', kind: 'skill', name: 'new-skill' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('complementary', { name: '资源编辑器' })).toHaveTextContent('new-skill');
  });
  it('keeps incomplete creations when switching and includes them in the draft picker', async () => {
    const user = await openEditor(); await user.click(screen.getByLabelText('新建资源')); await user.click(screen.getByRole('button', { name: '新建规则' }));
    await user.type(screen.getByLabelText('规则名称'), 'new rule');
    await user.click(screen.getByRole('button', { name: '关闭新建面板' }));
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: /草稿/ }));
    await user.click(screen.getByRole('button', { name: /new rule · 新建/ }));
    expect(screen.getByLabelText('规则名称')).toHaveValue('new rule'); expect(service.create).not.toHaveBeenCalled();
  });
  it('collects into the library without a second confirmation', async () => {
    const user = await openEditor(); await more(user); await user.click(screen.getByRole('button', { name: '收录到资源库' }));
    await waitFor(() => expect(service.adopt).toHaveBeenCalledWith(resource.id)); await waitFor(() => expect(service.apply).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(await screen.findByText('已收录到资源库。')).toBeVisible();
  });
  it('requires exactly one confirmation before deleting', async () => {
    const user = await openEditor(); service.delete.mockResolvedValue({ ...preview, action: 'delete', removesResource: true });
    service.apply.mockImplementation(async () => { delete data[resource.id]; return { resourceId: null, operationId: 'deletion', message: '已删除' }; });
    await more(user); await user.click(screen.getByRole('button', { name: '删除资源' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(resource.path); expect(service.apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认删除' })); await waitFor(() => expect(service.apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '资源编辑器' })).not.toBeInTheDocument());
  });
  it('blocks update installation while any resource has a draft', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- draft'); await user.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByText('请先处理未保存草稿，再安装应用更新。')).toBeVisible();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
  });
  it('protects window close and quit, saves all resources, then exits', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- first');
    await user.click(screen.getByRole('button', { name: /second-skill/ })); await screen.findByRole('textbox', { name: '资源内容' }); await user.type(editor(), '\n- second');
    act(() => lifecycle.handler()); expect(await screen.findByRole('dialog')).toHaveTextContent('2 项未保存修改'); expect(lifecycle.exit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '保存全部并退出' }));
    await waitFor(() => expect(lifecycle.exit).toHaveBeenCalledTimes(1)); expect(service.apply).toHaveBeenCalledTimes(2);
  });
  it('stays open and retains drafts if save-and-exit fails', async () => {
    const user = await openEditor(); service.editFiles.mockRejectedValue({ code: 'io', message: '没有写入权限' });
    await user.type(editor(), '\n- keep'); act(() => lifecycle.handler());
    await user.click(await screen.findByRole('button', { name: '保存全部并退出' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('没有写入权限'); expect(lifecycle.exit).not.toHaveBeenCalled(); expect(editor()).toHaveValue(content + '\n- keep');
  });
  it('can cancel exit or explicitly discard all drafts before quitting', async () => {
    const user = await openEditor(); await user.type(editor(), '\n- keep'); act(() => lifecycle.handler());
    await user.click(await screen.findByRole('button', { name: '取消' })); expect(editor()).toHaveValue(content + '\n- keep');
    act(() => lifecycle.handler()); await user.click(await screen.findByRole('button', { name: '放弃并退出' }));
    expect(lifecycle.exit).toHaveBeenCalledTimes(1); expect(service.apply).not.toHaveBeenCalled();
  });
  it('allows rescanning after an initial failure', async () => {
    service.overview.mockRejectedValueOnce('首次读取失败'); const user = userEvent.setup(); render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('首次读取失败'); await user.click(screen.getByRole('button', { name: '重新扫描所有资源' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

it('keeps the viewer open when saved metadata no longer matches the search', async () => {
  const user = await openEditor(); await user.type(screen.getByLabelText('搜索资源'), '审查'); await user.type(editor(), '\n- change');
  service.apply.mockImplementation(async () => {
    data[resource.id].resource = { ...resource, description: '新的说明' }; data[resource.id].fingerprint = 'saved';
    return { resourceId: resource.id, operationId: 'saved', message: '已保存' };
  });
  await user.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByText('当前资源不在筛选结果中，仍可继续编辑。')).toBeVisible();
  expect(screen.getByLabelText('搜索资源')).toHaveValue('审查'); expect(screen.getByRole('complementary', { name: '资源编辑器' })).toBeVisible();
});

it('offers opening an existing Codex instruction file instead of overwriting it', async () => {
  seed({ ...resource, id: 'local:agents', name: 'AGENTS', kind: 'rule', mainFile: 'AGENTS.md', path: '/test/home/.codex/AGENTS.md' }, '# existing rules');
  const user = await openEditor(); service.create.mockRejectedValue({ code: 'exists', message: '目标已存在，不会覆盖。' });
  await user.click(screen.getByRole('button', { name: 'Codex' }));
  await user.click(screen.getByLabelText('新建资源')); await user.click(screen.getByRole('button', { name: '新建规则' }));
  expect(screen.getByLabelText('目标工具')).toHaveValue('codex:global');
  await user.type(screen.getByLabelText('规则名称'), '工作约定');
  await user.type(within(screen.getByRole('group', { name: '规则内容' })).getByRole('textbox'), '# new rules');
  await user.click(screen.getByRole('button', { name: '创建' }));
  await user.click(await screen.findByRole('button', { name: '打开已有资源' }));
  await waitFor(() => expect(editor()).toHaveValue('# existing rules'));
  expect(service.apply).not.toHaveBeenCalled();
});

it('imports local resources with one submit and keeps errors in the same form', async () => {
  const user = await openEditor(); await user.click(screen.getByRole('button', { name: '资源库' }));
  await user.click(screen.getByRole('button', { name: '本地收录' }));
  await user.type(screen.getByPlaceholderText('选择包含 SKILL.md 的目录'), '/test/import-skill');
  service.import.mockRejectedValueOnce({ code: 'validation', message: '缺少 SKILL.md' });
  await user.click(screen.getByRole('button', { name: '收录到资源库' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('缺少 SKILL.md'); expect(service.apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '收录到资源库' }));
  await waitFor(() => expect(service.apply).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('keeps history restoration behind a difference preview and confirmation', async () => {
  const user = await openEditor();
  service.history.mockResolvedValue([{ id: 'old-edit', action: 'edit', name: resource.name, origin: 'local', targetPath: resource.path, status: 'completed', createdAt: 1791973710000, canRestore: true, error: null }]);
  service.restore.mockResolvedValue({ ...preview, action: 'restore' });
  await user.click(screen.getByRole('button', { name: '变更记录' })); await user.click(await screen.findByRole('button', { name: '预览恢复' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('确认本次变更'); expect(service.apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '确认恢复' })); await waitFor(() => expect(service.apply).toHaveBeenCalledTimes(1));
});

it('keeps read-only resources read-only and cannot delete them', async () => {
  data[resource.id].resource = { ...resource, readOnly: true };
  const user = await openEditor(); expect(editor()).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled(); await more(user);
  expect(screen.getByRole('button', { name: '删除资源' })).toBeDisabled();
});

it('falls back to global when the remembered project was unregistered', async () => {
  window.localStorage.setItem('skilldock.workspace.v1', JSON.stringify({ location: 'project:missing', views: {} }));
  render(<App />); await screen.findByRole('button', { name: /review-skill/ });
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem('skilldock.workspace.v1')!).location).toBe('global'));
});

it('keeps directory settings as a draft across navigation and includes them in exit protection', async () => {
  const user = await openEditor(); await user.click(screen.getByRole('button', { name: '设置' }));
  const input = screen.getByDisplayValue('/test/home/.claude'); await user.type(input, '-custom');
  await user.click(screen.getByRole('button', { name: '全局配置' })); await user.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByDisplayValue('/test/home/.claude-custom')).toBeVisible();
  act(() => lifecycle.handler()); expect(await screen.findByRole('dialog')).toHaveTextContent('1 项未保存修改');
});

it('can open a successfully collected resource even when the following scan fails', async () => {
  const user = await openEditor();
  service.overview.mockRejectedValueOnce('scan unavailable');
  service.apply.mockImplementation(async () => {
    seed({ ...resource, id: 'asset:collected', origin: 'library', tool: null, environmentId: null, scope: 'library', path: '/test/data/assets/collected' });
    return { resourceId: 'asset:collected', operationId: 'collected', message: '已收录' };
  });
  await more(user); await user.click(screen.getByRole('button', { name: '收录到资源库' }));
  await user.click(await screen.findByRole('button', { name: '查看资源' }));
  await waitFor(() => expect(screen.getByRole('complementary', { name: '资源编辑器' })).toHaveTextContent('资源库'));
  expect(service.apply).toHaveBeenCalledTimes(1);
});

function seedProjectGroups() {
  overview.projects = [{ id: 'shared', name: 'Shared Project', path: '/projects/shared' }, { id: 'company-only', name: 'Company Project', path: '/projects/company' }];
  overview.workspaces = [
    { id: 'default', name: '默认工作区', projectIds: ['shared'] },
    { id: 'company', name: '公司项目', projectIds: ['shared', 'company-only'] },
  ];
  overview.environments.push({ ...empty.environments[1], id: 'codex:project:shared', projectId: 'shared', scope: 'project' });
  seed({ ...resource, id: 'local:shared', name: 'shared-review', environmentId: 'codex:project:shared' });
}

it('filters projects by group and shares the same resource draft across groups', async () => {
  seedProjectGroups(); const user = await openEditor();
  expect(screen.queryByRole('button', { name: 'Company Project' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Shared Project' }));
  await user.click(await screen.findByRole('button', { name: /shared-review/ }));
  await user.type(editor(), '\n- shared draft'); await user.click(screen.getByRole('button', { name: 'Codex' }));
  await user.type(screen.getByLabelText('搜索资源'), 'shared');
  await user.selectOptions(screen.getByLabelText('切换工作区'), 'company');
  expect(screen.getByRole('button', { name: 'Company Project' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Shared Project' }));
  await waitFor(() => expect(editor()).toHaveValue(content + '\n- shared draft'));
  expect(screen.getByLabelText('搜索资源')).toHaveValue('shared');
  await user.selectOptions(screen.getByLabelText('切换工作区'), 'default');
  await waitFor(() => expect(editor()).toHaveValue(content + '\n- shared draft'));
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
  expect(service.apply).not.toHaveBeenCalled();
});

it('can jump to a project draft in an inactive workspace without losing content', async () => {
  seedProjectGroups(); overview.workspaces[1].projectIds = ['company-only'];
  const user = await openEditor(); await user.click(screen.getByRole('button', { name: 'Shared Project' }));
  await user.click(await screen.findByRole('button', { name: /shared-review/ })); await user.type(editor(), '\n- retained');
  await user.selectOptions(screen.getByLabelText('切换工作区'), 'company');
  await user.click(screen.getByRole('button', { name: /草稿/ }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /shared-review/ }));
  expect(screen.getByLabelText('切换工作区')).toHaveValue('default');
  await waitFor(() => expect(editor()).toHaveValue(content + '\n- retained'));
});

it('creates and renames groups with inline validation and protects the default group', async () => {
  const user = await openEditor();
  await user.click(screen.getByLabelText('管理工作区'));
  expect(screen.getByRole('button', { name: '删除工作区' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '新建工作区' }));
  await user.type(screen.getByLabelText('工作区名称'), '个人项目');
  service.createWorkspace.mockRejectedValueOnce({ code: 'exists', message: '已有同名工作区' });
  await user.click(screen.getByRole('button', { name: '保存工作区' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('已有同名工作区');
  expect(screen.getByLabelText('工作区名称')).toHaveValue('个人项目');
  service.createWorkspace.mockImplementation(async (name) => { overview.workspaces.push({ id: 'personal', name, projectIds: [] }); return service.overview(); });
  await user.click(screen.getByRole('button', { name: '保存工作区' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('切换工作区')).toHaveValue('personal');
  service.renameWorkspace.mockImplementation(async (id, name) => { overview.workspaces.find((item) => item.id === id)!.name = name; return service.overview(); });
  await user.click(screen.getByLabelText('管理工作区')); await user.click(screen.getByRole('button', { name: '重命名工作区' }));
  await user.clear(screen.getByLabelText('工作区名称')); await user.type(screen.getByLabelText('工作区名称'), '个人开发');
  await user.click(screen.getByRole('button', { name: '保存工作区' }));
  await waitFor(() => expect(service.renameWorkspace).toHaveBeenCalledWith('personal', '个人开发'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('option', { name: '个人开发' })).toBeInTheDocument();
});

it('adds multiple selected directories in one batch and reports only failed paths', async () => {
  const user = await openEditor(); vi.mocked(chooseFolders).mockResolvedValue(['/projects/one', '/projects/two', '/missing']);
  service.addProjects.mockImplementation(async () => {
    overview.projects = [{ id: 'one', name: 'One', path: '/projects/one' }, { id: 'two', name: 'Two', path: '/projects/two' }];
    overview.workspaces[0].projectIds = ['one', 'two'];
    return { overview: await service.overview(), addedProjectIds: ['one', 'two'], alreadyPresent: 0, failures: [{ path: '/missing', message: '目录不存在' }] };
  });
  await user.click(screen.getByRole('button', { name: '添加项目' }));
  expect(service.addProjects).toHaveBeenCalledExactlyOnceWith('default', ['/projects/one', '/projects/two', '/missing']);
  expect(await screen.findByRole('dialog')).toHaveTextContent('/missing'); expect(screen.getByRole('dialog')).toHaveTextContent('目录不存在');
  await user.click(screen.getByRole('button', { name: '知道了' }));
  expect(screen.getByRole('button', { name: 'One' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Two' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: '资源内容' })).toHaveValue(content);
  vi.mocked(chooseFolders).mockResolvedValue([]); await user.click(screen.getByRole('button', { name: '添加项目' }));
  expect(service.addProjects).toHaveBeenCalledTimes(1);
});

it('removes a project from the current group with one confirmation and retains other memberships', async () => {
  seedProjectGroups(); const user = await openEditor();
  service.removeProjectFromWorkspace.mockImplementation(async (workspaceId, projectId) => {
    overview.workspaces.find((group) => group.id === workspaceId)!.projectIds = overview.workspaces.find((group) => group.id === workspaceId)!.projectIds.filter((id) => id !== projectId);
    return service.overview();
  });
  await user.click(screen.getByLabelText('管理项目 Shared Project')); await user.click(screen.getByRole('button', { name: '从工作区移除' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('其他工作区关联会保留');
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '从工作区移除' }));
  await waitFor(() => expect(service.removeProjectFromWorkspace).toHaveBeenCalledExactlyOnceWith('default', 'shared'));
  expect(screen.queryByRole('button', { name: 'Shared Project' })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('切换工作区'), 'company');
  expect(screen.getByRole('button', { name: 'Shared Project' })).toBeVisible();
});

it('deletes only the selected workspace and falls back to the default group', async () => {
  seedProjectGroups(); const user = await openEditor(); await user.selectOptions(screen.getByLabelText('切换工作区'), 'company');
  service.deleteWorkspace.mockImplementation(async (id) => { overview.workspaces = overview.workspaces.filter((group) => group.id !== id); return service.overview(); });
  await user.click(screen.getByLabelText('管理工作区')); await user.click(screen.getByRole('button', { name: '删除工作区' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('移入默认工作区');
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除工作区' }));
  await waitFor(() => expect(screen.getByLabelText('切换工作区')).toHaveValue('default'));
  expect(service.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('company');
});

it('expands the full sidebar from the app icon in a narrow window and closes after project navigation', async () => {
  seedProjectGroups(); Object.defineProperty(window, 'innerWidth', { value: 1040, configurable: true });
  const user = await openEditor();
  const shell = screen.getByRole('main').parentElement!;
  expect(shell).toHaveClass('sidebar-collapsed');
  await user.click(screen.getByRole('button', { name: '展开侧栏' }));
  expect(shell).toHaveClass('sidebar-overlay'); expect(screen.getByRole('main', { hidden: true })).toHaveAttribute('inert');
  expect(screen.getByRole('button', { name: 'Shared Project' })).toHaveTextContent('Shared Project');
  await user.click(screen.getByRole('button', { name: 'Shared Project' }));
  expect(shell).toHaveClass('sidebar-collapsed'); expect(screen.getByRole('main')).not.toHaveAttribute('inert');
  await user.click(screen.getByRole('button', { name: '展开侧栏' })); fireEvent.keyDown(window, { key: 'Escape' });
  expect(shell).toHaveClass('sidebar-collapsed');
});

it('falls back from a deleted workspace while preserving legacy navigation preferences', async () => {
  window.localStorage.setItem('skilldock.workspace.v1', JSON.stringify({ workspaceId: 'deleted', location: 'project:missing', views: { global: { tool: 'codex' } } }));
  render(<App />); await screen.findByRole('button', { name: /review-skill/ });
  expect(screen.getByLabelText('切换工作区')).toHaveValue('default');
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
});

it('retains the current location when a multi-selection includes one new membership and one existing project', async () => {
  seedProjectGroups(); const user = await openEditor();
  vi.mocked(chooseFolders).mockResolvedValue(['/projects/shared', '/projects/company']);
  service.addProjects.mockImplementation(async () => {
    overview.workspaces[0].projectIds.push('company-only');
    return { overview: await service.overview(), addedProjectIds: ['company-only'], alreadyPresent: 1, failures: [] };
  });
  await user.click(screen.getByRole('button', { name: '添加项目' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Company Project' })).toBeVisible());
  expect(editor()).toHaveValue(content);
  expect(JSON.parse(window.localStorage.getItem('skilldock.workspace.v1')!).location).toBe('global');
});

it('keeps a dirty project registered and explains removal failures inside the confirmation', async () => {
  seedProjectGroups(); const user = await openEditor(); await user.click(screen.getByRole('button', { name: 'Shared Project' }));
  await user.click(await screen.findByRole('button', { name: /shared-review/ })); await user.type(editor(), '\n- keep me');
  await user.click(screen.getByLabelText('管理项目 Shared Project')); await user.click(screen.getByRole('button', { name: '从工作区移除' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '从工作区移除' }));
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('未保存草稿');
  expect(service.removeProjectFromWorkspace).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '取消' })); expect(editor()).toHaveValue(content + '\n- keep me');
});
