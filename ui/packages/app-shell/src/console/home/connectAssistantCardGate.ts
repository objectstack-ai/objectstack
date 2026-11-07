// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether the person hid Home's "Connect an AI Assistant" card. Kept apart
 * from `ConnectAssistantCard.tsx` so that module exports a component only.
 *
 * Home keeps no server-side preference; its other dismissible items (the
 * recovery-password reminder, the first-run checklist) remember a dismissal in
 * this browser's `localStorage`, and so does this card. The key carries the
 * person, so on a shared browser one person's dismissal does not hide the card
 * for the next. A storage that cannot be read answers "not hidden"; one that
 * cannot be written hides the card for this page only.
 */

export type CardStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DISMISS_PREFIX = 'os:home:connect-assistant-dismissed';

/** The record that this person hid the card on this browser. */
export function connectAssistantCardKey(userId: string): string {
  return `${DISMISS_PREFIX}:${userId}`;
}

/** The browser's `localStorage`, or `undefined` where reading it throws (a private window). */
export function cardStorage(): CardStorage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function wasCardDismissed(storage: CardStorage | undefined, userId: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(connectAssistantCardKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function markCardDismissed(storage: CardStorage | undefined, userId: string): void {
  if (!storage) return;
  try {
    storage.setItem(connectAssistantCardKey(userId), new Date().toISOString());
  } catch {
    // Not kept: the card stays hidden for this page only.
  }
}
