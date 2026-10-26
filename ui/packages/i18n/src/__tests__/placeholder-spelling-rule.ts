/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3512's placeholder-spelling rule, as a module rather than as
 * fixtures inside the suite that enforces it.
 *
 * ## Why it is not just written inside the test file (objectui#7310)
 *
 * It was, until this file. `scripts/check-i18n-call-site-keys.mjs` carries a
 * second implementation of the same judgement for its class 7
 * (`unresolvable-default-spelling`, objectui#4905) — a copy that exists because
 * the two gates read different POPULATIONS (copy tables here, inline
 * `defaultValue` call-site arguments there) and neither population can be
 * folded into the other. The copy was byte-equivalent when this module was
 * written, and honest about being a copy in both directions; what it was not
 * was mechanically held to that, and "two implementations of one contract"
 * drifts the first time one side learns a new spelling or a new exemption.
 *
 * `scripts/__tests__/placeholder-spelling-parity.test.ts` now holds them to
 * each other. It has to import BOTH implementations, and importing a
 * `*.test.ts` is not a way to reach one: vitest registers a `describe` into
 * whichever file is collecting when the module evaluates, so importing the
 * suite next door pulls its eighteen cases into the importer (measured — a
 * one-case probe file reported nineteen), and under the `unit` project's
 * `isolate: false` shared module graph WHICH file they land in is worker-order
 * dependent. So the rule moves out of the suite and into a module beside it;
 * the suite imports it back and its own cases are unchanged.
 *
 * ## Why the two are not merged instead
 *
 * Measured on this tree, not assumed — the route the card ordered first was to
 * have one module both readers import, and both directions of that are closed:
 *
 *   - `packages/i18n` is not reachable from `scripts/`. `scripts/` is not a
 *     workspace package, so under `tsconfig.scripts.json` (`moduleResolution:
 *     bundler`, no `paths`) `tsc` answers TS2307 and node answers
 *     ERR_MODULE_NOT_FOUND for `@object-ui/i18n` — while the same probe
 *     resolves `@object-ui/test-support` clean, so the blocker is the missing
 *     root dependency, not the resolver. Its `exports` also point at a `dist/`
 *     no fresh checkout has built, which would put a build in front of a gate
 *     that deliberately needs none.
 *   - A shared `.mjs` under `scripts/`, imported from here, type-checks in
 *     `scripts/` and fails HERE: `tsconfig.test.json` (run by this package's
 *     `type-check`) has no `allowJs`, so the import is TS7016 plus cascading
 *     TS7006s. That project is deliberately fenced — `paths: {}`, an explicit
 *     `types` list, `include` limited to this package's own tests — and
 *     widening it to admit one CI script is the consumer-side tolerance this
 *     repo's rules exist to refuse.
 *
 * So the duplication stays, and the parity test is what makes it honest: the
 * two implementations may not disagree on any input either of them can meet.
 */

/**
 * A `{{…}}` pair and its contents. `[^{}]*` deliberately: a placeholder never
 * nests braces, and refusing to cross one keeps an unterminated `{{` from
 * swallowing the rest of the sentence into a bogus "placeholder".
 */
export const DOUBLE_BRACE = /\{\{([^{}]*)\}\}/g;

/** Every `{{` occurrence, matched or not — the balance check's other half. */
const DOUBLE_BRACE_OPEN = /\{\{/g;

/**
 * The one spelling `fallbackT` resolves. `k` comes from `Object.entries(options)`
 * and is spliced into the needle raw, so the accepted name is exactly a bare
 * identifier: no whitespace, no format spec, no `-` prefix, no dotted path.
 */
const CANONICAL_NAME = /^[A-Za-z0-9_]+$/;

/** i18next's nesting syntax. The fallback has no notion of it at all. */
const NESTING = '$t(';

/** Why one placeholder is not something `fallbackT` can resolve. */
function reasonFor(inner: string): string {
  if (inner !== inner.trim()) return 'whitespace inside the braces';
  if (inner.startsWith('-')) return 'the {{- x}} unescape prefix';
  if (inner.includes(',')) return 'an i18next format spec';
  if (inner.includes('.')) return 'a dotted/keyed placeholder path';
  return 'a non-identifier placeholder name';
}

/**
 * THE rule. Returns one human-readable violation per offending placeholder, and
 * `[]` for copy the provider-less fallback renders identically to i18next.
 *
 * Only the inside of a `{{…}}` pair is judged, so single-brace `{x}` holes
 * (objectui#4135's downstream-fill convention) can never reach a verdict here.
 */
export function placeholderViolations(value: string): string[] {
  const out: string[] = [];
  const regions = [...value.matchAll(DOUBLE_BRACE)];
  for (const region of regions) {
    const inner = region[1];
    if (CANONICAL_NAME.test(inner)) continue;
    out.push(
      `${JSON.stringify(region[0])} — ${reasonFor(inner)}; the fallback resolves only {{name}}`,
    );
  }
  // An unterminated `{{` renders as literal braces on BOTH paths, so it is not
  // an i18next divergence — but it is never intentional copy, and the regions
  // above cannot report what they did not match.
  const opens = (value.match(DOUBLE_BRACE_OPEN) ?? []).length;
  if (opens > regions.length) out.push('an unterminated `{{` with no closing `}}`');
  if (value.includes(NESTING)) {
    out.push('`$t(` — i18next nesting, which the fallback emits verbatim');
  }
  return out;
}
