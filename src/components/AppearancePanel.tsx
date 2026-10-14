import { Moon, Sun, RotateCcw } from 'lucide-react';
import { defaultAppearance, fontOptions, fontSizes, useAppearance, type Appearance } from '../lib/appearance';

export function AppearancePanel({ disabled }: { disabled: boolean }) {
  const { appearance, changeAppearance, storageError } = useAppearance();
  return <section className="settings-card appearance-card" aria-label="外观与字体">
    <div className="section-heading"><h3>外观与字体</h3><p>选择立即生效，自动保存到本机。</p></div>
    <fieldset className="theme-picker" disabled={disabled}>
      <legend>主题</legend>
      {(['light', 'dark'] as const).map((theme) => <label key={theme} className={'theme-option ' + (appearance.theme === theme ? 'selected' : '')}>
        <input type="radio" name="theme" value={theme} checked={appearance.theme === theme} onChange={() => changeAppearance({ theme })} />
        <span className={'theme-swatch ' + theme} aria-hidden="true">{theme === 'light' ? <Sun size={22} /> : <Moon size={22} />}</span>
        <span>{theme === 'light' ? '白色主题' : '黑色主题'}</span>
      </label>)}
    </fieldset>
    <div className="form-grid appearance-fields">
      <label className="field">程序字体<select value={appearance.fontFamily} disabled={disabled}
        onChange={(event) => changeAppearance({ fontFamily: event.target.value as Appearance['fontFamily'] })}>
        {fontOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <label className="field">字号<select value={appearance.fontSize} disabled={disabled}
        onChange={(event) => changeAppearance({ fontSize: Number(event.target.value) })}>
        {fontSizes.map((size) => <option key={size} value={size}>{size}px{size === 16 ? '（默认）' : ''}</option>)}
      </select></label>
    </div>
    {appearance.fontFamily === 'custom' && <div className="field custom-font-field"><label htmlFor="custom-font">自定义字体名称</label>
      <input id="custom-font" aria-describedby="custom-font-hint" value={appearance.customFont} maxLength={80} placeholder="例如：思源黑体" disabled={disabled}
        onChange={(event) => changeAppearance({ customFont: event.target.value.replace(/[\r\n\x00-\x1f]/g, '') })} />
      <small id="custom-font-hint">使用本机已安装的字体；找不到时使用系统默认字体。</small>
    </div>}
    <div className="font-preview"><strong>阅读更舒适，工作更专注。</strong><span>SkillDock · Aa Bb Cc · 0123456789</span><code>name: my-skill</code></div>
    {storageError && <p className="inline-error" role="alert">{storageError}</p>}
    <footer><button className="button secondary" disabled={disabled} onClick={() => changeAppearance({ ...defaultAppearance })}><RotateCcw size={15} /> 恢复默认外观</button></footer>
  </section>;
}
