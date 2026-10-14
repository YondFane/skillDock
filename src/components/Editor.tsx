import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { useMemo } from 'react';
import { useAppearance } from '../lib/appearance';

const editorStyles = {
  '&': { fontSize: '1rem', height: '100%', backgroundColor: 'var(--surface-muted)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--code-font)', padding: '16px 0', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 16px', lineHeight: '1.85' },
  '.cm-gutters': { backgroundColor: 'var(--surface-muted)', color: 'var(--text-muted)', border: 'none', minWidth: '38px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--surface-subtle)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-tooltip, .cm-panel': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
};
const highlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.comment, tags.meta], color: 'var(--text-muted)' },
  { tag: [tags.heading, tags.strong], fontWeight: '600', color: 'var(--text)' },
  { tag: [tags.keyword, tags.string, tags.atom, tags.number, tags.link, tags.url], color: 'var(--text-secondary)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
]));
const markdownExtensions = [markdown(), EditorView.lineWrapping, highlighting];
const yamlExtensions = [yaml(), EditorView.lineWrapping, highlighting];

export function Editor({ value, onChange, readOnly, filename = '', label = '资源内容' }: {
  value: string; onChange: (value: string) => void; readOnly?: boolean; filename?: string; label?: string;
}) {
  const { appearance } = useAppearance();
  const theme = useMemo(() => EditorView.theme(editorStyles, { dark: appearance.theme === 'dark' }), [appearance]);
  return <div className="code-editor" data-testid="resource-content" role="group" aria-label={label}>
    <CodeMirror value={value} height="100%" theme={theme}
      extensions={/\.ya?ml$/i.test(filename) ? yamlExtensions : markdownExtensions}
      editable={!readOnly} readOnly={readOnly}
      basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true, autocompletion: false }}
      onChange={onChange} />
  </div>;
}
