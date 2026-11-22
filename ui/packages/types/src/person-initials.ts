/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE rule for a person's avatar initials. Every face that draws a person
 * with no picture uses it — the people cell and avatar widget (through
 * `@object-ui/fields`), the kanban card owner, the history timeline, the user
 * menu (`@object-ui/auth`) and the presence stack (`@object-ui/collaboration`).
 *
 * It lives in this package because it is the lowest one all of those callers
 * can reach: `@object-ui/auth` depends on no other `@object-ui` package, and
 * the field renderers are a tier above it, so the rule cannot live in
 * `@object-ui/fields` without dragging that tier into the auth client.
 * `@object-ui/fields` re-exports it unchanged.
 */

/**
 * Up-to-2-char initials for the avatar fallback, made of letters only
 * (objectstack#36046): brackets, punctuation, digits and spaces are skipped,
 * so a display name such as "Alice (Sales)" gives "AS", never "A(".
 * - "John Doe" → "JD"; "John" → "JO"; "A." → "A" (one letter when one is all there is)
 * - CJK single word → trailing 1–2 chars (given name): "张三" → "张三", "王小明" → "小明"
 * - no letter at all → "?"
 */
export function getPersonInitials(name: string): string {
  // A word is a run of letters (with their combining marks); everything else separates words.
  const words = (name || '').split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length >= 2) {
    return (firstLetter(words[0]) + firstLetter(words[words.length - 1])).toUpperCase();
  }
  const letters = Array.from(words[0]).filter((ch) => /\p{L}/u.test(ch));
  if (/[㐀-鿿]/.test(words[0])) {
    return letters.length <= 2 ? letters.join('') : letters.slice(-2).join('');
  }
  return letters.slice(0, 2).join('').toUpperCase();
}

/** A word's first letter, a whole code point (never half a surrogate pair). */
function firstLetter(word: string): string {
  return Array.from(word).find((ch) => /\p{L}/u.test(ch)) ?? '';
}
