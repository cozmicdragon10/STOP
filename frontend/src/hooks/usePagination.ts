import { useState } from 'react';

export const DEFAULT_PAGE_SIZE = 50;

// Splits a list into pages. resetKey is anything describing the current search and filters (a string works well):
// when it changes the list goes back to page 1. The page is also kept in range when the list gets shorter.
export function usePagination<T>(items: T[], resetKey: unknown, pageSize = DEFAULT_PAGE_SIZE) {
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Object.is(state.key, resetKey) ? state.page : 1, pageCount);
  const start = (page - 1) * pageSize;
  return {
    page,
    pageCount,
    pageSize,
    total: items.length,
    pageItems: items.slice(start, start + pageSize),
    setPage: (next: number) => setState({ key: resetKey, page: Math.min(Math.max(1, next), pageCount) }),
  };
}
