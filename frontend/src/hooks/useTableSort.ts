import { useState } from 'react';
import { nextSort } from '../utils/tableSort';
import type { SortState } from '../utils/tableSort';

export type TableSort<K extends string = string> = { sort: SortState<K>; toggle: (key: K) => void };

// The sort of one table. It starts in the table's own order unless a starting sort is given.
export function useTableSort<K extends string>(initial: SortState<K> = null): TableSort<K> {
  const [sort, setSort] = useState<SortState<K>>(initial);
  return { sort, toggle: (key: K) => setSort(s => nextSort(s, key)) };
}
