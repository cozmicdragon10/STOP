import { useScrollLock } from '../hooks/useScrollLock';

/** Put inside a dialog's backdrop: the page behind can't scroll while the dialog is showing. Renders nothing. */
export default function ScrollLock() {
  useScrollLock();
  return null;
}
