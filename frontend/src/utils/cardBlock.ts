// A Business Administrator can stop a client from paying by credit card (usually after a disputed card payment).
// Payment screens disable the Credit Card option for them; the server refuses card payments too.

interface MaybeBlocked {
  cardpaymentsblocked?: boolean | null;
  cardblockreason?: string | null;
}

export const cardBlocked = (client: MaybeBlocked | null | undefined): boolean => Boolean(client?.cardpaymentsblocked);

// Shown beside a disabled Credit Card option
export const cardBlockedText = (client: MaybeBlocked | null | undefined): string =>
  `Credit card payments are blocked for this client${client?.cardblockreason ? ` (${client.cardblockreason})` : ''}. Cash only.`;
