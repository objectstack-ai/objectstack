/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7611 — the pre-publish capability lint reads the capabilities the
 * registry serves.
 *
 * `validateCapabilityReferences` resolves a reference against three sources:
 * the built-in platform capabilities, `stack.capabilities` (the
 * `defineCapability` declarations) and `systemPermissions` grants. The console
 * assembled only the first and the last, so a capability declared with
 * `defineCapability` and granted by no permission set was reported as
 * resolving nowhere on Publish from Home. The pseudo-stack now carries the
 * registry's capability list (`GET /api/v1/meta/capability`).
 *
 * The rule is `@objectstack/lint`'s own, not a stand-in: the verdict pinned
 * here is the one the console's Publish toast shows.
 */

import { describe, it, expect, vi } from 'vitest';
import { validateCapabilityReferences } from '@objectstack/lint';
import { lintDraftCapabilityReferences } from './capabilityLint';

const draft = (item: Record<string, unknown>) => Promise.resolve({ item });

/** Two object drafts: one names a declared-only capability, one a misspelling. */
const REQUIRED: Record<string, string> = {
  declared_only: 'acme.restricted_ops',
  misspelled: 'acme.restricted_opz',
};

const PENDING = [
  { type: 'object', name: 'declared_only', packageId: null },
  { type: 'object', name: 'misspelled', packageId: null },
];

function fakeClient(capabilityList: () => Promise<unknown[]>) {
  return {
    getDraft: vi.fn((type: string, name: string) =>
      type === 'object' ? draft({ name, requiredPermissions: [REQUIRED[name]] }) : Promise.resolve(null),
    ),
    list: vi.fn((type: string) =>
      type === 'capability'
        ? capabilityList()
        : Promise.resolve([{ item: { name: 'member_default', systemPermissions: [] } }]),
    ),
  };
}

describe('lintDraftCapabilityReferences — registry capabilities (objectui#7611)', () => {
  it('resolves a capability the registry serves though no permission set grants it', async () => {
    const client = fakeClient(() =>
      Promise.resolve([{ name: 'acme.restricted_ops', label: 'Restricted Operations', scope: 'org' }]),
    );

    const warnings = await lintDraftCapabilityReferences(client, PENDING, validateCapabilityReferences);

    expect(client.list).toHaveBeenCalledWith('capability', {});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('object "misspelled"');
    expect(warnings[0]).toContain('"acme.restricted_opz"');
  });

  it('reads the registry row as the list serves it, `{ item }` envelope included', async () => {
    const client = fakeClient(() => Promise.resolve([{ item: { name: 'acme.restricted_ops', scope: 'org' } }]));

    const warnings = await lintDraftCapabilityReferences(client, PENDING, validateCapabilityReferences);

    expect(warnings.map((w) => w.split(':')[0])).toEqual(['object "misspelled"']);
  });

  it('CONTROL — the same drafts warn twice when the registry does not serve the capability', async () => {
    const client = fakeClient(() => Promise.resolve([]));

    const warnings = await lintDraftCapabilityReferences(client, PENDING, validateCapabilityReferences);

    expect(warnings.map((w) => w.split(':')[0])).toEqual(['object "declared_only"', 'object "misspelled"']);
  });

  it('a failed capability read leaves the pass advisory: the rule still runs on the other sources', async () => {
    const client = fakeClient(() => Promise.reject(new Error('network')));

    const warnings = await lintDraftCapabilityReferences(client, PENDING, validateCapabilityReferences);

    expect(warnings).toHaveLength(2);
  });
});
