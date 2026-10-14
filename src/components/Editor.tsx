import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';

const theme = EditorView.theme({
  '&': { fontSize: '12px', height: '100%', backgroundColor: '#fafbf9' },
  '.cm-content': { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', padding: '16px 0', caretColor: '#177f70' },
  '.cm-line': { padding: '0 16px', lineHeight: '1.85' },
  '.cm-gutters': { backgroundColor: '#fafbf9', color: '#a3ada6', border: 'none', minWidth: '38px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#eff5ef' },
  '.cm-selectionBackground': { backgroundColor: '#d3e9e0 !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
});
const markdownExtensions = [markdown(), EditorView.lineWrapping];
const yamlExtensions = [yaml(), EditorView.lineWrapping];

export function Editor({ value, onChange, readOnly, filename = '', label = '资源内容' }: {
  value: string; onChange: (value: string) => void; readOnly?: boolean; filename?: string; label?: string;
}) {
  return <div className="code-editor" data-testid="resource-content" role="group" aria-label={label}>
    <CodeMirror value={value} height="100%" theme={theme}
      extensions={/\.ya?ml$/i.test(filename) ? yamlExtensions : markdownExtensions}
      editable={!readOnly} readOnly={readOnly}
      basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true, autocompletion: false }}
      onChange={onChange} />
  </div>;
}
