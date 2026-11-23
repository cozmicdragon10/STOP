import { describe, expect, it } from 'vitest';
import { lockScroll } from './scrollLock';

describe('lockScroll', () => {
  it('keeps the page locked until the last stacked dialog closes', () => {
    const root = { style: { overflow: '' } };
    const unlockAccount = lockScroll(root);
    const unlockPayment = lockScroll(root);
    expect(root.style.overflow).toBe('hidden');
    unlockPayment();
    expect(root.style.overflow).toBe('hidden');
    unlockAccount();
    expect(root.style.overflow).toBe('');
  });

  it('ignores a second unlock from the same dialog', () => {
    const root = { style: { overflow: '' } };
    const unlockA = lockScroll(root);
    const unlockB = lockScroll(root);
    unlockA();
    unlockA();
    expect(root.style.overflow).toBe('hidden');
    unlockB();
    expect(root.style.overflow).toBe('');
  });

  it('puts back the overflow the page had before', () => {
    const root = { style: { overflow: 'scroll' } };
    const unlock = lockScroll(root);
    expect(root.style.overflow).toBe('hidden');
    unlock();
    expect(root.style.overflow).toBe('scroll');
  });
});
