import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearanceProvider, APPEARANCE_KEY } from '../lib/appearance';
import { AppearancePanel } from './AppearancePanel';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const show = () => render(<AppearanceProvider><AppearancePanel disabled={false} /></AppearanceProvider>);

it('keeps the chosen theme, font and size after reopening settings', async () => {
  const user = userEvent.setup();
  const first = show();
  expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('16px');
  await user.click(screen.getByRole('radio', { name: '黑色主题' }));
  await user.selectOptions(screen.getByLabelText('程序字体'), 'serif');
  await user.selectOptions(screen.getByLabelText('字号'), '20');
  first.unmount(); show();
  expect(screen.getByRole('radio', { name: '黑色主题' })).toBeChecked();
  expect(screen.getByLabelText('程序字体')).toHaveValue('serif');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('20px');
  expect(document.documentElement.style.getPropertyValue('--code-font')).toContain('SimSun');
});

it('recovers from damaged saved preferences and can reset a custom font', async () => {
  localStorage.setItem(APPEARANCE_KEY, '{bad JSON');
  show();
  expect(screen.getByRole('radio', { name: '白色主题' })).toBeChecked();
  await userEvent.selectOptions(screen.getByLabelText('程序字体'), 'custom');
  await userEvent.type(screen.getByLabelText('自定义字体名称'), '思源黑体');
  expect(document.documentElement.style.getPropertyValue('--app-font')).toContain('思源黑体');
  await userEvent.click(screen.getByRole('button', { name: '恢复默认外观' }));
  expect(screen.getByLabelText('程序字体')).toHaveValue('system');
  expect(screen.getByLabelText('字号')).toHaveValue('16');
  expect(screen.queryByLabelText('自定义字体名称')).not.toBeInTheDocument();
});

it('still changes the theme and explains when preferences cannot be saved', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  show();
  await userEvent.click(screen.getByRole('radio', { name: '黑色主题' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.getByRole('alert')).toHaveTextContent('本次选择将在关闭应用后重置');
});
