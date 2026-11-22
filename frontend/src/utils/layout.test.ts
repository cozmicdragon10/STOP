import { describe, expect, it } from 'vitest';
import { MIN_VISIBLE_PX, panelStartHidden } from './layout';

describe('panelStartHidden', () => {
  const screen = 720;
  const topBar = 80;

  it('is hidden when the panel starts below the bottom of the screen', () => {
    expect(panelStartHidden(857, screen, topBar)).toBe(true);
  });

  it('is hidden when only a sliver shows at the bottom', () => {
    expect(panelStartHidden(screen - MIN_VISIBLE_PX + 1, screen, topBar)).toBe(true);
  });

  it('is in view when enough of it shows', () => {
    expect(panelStartHidden(screen - MIN_VISIBLE_PX, screen, topBar)).toBe(false);
    expect(panelStartHidden(300, screen, topBar)).toBe(false);
  });

  it('is hidden when its start is scrolled up under the top bar or off the top', () => {
    expect(panelStartHidden(topBar - 1, screen, topBar)).toBe(true);
    expect(panelStartHidden(-2000, screen, topBar)).toBe(true);
  });

  it('is in view right at the top bar', () => {
    expect(panelStartHidden(topBar, screen, topBar)).toBe(false);
  });
});
