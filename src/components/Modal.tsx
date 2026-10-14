import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean }
export function Modal({ title, subtitle, children, onClose, wide, busy }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input:not(:disabled), textarea:not(:disabled)')?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className={'modal ' + (wide ? 'modal-wide' : '')}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="modal-shell">
        <header className="modal-header">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="icon-button" aria-label="关闭对话框" disabled={busy} onClick={onClose}><X size={19} /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
