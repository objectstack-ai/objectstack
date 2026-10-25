import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unresolvableSpellings } from '../check-i18n-call-site-keys.mjs';
import { placeholderViolations } from '../../packages/i18n/src/__tests__/placeholder-spelling-rule';
import { builtInLocales } from '../../packages/i18n/src/locales';
import { scanDefaultsTables } from '../../packages/test-support/src/defaults-table-scan';

/**
 * objectui#7310 — one contract, two implementations, held to each other.
 *
 * ## What is duplicated, and why it stays that way
 *
 * objectui#3512's rule is "a placeholder may only be spelled the one way
 * `createSafeTranslation`'s `fallbackT` resolves". Two gates enforce it over two
 * populations that cannot be folded into one:
 *
 *   - `packages/i18n/src/__tests__/placeholder-spelling-rule.ts`
 *     (`placeholderViolations`) — the ten locale packs and the discovered
 *     defaults TABLES, read as data by a vitest suite.
 *   - `scripts/check-i18n-call-site-keys.mjs` class 7 (`unresolvableSpellings`,
 *     objectui#4905) — the inline `defaultValue` text of every `t()` call site,
 *     found by a node script's TypeScript walk. Rebuilding that walk on the
 *     other side was rejected on objectui#4905: it is the classifier that file
 *     already is.
 *
 * Merging the two was measured first, as objectui#7310 ordered, and both
 * directions are closed. `@object-ui/i18n` does not resolve from `scripts/`:
 * under `tsconfig.scripts.json` (`moduleResolution: bundler`, no `paths`) `tsc`
 * answers TS2307 and node answers ERR_MODULE_NOT_FOUND, while the same probe
 * resolves `@object-ui/test-support` clean — so the blocker is that `scripts/`
 * is not a package with that dependency, and its `exports` point at a `dist/`
 * no fresh checkout has built. The other direction — a shared `.mjs` under
 * `scripts/`, imported by the i18n suite — type-checks in `scripts/` and fails
 * in `packages/i18n`, whose `tsconfig.test.json` has no `allowJs` (TS7016, plus
 * cascading TS7006s) and is deliberately fenced (`paths: {}`, an explicit
 * `types` list, `include` limited to its own tests).
 *
 * ## So this file is the guarantee instead
 *
 * The duplication was honest — each copy names the other — but a comment is not
 * a mechanism, and two implementations of one contract drift the first time one
 * of them learns a new spelling or a new exemption. This gate turns that promise
 * into a verdict: on every input either implementation can meet, they must
 * return the SAME violations, in the same order, with the same wording.
 *
 * ⛔ It does not judge whether the rule is right — that is each side's own
 * self-test, both of which stay where they are (the four i18next-only spellings
 * and both out-of-range classes in the i18n suite; the class-7 cases in
 * `check-i18n-call-site-keys.test.ts`). This one judges only that there is one
 * answer, so widening the rule means widening it twice or going red.
 *
 * ## Why the corpus is what it is
 *
 * Agreement over strings neither implementation reacts to proves nothing, and
 * agreement over hand-written adversarial strings alone would not survive the
 * fixtures being quietly trimmed. So the corpus is both, with a floor under
 * each part:
 *
 *   - `GRAMMAR_MATRIX` — every dialect the rule names, each boundary between
 *     them, both structurally out-of-range classes, and the shapes that reach
 *     the balance check. This is what actually discriminates: all of today's
 *     flagged inputs come from here, because the tree is green.
 *   - the ten locale packs' string leaves and every discovered defaults row —
 *     the real populations, so the fixtures cannot be a private grammar the two
 *     implementations agree on while disagreeing on the copy they actually
 *     judge.
 *
 * The gate's own population (inline `defaultValue` text) is not walked here: it
 * would mean running the node gate's TypeScript pass inside a unit test. It is
 * reached transitively instead — `check:i18n-keys` reports 993 of its 996
 * literal inline defaults byte-equal to their `en` value, and every `en` value
 * is in this corpus — and the residue is the 3 not-comparable plus the computed
 * ones, which is recorded rather than claimed as covered.
 */

/*
 * Both package-owned imports above are RELATIVE on purpose, and it is not a
 * style choice: `scripts/__tests__/scripts-type-check.test.ts` pins that no root
 * file of `tsconfig.scripts.json`'s program names an `@object-ui/*` specifier,
 * because that premise is what lets `ci.yml` run `pnpm type-check:scripts` in
 * the cheap half of the job, ABOVE the build. Spelled
 * `@object-ui/test-support/defaults-table-scan`, this file failed that pin
 * (objectui#8028 review) — and note what the pin is: a categorical guard on the
 * premise, not a measurement of whether a build is needed. Measured with no
 * package `dist` directory on disk at all, `pnpm type-check:scripts` was green
 * EITHER way,
 * because that package's `exports` point at `./src/*.ts`. So the specifier
 * would have cost nothing today and would have quietly retired the guarantee
 * the next `@object-ui/*` import does cost — which is exactly the kind of
 * premise a pin exists to hold.
 *
 * Reaching the same modules by path keeps the program's roots free of workspace
 * specifiers while compiling the very same source files: neither
 * `packages/i18n/src/locales` nor `packages/test-support/src/defaults-table-scan`
 * imports anything outside node builtins and `typescript`, so this file needs no
 * built declaration anywhere.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Hand-written inputs: the four i18next-only dialects, the two out-of-range
 * classes, and the boundaries between them. Both sides' own self-test cases are
 * included verbatim so this gate cannot pass while either suite's cases have
 * quietly changed meaning.
 */
const GRAMMAR_MATRIX: readonly string[] = [
  // Nothing to judge.
  '',
  'plain copy with no holes',
  // The one canonical spelling, and repeats of it.
  '{{name}}',
  '{{n1}}',
  '{{_x}}',
  '{{0}}',
  'Hello {{name}}, {{name}}',
  'Deleted {{count}} of {{total}}',
  // Dialect 1 — whitespace inside the braces, on both sides and each alone.
  '{{ name }}',
  '{{name }}',
  '{{ name}}',
  'Hello {{ name }}',
  '{{  }}',
  '{{a b}}',
  // Dialect 2 — an i18next format spec, spaced and unspaced.
  '{{count, number}}',
  '{{count,number}}',
  'Total {{count, number}}',
  // Dialect 3 — the unescape prefix, spaced and unspaced.
  '{{- name}}',
  '{{-name}}',
  'Hi {{- name}}',
  // Dialect 4 — nesting, alone and embedded.
  '$t(otherKey)',
  'A $t(otherKey) B',
  // A non-identifier name, and a dotted path.
  '{{a-b}}',
  '{{}}',
  '{{user.name}}',
  // The balance check: an unterminated open, and braces that only look paired.
  'Hello {{name',
  '{{{name}}}',
  '}}{{',
  '{{a}}}}',
  // Out of range by construction — single braces (objectui#4135's downstream
  // fill) and JSX object literals.
  '{shown} / {total}',
  '{count}',
  'Rendered {2} of {n}',
  'Showing {shown} / {total} tasks',
  'style={{ opacity: 0 }}',
  'context={{ org }}',
  // Several classes in one string, so ORDER of the returned violations is
  // compared too, not just the set.
  '{{ a }} {{b}} {{c, x}} $t(z)',
  // Non-ASCII inside and around a hole.
  'ünïcødé {{nàme}}',
];

function stringLeaves(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const value of Object.values(node as Record<string, unknown>)) stringLeaves(value, out);
}

describe('the placeholder-spelling rule has one answer, not two (objectui#7310)', () => {
  const packLeaves: string[] = [];
  for (const code of Object.keys(builtInLocales)) {
    stringLeaves((builtInLocales as Record<string, unknown>)[code], packLeaves);
  }
  const scan = scanDefaultsTables(REPO_ROOT);
  const defaultsValues = scan.rows.map((row) => row.value);
  const corpus = [...new Set([...GRAMMAR_MATRIX, ...packLeaves, ...defaultsValues])].sort();

  it('is asking two different implementations', () => {
    // The one way this gate could pass while checking nothing: both names
    // resolving to the same function. It is not a hypothetical — merging them
    // is the change this file exists to make unnecessary, and if someone does
    // merge them, this must be deleted rather than left reading as a guarantee.
    expect(unresolvableSpellings).not.toBe(placeholderViolations);
    expect(typeof unresolvableSpellings).toBe('function');
    expect(typeof placeholderViolations).toBe('function');
  });

  it('runs over both real populations, not only hand-written fixtures', () => {
    // Floors, not equalities: each population grows on its own schedule, and a
    // floor is what stops one silently shrinking to nothing while the agreement
    // assertion below goes on passing over an empty corpus (the objectui#3009
    // shape).
    expect(Object.keys(builtInLocales).length).toBeGreaterThanOrEqual(10);
    expect(packLeaves.length).toBeGreaterThan(25000);
    expect(defaultsValues.length).toBeGreaterThan(700);
    expect(scan.unreadable).toEqual([]);
    expect(GRAMMAR_MATRIX.length).toBeGreaterThanOrEqual(37);
    expect(corpus.length).toBeGreaterThan(20000);
  });

  it('the corpus actually reaches the rule — the positive control', () => {
    // Agreement is only worth something over inputs the rule reacts to. The
    // real packs are green today (that is what the two gates are for), so every
    // violation here comes from the matrix; asserting the count is non-zero is
    // what stops a matrix that has been trimmed to inert strings from reading
    // as a passing parity check.
    const flagged = corpus.filter((value) => unresolvableSpellings(value).length > 0);
    expect(flagged.length).toBeGreaterThanOrEqual(20);
    // Every dialect the rule names is represented among them, by its reason.
    const reasons = new Set(flagged.flatMap((value) => unresolvableSpellings(value)));
    const joined = [...reasons].join('\n');
    expect(joined).toContain('whitespace inside the braces');
    expect(joined).toContain('an i18next format spec');
    expect(joined).toContain('the {{- x}} unescape prefix');
    expect(joined).toContain('a dotted/keyed placeholder path');
    expect(joined).toContain('a non-identifier placeholder name');
    expect(joined).toContain('an unterminated `{{` with no closing `}}`');
    expect(joined).toContain('i18next nesting');
  });

  it('the two implementations agree on every input in the corpus', () => {
    const disagreements = corpus
      .map((value) => ({
        value,
        gate: unresolvableSpellings(value),
        pack: placeholderViolations(value),
      }))
      .filter(({ gate, pack }) => JSON.stringify(gate) !== JSON.stringify(pack))
      .map(
        ({ value, gate, pack }) =>
          `${JSON.stringify(value)}\n` +
          `    check-i18n-call-site-keys.mjs  -> ${JSON.stringify(gate)}\n` +
          `    placeholder-spelling-rule.ts   -> ${JSON.stringify(pack)}`,
      );

    expect(
      disagreements,
      'The two implementations of objectui#3512\'s placeholder-spelling rule returned different ' +
        'verdicts. One of them has learned a spelling or an exemption the other has not — teach ' +
        'the other one too, or merge them (see this file\'s header for what was measured about ' +
        'merging). Do NOT relax this gate.',
    ).toEqual([]);
  });
});
