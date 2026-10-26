/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin, STAGE 2 of 2 (FINAL) — `PluginComponentInput` is RETIRED:
 * the published alias is gone, not merely deprecated (objectui#5674).
 *
 * ## Sequencing
 *
 * Maintainer ruling, 2026-08-22 (item 13 = A): deprecate for a release, then
 * delete. Stage 1 (PR #5897) added the `@deprecated` tag and created this file
 * as `plugin-component-input-deprecation.test.ts`; nothing was removed there.
 * Stage 2 was filed as a follow-up (#5892) gated on "a release actually
 * shipping the deprecation" — but #5892 was later closed as a
 * duplicate into a release-batch carrier (objectui#10060) that now answers
 * 404, so the deletion had no carrier and the card sat on hold with no
 * `Restart-when:`. Execution ruling, 2026-09-27 (triage comment 5857459542,
 * carrying the maintainer's 「同意」): delete now rather than wait on a dead
 * carrier — `docs/NORTH-STAR.md` 〈阶段姿态〉 makes immediate retirement (no
 * alias, no window) the default once a name has zero consumers, and the
 * window this deprecation bought has already been spent.
 *
 * This file is the FLIPPED stage-1 pin, not a new one — a stage-1 pin that
 * asserts the alias exists cannot also assert its absence, so the two states
 * cannot coexist in one file under two names. Flipping in place (rather than
 * deleting the file and adding a fresh one) keeps the retirement's history in
 * one location's `git log`.
 *
 * ## What this test pins, and what it deliberately does not
 *
 * A retirement has two failure modes, symmetric with stage 1's:
 *
 *   1. the specifier is GONE from the published entry's source text —
 *      otherwise the deletion this changeset describes never happened;
 *   2. importing the retired name is a COMPILE ERROR — otherwise the name
 *      leaked back in under a different specifier shape (a bare re-export,
 *      a wildcard, a second alias) that a source-text check on one exact
 *      string would miss.
 *
 * Both are needed for the same reason stage 1 needed two: a test asserting
 * only (1) would pass if the specifier reappeared reworded; a test asserting
 * only (2) would pass on a tree that never had the name published to delete.
 * A third assertion controls the blast radius: `ComponentInput` itself (the
 * replacement) and the still-deprecated `PluginComponentMeta` neighbour in
 * the same export block must be untouched — this retirement is one name, not
 * a wider cut through the block it lived in.
 *
 * ## Why the compile-error leg is a REAL check, not a comment
 *
 * `@ts-expect-error` on the import line below is enforced by `tsc`, not by
 * vitest: this package's `type-check` script chains `tsc -p
 * tsconfig.test.json` over the test tree, so a directive that stops being
 * necessary — because the name was re-exported again — fails the BUILD with
 * "Unused '@ts-expect-error' directive" (TS2578). A green `vitest run` alone
 * says nothing about this leg; the repo's own `app-actions-retired-7469.test.ts`
 * documents and uses the identical pattern for a full published-name removal.
 * `import type` erases at runtime either way, so vitest never sees this line
 * execute — the type-check leg is where retirement-of-a-name is actually
 * caught, which is why this repo pairs a text leg with a type leg rather than
 * relying on either alone (stage 1's own header recorded the matching
 * asymmetry: a runtime check alone missed a type-only removal in reverse
 * verification).
 *
 * ## Why this reads SOURCE TEXT rather than `dist/`
 *
 * Same constraint stage 1 recorded: this repo's per-PR `test` job runs
 * `pnpm test` with NO build of the package under test ahead of it (turbo's
 * `test` task `dependsOn: ["^build"]` is the DEPENDENCY closure, never the
 * package's own build). A test requiring a fresh `dist/` would be vacuously
 * absent-or-red on a cold cache, not a signal.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments as strip } from '../../../../scripts/js-comment-mask.mjs';
import type { ComponentInput } from '../index.js';
// @ts-expect-error — `PluginComponentInput` is RETIRED (objectui#5674, stage 2): the
// published entry no longer exports it, so re-exporting it again would turn this
// directive unused (TS2578) and fail `type-check`.
import type { PluginComponentInput } from '../index.js';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const stripComments: (source: string) => string = strip;

/** Keeps the retired-import directive above honest: the name is USED, so a
 *  re-exported `PluginComponentInput` cannot leave the directive satisfied by
 *  an unused-import diagnostic instead of the missing-export one (same
 *  pattern as `app-actions-retired-7469.test.ts`'s `RetiredAppActionImport`). */
export type RetiredPluginComponentInputImport = PluginComponentInput;

const INDEX_SRC = readFileSync(
  fileURLToPath(new URL('../index.ts', import.meta.url)),
  'utf8',
);

/** The retired alias specifier, exactly as `index.ts` spelled it through stage 1. */
const RETIRED_SPECIFIER = 'ComponentInput as PluginComponentInput';

/**
 * `stripComments` (`scripts/js-comment-mask.mjs`, imported above as `strip`)
 * removes COMMENT characters only, keeping newlines, before the CODE absence
 * check below. Prose is deliberately left free to keep narrating the retired
 * name — `index.ts`'s neighbouring `PluginComponentMeta` docblock explains why
 * ITS deprecation did not land "alongside `PluginComponentInput`", a
 * historical fact about relative timing that stays true forever and is not
 * this retirement's docblock to rewrite. Only CODE — an export specifier, an
 * alias, an `import`/`export` clause — is asserted clean. The shared masker
 * (not a private regex pair) is required here: `check-hand-rolled-comment-mask`
 * refuses a new hand-rolled projection outright, and `stripComments` is
 * exactly the right pick since this call site reports neither a line nor an
 * offset — see that function's own header for the `stripComments` vs
 * `maskComments` split.
 */
const INDEX_CODE = stripComments(INDEX_SRC);

describe('PluginComponentInput — stage 2: the alias is gone from the published entry', () => {
  it('the exact stage-1 specifier no longer appears in `index.ts` source text', () => {
    expect(INDEX_SRC).not.toContain(RETIRED_SPECIFIER);
  });

  it('the bare name is not mentioned by `index.ts` CODE at all — not even reworded', () => {
    // Stronger than the specifier check above: catches a re-export under a
    // different alias shape (e.g. a renamed local plus a fresh `as
    // PluginComponentInput`) that a single exact-string match would miss.
    // Scoped to CODE (comments stripped) because a neighbour's docblock
    // legitimately still narrates the name in prose — see `stripComments`.
    expect(INDEX_CODE).not.toContain('PluginComponentInput');
  });

  it('is not re-exported by `plugin-scope.ts` either — the feeder re-export went with it', () => {
    // `plugin-scope.ts` carried `export type { ComponentInput } from
    // './base.js'` for the sole purpose of feeding this alias (its own
    // docblock said so and called for its removal alongside the alias). A
    // survival here would be dead code the deletion should have taken too.
    const pluginScopeSrc = readFileSync(
      fileURLToPath(new URL('../plugin-scope.ts', import.meta.url)),
      'utf8',
    );
    expect(pluginScopeSrc).not.toContain('PluginComponentInput');
  });
});

describe('PluginComponentInput — stage 2: importing the retired name is a type error', () => {
  it('the import above only compiles because of the `@ts-expect-error` directive', () => {
    // This assertion is a placeholder for a fact `tsc` enforces at build time,
    // not at test run time (see the file header). It exists so the suite
    // reads as a claim about both layers rather than the type leg being
    // invisible to anyone skimming `describe`/`it` names.
    expect(true).toBe(true);
  });
});

describe('PluginComponentInput — stage 2: the blast radius is exactly one name', () => {
  it('`ComponentInput` itself — the replacement — is untouched', () => {
    const value: ComponentInput = { name: 'field', type: 'string' };
    expect(value.name).toBe('field');
  });

  it('the still-deprecated `PluginComponentMeta` neighbour survives this retirement', () => {
    // Control: this PR retires ONE alias in the same export block that also
    // carries `ComponentMeta as PluginComponentMeta` (still `@deprecated`,
    // not yet retired — a separate card). A future edit that widened this
    // change into removing that one too would go unnoticed without this.
    expect(INDEX_SRC).toContain('ComponentMeta as PluginComponentMeta');
  });

  it('`PluginEventHandler`, the other neighbour in the same export block, survives', () => {
    expect(INDEX_SRC).toContain('PluginEventHandler');
  });
});
