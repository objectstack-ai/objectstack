// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `422 DEPENDENCY_MISSING` install refusal (ADR-0141 D2) read from its own
 * facts (objectstack#25792 item 3): the reader, the text it draws, and the
 * install call that carries the facts to the page.
 *
 * `t` echoes the KEY and the interpolated facts: the claim is WHICH line is
 * drawn for each entry and that it carries the entry's own id, range and
 * version — the words are each locale pack's.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dependencyMissingText, readDependencyMissing } from '../dependencyMissing';
import { installLocal } from '../marketplaceApi';

const t = (key: string, o?: Record<string, unknown>) =>
  (o ? `${key}(${['packageId', 'dependency', 'range', 'installedVersion'].map((k) => String(o[k])).join('|')})` : key);

/** The details the three install doors answer, as #25986 ships them. */
const DETAILS = {
  compatible: false,
  issues: [
    { severity: 'error', category: 'dependency_missing', message: "Package 'com.acme.psa' depends on 'app.objectstack.hotcrm' 6.x, which is not installed." },
    { severity: 'error', category: 'dependency_missing', message: "Package 'com.acme.psa' depends on 'com.acme.billing' ^2.1.0, installed at 1.4.0." },
  ],
  unmet: [
    { packageId: 'com.acme.psa', dependency: 'app.objectstack.hotcrm', range: '6.x', found: 'absent' },
    { packageId: 'com.acme.psa', dependency: 'com.acme.billing', range: '^2.1.0', found: 'out-of-range', installedVersion: '1.4.0' },
  ],
};

describe('readDependencyMissing', () => {
  it('reads one fact per unmet entry, in the refusal\'s order', () => {
    expect(readDependencyMissing(DETAILS)).toEqual(DETAILS.unmet);
  });

  it('reads every `found` the doors answer, the declaration-level one without a dependency', () => {
    const facts = readDependencyMissing({ unmet: [
      { packageId: 'p', dependency: 'd', range: 'latest', found: 'unreadable-range' },
      { packageId: 'p', dependency: 'd', range: '^6', found: 'unreadable-version', installedVersion: '6.1.0-beta.1' },
      { packageId: 'p', found: 'unreadable-declaration' },
    ] });
    expect(facts?.map((f) => f.found)).toEqual(['unreadable-range', 'unreadable-version', 'unreadable-declaration']);
  });

  it('draws nothing of its own from details it cannot read whole — the envelope message stands', () => {
    expect(readDependencyMissing(undefined)).toBeNull();
    expect(readDependencyMissing({ issues: DETAILS.issues })).toBeNull();
    expect(readDependencyMissing({ unmet: [] })).toBeNull();
    // One entry with a `found` this reader does not know: not a shorter list.
    expect(readDependencyMissing({ unmet: [DETAILS.unmet[0], { packageId: 'p', dependency: 'd', range: '1', found: 'disabled' }] })).toBeNull();
    expect(readDependencyMissing({ unmet: [{ packageId: 'p', range: '1', found: 'absent' }] })).toBeNull();
  });
});

describe('dependencyMissingText', () => {
  it('is the heading, then one line per entry built from that entry\'s facts', () => {
    expect(dependencyMissingText(readDependencyMissing(DETAILS)!, t).split('\n')).toEqual([
      'marketplace.install.dependencyMissing.heading',
      '• marketplace.install.dependencyMissing.absent(com.acme.psa|app.objectstack.hotcrm|6.x|—)',
      '• marketplace.install.dependencyMissing.outOfRange(com.acme.psa|com.acme.billing|^2.1.0|1.4.0)',
    ]);
  });
});

describe('installLocal carries the refusal\'s facts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects with the envelope\'s code, status and details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      error: { code: 'DEPENDENCY_MISSING', httpStatus: 422, message: 'Install refused: a declared dependency is not satisfied.', details: DETAILS },
    }), { status: 422, headers: { 'content-type': 'application/json' } })));
    const err = await installLocal({ packageId: 'pkg_psa' }).catch((e: unknown) => e) as Error & { code?: string; status?: number; details?: unknown };
    expect(err.code).toBe('DEPENDENCY_MISSING');
    expect(err.status).toBe(422);
    expect(err.details).toEqual(DETAILS);
  });
});
