/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AIInsightsSchema` and the `ai-insights` node type stay RETIRED (objectui#8800,
 * ADR-0049 enforce-or-remove).
 *
 * Director-seat ruling, decision batch #137 item 2, 2026-09-15, maintainer
 * verbatim 「同意」, letter **A**: the declaration and its `@object-ui/types`
 * barrel export go. **B** (write a renderer) and **C** (keep it as a documented
 * forward declaration) were refused in the same breath, so a re-added
 * declaration is a published-contract decision and ⛔ never a convenience — the
 * same reason `block-family-retired-4895.test.ts` exists beside its tombstone.
 *
 * ## Why it was retired, in one line each
 *
 * NOTHING ever registered the discriminant, so no node of that spelling reached
 * a renderer: `SchemaRenderer` resolved it to the OBJUI-001 "Unknown component
 * type" panel and the CLI validator called it an unknown schema type. Both
 * refusals are LOUD — ⛔ this was never a silent swallow — but both are at RUN
 * time, while `tsc` said yes because the declaration was on the published
 * `.d.ts`. The retirement moves the refusal to authoring time.
 *
 * ## ⚠️ The limit this pin inherits and does NOT close
 *
 * Every census below is the **IN-REPO HALF**. `git grep` reads this repository's
 * TRACKED files and nothing else: ⛔ not customer applications, ⛔ not published
 * documents, ⛔ not tenant metadata at rest, ⛔ not untracked files. A zero here
 * is a reading about this tree. `@object-ui/types` is published, so an external
 * TypeScript consumer that authored the node is structurally unobservable from
 * here — it gets a compile error naming the symbol, and the changeset's FROM/TO
 * is what it greps. The ruling was taken with this limit attached and ⛔ this file
 * does not quietly upgrade it.
 *
 * ## Three instruments, and why the obvious fourth is absent
 *
 *   - `tsc` sees the `@ts-expect-error` legs. They are the ONLY half that
 *     discriminates the retirement from its absence, because a retired type is a
 *     TypeScript-only refusal. They mean nothing unless `type-check` runs —
 *     vitest strips types. This package compiles every test file
 *     (`tsconfig.test.json`), which is what makes them real.
 *   - vitest reads the two declaration files as TEXT, so a re-introduced
 *     interface reddens even in a run that never type-checks.
 *   - vitest scans the whole TRACKED tree for both spellings, with lit controls
 *     drawn from the three AI siblings that DO render.
 *   - ⛔ The fourth — a runtime `name in module` check, the shape
 *     `block-family-retired-4895.test.ts` uses — is deliberately NOT here, and
 *     the reason is worth more than the leg: `AIInsightsSchema` was an
 *     `export type`, so it was never in any runtime namespace to begin with.
 *     That assertion would have passed identically before this retirement and
 *     after it. A leg that cannot tell the two worlds apart is not evidence, and
 *     writing it down would make this file look better covered than it is.
 *     ⚠️ `./blocks.ts` earned that leg because the block family had zod mirrors
 *     shipping as runtime values; this family has no zod mirror at all, which is
 *     asserted below rather than assumed.
 *     ⚠️ AMENDED 2026-09-28 (objectui#10859): the AI family HAS a zod module now
 *     — `../zod/ai.zod.ts` mirrors the three siblings that render, so the
 *     premise leg below re-derives what the retirement actually rests on (that
 *     face declares no `ai-insights` arm and exports no `AIInsightsSchema`)
 *     instead of the module's absence. Its `'AIInsightsSchema' in ZodFace` probe
 *     is NOT the fourth instrument ruled out above: that one would read the
 *     type-only `../ai.ts` namespace, where the name never existed at runtime;
 *     this one reads the zod barrel, where a mirror of the retired declaration
 *     WOULD be a runtime value, and its `AIRecommendationsSchema` lit control
 *     shows the probe can answer yes. The sentence above records the tree this
 *     pin was written against and is left as it was.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnyComponentSchema } from '../zod/index.zod.js';
import * as ZodFace from '../zod/index.zod.js';

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const DECLARATION_PATH = resolve(HERE, '..', 'ai.ts');
const BARREL_PATH = resolve(HERE, '..', 'index.ts');

/* ── The type face: the symbol is gone from the module AND from the barrel ── */

// @ts-expect-error objectui#8800 — `AIInsightsSchema` is RETIRED from `../ai`. There is no replacement type and no replacement key; see the tombstone in that file.
type _RetiredFromTheDeclaringModule = import('../ai').AIInsightsSchema;

// @ts-expect-error objectui#8800 — and RETIRED from the published barrel, which is the face an external consumer imports.
type _RetiredFromThePublishedBarrel = import('../index').AIInsightsSchema;

/**
 * ⭐ THE LIT CONTROLS for the two directives above, on the same instrument.
 *
 * `@ts-expect-error` fails LOUDLY when the line below it compiles (TS2578,
 * "unused directive"), so the directives cannot rot into silence. What they
 * cannot rule out on their own is a module that stopped resolving ANYTHING — a
 * bad merge that emptied `../ai`, or a moved barrel, would satisfy both. These
 * two resolve a sibling the ruling deliberately left alone, through the exact
 * same import forms, with no directive.
 */
type _SiblingStillResolvesFromTheModule = import('../ai').AIRecommendationsSchema;
type _SiblingStillResolvesFromTheBarrel = import('../index').NLQuerySchema;

/** Consumed so the two controls are not unused type aliases. */
type _ControlsAreReferenced = [
  _SiblingStillResolvesFromTheModule['type'],
  _SiblingStillResolvesFromTheBarrel['type'],
];

describe('objectui#8800 — `ai-insights` stays retired (type face)', () => {
  it('the DECLARING module no longer declares the interface or the spelling', () => {
    // The instrument `tsc` cannot be: a source-text read, so a re-introduced
    // declaration is caught even by a run that never type-checks.
    const source = readFileSync(DECLARATION_PATH, 'utf8');

    expect(/^export interface AIInsightsSchema\b/m.test(source)).toBe(false);
    expect(/^\s*type: 'ai-insights';/m.test(source)).toBe(false);

    // ⭐ LIT CONTROLS — the SAME two matchers, one sibling over, still fire. The
    // three AI schemas this file keeps are registered and rendered by
    // `@object-ui/plugin-ai`; only the fourth was retired. Without these, both
    // absences above would also be satisfied by a truncated read or a matcher
    // that can never match.
    expect(/^export interface AIRecommendationsSchema\b/m.test(source)).toBe(true);
    expect(/^\s*type: 'ai-recommendations';/m.test(source)).toBe(true);

    // The tombstone itself must stay: it is where the ruling, the boundary
    // against the three live schemas, and the in-repo limit are recorded. A
    // retirement whose reasoning is deleted is re-litigated by the next sweep.
    expect(source).toContain('`AIInsightsSchema` (`type: \'ai-insights\'`) — RETIRED');
  });

  it('the published BARREL no longer re-exports the symbol', () => {
    const barrel = readFileSync(BARREL_PATH, 'utf8');

    // Anchored on the export statement rather than the bare word, because the
    // barrel legitimately NAMES the symbol in the comment standing where the
    // export was — that comment is the point, not a leak.
    expect(/^\s*AIInsightsSchema,\s*$/m.test(barrel)).toBe(false);

    // ⭐ LIT CONTROL — the identical matcher finds a sibling that IS still
    // re-exported from the same block.
    expect(/^\s*AIRecommendationsSchema,\s*$/m.test(barrel)).toBe(true);
  });
});

describe('objectui#8800 — nothing in this TRACKED tree carries either spelling', () => {
  /**
   * What is excluded, and why each row is here. ⛔ No allow-list FILE: a list
   * that lives on disk outlives the reason for each of its rows.
   *
   *  - `*CHANGELOG.md` and `.changeset/` — the published RECORD of retirements,
   *    including this one, which must keep naming what it removed. Re-pointing
   *    a released CHANGELOG paragraph would make it describe a tree it was never
   *    written about.
   *  - `ai.ts` and `index.ts` — the two files the retirement EDITED. Each carries
   *    a tombstone comment that names the symbol on purpose; a scan reddening on
   *    them would be asserting the retirement had not landed. That they no longer
   *    DECLARE it is asserted above, by matchers shaped for a declaration.
   *  - `ai-zero-read-members-retired-8178.test.ts` — objectui#8178's pin, whose
   *    exclusion paragraph was rewritten BY THIS RULING and names the symbol to
   *    record what it used to hold.
   *  - this pin, which must write both spellings to probe for them.
   */
  const EXCLUDED = [
    ':!*CHANGELOG.md',
    ':!.changeset/',
    ':!packages/types/src/ai.ts',
    ':!packages/types/src/index.ts',
    ':!packages/types/src/__tests__/ai-zero-read-members-retired-8178.test.ts',
    ':!packages/types/src/__tests__/ai-insights-retired-8800.test.ts',
  ];

  /** `git grep -nE <pattern> -- . <exclusions>`, exit 1 (no match) normalised to an empty list. */
  const grepTree = (pattern: string): string[] => {
    try {
      const out = execFileSync('git', ['grep', '-nE', pattern, '--', '.', ...EXCLUDED], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return out.split('\n').filter(Boolean);
    } catch (e) {
      // `git grep` exits 1 for "no matches" — the PASS case here, distinguished
      // from a real failure (exit > 1) rather than swallowed.
      const status = (e as { status?: number }).status;
      if (status === 1) return [];
      throw e;
    }
  };

  it('the SYMBOL `AIInsightsSchema` appears nowhere outside the record and the pins', () => {
    expect(grepTree('AIInsightsSchema')).toEqual([]);
  });

  it('the SPELLING `ai-insights` appears nowhere — no author, no doc, no fixture', () => {
    expect(grepTree('ai-insights')).toEqual([]);
  });

  it('LIT CONTROLS — the same probe finds the three siblings that DO render', () => {
    // Without these, both zeros above would also be produced by a broken
    // `git grep` invocation, a wrong cwd, or an exclusion list that swallowed
    // the tree — and a swallowed tree renders as a successful retirement.
    expect(grepTree('AIRecommendationsSchema').length).toBeGreaterThan(0);
    expect(grepTree('ai-recommendations').length).toBeGreaterThan(0);
    expect(grepTree('NLQuerySchema').length).toBeGreaterThan(0);
  });
});

describe('objectui#8800 — PREMISE: the zod face never accepted the spelling', () => {
  // ⚠️ PREMISE, ⛔ not evidence: these legs were green BEFORE this retirement and
  // are green after, because `AnyComponentSchema` never had an AI arm. They are
  // here so the retirement's own claim — "the runtime already refused it; only
  // `tsc` said yes" — is re-derived on every run instead of remembered from the
  // card. If an arm for this spelling is ever added, this file goes red beside
  // the declaration that would have to come back with it.
  it('`AnyComponentSchema` refuses a node authored as `ai-insights`', () => {
    const refused = AnyComponentSchema.safeParse({ type: 'ai-insights', objectName: 'account' });
    expect(refused.success).toBe(false);
  });

  it('CONTROL: a discriminant the union DOES declare parses green on the same instrument', () => {
    // So the refusal above is a reading about this spelling, not a union that
    // refuses everything handed to it.
    expect(AnyComponentSchema.safeParse({ type: 'button', label: 'Save' }).success).toBe(true);
  });

  it('the AI zod mirror declares no `ai-insights` arm — the retirement still has ONE face, not two', () => {
    // The card's sweep found no zod mirror for `ai.ts`, and a mirror of the
    // RETIRED declaration would give the retirement a second face and change its
    // shape. ⚠️ AMENDED (objectui#10859): `ai.zod.ts` now exists and mirrors the
    // three siblings that render, so this leg no longer reads the module's
    // absence — it reads that the mirror carries no arm for the retired literal
    // and no schema under the retired name.
    const source = readFileSync(resolve(HERE, '..', 'zod', 'ai.zod.ts'), 'utf8');
    expect(source).not.toMatch(/ai-insights/);
    expect(source).not.toMatch(/AIInsights/);
    expect('AIInsightsSchema' in ZodFace).toBe(false);
    // ⭐ LIT CONTROLS — the same probes find a sibling the mirror DOES carry, so
    // the absences above are readings and not a broken path join or namespace.
    expect(source).toMatch(/z\.literal\('ai-recommendations'\)/);
    expect('AIRecommendationsSchema' in ZodFace).toBe(true);
  });
});
