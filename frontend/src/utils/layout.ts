// Below Tailwind's lg breakpoint, side-by-side panels stack, so what a tap changes can land off screen.
// Brings that panel into view; side by side it is already showing, so nothing moves.
export const scrollToStackedPanel = (panel: HTMLElement | null) => {
  if (panel && window.matchMedia('(max-width: 1023px)').matches) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
