import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { ChangePreview, Overview, Resource, ResourceDetail } from './lib/types';

const service = vi.hoisted(() => ({
  overview: vi.fn(), detail: vi.fn(), create: vi.fn(), edit: vi.fn(), delete: vi.fn(),
  import: vi.fn(), adopt: vi.fn(), apply: vi.fn(), history: vi.fn(), restore: vi.fn(),
  addProject: vi.fn(), removeProject: vi.fn(), settings: vi.fn(),
}));
vi.mock('./lib/api', () => ({ api: service, desktopAvailable: true, chooseFolder: vi.fn(), chooseMarkdown: vi.fn() }));
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange, readOnly, editable }: { value: string; onChange: (value: string) => void; readOnly?: boolean; editable?: boolean }) =>
    <textarea aria-label="资源内容" value={value} readOnly={readOnly || editable === false} onChange={(event) => onChange(event.target.value)} />,
}));

const resource: Resource = {
  id: 'asset:review', origin: 'library', kind: 'skill', name: 'review-skill', description: '审查代码时使用',
  compatibility: 'both', environmentId: null, tool: null, scope: 'library', path: '/test/data/assets/review', mainFile: 'SKILL.md',
  source: '新建', updatedAt: 1791973710000, revision: 1, fileCount: 1, readOnly: false, warnings: [],
};
const content = '---\nname: review-skill\ndescription: 审查代码时使用\n---\n\n# 原始步骤';
const detail: ResourceDetail = { resource, content, relativePath: 'SKILL.md', fingerprint: 'current-file-and-metadata-hash', files: [{ path: 'SKILL.md', size: 100, editable: true }] };
const empty: Overview = {
  resources: [], environments: [
    { id: 'claude:global', name: 'Claude Code · 全局', tool: 'claude', scope: 'global', projectId: null, root: '/test/home/.claude', skillsRoot: '/test/home/.claude/skills', rulesRoot: '/test/home/.claude/rules', instructionFiles: [], readOnly: false },
    { id: 'codex:global', name: 'Codex · 全局', tool: 'codex', scope: 'global', projectId: null, root: '/test/home/.codex', skillsRoot: '/test/home/.agents/skills', rulesRoot: null, instructionFiles: [], readOnly: false },
  ], projects: [], settings: { claudeRoot: '/test/home/.claude', codexRoot: '/test/home/.codex', codexSkillsRoot: '/test/home/.agents/skills' },
  dataDir: '/test/data', warnings: [],
};
const preview: ChangePreview = {
  id: 'preview-1', action: 'edit', name: 'review-skill', targetPath: resource.path,
  beforeContent: content, afterContent: content + '\n- 新步骤', changedFiles: ['SKILL.md'], totalFiles: 1, removesResource: false, warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  service.overview.mockResolvedValue({ ...empty, resources: [resource] });
  service.detail.mockResolvedValue(detail);
  service.history.mockResolvedValue([]);
});
afterEach(cleanup);

async function openEditor() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /review-skill/ }));
  await screen.findByRole('textbox', { name: '资源内容' });
  return user;
}

describe('local resource workflows', () => {
  it('creates a skill only after the user reviews and confirms the change', async () => {
    const user = userEvent.setup();
    service.overview.mockResolvedValue(empty);
    service.create.mockImplementation(async (input) => ({ ...preview, action: 'create', name: input.name, beforeContent: '', afterContent: input.content }));
    service.apply.mockImplementation(async () => {
      service.overview.mockResolvedValue({ ...empty, resources: [resource] });
      return { resourceId: resource.id, operationId: 'operation', message: '已保存' };
    });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '新建资源' }));
    await user.type(screen.getByLabelText('技能标识'), 'review-skill');
    await user.type(screen.getByLabelText('触发说明'), '审查代码时使用');
    await user.type(screen.getByLabelText('技能指令'), '# 原始步骤');
    await user.click(screen.getByRole('button', { name: '预览创建' }));
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ target: 'library', kind: 'skill', content: expect.stringContaining('name: review-skill') }));
    expect(service.apply).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '确认新建' }));
    await waitFor(() => expect(service.apply).toHaveBeenCalledWith('preview-1'));
    expect(await screen.findByRole('textbox', { name: '资源内容' })).toHaveValue(content);
  });

  it('sends the loaded fingerprint when editing and preserves the draft when review is cancelled', async () => {
    const user = await openEditor();
    service.edit.mockResolvedValue(preview);
    const textbox = screen.getByRole('textbox', { name: '资源内容' });
    await user.type(textbox, '\n- 新步骤');
    await user.click(screen.getByRole('button', { name: '预览保存' }));
    expect(service.edit).toHaveBeenCalledWith(expect.objectContaining({
      id: resource.id, relativePath: 'SKILL.md', expectedFingerprint: detail.fingerprint, content: content + '\n- 新步骤',
    }));
    await user.click(await screen.findByRole('button', { name: '返回编辑' }));
    expect(textbox).toHaveValue(content + '\n- 新步骤');
    expect(service.apply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '预览保存' })).toBeEnabled();
  });

  it('requires confirmation for delete and refreshes after the backend removes the resource', async () => {
    const user = await openEditor();
    service.delete.mockResolvedValue({ ...preview, action: 'delete', afterContent: '', removesResource: true });
    service.apply.mockImplementation(async () => {
      service.overview.mockResolvedValue(empty);
      return { resourceId: null, operationId: 'deletion', message: '删除已完成' };
    });
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(service.delete).toHaveBeenCalledWith(resource.id, detail.fingerprint);
    expect(service.apply).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '确认删除' }));
    expect(await screen.findByText('让好用的工作方式，随时就绪')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '资源内容' })).not.toBeInTheDocument();
  });

  it('does not silently discard unsaved text when navigating away', async () => {
    const user = await openEditor();
    await user.type(screen.getByRole('textbox', { name: '资源内容' }), '\n- 未保存');
    await user.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '项目' }));
    expect(await screen.findByText('当前修改尚未保存')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '资源内容' })).toHaveValue(content + '\n- 未保存');
    await user.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '项目' }));
    await user.click(await screen.findByRole('button', { name: '放弃修改并继续' }));
    expect(await screen.findByText('从一个项目开始')).toBeVisible();
    expect(service.edit).not.toHaveBeenCalled();
  });

  it('shows conflict errors and prevents replaying an already-consumed review', async () => {
    const user = await openEditor();
    service.edit.mockResolvedValue(preview);
    service.apply.mockRejectedValue({ code: 'conflict', message: '文件已被其他程序修改，请重新读取。' });
    await user.type(screen.getByRole('textbox', { name: '资源内容' }), '\n- 新步骤');
    await user.click(screen.getByRole('button', { name: '预览保存' }));
    await user.click(await screen.findByRole('button', { name: '确认编辑' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('文件已被其他程序修改');
    expect(screen.getByRole('button', { name: '确认编辑' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '返回编辑' })).toBeEnabled();
  });

  it('allows rescanning after an initial backend failure', async () => {
    const user = userEvent.setup();
    service.overview.mockRejectedValueOnce({ code: 'io', message: '首次读取失败' }).mockResolvedValue(empty);
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('首次读取失败');
    const retry = screen.getByRole('button', { name: '重新扫描所有资源' });
    expect(retry).toBeEnabled();
    await user.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(service.overview).toHaveBeenCalledTimes(2);
  });
});
