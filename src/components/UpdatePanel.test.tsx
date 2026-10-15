import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePanel } from './UpdatePanel';

const service = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: service.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: service.relaunch }));
vi.mock('../lib/api', () => ({ desktopAvailable: true }));

const makeUpdate = () => ({ version: '0.2.0', body: '修复文件导入问题', close: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined) });

beforeEach(() => { vi.resetAllMocks(); service.relaunch.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('application updates', () => {
  it('shows that the app is current without offering installation', async () => {
    service.check.mockResolvedValue(null);
    render(<UpdatePanel disabled={false} onBusyChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('当前已是最新版本。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '下载并安装' })).not.toBeInTheDocument();
  });

  it('waits for an explicit install click and a verified download before installing', async () => {
    const update = makeUpdate();
    service.check.mockResolvedValue(update);
    const busy = vi.fn();
    render(<UpdatePanel disabled={false} onBusyChange={busy} />);
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('发现新版本 v0.2.0')).toBeVisible();
    expect(screen.getByText('修复文件导入问题')).toBeVisible();
    expect(update.download).not.toHaveBeenCalled();
    let finish!: () => void;
    update.download.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await userEvent.click(screen.getByRole('button', { name: '下载并安装' }));
    expect(update.install).not.toHaveBeenCalled();
    expect(busy).toHaveBeenCalledWith(true);
    finish();
    await waitFor(() => expect(service.relaunch).toHaveBeenCalledOnce());
    expect(update.install).toHaveBeenCalledOnce();
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('does not install or restart after a failed signature or download', async () => {
    const update = makeUpdate();
    update.download.mockRejectedValue(new Error('signature verification failed'));
    service.check.mockResolvedValue(update);
    const busy = vi.fn();
    render(<UpdatePanel disabled={false} onBusyChange={busy} />);
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await userEvent.click(await screen.findByRole('button', { name: '下载并安装' }));
    expect(await screen.findByText(/signature verification failed/)).toBeVisible();
    expect(update.install).not.toHaveBeenCalled();
    expect(service.relaunch).not.toHaveBeenCalled();
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('allows a network failure to be retried', async () => {
    service.check.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(null);
    render(<UpdatePanel disabled={false} onBusyChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText(/检查失败/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('当前已是最新版本。')).toBeVisible();
  });

  it('blocks an install when directory changes have not been saved', async () => {
    const update = makeUpdate();
    service.check.mockResolvedValue(update);
    const busy = vi.fn();
    const view = render(<UpdatePanel disabled={false} onBusyChange={busy} />);
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await screen.findByRole('button', { name: '下载并安装' });
    view.rerender(<UpdatePanel disabled={true} onBusyChange={busy} />);
    expect(screen.getByRole('button', { name: '下载并安装' })).toBeDisabled();
    expect(update.install).not.toHaveBeenCalled();
  });

  it('retries a failed restart without reinstalling the update', async () => {
    const update = makeUpdate();
    service.check.mockResolvedValue(update);
    service.relaunch.mockRejectedValueOnce(new Error('restart unavailable')).mockResolvedValueOnce(undefined);
    render(<UpdatePanel disabled={false} onBusyChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await userEvent.click(await screen.findByRole('button', { name: '下载并安装' }));
    expect(await screen.findByText(/更新已安装，请点击重新启动/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '重新启动' }));
    expect(service.relaunch).toHaveBeenCalledTimes(2);
    expect(update.install).toHaveBeenCalledOnce();
  });

  it('closes a pending update resource when the panel has been left', async () => {
    const update = makeUpdate();
    let finish!: (value: typeof update) => void;
    service.check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<UpdatePanel disabled={false} onBusyChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
    view.unmount(); finish(update);
    await waitFor(() => expect(update.close).toHaveBeenCalledOnce());
  });
});

it('allows checking updates with drafts but blocks installation until drafts are saved', async () => {
  const update = makeUpdate(); service.check.mockResolvedValue(update);
  const view = render(<UpdatePanel disabled={false} installationBlocked={true} onBusyChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
  expect(await screen.findByRole('button', { name: '下载并安装' })).toBeDisabled(); expect(update.download).not.toHaveBeenCalled();
  view.rerender(<UpdatePanel disabled={false} installationBlocked={false} onBusyChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: '下载并安装' })).toBeEnabled();
});

it('also protects retrying a restart if new drafts exist after installation', async () => {
  const update = makeUpdate(); service.check.mockResolvedValue(update);
  service.relaunch.mockRejectedValue(new Error('restart unavailable'));
  const view = render(<UpdatePanel disabled={false} onBusyChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '检查更新' }));
  await userEvent.click(await screen.findByRole('button', { name: '下载并安装' }));
  await screen.findByRole('button', { name: '重新启动' });
  view.rerender(<UpdatePanel disabled={false} installationBlocked={true} onBusyChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: '重新启动' })).toBeDisabled(); expect(service.relaunch).toHaveBeenCalledTimes(1);
});
