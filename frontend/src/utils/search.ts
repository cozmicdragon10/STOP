// Search boxes: every word typed must appear somewhere in the row's fields (any order, any case).
// An empty search matches everything.
export function matchesAllWords(search: string, fields: (string | null | undefined)[]): boolean {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every(w => haystack.includes(w));
}
