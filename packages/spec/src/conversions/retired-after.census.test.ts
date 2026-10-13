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
 *     newest stable release at the moment it lands, read off the package's own
 *     version label. Under a stable label that is the label itself — the label
 *     at the moment it lands is the last release — so a retirement landing
 *     after a release bump cannot be stamped low. Under a prerelease label it is
 *     the newest published stable release, below the label's release triple
 *     (see below). One tolerance, and only one: while the label is AHEAD of the
 *     census's last release (the release PR bumped it and the census has not
 *     yet recorded that release's tarball), an unpublished entry may carry any
 *     version from the census's last release up to the label — it landed either
 *     before the bump or after it, and only the new tarball can say which.
 *     Refreshing the census after the publish closes the tolerance again.
 *
 * The label is read on its RELEASE TRIPLE, with semver precedence. Changesets
 * pre mode writes a prerelease label (`18.0.0-next.0`) into this package on
 * the Version Packages PR, and onto `main` once that lands, so every
 * comparison against the label uses `x.y.z` with the prerelease suffix
 * dropped: `18.0.0-next.N` reads as `18.0.0`. That is the reading the artifact
 * door gives the runtime label (it compares `x.y.z` triples and tolerates a
 * suffix). A prerelease precedes its release, so "at or below the label" means
 * strictly below `x.y.z` under a prerelease label: `18.0.0-next.N` admits
 * `17.7.0` and refuses `18.0.0`. That is the PUBLISHED rule applied before the
 * fact: a retirement landing under a prerelease label is first carried retired
 * by the stable `x.y.z` (the census holds stable releases only), so its value
 * is the stable release just before that tarball, never `x.y.z` itself — which
 * is refused now rather than at the census refresh after `x.y.z` ships. On a
 * stable label the reading is the label itself, inclusive, so no assertion
 * changes meaning there. Under a prerelease label the census never records
 * that label's tarball, so the release-pending tolerance above stays open,
 * spanning `[last censused release, release triple)`, until the stable release
 * is published and censused, when the PUBLISHED rule re-judges every stamp. A
 * stable maintenance release published meanwhile without the retirement (a
 * `17.x` release during the 18 prerelease) still accepted the old shape, so
 * once censused it raises the range's lower bound and the entry is re-stamped
 * to it. Only the label gets this reading: a census version and a
 * `retiredAfter` stamp stay stable `x.y.z`, and a label that is neither
 * `x.y.z` nor `x.y.z-PRERELEASE` still throws.
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

/**
 * The release triple of a package label: `x.y.z` as is, `x.y.z-PRERELEASE`
 * with the suffix dropped (`18.0.0-next.0` reads as `18.0.0`). Anything else
 * throws. See the file docblock for why the label alone is read this way.
 */
function releaseTriple(label: string): string {
  const m = /^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(label);
  if (!m) throw new Error(`not an x.y.z or x.y.z-prerelease package label: '${label}'`);
  return m[1]!;
}

/** A package label as a failure message names it. */
function labelShown(label: string): string {
  const release = releaseTriple(label);
  return label === release ? `'${label}'` : `'${label}' (release triple '${release}')`;
}

/**
 * Whether the stable version `v` is at or below the package label, by semver
 * precedence: a stable label `x.y.z` admits `x.y.z` itself; a prerelease label
 * `x.y.z-PRERELEASE` precedes its release, so only a version strictly below
 * `x.y.z` is at or below it. See the file docblock.
 */
function atOrBelowLabel(v: string, label: string): boolean {
  const release = releaseTriple(label);
  return label === release ? cmp(v, release) <= 0 : cmp(v, release) < 0;
}

/**
 * Why an UNPUBLISHED entry's stamp `v` breaks the docblock's UNPUBLISHED rule
 * under `label` and a census whose last release is `lastCensused`, or `null`
 * when it does not. A prerelease label never takes the exact-label branch: the
 * census never records its tarball, so the release-pending range stays open.
 */
function unpublishedStampProblem(v: string, label: string, lastCensused: string): string | null {
  const release = releaseTriple(label);
  const prerelease = label !== release;
  if (!prerelease && cmp(release, lastCensused) <= 0) {
    return v === release ? null : `retiredAfter '${v}', but no published tarball retires it, so it takes the label ${labelShown(label)}`;
  }
  if (cmp(v, lastCensused) >= 0 && atOrBelowLabel(v, label)) return null;
  if (!prerelease) return `retiredAfter '${v}' is outside [${lastCensused}, ${release}] — refresh the census (${REGEN})`;
  return (
    `retiredAfter '${v}' is outside [${lastCensused}, ${release}): under the prerelease label ${labelShown(label)}, ` +
    `a retirement stamps the newest published stable release, never '${release}' — the first stable release that carries it retired ` +
    `(after a stable publish, refresh the census: ${REGEN})`
  );
}

/** The label as every comparison below reads it. */
const RELEASE = releaseTriple(LABEL);
/** Whether the label is a prerelease of {@link RELEASE}, which it then precedes. */
const PRERELEASE = LABEL !== RELEASE;
/** The label as a failure message names it. */
const LABEL_SHOWN = labelShown(LABEL);

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

describe('retiredAfter census — every retired entry stamped from the published tarballs', () => {
  it('the census is well-formed: stable releases in ascending order, never ahead of the package label', () => {
    expect(CENSUS.releases.length).toBeGreaterThan(0);
    const versions = [CENSUS.precedingRelease, ...CENSUS.releases.map((r) => r.version)];
    for (let i = 1; i < versions.length; i++) {
      expect(cmp(versions[i - 1]!, versions[i]!), `${versions[i - 1]} < ${versions[i]}`).toBe(-1);
    }
    expect(atOrBelowLabel(LAST_CENSUSED, LABEL), `census (${LAST_CENSUSED}) is ahead of the label ${LABEL_SHOWN}`).toBe(true);
    for (const r of CENSUS.releases) {
      expect(r.integrity).toMatch(/^sha512-/);
      expect([...r.retired].sort()).toEqual(r.retired);
    }
  });

  it('every retired entry carries a stable x.y.z retiredAfter, never above the package label', () => {
    expect(RETIRED.length).toBeGreaterThan(0);
    for (const c of RETIRED) {
      expect(c.retiredAfter, c.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(
        atOrBelowLabel(c.retiredAfter!, LABEL),
        `${c.id}: retiredAfter ${c.retiredAfter} > label ${LABEL_SHOWN}` +
          (PRERELEASE ? `, which precedes '${RELEASE}': stamp the newest published stable release` : ''),
      ).toBe(true);
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

  it('every UNPUBLISHED entry carries the newest stable release (the release-pending range while the census trails the label)', () => {
    const wrong: string[] = [];
    for (const c of RETIRED) {
      if (publishedRetiredAfter(c.id) !== null) continue;
      const problem = unpublishedStampProblem(c.retiredAfter!, LABEL, LAST_CENSUSED);
      if (problem !== null) wrong.push(`${c.id}: ${problem}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the UNPUBLISHED rule under a simulated label', () => {
  it('a stable label admits itself: the release-pending range is inclusive, and a census at the label takes the exact label', () => {
    for (const v of ['17.4.0', '17.5.0', '17.7.0']) expect(unpublishedStampProblem(v, '17.7.0', '17.4.0'), v).toBeNull();
    for (const v of ['17.3.0', '17.7.1', '18.0.0']) expect(unpublishedStampProblem(v, '17.7.0', '17.4.0'), v).not.toBeNull();
    expect(unpublishedStampProblem('17.7.0', '17.7.0', '17.7.0')).toBeNull();
    expect(unpublishedStampProblem('17.6.0', '17.7.0', '17.7.0')).not.toBeNull();
  });

  it('a prerelease label refuses its own release triple and admits the newest published stable release', () => {
    for (const label of ['18.0.0-next.0', '18.0.0-next.12']) {
      for (const v of ['17.4.0', '17.7.0', '17.7.1']) expect(unpublishedStampProblem(v, label, '17.4.0'), `${v} under ${label}`).toBeNull();
      for (const v of ['17.3.0', '18.0.0', '18.0.1']) expect(unpublishedStampProblem(v, label, '17.4.0'), `${v} under ${label}`).not.toBeNull();
    }
    // Whatever the census holds, a prerelease label keeps the range open: it never takes the exact-label branch.
    expect(unpublishedStampProblem('17.7.0', '18.0.0-next.0', '17.7.0')).toBeNull();
    expect(unpublishedStampProblem('18.0.0', '18.0.0-next.0', '18.0.0')).not.toBeNull();
  });

  it('the same precedence bounds every comparison against the label', () => {
    expect(atOrBelowLabel('17.7.0', '17.7.0')).toBe(true);
    expect(atOrBelowLabel('17.7.1', '17.7.0')).toBe(false);
    expect(atOrBelowLabel('17.7.0', '18.0.0-next.0')).toBe(true);
    expect(atOrBelowLabel('18.0.0', '18.0.0-next.0')).toBe(false);
  });
});

describe('the package label is read on its release triple', () => {
  it('a stable label is its own release triple', () => {
    expect(releaseTriple('17.7.0')).toBe('17.7.0');
    expect(releaseTriple('18.0.0')).toBe('18.0.0');
  });

  it('a prerelease label reads as its release triple', () => {
    expect(releaseTriple('18.0.0-next.0')).toBe('18.0.0');
    expect(releaseTriple('18.0.0-next.12')).toBe('18.0.0');
    expect(releaseTriple('18.1.0-rc.1')).toBe('18.1.0');
    // ...so its triple compares at, never above, the release it precedes (atOrBelowLabel adds the precedence).
    expect(cmp('17.7.0', releaseTriple('18.0.0-next.0'))).toBe(-1);
    expect(cmp('18.0.0', releaseTriple('18.0.0-next.0'))).toBe(0);
  });

  it('a malformed label still throws, naming the label', () => {
    for (const bad of ['', 'next', '18', '18.0', 'v18.0.0', '18.0.0-', '18.0.0-next..0', '18.0.0.0', ' 18.0.0']) {
      expect(() => releaseTriple(bad), JSON.stringify(bad)).toThrow(`'${bad}'`);
    }
  });

  it('the release-triple reading is the label\'s alone: a census version or a stamp stays stable x.y.z', () => {
    expect(() => triple('18.0.0-next.0')).toThrow(`'18.0.0-next.0'`);
    expect(() => cmp('18.0.0-next.0', '17.7.0')).toThrow(`'18.0.0-next.0'`);
  });
});
