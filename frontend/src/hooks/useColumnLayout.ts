import { useState } from 'react';

interface SavedLayout {
  order: string[];
  hidden: string[];
}

// Which table columns show and in what order, remembered in this browser under storageKey. allKeys is the default
// order; locked columns can be moved but not hidden. A saved layout from an older version is tidied up: columns that no
// longer exist are dropped and new ones are added at the end.
export function useColumnLayout<K extends string>(storageKey: string, allKeys: readonly K[], locked: readonly K[] = []) {
  const [layout, setLayout] = useState<{ order: K[]; hidden: Set<K> }>(() => {
    let saved: Partial<SavedLayout> = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { /* storage unavailable or bad JSON */ }
    const known = (keys: unknown) => (Array.isArray(keys) ? keys : []).filter((k): k is K => allKeys.includes(k as K));
    const order = [...new Set(known(saved.order))];
    return {
      order: [...order, ...allKeys.filter(k => !order.includes(k))],
      hidden: new Set(known(saved.hidden).filter(k => !locked.includes(k))),
    };
  });

  const save = (order: K[], hidden: Set<K>) => {
    setLayout({ order, hidden });
    try { localStorage.setItem(storageKey, JSON.stringify({ order, hidden: [...hidden] })); } catch { /* storage unavailable */ }
  };

  return {
    order: layout.order,
    visibleKeys: layout.order.filter(k => !layout.hidden.has(k)),
    isVisible: (key: K) => !layout.hidden.has(key),
    isLocked: (key: K) => locked.includes(key),
    toggle: (key: K) => {
      if (locked.includes(key)) return;
      const hidden = new Set(layout.hidden);
      if (!hidden.delete(key)) hidden.add(key);
      save(layout.order, hidden);
    },
    // Moves the column at index from to index to
    move: (from: number, to: number) => {
      if (from === to || to < 0 || to >= layout.order.length) return;
      const order = [...layout.order];
      const [key] = order.splice(from, 1);
      order.splice(to, 0, key);
      save(order, layout.hidden);
    },
    reset: () => {
      setLayout({ order: [...allKeys], hidden: new Set() });
      try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    },
    isDefault: layout.hidden.size === 0 && layout.order.every((k, i) => k === allKeys[i]),
  };
}
