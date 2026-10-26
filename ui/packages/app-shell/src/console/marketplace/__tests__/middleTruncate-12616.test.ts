// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The marketplace card's id is cut in the middle, never at its end
 * (objectui#12616): a card too narrow for the whole manifest id keeps its head
 * and its package suffix with "…" between, so the part that tells two packages
 * apart stays readable. The card draws the id as two runs, a head that shrinks
 * and a suffix that does not (`MarketplacePage.cardHeader-12616.test.tsx`
 * pins that structure); `splitPackageSuffix` finds the split, and these cases
 * pin it.
 */

import { describe, expect, it } from 'vitest';
import { splitPackageSuffix } from '../middleTruncate';

describe('splitPackageSuffix (objectui#12616)', () => {
  it('splits a reverse-domain id after its last ".", so the package name is the suffix', () => {
    expect(splitPackageSuffix('app.objectstack.hotcrm')).toEqual({ head: 'app.objectstack.', suffix: 'hotcrm' });
    expect(splitPackageSuffix('com.northwind.customer-relationship-suite')).toEqual({
      head: 'com.northwind.',
      suffix: 'customer-relationship-suite',
    });
  });

  it('has no suffix when the id has no package segment, so the card cuts it at its end', () => {
    expect(splitPackageSuffix('hotcrm')).toEqual({ head: 'hotcrm', suffix: '' });
    expect(splitPackageSuffix('com.acme.')).toEqual({ head: 'com.acme.', suffix: '' });
    expect(splitPackageSuffix('.hidden')).toEqual({ head: '.hidden', suffix: '' });
    expect(splitPackageSuffix('')).toEqual({ head: '', suffix: '' });
  });

  it('never shortens the id: the two runs are the whole id', () => {
    for (const id of ['app.objectstack.hotcrm', 'com.northwind.customer-relationship-suite', 'hotcrm', 'com.acme.', 'a.b']) {
      const { head, suffix } = splitPackageSuffix(id);
      expect(head + suffix).toBe(id);
    }
  });
});
