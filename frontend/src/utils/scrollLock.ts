// Stops the page behind a dialog from scrolling. Locks are counted, so with dialogs stacked (a payment over an open
// account) closing the top one leaves the page locked until the last one closes. Returns the unlock function.
let locks = 0;
let savedOverflow = '';

export function lockScroll(root: { style: { overflow: string } } = document.documentElement): () => void {
  if (locks === 0) {
    savedOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }
  locks++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks--;
    if (locks === 0) root.style.overflow = savedOverflow;
  };
}
