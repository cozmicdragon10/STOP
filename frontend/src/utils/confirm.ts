import type { ReactNode } from 'react';

// "Are you sure?" questions, shown as the app's centered dialog (ConfirmDialogHost) instead of the browser's confirm box.
//   if (!(await askConfirm({ title: 'Delete this file?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
export interface ConfirmRequest {
  title: string;
  // More detail under the title; line breaks in a string are kept
  message?: ReactNode;
  // Button text; defaults are OK / Cancel
  confirmLabel?: string;
  cancelLabel?: string;
  // Red confirm button, for deleting or undoing something
  danger?: boolean;
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

// One question shows at a time; others wait their turn
const queue: Pending[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  // No dialog host on the page (a component test): fall back to the browser's box
  if (listeners.size === 0) {
    const text = typeof request.message === 'string' ? `${request.title}\n\n${request.message}` : request.title;
    return Promise.resolve(window.confirm(text));
  }
  return new Promise(resolve => {
    queue.push({ ...request, resolve });
    changed();
  });
}

// For ConfirmDialogHost
export function subscribeConfirm(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const currentConfirm = (): Pending | null => queue[0] ?? null;
export function answerConfirm(ok: boolean) {
  const first = queue.shift();
  if (!first) return;
  first.resolve(ok);
  changed();
}
