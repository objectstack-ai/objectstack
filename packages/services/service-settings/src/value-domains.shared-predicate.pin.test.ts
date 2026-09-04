// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ratchet: `service-settings` does not define standard-domain membership.
 *
 * ## Why this file exists
 *
 * Maintainer ruling 2026-09-02: ONE closed vocabulary and ONE membership
 * predicate, shared by settings specifiers and object fields. Before it, three
 * copies of the same three definitions were in the tree — `packages/spec`,
 * `packages/services/service-settings` and `packages/core`'s module-private
 * `isValidTimeZone`. Three copies of one definition is the shape that drifts,
 * and the copy carrying no pins is the one a future editor "modernises".
 * `core` was re-pointed with its own pin
 * (`resolve-authz-context.time-zone-domain.pin.test.ts`); this file is that
 * pin's opposite number for the settings door, and it is the ratchet the
 * settings card asked for: a re-added table goes red HERE, at the seam, rather
 * than silently re-opening the divergence the ruling closed.
 *
 * ## Why a source scan and not an import-shape assertion
 *
 * A behavioural test cannot see this defect. A re-added local table that
 * happens to agree with the shared one today passes every membership case in
 * `value-domains.test.ts` — the divergence it opens is in the FUTURE, the day
 * one of the two is edited. What has to be pinned is therefore the absence of
 * the second definition, which is a fact about the source text.
 *
 * The scan covers the package's whole non-test source **recursively**, not just
 * `value-domains.ts` and not just `src/*`: "delete the table from this file",
 * "move the table to a new file" and "move it into `src/manifests/`" are one
 * defect, and a single-file or single-directory check survives all but the
 * first. Both table SHAPES are detected — the space-separated string this file
 * replaced and the array literal a re-typing would more likely produce.
 *
 * ## What each check does and does not cover — measured, not claimed
 *
 * The absence checks are a source scan, so they see shapes. Two mutations were
 * run against an earlier draft of this file and passed it GREEN, which is why
 * the checks below are shaped as they are: a probe table placed one directory
 * down (`src/manifests/`), and a 249-code ARRAY literal in a new sibling module
 * that `value-domains.ts` imported and consulted for `iso_3166_alpha2` while
 * the shared predicate still served the other two. Both now red.
 *
 * ## Two routes, and the two checks that are NOT interchangeable
 *
 * A table the DOOR REACHES is closed at its root by the import-surface pin:
 * `value-domains.ts` may import from `@objectstack/spec/shared` and nothing
 * else, so a table anywhere in the tree is inert while nothing here can name
 * it, and a relative specifier is how it would be named.
 *
 * A judge STANDING IN FRONT OF THE DOOR is closed by the package-wide density
 * scan, and that distinction is a measured falsification, not a design
 * flourish. An earlier draft ran the density scan on the door alone and
 * argued the import pin covered everything else. It does not: the same
 * alternation put in the door's CALLER — `settings-service.ts`, replacing the
 * `firstRejectedDomainMember(…)` call at the save-path refusal — is never
 * reached by the door, answers `iso_3166_alpha2` itself, and falls through
 * for the other two. Door blob unchanged, no quoted codes, no new caller of
 * the predicate: every instrument here was green and the whole package was
 * green, while a second judge decided the `value_domain` FieldError on every
 * alpha-2 save. Deleting two codes from it turned two behavioural cases red,
 * so it was live code, not decoration.
 *
 * Every scan below is DELIMITER-AGNOSTIC. It was not, and that is the round-2
 * finding: a verbatim double-quoted copy of the array mutation passed the
 * whole file green, because the import pin and both shape regexes hard-coded
 * the single quote. This package has no `quotes` lint rule active, so both
 * spellings are legal here and only these pins can tell them apart. The space
 * after `from` is optional for the same reason, and the density scan's
 * separator class admits a newline — a one-code-per-line template literal is
 * the same table.
 *
 * ## NOT covered — stated so the claim stays the size of the evidence
 *
 * Each of these was constructed and measured, and each is left open
 * deliberately rather than unnoticed:
 *
 * - **3-letter tables.** A currency list is not shape-detected in any
 *   spelling; every scan here is two-letter. Currency is reached
 *   BEHAVIOURALLY instead, by the population agreement pins in
 *   `value-domains.test.ts`.
 * - **Separators of three characters or more** (`'AD',  'AE',` with padding,
 *   or a comment between entries) fall outside the density class.
 * - **No separator at all** — one 498-character string sliced with
 *   `.match(/../g)` — has no run to find.
 * - **Widening by a single literal** (`|| v === 'XK'`) is invisible to every
 *   scan here, and the population pins cover NARROWING exhaustively while the
 *   complement is infinite. The trap corpus seeds the plausible members of
 *   that complement rather than pretending to close it.
 * - **A table reached through a BARE package specifier** rather than a
 *   relative one would pass the import pin.
 * - Two further routes are closed by the toolchain rather than by a pin here,
 *   and are recorded because a toolchain is not a guarantee: the suite's
 *   module resolution, and the `tsup` es2020 target.
 *
 * Test sources are exempt from the scan: they are evidence, not enforcement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
// The repo's ONE answer to "is this span a comment, or code?" — a private
// stripper here would be the drift its header records (and
// `check:comment-mask-adoption` refuses one). `stripComments` is the right
// projection: every finding below reports a bare file name, never an offset.
// The `.mjs` specifier is deliberate; `scripts/js-comment-mask.d.mts` beside
// it is a hand-written declaration, so this import needs no `allowJs`.
import { stripComments } from '../../../../scripts/js-comment-mask.mjs';

/**
 * Seeded from `import.meta.url` in a spelling `check:cross-package-test-inputs`
 * resolves statically. The READS below do not escape the package — they are
 * this package's own `src/`.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));
const DOOR = join(SRC, 'value-domains.ts');

/**
 * Every non-test `.ts` under this package's `src/`, RECURSIVELY, as
 * `[path-relative-to-src, source]`.
 *
 * Recursive because `readdirSync` is not: `src/manifests/` and
 * `src/translations/` exist today, and a table placed in either passed an
 * earlier draft of this pin green.
 */
function runtimeSources(dir: string = SRC): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...runtimeSources(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push([relative(SRC, full), readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

describe('value-domains.ts answers from the shared predicate', () => {
  it('imports the vocabulary and the predicate from @objectstack/spec/shared', () => {
    const src = readFileSync(DOOR, 'utf8');
    expect(src).toContain("from '@objectstack/spec/shared'");
    expect(src).toContain('isValueDomainMember');
    expect(src).toContain('ValueDomainSchema');
  });

  it('imports from NOTHING ELSE — the door cannot reach a table wherever one is put', () => {
    // The root close. Every absence check in this file is a shape scan and so
    // is defeatable by a shape it does not know; this one is not a scan for a
    // table at all, it is the statement that the door has exactly one source of
    // membership. A 249-code array literal in a sibling module is harmless
    // while nothing here can import it, and a relative specifier is how it
    // would be reached.
    // Delimiter-agnostic and space-agnostic on purpose. An earlier draft read
    // `/\bfrom\s+'([^']+)'/` — single quotes and a mandatory space — and a
    // verbatim double-quoted copy of the mutation below walked straight past
    // it: `from "./zz-alpha2-array.js"` is not seen, so the pin reported the
    // one legal specifier and passed. ESLint does not close that door either;
    // this package has no `quotes` rule active, so both spellings are legal
    // here and only this pin can tell them apart.
    const code = stripComments(readFileSync(DOOR, 'utf8'));
    const specifiers = [...code.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)].map((m) => m[2]);
    expect(specifiers).toEqual(['@objectstack/spec/shared']);
  });

  it('declares no membership machinery of its own', () => {
    const src = readFileSync(DOOR, 'utf8');
    // The three copies that were here, by the shape each took. Comments in
    // this file's own header name them, so match on code, not on prose: every
    // check below is run against the source with comments stripped.
    const code = stripComments(src);
    expect(code, 'the currency probe belongs to the shared module').not.toContain('supportedValuesOf');
    expect(code, 'the time-zone probe belongs to the shared module').not.toContain('Intl.DateTimeFormat');
    expect(code, 'a lookup table here is a second membership definition').not.toContain('new Set(');
  });
});

describe('no membership table anywhere in this package', () => {
  it('carries no ISO 3166-1 alpha-2 code list, in either shape', () => {
    // The alpha-2 list has no standard-library oracle, so it is the one domain
    // a well-meaning editor is most likely to re-type locally. Detected by
    // shape rather than by file, and BOTH shapes are needed: the
    // space-separated string this package used to carry, and the array literal
    // a fresh re-typing produces — an earlier draft checked only the first and
    // a 249-element array passed it green.
    // Both shapes, and — the round-2 finding — EVERY delimiter. The first
    // draft of these two regexes hard-coded the single quote, so a verbatim
    // double-quoted copy of the same table passed the whole file green.
    const SPACED = /(['"`])(?:[A-Z]{2} ){7}/;
    const ARRAY = /(?:(['"])[A-Z]{2}\1,\s*){7}/;
    for (const [name, src] of runtimeSources()) {
      const code = stripComments(src);
      expect(SPACED.test(code), `${name} carries a space-separated alpha-2 code list`).toBe(false);
      expect(ARRAY.test(code), `${name} carries an array-literal alpha-2 code list`).toBe(false);
    }
  });

  it('carries no dense run of two-letter tokens, in ANY delimiter or none — the alternation shape', () => {
    // A membership table needs no quotes and no import at all: the 249 codes
    // as a regex alternation (`/^(?:AD|AE|…|ZW)$/`) is a table by every
    // meaning of the word, and passes a quote-shaped scan and the import pin
    // alike. What is invariant across those spellings is DENSITY: seven or
    // more bare two-uppercase-letter tokens separated by one or two
    // non-alphanumerics — a newline among them, which is how a
    // one-code-per-line template literal spells the same thing.
    //
    // PACKAGE-WIDE, and the reason is a measured falsification rather than
    // caution. An earlier draft ran this on the door alone, arguing that the
    // import pin kept a table in a sibling module out of reach. It does — but
    // only a table the door REACHES. The alternation put in the door's CALLER
    // (`settings-service.ts`, replacing the `firstRejectedDomainMember(…)`
    // call at the save-path refusal) is never reached by the door at all: it
    // stands IN FRONT of it, answers `iso_3166_alpha2` itself, and falls
    // through for the other two. Door blob unchanged, no quoted codes, no new
    // caller of the predicate — every other instrument here green, and the
    // whole package green, while a second judge decided the `value_domain`
    // FieldError on every alpha-2 save.
    //
    // The false-positive exposure is a census, not a hope: this pattern hits
    // 1 of 1,885 runtime `.ts` files repo-wide (49 `src` roots, comments
    // masked) — the shared module `value-domain.zod.ts` in the spec package,
    // i.e. the table itself, which is the one place the definition belongs.
    // (Named without a repo-relative path on purpose: this test does not READ
    // that file, and `check:cross-package-test-inputs` reads a spelled path as
    // a declared input. Its scan is source text, comments included.) Quoted
    // arrays, string enums (`MO = 'MO'`), unions and `{ AD: 1, … }` maps do
    // not trip it: quotes and digits push the separator past two characters.
    const DENSE = /(?:\b[A-Z]{2}\b[^A-Za-z0-9]{1,2}){7}/;
    for (const [name, src] of runtimeSources()) {
      expect(DENSE.test(stripComments(src)), `${name} carries a dense run of two-letter tokens`).toBe(false);
    }
  });

  it('probes no Intl enumeration on any enforcement path', () => {
    for (const [name, src] of runtimeSources()) {
      expect(stripComments(src), `${name} probes an Intl enumeration`).not.toContain('supportedValuesOf');
    }
  });

  it('states the membership question exactly once, as the shared call', () => {
    // Positive half of the ratchet: the absence checks above are satisfiable
    // by deleting the enforcement altogether, so pin that the call is present
    // and that exactly one file makes it. Note the honest limit, the same one
    // this file's header states: what reddens for a DIVERGENT second
    // definition may pass for an identical duplicate, which is why the shape
    // scans exist beside the behavioural pins rather than instead of them.
    const callers = runtimeSources().filter(([, src]) => stripComments(src).includes('isValueDomainMember('));
    expect(callers.map(([name]) => name)).toEqual(['value-domains.ts']);
  });
});
