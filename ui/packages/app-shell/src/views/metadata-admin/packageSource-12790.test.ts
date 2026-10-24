// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Source boundary reads the served `source` key (objectui#12790).
 *
 * objectstack#24010 put the origin on every `/api/v1/packages` row:
 * `InstalledPackageSourceSchema` (`@objectstack/spec/kernel`) declares the
 * closed set, and `InstalledPackageAtEitherStageSchema`
 * (`@objectstack/spec/api-assembled`) requires it on both stage branches of the
 * served row. These pins hold the page's local tuple to those two declarations,
 * and hold `readServedSource` to reading that key and nothing else: no other
 * key on the row stands in for it, and an absent or unknown value is refused
 * by name.
 */

import { describe, expect, it } from 'vitest';
import { InstalledPackageSourceSchema } from '@objectstack/spec/kernel';
import { InstalledPackageAtEitherStageSchema } from '@objectstack/spec/api-assembled';
import {
  PACKAGE_SOURCES,
  PackageSourceRefusal,
  packagesHref,
  readServedSource,
  readSourceFilter,
} from './packageSource';

const sorted = (values: readonly string[]) => [...values].sort();

/** The refusal `fn` throws, so a test can read its code and subject. */
function refusalOf(fn: () => unknown): PackageSourceRefusal {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PackageSourceRefusal);
    return e as PackageSourceRefusal;
  }
  throw new Error('expected a PackageSourceRefusal, and nothing was thrown');
}

describe('PACKAGE_SOURCES is the closed set the spec declares (objectui#12790)', () => {
  it('equals the options of `InstalledPackageSourceSchema`', () => {
    expect(InstalledPackageSourceSchema.options.length).toBeGreaterThan(0);
    expect(sorted(PACKAGE_SOURCES)).toEqual(sorted(InstalledPackageSourceSchema.options));
  });

  it('equals the `source` options on both stage branches of the served row', () => {
    const branches = InstalledPackageAtEitherStageSchema.options;
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(sorted(branch.shape.source.options)).toEqual(sorted(PACKAGE_SOURCES));
    }
  });
});

describe('readServedSource reads the served `source` and nothing else (objectui#12790)', () => {
  it.each(PACKAGE_SOURCES)('a served `%s` reads as itself', (source) => {
    expect(readServedSource({ manifest: { id: 'com.acme.pkg' }, source })).toBe(source);
  });

  it.each([
    ['absent', {}],
    ['null', { source: null }],
    ['empty', { source: '' }],
    ['outside the closed set', { source: 'plugin' }],
    ['a different spelling of a member', { source: 'Marketplace' }],
    ['not a string', { source: 1 }],
  ])('a `source` that is %s is refused by name, naming the package', (_label, served) => {
    const refusal = refusalOf(() => readServedSource({ manifest: { id: 'com.acme.pkg' }, ...served }));
    expect(refusal.code).toBe('PACKAGE_SOURCE_UNKNOWN');
    expect(refusal.subject).toBe('com.acme.pkg');
  });

  it('`writable` never stands in for a missing `source`, in either direction', () => {
    for (const writable of [true, false]) {
      const row = { manifest: { id: 'app.b2r4' }, writable };
      const refusal = refusalOf(() => readServedSource(row));
      expect(refusal.code).toBe('PACKAGE_SOURCE_UNKNOWN');
    }
  });

  it('CONTROL: a non-writable authored row reads `authored` (the retired join called it code or marketplace)', () => {
    const row = { manifest: { id: 'com.acme.platform_base', scope: 'system' }, source: 'authored', writable: false };
    expect(readServedSource(row)).toBe('authored');
  });
});

describe('the `?source=` filter keeps its contract (objectui#12675, objectui#12790)', () => {
  it.each(PACKAGE_SOURCES)('`?source=%s` is read as that value and spelled back by packagesHref', (source) => {
    expect(readSourceFilter([source])).toBe(source);
    expect(packagesHref('/apps/setup', source)).toBe(`/apps/setup/component/developer/packages?source=${source}`);
  });

  it('no param reads as no filter; an unknown or repeated one is refused by name', () => {
    expect(readSourceFilter([])).toBeNull();
    expect(refusalOf(() => readSourceFilter(['plugin'])).code).toBe('PACKAGE_SOURCE_FILTER_UNKNOWN');
    expect(refusalOf(() => readSourceFilter(['code', 'authored'])).code).toBe('PACKAGE_SOURCE_FILTER_REPEATED');
  });
});
