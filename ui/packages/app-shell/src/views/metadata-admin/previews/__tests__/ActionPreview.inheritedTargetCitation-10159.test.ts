// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10159 — the `INHERITED_TARGET` docblock quotes the resolver's read,
 * and this file is what keeps it quoting a read that exists.
 *
 * ## The defect
 *
 * The docblock above `INHERITED_TARGET` in `ActionPreview` tells its reader
 * where a field-backed picker's real target comes from at runtime, and it does
 * so by QUOTING the resolver's expression. objectui#6837 narrowed that read in
 * `resolveActionParam` to the one spelling the protocol declares,
 * `field.reference`; the quotation was not narrowed with it and kept naming
 * `field.reference_to`. That is more than a stale comment: `@objectstack/spec`
 * refuses `reference_to` on a field definition BY NAME (`unrecognized_keys`,
 * with the rename to `reference` as the suggestion), so a reader who took the
 * comment at its word would author a key the platform rejects.
 *
 * ## Why the assertion is shaped this way
 *
 *  1. **The quotation is re-derived from the docblock, never transcribed
 *     here.** A pin that restated the expected expression would be a second
 *     copy of the claim, free to rot alongside the first. The only thing this
 *     file knows is WHERE to look: the backtick span in that docblock that
 *     starts `referenceTo:`.
 *  2. **It is looked for in the resolver's CODE, with comments masked** by the
 *     shared `scripts/js-comment-mask.mjs` — the resolver's own comments
 *     discuss `reference_to` at length, and a match over raw text could be
 *     satisfied by prose about a read rather than by the read.
 *  3. **At a token boundary, not as a substring.** A plain `includes` would
 *     accept a docblock quoting `field.reference` against code that reads
 *     `field.reference_to` — this defect's mirror image. The DISCRIMINATOR case
 *     pins that the boundary refuses a prefix.
 *  4. **Whitespace is compared collapsed on both sides,** so re-wrapping the
 *     docblock or re-formatting the code moves nothing; only a change of
 *     tokens does.
 *
 * The CONTROL case proves the instrument is lit: the same reader, mask and
 * boundary FIND every `referenceTo:` read the resolver really has. Without it
 * the main assertion's red could mean a blind instrument as easily as a wrong
 * quotation.
 *
 * Cited by content — symbol names and quoted strings — and never by line
 * address (AGENTS.md #11): the absence of that discipline is how this
 * quotation drifted without anyone seeing it.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Rooted on THIS file, never on `process.cwd()` (objectui#7799). */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');

const PREVIEW = 'packages/app-shell/src/views/metadata-admin/previews/ActionPreview.tsx';
// Moved out of app-shell into `@object-ui/fields` by objectui#12105, so the
// bulk dialog reads the same resolver (the read this docblock quotes is unchanged).
const RESOLVER = 'packages/fields/src/resolveActionParams.ts';

/** Read a tracked file, and prove the read landed or every assertion on it is vacuous. */
function read(rel: string): string {
  const abs = path.join(repoRoot, rel);
  expect(existsSync(abs), `source not found at ${abs}`).toBe(true);
  const text = readFileSync(abs, 'utf8');
  expect(text.length, `${rel} read back empty`).toBeGreaterThan(0);
  return text;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ');

/** The resolver's code, comments masked and whitespace collapsed. */
function resolverCode(): string {
  return collapse(mask(read(RESOLVER)));
}

/** The docblock directly above `const INHERITED_TARGET`, with its `*` gutters removed. */
function inheritedTargetDocblock(): string {
  const source = read(PREVIEW);
  const at = source.indexOf('\nconst INHERITED_TARGET');
  expect(at, '`const INHERITED_TARGET` not found — the docblock reader has nothing to read').toBeGreaterThan(-1);
  const before = source.slice(0, at);
  const opens = before.lastIndexOf('/**');
  expect(opens, 'no docblock above `INHERITED_TARGET`').toBeGreaterThan(-1);
  const block = before.slice(opens);
  expect(block.trimEnd().endsWith('*/'), 'the block above `INHERITED_TARGET` is not a closed docblock').toBe(true);
  return collapse(block.replace(/\n\s*\*(?!\/)/g, ' '));
}

/** Every backtick span in `text` that quotes a `referenceTo:` read. */
function quotedReferenceToReads(text: string): string[] {
  return [...text.matchAll(/`(referenceTo:[^`]*)`/g)].map((m) => collapse(m[1].trim()));
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `expr` occurs in `code` as whole tokens — not as the prefix of a longer identifier. */
function occursAsTokens(expr: string, code: string): boolean {
  return new RegExp(`(?<![\\w$])${escape(expr)}(?![\\w$])`).test(code);
}

describe('objectui#10159 — the `INHERITED_TARGET` docblock quotes the read the resolver performs', () => {
  it('the docblock attributes exactly one `referenceTo:` read to `resolveActionParams`', () => {
    // Landing proof: a reader that found the wrong block, or no quotation in
    // it, would let the next case pass by checking nothing.
    const block = inheritedTargetDocblock();
    expect(block, 'the extracted block is not the `INHERITED_TARGET` docblock').toContain('bound field');
    expect(block, 'the docblock no longer names the resolver this file reads').toContain('`resolveActionParams`');
    expect(quotedReferenceToReads(block)).toHaveLength(1);
  });

  it('that quotation occurs in the resolver\'s code, as whole tokens', () => {
    const [quoted] = quotedReferenceToReads(inheritedTargetDocblock());
    expect(
      occursAsTokens(quoted, resolverCode()),
      `the docblock quotes \`${quoted}\`, which the resolver does not perform — quote the read it does`,
    ).toBe(true);
  });

  it('CONTROL — the same reader, mask and boundary find every `referenceTo:` read the resolver has', () => {
    const code = resolverCode();
    const reads = [...code.matchAll(/referenceTo: [^,}]+/g)].map((m) => m[0].trim());
    // A mask that blanked everything, or a wrong path, would leave nothing here.
    expect(reads.length, 'no `referenceTo:` read survived the mask — the main case would be vacuous').toBeGreaterThan(0);
    expect(reads.some((r) => r.startsWith('referenceTo: param.reference ??'))).toBe(true);
    for (const r of reads) expect(occursAsTokens(r, code), r).toBe(true);
  });

  it('DISCRIMINATOR — the boundary refuses a prefix of a longer identifier', () => {
    expect(occursAsTokens('field.reference', 'x = field.reference_to;')).toBe(false);
    expect(occursAsTokens('field.reference', 'x = field.reference,')).toBe(true);
    expect(occursAsTokens('field.reference_to', 'x = field.reference,')).toBe(false);
  });
});
