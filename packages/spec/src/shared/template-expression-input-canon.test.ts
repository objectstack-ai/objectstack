// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The canon a `TemplateExpressionInputSchema` hover shows (ADR-0032 Decision 4:
 * fix the canon first — the model emits what it is shown).
 *
 * The schema's docblock ships as the `.d.ts` hover text of the spec tarball,
 * and it is where an author (or an agent) reads which placeholder spelling a
 * template slot takes. Since protocol 18 a notify node's `title` / `message`
 * read `{{var}}` only (#22110), so no sentence of that docblock may still
 * prescribe the single-brace `{var}` for a notify slot. The one sentence that
 * may name `{var}` there is the one saying it is REFUSED.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./expression.zod.ts', import.meta.url), 'utf8');

/** The `/** … *\/` block directly above `marker`, as prose (comment gutters removed). */
function docblockAbove(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`marker not found: ${marker}`);
  const end = source.lastIndexOf('*/', at);
  const start = source.lastIndexOf('/**', end);
  return source.slice(start + 3, end).replace(/\n\s*\* ?/g, ' ');
}

/** A single-brace `{var}` — not the inside of `{{var}}`. */
const SINGLE_BRACE_VAR = /(^|[^{])`?\{var\}`?(?!\})/;

describe('TemplateExpressionInputSchema docblock — the canon on a notify slot', () => {
  const doc = docblockAbove(SOURCE, 'export const TemplateExpressionInputSchema');
  const sentences = doc.split(/(?<=\.)\s+/);

  it('reads the docblock it means to — the notify bullet and the closing prescription are there', () => {
    expect(sentences.some((s) => /notify/i.test(s) && s.includes('{{var}}'))).toBe(true);
    expect(sentences.some((s) => s.includes('So write the spelling the slot\'s renderer reads'))).toBe(true);
  });

  it('prescribes no single-brace `{var}` for a notify slot — only the sentence that refuses it names one', () => {
    const offending = sentences.filter((s) => /notify/i.test(s) && SINGLE_BRACE_VAR.test(s) && !/refused/.test(s));
    expect(offending).toEqual([]);
  });
});
