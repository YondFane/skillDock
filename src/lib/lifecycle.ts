import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export async function listenForExit(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const unlisten = await listen('workspace-exit-requested', handler);
  try { await invoke('workspace_ready'); }
  catch (error) { unlisten(); throw error; }
  return unlisten;
}
export async function exitWorkspace() {
  if (isTauri()) await invoke('exit_workspace');
}
