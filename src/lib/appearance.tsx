import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const APPEARANCE_KEY = 'skilldock.appearance';
export const fontOptions = [
  { value: 'system', label: '系统默认', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { value: 'sans', label: '微软雅黑 / 苹方', family: '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif' },
  { value: 'serif', label: '宋体 / 华文宋体', family: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif' },
  { value: 'mono', label: '等宽字体', family: '"Cascadia Code", "SFMono-Regular", Consolas, "Microsoft YaHei", monospace' },
  { value: 'custom', label: '自定义字体', family: '' },
] as const;
export const fontSizes = [14, 16, 18, 20, 22];
export interface Appearance {
  theme: 'light' | 'dark';
  fontFamily: typeof fontOptions[number]['value'];
  customFont: string;
  fontSize: number;
}
export const defaultAppearance: Appearance = { theme: 'light', fontFamily: 'system', customFont: '', fontSize: 16 };

export function loadAppearance(): Appearance {
  try {
    const saved = JSON.parse(window.localStorage.getItem(APPEARANCE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return { ...defaultAppearance };
    return {
      theme: saved.theme === 'dark' ? 'dark' : 'light',
      fontFamily: fontOptions.some((option) => option.value === saved.fontFamily) ? saved.fontFamily : 'system',
      customFont: typeof saved.customFont === 'string' ? saved.customFont.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 80) : '',
      fontSize: fontSizes.includes(saved.fontSize) ? saved.fontSize : 16,
    };
  } catch { return { ...defaultAppearance }; }
}

export function applyAppearance(appearance: Appearance) {
  const custom = appearance.customFont.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const family = appearance.fontFamily === 'custom' && custom
    ? `"${custom}", ${fontOptions[0].family}`
    : fontOptions.find((option) => option.value === appearance.fontFamily)?.family || fontOptions[0].family;
  document.documentElement.dataset.theme = appearance.theme;
  document.documentElement.style.setProperty('--app-font', family);
  document.documentElement.style.setProperty('--app-font-size', `${appearance.fontSize}px`);
  document.documentElement.style.setProperty('--code-font', appearance.fontFamily === 'system' ? fontOptions[3].family : family);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance.theme === 'dark' ? '#111111' : '#ffffff');
}

const AppearanceContext = createContext({
  appearance: defaultAppearance,
  changeAppearance: (_patch: Partial<Appearance>) => {},
  storageError: '',
});
export const useAppearance = () => useContext(AppearanceContext);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(loadAppearance);
  const [storageError, setStorageError] = useState('');
  useLayoutEffect(() => {
    applyAppearance(appearance);
    try { window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); setStorageError(''); }
    catch { setStorageError('偏好未能保存，本次选择将在关闭应用后重置。'); }
  }, [appearance]);
  useEffect(() => {
    if (isTauri()) void getCurrentWindow().setTheme(appearance.theme).catch(() => {});
  }, [appearance.theme]);
  return <AppearanceContext.Provider value={{ appearance, changeAppearance: (patch) => setAppearance((current) => ({ ...current, ...patch })), storageError }}>
    {children}
  </AppearanceContext.Provider>;
}
