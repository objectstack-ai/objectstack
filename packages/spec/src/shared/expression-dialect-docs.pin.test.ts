// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6085] The `## Dialects` table in `expression.zod.ts`'s module TSDoc lists
 * exactly the members of `ExpressionDialect` — no more, no fewer.
 *
 * That table is not a comment. `build-docs.ts` publishes the module doc block
 * verbatim as the opening prose of `content/docs/references/shared/expression.mdx`,
 * so it is the authoring surface an author (often an AI author, ADR-0033) reads
 * to learn which dialects exist. It drifted in BOTH directions at once and
 * stayed that way for majors:
 *
 *  - it carried a `js` row, complete with an engine (`isolated-vm` / `quickjs`)
 *    and a use ("mapping, hook bodies"), for a dialect retired at #3278
 *    (ADR-0058 addendum) that `ExpressionSchema` rejects on parse — the
 *    Prime Directive #10 shape, advertising a capability the runtime refuses;
 *  - it omitted `template`, a real member with its own author helper
 *    (`TemplateExpressionInputSchema`, `tmpl`), so the one dialect an author
 *    reaches for on notification bodies and prompt templates was undocumented.
 *
 * Twelve lines below the table, the enum and the comment beside it had the
 * retirement right the whole time. Nothing compared the two, which is exactly
 * the gap this pin closes: `check:docs` re-renders the page FROM this table, so
 * it verifies the artifact matches the source and is green on a source that
 * lies.
 *
 * ⛔ Scope: the relation, not the wording. Rewording a `use` cell or renaming an
 * engine is free; adding or dropping a ROW without the enum agreeing is not.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, it, expect } from 'vitest';

import { ExpressionDialect } from './expression.zod';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, 'expression.zod.ts');

/**
 * The dialect names in the first column of the `## Dialects` table.
 *
 * Read out of the raw source rather than out of the generated `.mdx`, because
 * the source is what a reader of the file sees AND what the generator copies —
 * one read covers both surfaces, and it cannot go green because a regen was
 * forgotten.
 */
function dialectRowsInDocTable(): string[] {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const section = source.slice(source.indexOf('## Dialects'));
  const row = /^\s*\*\s*\|\s*`([a-z_]+)`\s*\|/;

  // Walk the section rather than slicing it: the header is followed by a blank
  // doc line and a `|:---|` separator, so any "up to the first blank line" cut
  // lands before the rows. Collect the run of body rows and stop when it ends.
  const names: string[] = [];
  for (const line of section.split('\n')) {
    const match = row.exec(line);
    if (match) { names.push(match[1]); continue; }
    if (names.length > 0) break; // the table's body ended
  }
  return names;
}

describe('[#6085] expression.zod.ts dialect table === ExpressionDialect', () => {
  const rows = dialectRowsInDocTable();

  it('finds the table at all (anti-vacuity)', () => {
    // Every assertion below compares two lists; an empty left side would make
    // them all pass the day someone reformats the block or moves the section.
    expect(rows.length, 'no `| `dialect` |` rows parsed out of the `## Dialects` table')
      .toBeGreaterThan(0);
    expect(ExpressionDialect.options.length).toBeGreaterThan(0);
  });

  it('documents exactly the enum members, in the enum-agnostic sense of a set', () => {
    expect([...rows].sort()).toEqual([...ExpressionDialect.options].sort());
  });

  it('never re-advertises `js`, retired at #3278', () => {
    // The specific regression this pin was written for. `js` is not an
    // expression dialect at all — procedural JavaScript is the L2 authoring
    // surface (`ScriptBody { language: 'js' }`), so a row here would send an
    // author to a value `ExpressionSchema` rejects.
    expect(rows).not.toContain('js');
    expect(ExpressionDialect.safeParse('js').success).toBe(false);
  });

  it('documents `template`, which has an author helper and is easy to omit', () => {
    expect(rows).toContain('template');
    expect(ExpressionDialect.safeParse('template').success).toBe(true);
  });
});
