// Below Tailwind's lg breakpoint, side-by-side panels stack, so what a tap changes can land off screen.
// Brings that panel into view; side by side it is already showing, so nothing moves.
export const scrollToStackedPanel = (panel: HTMLElement | null) => {
  if (panel && window.matchMedia('(max-width: 1023px)').matches) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// How much of a panel must show at the bottom of the screen to count as seen (about a heading and a line or two)
export const MIN_VISIBLE_PX = 120;

// Whether the start of a panel is out of sight: scrolled up under the top bar (topInset), or below the bottom of the
// screen with less than minVisible of it showing.
export const panelStartHidden = (top: number, viewportHeight: number, topInset: number, minVisible = MIN_VISIBLE_PX) =>
  top < topInset || top > viewportHeight - minVisible;

// Scrolls a panel to the top of the screen when its start is out of sight, e.g. a picked day's details that open below
// the calendar, or a list's first rows after paging from the bottom. Already in view, nothing moves.
// Call after the change has rendered (requestAnimationFrame from a click handler).
export const revealPanel = (panel: HTMLElement | null) => {
  if (!panel) return;
  // The page's scroll-padding-top keeps scrolled-to panels clear of the sticky top bar; the same inset counts as hidden
  const topInset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  if (panelStartHidden(panel.getBoundingClientRect().top, window.innerHeight, topInset)) {
    panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
};
