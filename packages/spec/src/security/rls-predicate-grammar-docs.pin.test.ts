// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6919] The RLS predicate grammar is stated on THREE faces of
 * `rls.zod.ts`, and they must not drift apart again.
 *
 * The three:
 *
 *  1. **module docblock** — the `ObjectStack RLS:` bullet list. `build-docs.ts`
 *     publishes the module block verbatim as the opening prose of
 *     `content/docs/references/security/rls.mdx`, so this face is READ BY USERS.
 *  2. **property docblock** — the TSDoc block above `using`. No generator reads
 *     property-level TSDoc, so this face is read only by whoever opens the file
 *     (often an AI author, ADR-0033) — which is exactly why it rotted unnoticed.
 *  3. **`.describe()` on `using`** — also published (it renders into the same
 *     page's property table).
 *
 * They have now drifted twice. Both times the same way: a face froze a
 * *snapshot* of the compiler as a **closed enumeration with a count**
 * ("Exactly four forms compile"; "equality, set-membership, always-true"),
 * the compiler grew, and the prose stayed. #6762 / PR #6918 fixed faces 1 and
 * 3; #6919 rewrote face 2 and deleted the interim `⚠️ STALE` marker PR #6918
 * had parked on it. Nothing compared the three, so face 2 contradicted face 3
 * — on the same property — across two majors.
 *
 * ⛔ Scope: **the claim shape, not the wording.** Rephrasing a sentence,
 * reordering the bullets, or adding a newly-supported form is free. Reverting
 * any face to a fixed-count / closed-set claim, dropping an operator that
 * enforces, or dropping the fail-closed statement is not.
 *
 * Why a source-text pin is the right instrument here, given #6987's warning
 * that source-scanning pins nail the wrong number when the pinned fact lives
 * outside the source: the fact pinned here IS text — three prose faces of one
 * file agreeing with each other. Reading the source is not a proxy for the
 * fact, it is the fact. (The behavioural half — which predicates actually
 * lower — is owned by `isSupportedRlsExpression`'s own tests in
 * `@objectstack/formula`; this file must not restate it, and deliberately does
 * not import a runtime package.)
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, it, expect } from 'vitest';

import { RowLevelSecurityPolicySchema } from './rls.zod';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, 'rls.zod.ts');

const source = fs.readFileSync(SOURCE, 'utf8');

/**
 * Face 1 — the `ObjectStack RLS:` bullets of the module docblock.
 *
 * Read out of the raw source rather than out of the generated `.mdx`: the
 * source is what a reader of the file sees AND what the generator copies, so
 * one read covers both surfaces and it cannot go green because a regen was
 * forgotten.
 */
function moduleFace(): string {
  const blockEnd = source.indexOf('*/');
  const block = source.slice(0, blockEnd);
  const anchor = block.indexOf('ObjectStack RLS:');
  expect(anchor, '`ObjectStack RLS:` heading not found in the module docblock').toBeGreaterThan(-1);

  // Collect the run of `* - ` bullets that follows, stopping when it ends.
  const lines: string[] = [];
  for (const line of block.slice(anchor).split('\n')) {
    if (/^\s*\*\s*-\s+\S/.test(line)) { lines.push(line); continue; }
    if (lines.length > 0) break;
  }
  return lines.join('\n');
}

/** Face 2 — the TSDoc block immediately above the `using` property. */
function propertyFace(): string {
  const decl = source.indexOf('\n  using: z.string()');
  expect(decl, '`using: z.string()` declaration not found').toBeGreaterThan(-1);
  const end = source.lastIndexOf('*/', decl);
  const start = source.lastIndexOf('/**', end);
  expect(start, 'no TSDoc block found above `using`').toBeGreaterThan(-1);
  return source.slice(start, end + 2);
}

/** Face 3 — the `.describe()` carried by the `using` property. */
function describeFace(): string {
  const shape = (RowLevelSecurityPolicySchema as unknown as { shape: Record<string, { description?: string }> }).shape;
  return shape.using?.description ?? '';
}

/**
 * Every operator the reference compiler lowers, spelled the way all three
 * faces spell it (backticked, canonical CEL). Adding a row here when the
 * compiler grows is the intended maintenance: it turns "the docs are stale"
 * from something nobody notices into a red test.
 */
const ENFORCING_OPERATORS = ['`==`', '`!=`', '`<`', '`<=`', '`>`', '`>=`', '`in`', '`&&`', '`||`'] as const;

/** A count attached to the accepted set — the exact defect that recurred. */
const FIXED_COUNT_CLAIM =
  /\b(?:exactly|precisely|only|just)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:forms?|shapes?|expressions?|predicates?)\b/i;

/** The same defect spelled without the adverb ("four forms compile"). */
const BARE_COUNT_CLAIM =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:forms?|shapes?)\s+(?:compile|lower|are\s+supported)\b/i;

const FACES: ReadonlyArray<readonly [string, string]> = [
  ['module docblock', moduleFace()],
  ['property docblock', propertyFace()],
  ['.describe()', describeFace()],
];

describe('[#6919] rls.zod.ts states one predicate grammar on all three faces', () => {
  it('finds all three faces at all (anti-vacuity)', () => {
    // Every assertion below is a search over a string. An empty haystack would
    // make the negative ones pass forever the day someone moves a block.
    for (const [name, text] of FACES) {
      expect(text.length, `${name} face came back empty — the extractor no longer finds it`)
        .toBeGreaterThan(200);
    }
    expect(propertyFace()).toContain('Supported expression grammar');
  });

  it.each(FACES.map(([name, text]) => ({ name, text })))(
    'the $name face states no fixed count of accepted forms',
    ({ name, text }) => {
      // ⛔ #6919: replacing "four" with the current number is the SAME defect —
      // the grammar is "whatever lowers to a filter", not a numbered list.
      expect(FIXED_COUNT_CLAIM.test(text), `${name} re-introduced a counted accepted set`).toBe(false);
      expect(BARE_COUNT_CLAIM.test(text), `${name} re-introduced a counted accepted set`).toBe(false);
    },
  );

  it.each(FACES.map(([name, text]) => ({ name, text })))(
    'the $name face does not re-assert a retracted under-statement',
    ({ name, text }) => {
      // The two literal sentences #6762 / #6918 / #6919 removed.
      expect(text, `${name} re-asserts that only \`=\` compares`).not.toMatch(/comparison\s+operators?\s+other\s+than/i);
      expect(text, `${name} re-asserts the closed three-item grammar`)
        .not.toMatch(/equality,\s*set-membership,\s*always-true/i);
    },
  );

  it.each(FACES.map(([name, text]) => ({ name, text })))(
    'the $name face still says the compiler fails closed',
    ({ name, text }) => {
      // The one safety-relevant sentence. A face that drops it turns a
      // "matches zero rows" contract into an unstated one.
      expect(text, `${name} no longer states the fail-closed contract`).toMatch(/fails?\s+closed/i);
    },
  );

  it('the property docblock and `.describe()` name the same operator set', () => {
    // The pair that literally contradicted each other on one property (#6919).
    const property = propertyFace();
    const described = describeFace();
    for (const op of ENFORCING_OPERATORS) {
      expect(property, `property docblock stopped naming ${op}`).toContain(op);
      expect(described, `.describe() stopped naming ${op}`).toContain(op);
    }
    // The allow-all is a literal, not an operator, but it is the form most
    // often dropped when someone "tidies" the list.
    expect(property).toContain('`true`');
    expect(described).toContain('`true`');
  });

  it('the module face describes an open grammar, not a closed list', () => {
    // This face is ONE published line, so it cannot enumerate operators. What
    // it must not do is name a finite set of categories again: it has to carry
    // the composition operators, which are what a closed "equality /
    // set-membership / always-true" list always omits.
    const module = moduleFace();
    expect(module).toContain('`&&`');
    expect(module).toContain('`||`');
    expect(module).toMatch(/comparisons/i);
    expect(module).toMatch(/set-membership/i);
  });

  it('carries no `STALE` marker on any face', () => {
    // PR #6918 parked a `⚠️ STALE` marker on the property block as an interim
    // measure and #6919 removed it with the rewrite. A marker coming back is a
    // signal that the faces disagree again — which is what this pin is for.
    for (const [name, text] of FACES) {
      expect(text, `${name} carries a STALE marker again`).not.toMatch(/\bSTALE\b/);
    }
  });

  it('presents CEL as the canonical spelling, SQL as the deprecated bridge', () => {
    // ADR-0058 D1. `sqlPredicateToCel` is `@deprecated`; a face that leads with
    // SQL sends an author to the dialect we are migrating off.
    expect(propertyFace()).toMatch(/canonical CEL/);
    expect(describeFace()).toMatch(/canonical CEL/);
    expect(moduleFace()).toMatch(/CEL/);
  });
});
