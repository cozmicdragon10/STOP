import { useEffect } from 'react';
import { lockScroll } from '../utils/scrollLock';

/** Stops the page behind from scrolling while `active` is true (see utils/scrollLock). */
export function useScrollLock(active = true) {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
