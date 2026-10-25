/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The "Schema-Driven Usage" example on `@object-ui/plugin-timeline`'s README
 * must survive the contract this package ships — `safeValidateSchema` from
 * `@object-ui/types/zod`, the tolerant face (objectui#10824).
 *
 * ## The hole this closes
 *
 * The README taught its node as `component: 'timeline'`. Every node in this
 * protocol is keyed by `type`, so `safeValidateSchema` refused the document
 * exactly as a reader would copy it (`invalid_union` at `type`), and the page
 * ships on npm — `README.md` is in that package's `files`. No gate was asking:
 *
 *   - `check:doc-types` judges `type` string literals, and a node spelled with
 *     `component` has none, so there was nothing for it to judge;
 *   - `check:readme-exports` judges import bindings, not metadata literals;
 *   - `check:doc-snippets` compiles fenced code against the built `dist/`, and
 *     this block is an unannotated `const schema = { … }` literal, so nothing in
 *     it is a type the compiler could refuse.
 *
 * So this file asks the one question nobody was asking of this page: does the
 * example it teaches validate. `plugin-dashboard`'s
 * `readme-dashboard-examples-spec-valid.test.ts` asks the same of that
 * package's README, and this is that pattern applied here, not a new one.
 *
 * ## Why BOTH faces are read
 *
 * The tolerant face is `.passthrough()`: a key it does not declare is kept and
 * judged by nothing. So on its own it cannot tell "every key the page teaches is
 * declared" from "the page teaches `type` AND a stray key nobody reads" — a
 * README that said `type: 'timeline', component: 'timeline'` would pass it. The
 * strict authoring face (`StrictAnyComponentSchema`, objectui#8345) closes every
 * object to its declared keys, so it is the reading that answers the second
 * question. Both are asserted; the tolerant face is the card's criterion and is
 * asserted first.
 *
 * ## Why the block is EXTRACTED and evaluated, never mirrored here
 *
 * A copy of the example in this file would be a second, hand-kept twin of the
 * page — the construction that let the page drift in the first place. So the
 * block is read out of `README.md` on every run: the section is bounded by its
 * own `##` heading, fence pairing is `scripts/markdown-fence-scan.mjs` (the
 * repository's one answer to "does this line open a fence, and what closes
 * it"), and the literal is evaluated as JavaScript, which is what reads its
 * comments and trailing commas the way a reader's editor does. A block the
 * harness cannot find or cannot evaluate FAILS; it is never skipped, because an
 * unexaminable block that reads as a clean one is the shape the doc-gate family
 * exists to prevent (objectui#4846).
 *
 * ## Why it lives here and not in `packages/plugin-timeline`
 *
 * It reads a file off disk, and `packages/plugin-timeline/tsconfig.test.json`
 * names no `node` types, so a `node:fs` import there does not type-check — the
 * reason that package's `metaFields` source pin lives elsewhere too. This
 * package's test config names them, owns both faces the document is judged
 * against, and already reads another plugin's README the same way
 * (`calendar-flat-color-allday-8466.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { closesFence, openFence } from '../../../../scripts/markdown-fence-scan.mjs';

interface OpenFence {
  marker: string;
  run: number;
  info: string;
  lang: string;
}

/** Local annotations, since the import above is untyped — the call sites stay checked. */
const open: (line: string) => OpenFence | null = openFence;
const closes: (line: string, fence: OpenFence) => boolean = closesFence;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const README = join(ROOT, 'packages/plugin-timeline/README.md');

/** The section the example lives in, matched as a whole heading line. */
const SECTION = '## Schema-Driven Usage';

interface Block {
  /** 1-based README line of the block's first code line. */
  line: number;
  source: string;
}

/** Every fenced block in the section, bounded by the next heading of the same or a higher level. */
function sectionBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(SECTION);
  if (start < 0) throw new Error(`"${SECTION}" heading not found in ${README}`);
  if (lines.indexOf(SECTION, start + 1) >= 0) throw new Error(`"${SECTION}" appears twice in ${README}`);

  const blocks: Block[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    const fence = open(lines[i]);
    if (!fence) continue;
    let end = i + 1;
    while (end < lines.length && !closes(lines[end], fence)) end += 1;
    if (end >= lines.length) throw new Error(`unclosed fence at ${README}:${i + 1}`);
    blocks.push({ line: i + 2, source: lines.slice(i + 1, end).join('\n') });
    i = end;
  }
  return blocks;
}

/**
 * The document the block assigns to `schema`. The side-effect import is dropped
 * — it is the registration a host performs, not part of the document — and the
 * rest is evaluated as written. Not wrapped in a try/catch: the evaluator's own
 * error names what it could not read, which is louder than a re-throw (and a
 * wrapper would have to attach a `cause`, which is ES2022 — above this
 * project's ES2020 lib; same route as the dashboard README test).
 */
function documentOf(block: Block): unknown {
  const body = block.source
    .split('\n')
    .filter((l) => !/^\s*import\b/.test(l))
    .join('\n');
  return new Function(`${body}\n;return schema;`)();
}

type Parse = { success: boolean; error?: { issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }> } };

/** `code @ path: message`, one per issue — what a failure prints, never what it asserts. */
function describeIssues(result: Parse): string {
  if (result.success) return '';
  return (result.error?.issues ?? [])
    .map((i) => `${i.code} @ ${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

const blocks = sectionBlocks(readFileSync(README, 'utf8')).filter((b) => /\bconst\s+schema\b/.test(b.source));

describe('plugin-timeline README "Schema-Driven Usage" example (objectui#10824)', () => {
  // Without this, a heading rename or a reworded block makes every assertion
  // below vacuous — an extractor that found nothing reads exactly like a page
  // that is clean.
  it('finds exactly one schema document in the section', () => {
    expect(blocks.map((b) => b.line)).toHaveLength(1);
  });

  it('validates against safeValidateSchema — the tolerant face', () => {
    const result = safeValidateSchema(documentOf(blocks[0])) as Parse;
    expect(describeIssues(result), `packages/plugin-timeline/README.md:${blocks[0].line} is refused`).toBe('');
    expect(result.success).toBe(true);
  });

  it('teaches no key the strict authoring face refuses — every key is declared', () => {
    const result = StrictAnyComponentSchema.safeParse(documentOf(blocks[0])) as Parse;
    expect(describeIssues(result), `packages/plugin-timeline/README.md:${blocks[0].line} carries an undeclared key`).toBe('');
    expect(result.success).toBe(true);
  });
});
