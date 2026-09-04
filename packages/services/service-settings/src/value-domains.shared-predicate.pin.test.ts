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
 * The scan covers the package's whole non-test source, not just
 * `value-domains.ts`: "delete the table from this file" and "move the table to
 * a new file" are the same defect, and only the second one survives a
 * single-file check. Test sources are deliberately exempt — the currency
 * equivalence measurement in `value-domains.test.ts` probes
 * `Intl.supportedValuesOf('currency')` on purpose, and that probe is evidence,
 * not an enforcement path.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const DOOR = join(SRC, 'value-domains.ts');

/** Every non-test `.ts` in this package's `src/`, as `[name, source]`. */
function runtimeSources(): Array<[string, string]> {
  return readdirSync(SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(join(SRC, f), 'utf8')] as [string, string]);
}

describe('value-domains.ts answers from the shared predicate', () => {
  it('imports the vocabulary and the predicate from @objectstack/spec/shared', () => {
    const src = readFileSync(DOOR, 'utf8');
    expect(src).toContain("from '@objectstack/spec/shared'");
    expect(src).toContain('isValueDomainMember');
    expect(src).toContain('ValueDomainSchema');
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
  it('carries no ISO 3166-1 alpha-2 code list', () => {
    // The alpha-2 list has no standard-library oracle, so it is the one
    // domain a well-meaning editor is most likely to re-type locally. Detected
    // by shape rather than by file: a string literal holding a run of
    // space-separated uppercase pairs.
    const RUN = /'(?:[A-Z]{2} ){7}/;
    for (const [name, src] of runtimeSources()) {
      expect(RUN.test(stripComments(src)), `${name} looks like it carries an alpha-2 code list`).toBe(false);
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
    // and that exactly one file makes it.
    const callers = runtimeSources().filter(([, src]) => stripComments(src).includes('isValueDomainMember('));
    expect(callers.map(([name]) => name)).toEqual(['value-domains.ts']);
  });
});

/** Drop line and block comments, so prose naming a banned shape is not a hit. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
