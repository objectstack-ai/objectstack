// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The canon this file's template docblocks show (ADR-0032 Decision 4: fix the
 * canon first — the model emits what it is shown).
 *
 * Three exported symbols of `expression.zod.ts` tell an author (or an agent)
 * which placeholder spelling a template slot takes, and each docblock ships as
 * the `.d.ts` hover text of the spec tarball: `TemplateExpressionInputSchema`,
 * the `tmpl` helper the notify `title` / `message` `.describe()` names as the
 * way to write the envelope, and `TYPED_EXPRESSION_SOURCE_REQUIRED`. Since
 * protocol 18 a notify node's `title` / `message` read `{{var}}` only (#22110),
 * so no sentence of those docblocks may still prescribe a single-brace
 * placeholder (`{var}`, `{record.x}`, `{record.name}`) for a notify slot. The
 * one sentence that may name one there is the one saying it is REFUSED. The
 * three are held as one set: the canon in this file is one canon.
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

/** A single-brace placeholder — `{var}`, `{record.x}` — not the inside of a `{{ }}` hole. */
const SINGLE_BRACE_PLACEHOLDER = /(^|[^{])\{[A-Za-z_$][\w.$]*\}(?!\})/;

/** The docblocks held as one canon, each with a sentence that proves the read reached it. */
const DOCBLOCKS: ReadonlyArray<{ marker: string; reached: RegExp }> = [
  { marker: 'export const TemplateExpressionInputSchema', reached: /So write the spelling the slot's renderer reads/ },
  { marker: 'export function tmpl', reached: /Write the spelling the slot's renderer reads/ },
  { marker: 'export const TYPED_EXPRESSION_SOURCE_REQUIRED', reached: /The `template` sentence prescribes/ },
];

describe('expression.zod.ts template docblocks — the canon on a notify slot', () => {
  for (const { marker, reached } of DOCBLOCKS) {
    const doc = docblockAbove(SOURCE, marker);
    const sentences = doc.split(/(?<=\.)\s+/);

    describe(marker, () => {
      it('reads the docblock it means to — it names a notify slot, and its prescription sentence is there', () => {
        expect(sentences.some((s) => /notify/i.test(s))).toBe(true);
        expect(reached.test(doc)).toBe(true);
      });

      it('prescribes no single-brace placeholder for a notify slot — only a sentence that refuses one names it', () => {
        const offending = sentences.filter((s) => /notify/i.test(s) && SINGLE_BRACE_PLACEHOLDER.test(s) && !/refused/.test(s));
        expect(offending).toEqual([]);
      });
    });
  }
});
