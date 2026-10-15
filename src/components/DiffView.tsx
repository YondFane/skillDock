import { diffLines } from 'diff';

export function DiffView({ before, after }: { before: string; after: string }) {
  if (before === after) return <p className="diff-empty muted">当前文件内容未变化。</p>;
  return <div className="inline-diff" aria-label="变更差异">{diffLines(before, after).map((part, index) =>
    <div key={index} className={'diff-part ' + (part.added ? 'diff-added' : part.removed ? 'diff-removed' : '')}>
      {part.value.split('\n').map((line, row, lines) => row === lines.length - 1 && !line ? null :
        <div className="diff-line" key={row}><span>{part.added ? '+' : part.removed ? '−' : ' '}</span><code>{line || ' '}</code></div>)}
    </div>)}</div>;
}
