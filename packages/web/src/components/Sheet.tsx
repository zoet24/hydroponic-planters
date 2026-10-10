import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/**
 * Full screen on a phone, a centred modal on desktop — styled in index.css.
 *
 * Uses showModal() rather than the open attribute: that is what gives focus
 * trapping, the backdrop and Escape-to-close without writing any of them.
 */
export function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="sheet"
      onClose={onClose}
      onCancel={onClose}
      aria-label={label}
      // A click on the backdrop lands on the dialog element itself, never on
      // the content inside it, so comparing the target is enough to tell the
      // two apart without a wrapper or a stopPropagation.
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="screen screen--sheet">{children}</div>
    </dialog>
  );
}

export function SheetHead({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="screen__head">
      <button type="button" onClick={onClose} className="iconbutton" aria-label="Back to the dashboard">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <div>
        <h1 className="screen__title">{title}</h1>
        {subtitle && <p className="screen__subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}

/** Every record modal is opened as a child route of the planter detail screen. */
export function useSheetRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return { id, close: () => navigate(`/planters/${id}`) };
}

/**
 * The optional free-text field the record modals share.
 *
 * Kept to the same 500 characters the API enforces, so the limit is visible
 * before the request is rejected rather than after.
 */
export function NoteField({
  value,
  onChange,
  label = 'Note (optional)',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label htmlFor="note">{label}</label>
      <textarea
        id="note"
        rows={3}
        maxLength={500}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="field__hint">{value.length}/500</p>
    </div>
  );
}
