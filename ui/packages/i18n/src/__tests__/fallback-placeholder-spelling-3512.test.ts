/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every placeholder a provider-less fallback will ever meet is spelled the one
 * way that fallback can resolve — objectui#3512.
 *
 * ## The fork this closes, and the direction it is closed in
 *
 * `createSafeTranslation`'s `fallbackT` interpolates with an EXACT literal
 * needle (`useSafeTranslation.ts`: ``value.split(`{{${k}}}`).join(String(v))``),
 * so it recognises `{{name}}` and nothing else. i18next — which serves the
 * SAME strings whenever an `I18nProvider` is mounted — additionally recognises
 * `{{ name }}` (whitespace inside the braces), `{{count, number}}` (a format
 * spec), `{{- name}}` (the unescape prefix) and `$t(otherKey)` (nesting).
 * Measured on a real i18next 26.3.6 instance configured the way `createI18n`
 * configures it (`interpolation: { escapeValue: false }`), those four render
 * correctly through the provider and leak literal braces without one.
 *
 * The card left two directions open. The maintainer's objectui#4135 ruling
 * settled it: `{{x}}` is EXCLUSIVELY i18next-bound copy, `{x}` is a hole filled
 * downstream of `t()`. So the answer is not to teach the fallback three more
 * dialects (a second interpolator to keep in step with i18next forever), it is
 * to hold the copy to the one spelling both paths agree on. Declared =
 * enforced: the divergence stays unreachable by construction instead of by
 * luck. The fallback's behaviour is deliberately NOT changed by this file.
 *
 * ## The false positives this must not produce
 *
 * Two classes, both named on the card and by three triage rounds:
 *
 *   - **Single braces.** `{shown}` / `{total}` in `gantt.quickFilter.resultSummary`
 *     is a downstream hole by design — its call site does a literal
 *     `.replace('{shown}', …)`. Under #4135 that is the CORRECT spelling for a
 *     non-i18next hole, so flagging it would invert the ruling. The rule below
 *     only ever inspects the inside of a `{{…}}` pair, so single braces are
 *     structurally out of range, and the liveness cases pin real single-brace
 *     rows staying green.
 *   - **JSX object literals.** `style={{ opacity: 0 }}`, `context={{ org }}` —
 *     `{{` in TSX that is syntax, not copy. Every earlier sweep of this card hit
 *     them, because a bare source grep cannot tell them from a spaced
 *     placeholder. This gate never greps source text for `{{`: it reads only
 *     STRING VALUES reached through a copy table's own data structure, and a JSX
 *     brace is not inside a string literal. The class is excluded by where the
 *     scanner looks, not by an allow-list that could rot.
 *
 * ## The copy sources under the gate, and why exactly these
 *
 * The subject is "text a literal-needle interpolator can be asked to render".
 * Three surfaces, measured on this tree:
 *
 *   1. **The ten locale packs** (`builtInLocales`, 28k+ string leaves). Imported
 *      as data. They are upstream of surface 2 — `defaults-maps-mirror-en-pack.test.ts`
 *      (objectui#4401) and objectui#3440 pin defaults rows byte-identical to
 *      their `en` row — so a spaced placeholder authored in a pack lands in a
 *      defaults table by way of a gate that is doing its job. Note the existing
 *      `all-locales-key-parity.test.ts` "placeholders match en" case cannot see
 *      this: its `\{\{\w+\}\}` shape regex simply does not match `{{ name }}`,
 *      so a spelling introduced in `en` AND its nine translations at once is
 *      shape-equal, hence green. That case compares packs to each other; this
 *      one judges a pack against the fallback's grammar in absolute terms.
 *   2. **The `createSafeTranslation` defaults tables** — 31 of them, 762 string
 *      rows, DISCOVERED rather than listed (below), so a new table is gated the
 *      day it is written.
 *   3. **The three hand-rolled sibling tables** whose packages re-implemented
 *      the same literal needle instead of taking the factory
 *      (`GANTT_DEFAULT_TRANSLATIONS`, `IMPORT_DEFAULT_TRANSLATIONS`,
 *      `TIMELINE_DEFAULT_TRANSLATIONS`; each file states its own reason for not
 *      using the factory). They are a registry, and a completeness case pins the
 *      set of files carrying that needle, so a fourth copy of the interpolator
 *      cannot quietly land outside the gate.
 *
 * Two neighbours were measured and deliberately left out:
 *
 *   - **Inline `t(key, { defaultValue })`.** `fallbackT` does read it (the
 *     objectui#3865 chain step), and 0 of them violate the rule today. Left out
 *     because it is a call-site OPTION rather than a copy table — the two
 *     surfaces this card was scoped to — and because `check:i18n-keys`'
 *     `default-value-drift` class already pins 906 of its 909 literal inline
 *     defaults byte-identical to their `en` row, which surface 1 gates. The
 *     residual is those 3 "not comparable" plus 62 computed ones: recorded as a
 *     coverage boundary, and filed, rather than silently assumed covered.
 *   - **`ConcurrentUpdateDialog.tsx`'s `.split('{{field}}')`.** A hard-coded
 *     needle CONSUMING a pack value, not a table of its own — surface 1 covers
 *     the value it splits.
 *
 * ## Division of labour with the three existing i18n gates
 *
 * All four read the same packs, and each is blind to what this one owns:
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` — its `holesOf()` deliberately
 *     reads THROUGH all four dialects when extracting a hole's NAME (`{{n, number}}`
 *     yields `n`, `{{- html}}` yields `html`, `{{user.name}}` yields `user`), so
 *     that an argument-parity verdict survives one appearing. It tolerates; it
 *     never rejects — and its own comment records the measurement this file turns
 *     into a rule: "all 84 distinct holes in `en` are bare names". This gate is
 *     the enforcement half of that sentence.
 *   - `all-locales-key-parity.test.ts` — pack vs pack, and RELATIVE: its shape
 *     regex is `\{\{\w+\}\}`, which does not match `{{ name }}` at all. A
 *     spelling introduced in `en` and its nine translations together is
 *     shape-equal in that comparison, hence green. This file judges a pack
 *     against the fallback's grammar in ABSOLUTE terms, which is the only way
 *     that case is reachable.
 *   - `scripts/check-i18n-en-drift.mjs` — fires on an `en` value CHANGING. A
 *     value authored with a spaced placeholder on day one never changes, so it
 *     is invisible there by construction.
 *
 * ## Why this file lives in `@object-ui/i18n` when two of its surfaces do not
 *
 * The rule is DIRECTION, not absence. This paragraph read "this file imports
 * nothing outside its own package" until objectui#8029 — false since
 * objectui#7884 added the `@object-ui/test-support` import below, and false in
 * the load-bearing way, because this paragraph is the stated REASON the file may
 * sit here: the next person deciding "may this suite import X?" would have been
 * applying a rule the file itself breaks.
 *
 * `defaults-maps-mirror-en-pack.test.tsx` had to move to `app-shell` because it
 * imports `@object-ui/plugin-detail`, `-list` and `-designer`, and each of those
 * three declares `@object-ui/i18n` (two in `dependencies`, one as a peer) —
 * importing them back inverts the dependency. What THIS file may import is
 * anything that cannot import this package back. A new import belongs here only
 * if it passes all three checks:
 *
 *   1. **Direction.** The imported package must not depend on `@object-ui/i18n`,
 *      directly or transitively. `@object-ui/test-support` declares no
 *      `@object-ui/*` dependency in any of its four fields — and is
 *      `private: true`, never published — so no path back exists. Which is why
 *      the SAME import also sits in the sibling: it is not what moved that file.
 *   2. **Reach.** It must be a declared entry point of that package:
 *      `@object-ui/test-support/defaults-table-scan` is an `exports` subpath, not
 *      a deep path into another package's `src/__tests__/` — the shape
 *      objectui#4325 ruled out, and the reason the walk lives in a third package
 *      rather than in either caller.
 *   3. **Ship.** It must not reach a consumer: declared in this package's
 *      `devDependencies`, and imported from a file under `__tests__/`, a
 *      directory this package's build `tsconfig.json` excludes
 *      (`check:published-tsconfig-exclude`). That is the tooling tier
 *      `check-phantom-dependencies.mjs` judges against dev dependencies instead
 *      of runtime ones, on the ground that no consumer ever resolves such a file.
 *
 * What has NOT changed is the property that keeps the gated SURFACES out of the
 * graph, and it is worth keeping separate from the three checks above: the packs
 * are a same-package import, while the defaults tables and the needle files are
 * READ as text and parsed, never imported — so gating them adds no module
 * dependency in either direction (same mechanism as
 * `forwardref-props-annotation.guard.test.ts`). Only the WALK that discovers
 * them is an import, and it is the one the three checks are about. So the rule
 * can live beside the fallback whose grammar it is enforcing, which is where the
 * next person to touch `useSafeTranslation.ts` will look.
 *
 * ⛔ Nothing mechanical holds this paragraph to the import list above — comment
 * accuracy is not gateable here, which is how the old sentence survived #7884
 * for as long as it did. Re-read it when you add an import.
 *
 * ## Direction of the reverse verification, predicted before running (#4118)
 *
 * Straight red, not the inverted or count-shaped variants: the rule is an
 * absolute predicate over values, with no `??` chain and no verdict count for a
 * mutation to empty out. Injecting `{{ name }}` (spaced), `{{count, number}}`
 * (format spec) or `$t(other)` (nesting) into ONE real row of ONE real table
 * must turn exactly the case that owns that surface red, naming the file and the
 * key — and leave the liveness and single-brace cases green, because the
 * injected row is one row. Verified all three ways on this tree, plus the two
 * false-positive controls staying green; recorded on the PR.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HAND_ROLLED_TABLES,
  scanDefaultsTables,
} from '@object-ui/test-support/defaults-table-scan';
import { DOUBLE_BRACE, placeholderViolations } from './placeholder-spelling-rule';
import { builtInLocales } from '../locales';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/i18n/src/__tests__  ->  repo root
const REPO_ROOT = path.resolve(here, '../../../..');

/* ------------------------------------------------------------------ */
/* The rule — beside this file, so the parity gate can reach it        */
/* ------------------------------------------------------------------ */

/*
 * The predicate was written out here until objectui#7310. It now lives in
 * `./placeholder-spelling-rule.ts`, unchanged, because
 * `scripts/__tests__/placeholder-spelling-parity.test.ts` has to import it
 * alongside `check-i18n-call-site-keys.mjs`'s copy — and a `*.test.ts` is not
 * importable for that purpose: vitest registers each `describe` into whichever
 * file is collecting when the module evaluates, so importing this suite drags
 * its cases into the importer. That module's header records the measurement,
 * and why the two implementations are pinned to each other rather than merged.
 *
 * Every case below is this side's own self-test and is unchanged.
 */

/* ------------------------------------------------------------------ */
/* Copy source 1 — the ten locale packs                                */
/* ------------------------------------------------------------------ */

interface Leaf {
  readonly key: string;
  readonly value: string;
}

function leaves(node: unknown, prefix = ''): Leaf[] {
  if (typeof node === 'string') return [{ key: prefix, value: node }];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

const LOCALE_CODES = Object.keys(builtInLocales) as (keyof typeof builtInLocales)[];
const PACK_LEAVES = new Map(LOCALE_CODES.map((code) => [code, leaves(builtInLocales[code])]));

/* ------------------------------------------------------------------ */
/* Copy source 2/3 — the defaults tables, read from source             */
/* ------------------------------------------------------------------ */

/*
 * The walk that discovers these tables moved to
 * `@object-ui/test-support`'s `defaults-table-scan.ts` in objectui#7884, so
 * that the objectui#4401 gate — "every defaults row names a key the `en` pack
 * actually defines", which used to read a hand-written list of three imported
 * maps and therefore judged 400 of 1056 rows — asks its question of exactly the
 * population this file asks its own question of. Two traversals would be two
 * definitions of that population, drifting apart. Nothing about the discovery
 * changed in the move: same factory names, same hand-rolled registry, same
 * `unreadable` reporting. Verified byte-identical either side of the move on the
 * same tree — 35 discovery entries, 1072 rows, 0 unreadable, the same 4 needle
 * files, and the same sha256 over every row. (The walked-FILE count matched too,
 * but it is not quoted here: it moves by one with `apps/site/next-env.d.ts`,
 * which is generated at install time, so it is a property of the checkout rather
 * than of the tree. The case below floors it instead of pinning it.)
 */

/**
 * Files that carry the literal needle today — the completeness case's subject.
 *
 * The canonical copy moved out of `useSafeTranslation.ts` into
 * `fallbackInterpolation.ts` in objectui#6219, so that `useObjectTranslation`'s
 * not-ready path could run the SAME interpolator rather than grow a fifth. The
 * set is the same size for that reason: this registry counts copies of the
 * grammar, and that change moved one rather than adding one.
 */
const NEEDLE_FILES = [
  'packages/i18n/src/fallbackInterpolation.ts',
  'packages/plugin-gantt/src/useGanttTranslation.ts',
  'packages/plugin-grid/src/ImportWizard.tsx',
  'packages/plugin-timeline/src/useTimelineTranslation.ts',
];

const TABLE_SCAN = scanDefaultsTables(REPO_ROOT);

/* ------------------------------------------------------------------ */
/* The cases                                                           */
/* ------------------------------------------------------------------ */

describe('the fallback only ever meets placeholders it can resolve (objectui#3512)', () => {
  describe('the locale packs', () => {
    it('the walk reaches real copy — not an empty assertion', () => {
      // Non-vacuity, #4118 family standard. Every assertion below is "no value
      // violates", which a broken walk satisfies trivially. Floors, not pins.
      expect(LOCALE_CODES).toHaveLength(10);
      const total = [...PACK_LEAVES.values()].reduce((n, list) => n + list.length, 0);
      expect(total).toBeGreaterThan(20_000);
      for (const code of LOCALE_CODES) {
        expect(PACK_LEAVES.get(code)!.length, `${code} contributed no strings`).toBeGreaterThan(
          1_000,
        );
      }
    });

    it('the scanner sees placeholders at all — the positive control', () => {
      // The zero-violation assertions below are only meaningful if the scanner
      // finds the placeholders that DO exist. Same reasoning as the parity
      // suite's `EN.size > 2000` guard: a regex that matched nothing would make
      // this file green while asserting nothing whatsoever.
      const spellings = new Set<string>();
      for (const { value } of PACK_LEAVES.get('en')!) {
        for (const region of value.matchAll(DOUBLE_BRACE)) spellings.add(region[0]);
      }
      expect(spellings.size).toBeGreaterThan(50);
      expect(spellings).toContain('{{count}}');
      expect(spellings).toContain('{{name}}');
      // …and every one of them is canonical, which is the rule restated over
      // the set the control just proved is non-empty.
      expect([...spellings].filter((s) => placeholderViolations(s).length > 0)).toEqual([]);
    });

    it.each(LOCALE_CODES)('%s uses only placeholders the fallback resolves', (code) => {
      const violations = PACK_LEAVES.get(code)!.flatMap(({ key, value }) =>
        placeholderViolations(value).map(
          (why) => `${code} pack, ${key} = ${JSON.stringify(value)}\n    ${why}`,
        ),
      );
      expect(violations, `${code}: ${violations.length} placeholder spelling violation(s)`).toEqual(
        [],
      );
    });
  });

  describe('the defaults tables', () => {
    it('discovers every table — not an empty assertion', () => {
      // The discovery is structural (first argument of the factory + the
      // hand-rolled registry), so these are floors that a new table raises for
      // free; only a table DISAPPEARING has to be explained.
      expect(TABLE_SCAN.tables.length).toBeGreaterThanOrEqual(34);
      expect(TABLE_SCAN.rows.length).toBeGreaterThanOrEqual(700);
      expect(TABLE_SCAN.sourceFiles.length).toBeGreaterThan(1_000);
      // Every discovered table resolved to a literal and every row to a string.
      // A table the scanner cannot read is a hole in the gate, reported here
      // rather than skipped in silence.
      expect(TABLE_SCAN.unreadable).toEqual([]);
    });

    it('covers the three hand-rolled interpolators, and no fourth exists', () => {
      // The registry above is a list, and lists rot. This pins the fact that
      // makes it complete: exactly these files re-implement the literal needle.
      // A new copy of `fallbackT` fails here, naming itself, instead of serving
      // an ungated table.
      expect(TABLE_SCAN.needle).toEqual(NEEDLE_FILES);
      for (const { name, file } of HAND_ROLLED_TABLES) {
        const rows = TABLE_SCAN.rows.filter((row) => row.table === `${name} (${file})`);
        expect(rows.length, `${name} contributed no rows`).toBeGreaterThan(0);
      }
    });

    it('every table row uses only placeholders the fallback resolves', () => {
      // THE gate for surfaces 2 and 3. This is the path that actually renders
      // without a provider, so a violation here is the user-visible one.
      const violations = TABLE_SCAN.rows.flatMap(({ table, where, key, value }) =>
        placeholderViolations(value).map(
          (why) => `${where}  ${key} = ${JSON.stringify(value)}\n    in ${table}\n    ${why}`,
        ),
      );
      expect(
        violations,
        `${violations.length} placeholder spelling violation(s) in the defaults tables`,
      ).toEqual([]);
    });
  });

  describe('the rule does not over-reach (objectui#4135)', () => {
    it('leaves single-brace holes alone', () => {
      // #4135: `{x}` is a hole filled downstream of `t()`. Flagging it would
      // invert the ruling this gate exists to enforce. Both a synthetic case and
      // the real row that motivated the exception.
      expect(placeholderViolations('Showing {shown} / {total} tasks')).toEqual([]);
      expect(placeholderViolations('{count}')).toEqual([]);
      expect(placeholderViolations('Rendered {2} of {n}')).toEqual([]);

      const real = PACK_LEAVES.get('en')!.find(
        ({ key }) => key === 'gantt.quickFilter.resultSummary',
      );
      // Positive control: the exempt row is genuinely IN the scanned set and
      // genuinely single-braced, so its green verdict is the rule declining to
      // fire — not the row having quietly left the corpus.
      expect(real?.value, 'the single-brace control row left the en pack').toContain('{shown}');
      expect(real?.value).not.toContain('{{');
      expect(placeholderViolations(real!.value)).toEqual([]);
    });

    it('leaves JSX object-literal braces out of range by construction', () => {
      // The known false-positive class from three triage rounds: `style={{ … }}`
      // and `context={{ org }}` are TSX syntax, never copy. They are excluded by
      // WHERE the scanner looks — inside string values of a copy table — so the
      // proof is that no scanned row is a JSX brace, not an allow-list.
      const jsxLike = TABLE_SCAN.rows.filter(
        ({ value }) => value.includes('style={{') || value.includes('={{'),
      );
      expect(jsxLike.map((row) => `${row.where} ${row.key}`)).toEqual([]);
      // And the packs never carry a JSX-shaped string either.
      const packJsx = [...PACK_LEAVES.values()]
        .flat()
        .filter(({ value }) => value.includes('={{'));
      expect(packJsx.map(({ key }) => key)).toEqual([]);
    });

    it('does fire on each of the four i18next-only spellings', () => {
      // The rule's own unit coverage, so the corpus cases above cannot be the
      // only evidence it works. One case per divergence the card measured.
      expect(placeholderViolations('Hello {{ name }}')).toHaveLength(1);
      expect(placeholderViolations('Hello {{ name }}')[0]).toContain('whitespace');
      expect(placeholderViolations('Total {{count, number}}')).toHaveLength(1);
      expect(placeholderViolations('Total {{count, number}}')[0]).toContain('format spec');
      expect(placeholderViolations('Hi {{- name}}')).toHaveLength(1);
      expect(placeholderViolations('Hi {{- name}}')[0]).toContain('unescape prefix');
      expect(placeholderViolations('A $t(otherKey)')).toHaveLength(1);
      expect(placeholderViolations('A $t(otherKey)')[0]).toContain('nesting');
      // …and the canonical spelling, which every one of them is a deviation from.
      expect(placeholderViolations('Hello {{name}}, {{name}}')).toEqual([]);
      expect(placeholderViolations('Deleted {{count}} of {{total}}')).toEqual([]);
      // Structural leftovers the regions cannot report on their own.
      expect(placeholderViolations('Hello {{name')).toHaveLength(1);
      expect(placeholderViolations('Hello {{name')[0]).toContain('unterminated');
    });
  });
});
