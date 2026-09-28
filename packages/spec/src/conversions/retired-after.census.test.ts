// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from './registry.js';

/**
 * [#20390] `MetadataConversion.retiredAfter` — the census pin.
 *
 * Every retired entry carries `retiredAfter`: the last published
 * `@objectstack/spec` version whose authoring surface still accepted its old
 * shape. The artifact-ingestion door reads it per entry, so a wrong value is a
 * wrong boot verdict — too low and an artifact built by the last release is
 * refused by the unreleased `main` that retired its key; too high and the door
 * converts an artifact authored after the retirement instead of refusing it.
 * tsc makes the field REQUIRED; this file pins each VALUE.
 *
 * The facts come from `retired-after.census.json`: for every stable release
 * since the registry first shipped, the ids its published tarball marks
 * retired, re-derived from npm by `scripts/build-retired-after-census.ts`
 * (tarball integrity checked). Two rules, both the ruling's:
 *
 *   - PUBLISHED entry (retired in some censused tarball): the value is the
 *     stable release just before the FIRST tarball that carries it retired.
 *   - UNPUBLISHED entry (retired in no censused tarball): the value is the
 *     package's own version label — the label at the moment it lands, which is
 *     the last release — so a retirement landing after a release bump cannot be
 *     stamped low. One tolerance, and only one: while the label is AHEAD of the
 *     census's last release (the release PR bumped it and the census has not
 *     yet recorded that release's tarball), an unpublished entry may carry any
 *     version from the census's last release up to the label — it landed either
 *     before the bump or after it, and only the new tarball can say which.
 *     Refreshing the census after the publish closes the tolerance again.
 */

type Triple = [number, number, number];

interface CensusRelease {
  version: string;
  integrity: string;
  retired: string[];
}

interface Census {
  precedingRelease: string;
  releases: CensusRelease[];
}

const CENSUS = JSON.parse(
  readFileSync(new URL('./retired-after.census.json', import.meta.url), 'utf8'),
) as Census;
const LABEL = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const REGEN = 'pnpm --filter @objectstack/spec exec tsx scripts/build-retired-after-census.ts';

function triple(v: string): Triple {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not a stable x.y.z version: '${v}'`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: string, b: string): number {
  const x = triple(a);
  const y = triple(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

const LAST_CENSUSED = CENSUS.releases.at(-1)!.version;

/**
 * The stable release just before the first censused tarball that carries `id`
 * retired — or `null` when no published tarball does (an unpublished entry).
 */
function publishedRetiredAfter(id: string): string | null {
  const k = CENSUS.releases.findIndex((r) => r.retired.includes(id));
  if (k < 0) return null;
  return k === 0 ? CENSUS.precedingRelease : CENSUS.releases[k - 1]!.version;
}

const RETIRED = ALL_CONVERSIONS.filter((c) => c.retiredFromLoadPath === true);
const LIVE = ALL_CONVERSIONS.filter((c) => c.retiredFromLoadPath !== true);

describe('[#20390] retiredAfter census — every retired entry stamped from the published tarballs', () => {
  it('the census is well-formed: stable releases in ascending order, never ahead of the package label', () => {
    expect(CENSUS.releases.length).toBeGreaterThan(0);
    const versions = [CENSUS.precedingRelease, ...CENSUS.releases.map((r) => r.version)];
    for (let i = 1; i < versions.length; i++) {
      expect(cmp(versions[i - 1]!, versions[i]!), `${versions[i - 1]} < ${versions[i]}`).toBe(-1);
    }
    expect(cmp(LAST_CENSUSED, LABEL), `census (${LAST_CENSUSED}) is ahead of the label (${LABEL})`).toBeLessThanOrEqual(0);
    for (const r of CENSUS.releases) {
      expect(r.integrity).toMatch(/^sha512-/);
      expect([...r.retired].sort()).toEqual(r.retired);
    }
  });

  it('every retired entry carries a stable x.y.z retiredAfter, never above the package label', () => {
    expect(RETIRED.length).toBeGreaterThan(0);
    for (const c of RETIRED) {
      expect(c.retiredAfter, c.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(cmp(c.retiredAfter!, LABEL), `${c.id}: retiredAfter ${c.retiredAfter} > label ${LABEL}`).toBeLessThanOrEqual(0);
    }
  });

  it('no live entry carries retiredAfter (it is set together with retiredFromLoadPath)', () => {
    for (const c of LIVE) expect(c.retiredAfter, c.id).toBeUndefined();
  });

  it('every PUBLISHED entry carries the stable release before the first tarball that retired it', () => {
    const wrong: string[] = [];
    let published = 0;
    for (const c of RETIRED) {
      const want = publishedRetiredAfter(c.id);
      if (want === null) continue;
      published += 1;
      if (c.retiredAfter !== want) wrong.push(`${c.id}: retiredAfter '${c.retiredAfter}', the tarballs say '${want}'`);
    }
    expect(wrong, `stamp these from the census (${REGEN} re-derives it)`).toEqual([]);
    // The census reaches at least one published retirement — a census that
    // matched nothing would pass the loop above vacuously.
    expect(published).toBeGreaterThan(0);
  });

  it('every UNPUBLISHED entry carries the package label (the release-pending range while the census trails it)', () => {
    const pending = cmp(LABEL, LAST_CENSUSED) > 0;
    const wrong: string[] = [];
    for (const c of RETIRED) {
      if (publishedRetiredAfter(c.id) !== null) continue;
      const v = c.retiredAfter!;
      if (!pending && v !== LABEL) {
        wrong.push(`${c.id}: retiredAfter '${v}', but no published tarball retires it, so it takes the label '${LABEL}'`);
      } else if (pending && (cmp(v, LAST_CENSUSED) < 0 || cmp(v, LABEL) > 0)) {
        wrong.push(`${c.id}: retiredAfter '${v}' is outside [${LAST_CENSUSED}, ${LABEL}] — refresh the census (${REGEN})`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
