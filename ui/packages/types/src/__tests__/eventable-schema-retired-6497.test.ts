/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `UIEventHandler` and `EventableSchema` stay RETIRED (objectui#6497, ADR-0049
 * enforce-or-remove).
 *
 * Director-seat ruling, 2026-09-24, maintainer verbatim 「同意」: remove, the
 * re-priced option 2. Both published types go, with their barrel re-exports and
 * the `EventableSchema` arm of `APISchema`. Option 1 (wire the dialect: zod
 * mirror, extenders, a dispatcher) and option 3 (leave it published) were the
 * alternatives the card priced, so a re-added declaration is a
 * published-contract decision and ⛔ never a convenience. The ruling follows
 * objectui#6182 (ruled A): an authored handler EXPRESSION is not a supported
 * authoring form; the supported form is the declarative `ActionDef` object.
 *
 * ## ⚠️ The limit this pin inherits and does NOT close
 *
 * The tree scan below is the IN-REPO half: `git grep` reads this repository's
 * TRACKED files only — ⛔ not customer applications, ⛔ not untracked files. An
 * external TypeScript consumer that imported either name gets a compile error
 * naming the symbol, and the changeset is what it reads.
 *
 * ## Three instruments, and why the obvious fourth is absent
 *
 *   - `tsc` sees the `@ts-expect-error` legs. They are the only half that tells
 *     the retirement from its absence, because a retired type is a
 *     TypeScript-only refusal, and they mean nothing unless `type-check` runs
 *     (vitest strips types). This package compiles every `*.test.ts` file
 *     through `tsconfig.test.json`, which is what makes them real.
 *   - vitest reads the declaring module and the barrel as TEXT, so a
 *     re-introduced interface or re-export reddens even in a run that never
 *     type-checks.
 *   - vitest scans the whole TRACKED tree for both spellings, with a lit
 *     control on the same probe.
 *   - ⛔ A runtime `name in module` leg is deliberately absent: both names were
 *     `export type`, so neither was ever in a runtime namespace. That leg would
 *     pass identically before and after this retirement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const DECLARATION_PATH = resolve(HERE, '..', 'api-types.ts');
const BARREL_PATH = resolve(HERE, '..', 'index.ts');

/* ── The type face: both symbols are gone from the module AND from the barrel ── */

// @ts-expect-error objectui#6497 — `UIEventHandler` is RETIRED from `../api-types`. No replacement type; see the tombstone in that file.
type _HandlerRetiredFromTheDeclaringModule = import('../api-types').UIEventHandler;

// @ts-expect-error objectui#6497 — `EventableSchema` is RETIRED from `../api-types`. No replacement type; see the tombstone in that file.
type _EventableRetiredFromTheDeclaringModule = import('../api-types').EventableSchema;

// @ts-expect-error objectui#6497 — and `UIEventHandler` is RETIRED from the published barrel, the face an external consumer imports.
type _HandlerRetiredFromThePublishedBarrel = import('../index').UIEventHandler;

// @ts-expect-error objectui#6497 — and `EventableSchema` is RETIRED from the published barrel, the face an external consumer imports.
type _EventableRetiredFromThePublishedBarrel = import('../index').EventableSchema;

/**
 * ⭐ THE LIT CONTROLS for the four directives above, on the same instrument.
 *
 * `@ts-expect-error` fails loudly when the line below it compiles (TS2578,
 * "unused directive"), so the directives cannot rot into silence. What they
 * cannot rule out on their own is a module that stopped resolving ANYTHING — an
 * emptied `../api-types` or a moved barrel would satisfy all four. These resolve
 * siblings the ruling left alone, through the exact same import forms, with no
 * directive.
 */
type _SiblingStillResolvesFromTheModule = import('../api-types').DataFetchableSchema;
type _SiblingStillResolvesFromTheBarrel = import('../index').ExpressionNodeSchema;
type _UnionStillResolvesFromTheBarrel = import('../index').APISchema;

/** Consumed so the controls are not unused type aliases. */
type _ControlsAreReferenced = [
  _SiblingStillResolvesFromTheModule['type'],
  _SiblingStillResolvesFromTheBarrel['type'],
  _UnionStillResolvesFromTheBarrel['type'],
];

describe('objectui#6497 — the event-handler dialect stays retired (type face)', () => {
  it('the DECLARING module no longer declares either interface', () => {
    const source = readFileSync(DECLARATION_PATH, 'utf8');

    expect(/^export interface UIEventHandler\b/m.test(source)).toBe(false);
    expect(/^export interface EventableSchema\b/m.test(source)).toBe(false);

    // ⭐ LIT CONTROL — the same matcher shape, one sibling over, still fires.
    // Without it both absences above would also be satisfied by a truncated
    // read or a matcher that can never match.
    expect(/^export interface DataFetchableSchema\b/m.test(source)).toBe(true);

    // The tombstone stays: it records the ruling, what went and the supported
    // form. A retirement whose reasoning is deleted is re-litigated by the next
    // sweep.
    expect(source).toContain('`UIEventHandler` and `EventableSchema` — RETIRED');
  });

  it('`APISchema` no longer carries an `EventableSchema` arm', () => {
    const source = readFileSync(DECLARATION_PATH, 'utf8');
    const union = /^export type APISchema =([^;]*);/m.exec(source);

    // The union is still declared (a missing union would make the next two
    // assertions vacuous), it no longer names the retired arm, and it still
    // names a surviving arm — the lit control on the same extracted text.
    expect(union).not.toBeNull();
    expect(union![1]).not.toMatch(/\bEventableSchema\b/);
    expect(union![1]).toMatch(/\bDataFetchableSchema\b/);
  });

  it('the published BARREL no longer re-exports either symbol', () => {
    const barrel = readFileSync(BARREL_PATH, 'utf8');

    // Anchored on the export-list entry rather than the bare word, because the
    // barrel legitimately NAMES both symbols in the comment standing where the
    // exports were — that comment is the point, not a leak.
    expect(/^\s*UIEventHandler,\s*$/m.test(barrel)).toBe(false);
    expect(/^\s*EventableSchema,\s*$/m.test(barrel)).toBe(false);

    // ⭐ LIT CONTROL — the identical matcher finds siblings that ARE still
    // re-exported from the same block.
    expect(/^\s*DataFetchableSchema,\s*$/m.test(barrel)).toBe(true);
    expect(/^\s*APISchema,\s*$/m.test(barrel)).toBe(true);
  });
});

describe('objectui#6497 — nothing in this TRACKED tree carries either symbol', () => {
  /**
   * What is excluded, and why each row is here. ⛔ No allow-list FILE: a list
   * that lives on disk outlives the reason for each of its rows.
   *
   *  - `*CHANGELOG.md` and `.changeset/` — the published RECORD of retirements,
   *    including this one, which must keep naming what it removed.
   *  - `api-types.ts` and `index.ts` — the two files the retirement EDITED. Each
   *    carries a tombstone comment naming both symbols on purpose; that they no
   *    longer DECLARE or RE-EXPORT them is asserted above by matchers shaped for
   *    a declaration and an export-list entry.
   *  - this pin, which must write both spellings to probe for them.
   */
  const EXCLUDED = [
    ':!*CHANGELOG.md',
    ':!.changeset/',
    ':!packages/types/src/api-types.ts',
    ':!packages/types/src/index.ts',
    ':!packages/types/src/__tests__/eventable-schema-retired-6497.test.ts',
  ];

  /** `git grep -nE PATTERN -- . EXCLUSIONS`, exit 1 (no match) normalised to an empty list. */
  const grepTree = (pattern: string): string[] => {
    try {
      const out = execFileSync('git', ['grep', '-nE', pattern, '--', '.', ...EXCLUDED], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return out.split('\n').filter(Boolean);
    } catch (e) {
      // `git grep` exits 1 for "no matches" — the PASS case here, told apart
      // from a real failure (exit > 1) rather than swallowed.
      const status = (e as { status?: number }).status;
      if (status === 1) return [];
      throw e;
    }
  };

  it('the symbol `UIEventHandler` appears nowhere outside the record and this pin', () => {
    expect(grepTree('\\bUIEventHandler\\b')).toEqual([]);
  });

  it('the symbol `EventableSchema` appears nowhere — no extender, no zod mirror, no reader, no doc', () => {
    expect(grepTree('\\bEventableSchema\\b')).toEqual([]);
  });

  it('LIT CONTROL — the same probe finds the supported form, `ActionDef`', () => {
    // Without this, both zeros above would also be produced by a broken
    // `git grep` invocation, a wrong cwd, or an exclusion list that swallowed
    // the tree — and a swallowed tree renders as a successful retirement.
    expect(grepTree('\\bActionDef\\b').length).toBeGreaterThan(0);
  });
});
