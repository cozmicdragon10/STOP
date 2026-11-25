import { useEffect, useRef, useSyncExternalStore } from 'react';
import { answerConfirm, currentConfirm, subscribeConfirm } from '../utils/confirm';
import ScrollLock from './ScrollLock';

// Shows the questions asked with askConfirm (utils/confirm.ts) as a centered dialog over a dimmed page. Mounted once at
// the app root. Escape or a click outside is Cancel; Enter is the confirm button, which has focus when it opens.
export default function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribeConfirm, currentConfirm);
  const okButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    okButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes only this dialog, not one underneath it
      e.stopImmediatePropagation();
      answerConfirm(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request]);

  if (!request) return null;
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = request;

  return (
    // z-[70]: above the client account panel (z-50) and the app's other pop-ups (z-[60]), which can ask these questions
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex overflow-y-auto z-[70] p-4" onClick={() => answerConfirm(false)}>
      <ScrollLock />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={message ? 'confirm-dialog-message' : undefined}
        onClick={e => e.stopPropagation()}
        className="m-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 id="confirm-dialog-title" className="text-lg font-bold text-white">{title}</h3>
        {message && <div id="confirm-dialog-message" className="text-sm text-slate-300 whitespace-pre-line">{message}</div>}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={() => answerConfirm(false)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold px-4 py-2 rounded-lg text-sm">
            {cancelLabel}
          </button>
          <button ref={okButton} type="button" onClick={() => answerConfirm(true)}
            className={`${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'} text-white font-semibold px-4 py-2 rounded-lg text-sm`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
