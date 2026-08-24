// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * glob-match -- the ONE turbo-flavoured glob predicate the `scripts/` gates
 * share, and deliberately nothing else.
 *
 * Supports the three constructs the declarations in this repo use, and only
 * those: `**` (any number of whole path segments), `*` (within one segment),
 * and literals. Dependency-free on purpose -- these gates run in CI before
 * anything is built, and a `scripts/` gate that can fail on a resolution
 * problem is a gate that gets muted.
 *
 * ## Why a plain module, and why it is SEPARATE from the table (#11511)
 *
 * `globToRegExp` used to live in `scripts/check-cross-package-test-inputs.mjs`
 * beside the declaration table it is applied to. Two other gates read out of
 * that file, and `scripts/pm/dispatch-gates.mjs` follows a gate's first-party
 * imports one level but NEVER into a module that is itself a discovered gate
 * file -- so neither importer derived anything from it.
 *
 * Splitting the two halves out is what fixes that, and they had to land in TWO
 * modules rather than one. The follow appends a followed module's watch hints
 * to every importer WHOLE, regardless of which binding the importer named, so a
 * single shared module would have handed `check:examples-live-imports` -- which
 * wants this predicate and whose own subject is `examples/` -- the whole
 * cross-package declaration table. Measured on 589758d22:
 *
 *   one shared module   check:examples-live-imports  241 -> 3346  (+3105)
 *   this split          check:examples-live-imports  241 ->  241  (    0)
 *
 * The declarations therefore live in `scripts/cross-package-test-inputs.mjs`,
 * which is imported only by the two gates that really read them.
 *
 * ## ⛔ THIS MODULE DECLARES NO PATH POPULATION, AND MUST NOT GROW ONE
 *
 * That zero above is the whole point of this file existing separately, so it is
 * pinned mechanically rather than by review: `selfTest` reads THIS FILE's own
 * bytes and fails on any path-shaped literal in the module body -- in the
 * predicate, in an error message, or in a fixture. Every fixture below is
 * ASSEMBLED from segments for that reason, the same discipline and the same
 * measured reason as `scripts/workspace-enumerator.mjs`.
 *
 * A glob belongs to whatever gate or table DECLARES it. What is consolidated
 * here is the SEMANTICS of matching one, never a list of them.
 *
 * ## Inert on import
 *
 * No CLI and no top-level statement that runs anything, per `check:entry-guard`'s
 * second rule. That rule exists because importing a gate for its exports used to
 * run the gate: `check-examples-live-imports.mjs` hand-copied `globToRegExp`
 * rather than pay that cost, and the copy was only retired once #10610 put the
 * dispatch behind an entry guard. Two copies of these semantics is the drift
 * this module now makes impossible -- the gates that decide whether a declared
 * input glob really covers a read MUST agree about what `**` means.
 */

import { readFileSync } from 'node:fs';

import { maskComments } from './js-comment-mask.mjs';

/**
 * One glob, anchored, as a RegExp over repo-relative POSIX paths.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` consumes zero or more whole segments; a trailing `**` consumes the rest.
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Whether any of `globs` matches `path`.
 *
 * @param {string} path repo-relative, POSIX separators
 * @param {string[]} globs
 * @returns {boolean}
 */
export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

/**
 * The shared assertions, returned rather than printed so each importing gate
 * can fold them into its own `--self-test` report.
 *
 * This module is deliberately not a gate (see the header), so it has no CI
 * invocation of its own: its coverage is that its importers run `--self-test`
 * in lint.yml and call this.
 *
 * @returns {string[]} failure descriptions; empty means OK
 */
export function selfTest() {
  const failures = [];
  const t = (name, ok) => {
    if (!ok) failures.push(`glob-match: ${name}`);
  };
  // Every fixture path is ASSEMBLED, never spelled -- see the header's "declares
  // no path population" rule, which the last case in this function enforces
  // against these very lines.
  const P = (...segments) => segments.join('/');
  const OBJ = '*.object.ts';

  // ── `**` spans whole segments ─────────────────────────────────────────────
  t('** spans segments', matchesAny(P('packages', 'platform-objects', 'src', 'identity', 'x.object.ts'), [P('packages', '**', OBJ)]));
  t('** matches a direct child', matchesAny(P('packages', 'a.object.ts'), [P('packages', '**', OBJ)]));
  t('trailing ** matches a subtree', matchesAny(P('packages', 'lint', 'src', 'rules', 'a.ts'), [P('packages', 'lint', 'src', '**')]));

  // ── `*` stays inside one segment ──────────────────────────────────────────
  t('* does not span segments', !matchesAny(P('packages', 'a', 'b.object.ts'), [P('packages', OBJ)]));
  t('* matches within one segment', matchesAny(P('packages', 'a.object.ts'), [P('packages', OBJ)]));

  // ── literals are literal ──────────────────────────────────────────────────
  const IDX = P('content', 'docs', 'references', 'index.mdx');
  t('a literal file glob matches itself', matchesAny(IDX, [IDX]));
  t('the dot is a literal, not a wildcard', !matchesAny(IDX.replace('/docs', 'Xdocs'), [IDX]));
  t('a non-matching extension is rejected', !matchesAny(P('packages', 'x', 'src', 'a.ts'), [P('packages', '**', OBJ)]));

  // The distinction `coversDirectory` exists for, pinned from this side too: a
  // subtree glob is written to match FILES, so it does NOT match the bare
  // directory string it covers.
  t('a subtree glob does not match the bare directory it covers', !matchesAny(P('packages', 'lint', 'src'), [P('packages', 'lint', 'src', '**')]));

  t('an empty glob list matches nothing', !matchesAny(P('packages', 'a.ts'), []));
  t('the regex is anchored at both ends', !globToRegExp(P('packages', 'a.ts')).test(P('vendor', 'packages', 'a.ts', 'b')));

  // ── the property this module exists to keep: NO path population ───────────
  //
  // Read off THIS FILE's own bytes so a stale copy cannot satisfy it. A
  // path-shaped literal added here is inherited as a watch hint by every
  // importing gate: priced in the header at +3105 (gate, file) pairs for the
  // single caller that wants nothing but a predicate.
  //
  // The predicate below is deliberately STRICTER than the one it guards
  // (`extractWatchHints` in scripts/pm/dispatch-gates.mjs): any quoted literal
  // containing a separator counts here, where that scanner also applies
  // namespace refusals and self-test masking. It can therefore only refuse
  // MORE than the real scanner -- it fails loudly for a literal the derivation
  // would have ignored, and never passes one the derivation would have taken.
  //
  // `maskComments`, never a hand-rolled comment strip: a glob CONTAINS a
  // comment opener -- the `/` and `*` of a `packages/*` are exactly `/*` -- so a
  // naive stripper starts a comment at the literal it is looking for and eats
  // forward to the next `*/`, deleting the evidence. Measured on
  // workspace-enumerator, where that mistake let a planted population through.
  try {
    const self = readFileSync(new URL(import.meta.url), 'utf8');
    const body = maskComments(self);
    const offending = [...body.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)]
      .map((m) => m[1])
      .filter((raw) => /^[\w.@][\w.@/*-]*$/.test(raw))
      // The same leading-`./` strip extractWatchHints applies before it asks
      // whether a literal is pathy, so a relative import specifier scores the
      // way it really scores there (no separator left -> not a hint) instead of
      // reading as a population declaration.
      .map((raw) => raw.replace(/^(?:\.\.?(?:\/|$))+/, ''))
      .filter((raw) => raw.includes('/'))
      .filter((raw) => !raw.startsWith('node:'));
    t(
      `no path-shaped literal in this module body can become a watch hint (found: ${offending.join(', ') || 'none'})`,
      offending.length === 0,
    );
  } catch (err) {
    failures.push(`glob-match: could not read own source to check for path literals (${err?.message})`);
  }

  return failures;
}
