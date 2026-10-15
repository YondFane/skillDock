import { useEffect, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { version } from '../../package.json';
import { desktopAvailable } from '../lib/api';
import { errorMessage } from '../lib/types';

type Phase = 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'installing' | 'installed' | 'error';

export function UpdatePanel({ disabled, installationBlocked = false, onBusyChange }: {
  disabled: boolean; installationBlocked?: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState('检查 GitHub 上已发布的最新版本。');
  const [progress, setProgress] = useState<number | null>(null);
  const resource = useRef<Update | null>(null);
  const active = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      void resource.current?.close().catch(() => {});
      resource.current = null;
    };
  }, []);

  const checkForUpdate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('checking'); setMessage('正在检查更新…'); setProgress(null);
    const previous = resource.current;
    resource.current = null; setUpdate(null);
    try {
      await previous?.close();
      const latest = await check({ timeout: 20_000 });
      if (!active.current) { await latest?.close(); return; }
      resource.current = latest; setUpdate(latest);
      setPhase(latest ? 'available' : 'current');
      setMessage(latest ? `发现新版本 v${latest.version}` : '当前已是最新版本。');
    } catch (error) {
      if (active.current) {
        setPhase('error');
        setMessage(`检查失败，请确认网络可访问 GitHub 后重试。${errorMessage(error)}`);
      }
    } finally { inFlight.current = false; }
  };

  const installUpdate = async () => {
    if (!update || disabled || installationBlocked || inFlight.current) return;
    inFlight.current = true; onBusyChange(true);
    setPhase('downloading'); setMessage('正在下载更新…'); setProgress(null);
    let downloaded = 0;
    let total: number | undefined;
    try {
      await update.download((event) => {
        if (event.event === 'Started') total = event.data.contentLength;
        if (event.event === 'Progress') downloaded += event.data.chunkLength;
        if (active.current && total) setProgress(Math.min(100, Math.round(downloaded / total * 100)));
      }, { timeout: 300_000 });
      setPhase('installing'); setMessage('下载已验证，正在安装更新…');
      await update.install();
      setPhase('installed'); setMessage('更新已安装，正在重新启动…');
      await relaunch().catch((error) => {
        setMessage(`更新已安装，请点击重新启动或手动重启应用。${errorMessage(error)}`);
      });
    } catch (error) {
      if (active.current) {
        setPhase('error'); setProgress(null);
        setMessage(`更新未完成：${errorMessage(error)}。可重试或重新检查更新。`);
      }
    } finally { inFlight.current = false; onBusyChange(false); }
  };

  const updating = phase === 'downloading' || phase === 'installing';
  return <section className="settings-card update-card" aria-label="应用更新">
    <div className="section-heading"><h3>应用更新</h3><p>当前版本 v{version} · Windows 与 macOS 直接更新</p></div>
    <p className={phase === 'error' ? 'inline-error' : 'update-status'} role="status" aria-live="polite">{message}</p>
    {update?.body && <pre className="update-notes">{update.body}</pre>}
    {updating && <progress aria-label="更新下载进度" max={100} value={progress ?? undefined} />}
    {updating && progress !== null && <span className="update-status">{progress}%</span>}
    <p className="update-hint">安装更新会关闭并重新启动应用，请先保存修改。</p>
    {disabled && !updating && <p className="update-hint">请先保存目录修改或等待当前操作完成。</p>}
    <footer className="update-actions">
      <button className="button secondary" disabled={!desktopAvailable || disabled || phase === 'checking' || updating || phase === 'installed'} onClick={() => void checkForUpdate()}>
        {phase === 'checking' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} 检查更新
      </button>
      {update && phase !== 'installed' && <button className="button primary" disabled={disabled || installationBlocked || updating || phase === 'checking'} onClick={() => void installUpdate()}>
        {updating ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />} {updating ? '正在更新…' : '下载并安装'}
      </button>}
      {phase === 'installed' && <button className="button primary" disabled={disabled || installationBlocked} onClick={() => {
        if (disabled || installationBlocked) return;
        void relaunch().catch((error) => setMessage(`请手动重新启动应用。${errorMessage(error)}`));
      }}>重新启动</button>}
    </footer>
  </section>;
}
