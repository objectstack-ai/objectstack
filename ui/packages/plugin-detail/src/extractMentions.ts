/**
 * extractMentions
 *
 * Parses `@<label>` tokens out of a comment body and resolves them to user
 * ids using the same suggestion list that drives the mention dropdown. The
 * inserted format from {@link RichTextCommentInput#handleSelectMention} is
 * `@${label} ` (label may contain spaces), so we can't just split on
 * whitespace — instead we scan the suggestion list (longest label first to
 * avoid prefix collisions like "Anna" vs "Anna Lee") and match each label
 * preceded by `@` and not followed by a word character.
 *
 * Returns a de-duplicated array of suggestion ids. Free-text `@something`
 * tokens that don't match any known suggestion are ignored — the renderer
 * still highlights them visually, but they don't generate notifications.
 *
 * @example
 *   extractMentions('hey @QA Test please review', [
 *     { id: 'u1', label: 'QA Test' },
 *     { id: 'u2', label: 'Alice' },
 *   ]); // → ['u1']
 */

export interface MentionTarget {
  id: string;
  label: string;
}

export function extractMentions<T extends MentionTarget>(
  text: string,
  suggestions: readonly T[],
): string[] {
  if (!text || !suggestions.length) return [];
  // Longest labels first so "Anna Lee" wins over "Anna" when both exist.
  const sorted = [...suggestions].sort(
    (a, b) => b.label.length - a.label.length,
  );
  // Working copy: as we consume a match span, blank it out so a shorter
  // label can't re-match the same prefix region (e.g. "Anna" claiming
  // "@Anna Lee" after "Anna Lee" already won).
  let remaining = text;
  const ids = new Set<string>();
  for (const s of sorted) {
    if (!s.label) continue;
    const escaped = s.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match `@LABEL` not followed by an alphanumeric (so `@Anna` doesn't
    // match `@AnnaLee`). Allow trailing whitespace, punctuation, or end.
    const re = new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'gu');
    if (re.test(remaining)) {
      ids.add(s.id);
      remaining = remaining.replace(re, (match) => ' '.repeat(match.length));
    }
  }
  return [...ids];
}
