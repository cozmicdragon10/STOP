// The message to show for a caught error: its own message when it has one, otherwise the fallback.
// Errors thrown by api.ts carry the server's message; anything else (a network failure, a thrown string) gets the fallback.
export const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;
