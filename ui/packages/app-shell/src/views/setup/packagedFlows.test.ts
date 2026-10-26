// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which flows Setup › Packaged automation lists (ADR-0126 §7.4).
 *
 * The scoping rule is the part of that page most worth measuring directly.
 * Its hard case is not "does a package ship this" but the counterexample: a
 * TENANT-authored overlay bound to a package carries a real `_packageId`, so
 * every two-clause shortcut classifies it as packaged. cloud#970 measured that
 * misread on a Studio-authored artifact after a kernel rebuild; here it would
 * put a tenant's own flow behind an install-wide switch.
 */

import { describe, expect, it } from 'vitest';

import {
  activationReading,
  envelopeData,
  envelopeRefused,
  isPackagedFlowItem,
  joinPackagedFlows,
  readMetadataItems,
  readRuntimeStates,
} from './packagedFlows';

/** A packaged flow metadata item — loader-introduced, real package id. */
function packagedItem(name: string, label: string) {
  return { name, label, _packageId: 'com.objectstack.crm', _provenance: 'package' };
}

describe('isPackagedFlowItem', () => {
  it('accepts a loader-introduced item', () => {
    expect(isPackagedFlowItem({ _packageId: 'com.objectstack.crm', _provenance: 'package' })).toBe(true);
    // A package id with no provenance is still a code artifact — the server's
    // test excludes provenance `'org'`, it does not require `'package'`.
    expect(isPackagedFlowItem({ _packageId: 'com.objectstack.crm' })).toBe(true);
  });

  it('refuses the tenant overlay bound to a package — the cloud#970 counterexample', () => {
    expect(isPackagedFlowItem({ _packageId: 'app.crm', _provenance: 'org' })).toBe(false);
  });

  it('refuses the overlay-bound-to-no-package sentinel and unpackaged items', () => {
    expect(isPackagedFlowItem({ _packageId: 'sys_metadata' })).toBe(false);
    expect(isPackagedFlowItem({ name: 'my_flow' })).toBe(false);
    expect(isPackagedFlowItem({ _packageId: '' })).toBe(false);
    expect(isPackagedFlowItem(null)).toBe(false);
    expect(isPackagedFlowItem(undefined)).toBe(false);
  });
});

describe('joinPackagedFlows', () => {
  it('lists only registered flows a package ships, labelled from the metadata item', () => {
    const rows = joinPackagedFlows(
      [
        { name: 'pkg_notify', enabled: false },
        { name: 'tenant_flow', enabled: true },
        { name: 'overlay_flow', enabled: true },
      ],
      [
        packagedItem('pkg_notify', 'Notify owner'),
        { name: 'tenant_flow', label: 'Mine', _packageId: 'sys_metadata' },
        { name: 'overlay_flow', label: 'Mine too', _packageId: 'app.crm', _provenance: 'org' },
        // Packaged, but the engine never registered it — no row, because both
        // actions the page offers go through the engine.
        packagedItem('pkg_dormant', 'Dormant'),
      ],
    );

    expect(rows).toEqual([{ name: 'pkg_notify', label: 'Notify owner', enabled: false }]);
  });

  it('falls back to the machine name when the packaged item has no label', () => {
    const rows = joinPackagedFlows(
      [{ name: 'pkg_notify', enabled: true }],
      [{ name: 'pkg_notify', _packageId: 'com.objectstack.crm', _provenance: 'package' }],
    );
    expect(rows[0]).toEqual({ name: 'pkg_notify', label: 'pkg_notify', enabled: true });
  });

  it('treats an omitted `enabled` as on — an engine that reports none has nothing disabled', () => {
    const rows = joinPackagedFlows([{ name: 'pkg_notify' }], [packagedItem('pkg_notify', 'Notify')]);
    expect(rows[0].enabled).toBe(true);
  });

  it('orders by label, then by machine name', () => {
    const rows = joinPackagedFlows(
      [{ name: 'b_flow' }, { name: 'a_flow' }, { name: 'c_flow' }],
      [packagedItem('b_flow', 'Alpha'), packagedItem('a_flow', 'Zulu'), packagedItem('c_flow', 'Alpha')],
    );
    expect(rows.map((r) => r.name)).toEqual(['b_flow', 'c_flow', 'a_flow']);
  });

  it('ignores rows and items with no usable name', () => {
    const rows = joinPackagedFlows(
      [{ name: '' }, { enabled: true }, { name: 'pkg_notify' }],
      [{ name: '', _packageId: 'p' }, null, packagedItem('pkg_notify', 'Notify')],
    );
    expect(rows.map((r) => r.name)).toEqual(['pkg_notify']);
  });
});

describe('the unbound reason (objectui#9217)', () => {
  it('carries a string `reason` through unchanged, character for character', () => {
    // Fixture text, not a contract: what is pinned is that whatever sentence
    // the platform sends reaches the row unedited.
    const sentence = "trigger 'record_change' is registered but binding failed — see earlier warnings";
    const rows = joinPackagedFlows(
      [{ name: 'pkg_notify', enabled: true, bound: false, triggerType: 'record_change', reason: sentence }],
      [packagedItem('pkg_notify', 'Notify')],
    );
    expect(rows[0]).toEqual({ name: 'pkg_notify', label: 'Notify', enabled: true, reason: sentence });
  });

  it('leaves the key ABSENT on a row that sends none — including an older backend', () => {
    const rows = joinPackagedFlows(
      [{ name: 'pkg_notify', enabled: true, bound: true }, { name: 'pkg_legacy' }],
      [packagedItem('pkg_notify', 'Notify'), packagedItem('pkg_legacy', 'Legacy')],
    );
    for (const row of rows) expect(Object.keys(row)).not.toContain('reason');
  });

  it('ignores a `reason` that is not a non-empty string', () => {
    const odd: unknown[] = [42, true, null, { code: 'policy' }, ['a sentence'], ''];
    const rows = joinPackagedFlows(
      odd.map((reason, i) => ({ name: `pkg_${i}`, enabled: true, bound: false, reason })),
      odd.map((_, i) => packagedItem(`pkg_${i}`, `Flow ${i}`)),
    );
    expect(rows).toHaveLength(odd.length);
    for (const row of rows) expect(Object.keys(row)).not.toContain('reason');
  });
});

describe('the effective state beside the flag (objectui#13159)', () => {
  it('carries a string `unboundCause` through, and leaves it ABSENT on rows that send none', () => {
    const rows = joinPackagedFlows(
      [
        {
          name: 'pkg_digest',
          enabled: true,
          bound: false,
          triggerType: 'schedule',
          reason: 'disabled by deployment policy',
          unboundCause: 'deployment_policy',
        },
        { name: 'pkg_notify', enabled: true, bound: true },
        // A backend that predates the field sends the sentence alone.
        { name: 'pkg_older', enabled: true, bound: false, triggerType: 'schedule', reason: 'not armed' },
      ],
      [packagedItem('pkg_digest', 'Digest'), packagedItem('pkg_notify', 'Notify'), packagedItem('pkg_older', 'Older')],
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('pkg_digest')).toEqual({
      name: 'pkg_digest',
      label: 'Digest',
      enabled: true,
      reason: 'disabled by deployment policy',
      unboundCause: 'deployment_policy',
    });
    expect(Object.keys(byName.get('pkg_notify')!)).not.toContain('unboundCause');
    expect(Object.keys(byName.get('pkg_older')!)).not.toContain('unboundCause');
  });

  it('ignores an `unboundCause` that is not a non-empty string', () => {
    const odd: unknown[] = [42, true, null, { cause: 'deployment_policy' }, ['deployment_policy'], ''];
    const rows = joinPackagedFlows(
      odd.map((unboundCause, i) => ({ name: `pkg_${i}`, enabled: true, bound: false, unboundCause })),
      odd.map((_, i) => packagedItem(`pkg_${i}`, `Flow ${i}`)),
    );
    expect(rows).toHaveLength(odd.length);
    for (const row of rows) expect(Object.keys(row)).not.toContain('unboundCause');
  });

  it('reads an enabled row the engine reports unarmed as not running, whatever the cause', () => {
    for (const unboundCause of ['deployment_policy', 'disabled_subflow', 'missing_trigger', 'binding_failure']) {
      expect(activationReading({ enabled: true, unboundCause })).toBe('not-running');
    }
  });

  it('reads an enabled row with no unbound cause as on, and a disabled row as off', () => {
    // Bound to its trigger, or a flow with no trigger that runs when invoked:
    // the engine sends no cause for either.
    expect(activationReading({ enabled: true })).toBe('on');
    expect(activationReading({ enabled: false })).toBe('off');
    // The flag decides first: a switched-off flow never runs, cause or not.
    expect(activationReading({ enabled: false, unboundCause: 'deployment_policy' })).toBe('off');
  });
});

describe('envelope readers', () => {
  it('reads the runtime list wrapped or bare, and nothing else', () => {
    expect(readRuntimeStates({ data: { flows: [{ name: 'a' }] } })).toEqual([{ name: 'a' }]);
    expect(readRuntimeStates({ flows: [{ name: 'b' }] })).toEqual([{ name: 'b' }]);
    expect(readRuntimeStates({ flows: 'nope' })).toEqual([]);
    expect(readRuntimeStates(null)).toEqual([]);
  });

  it('reads the metadata list as a bare array or `{ items }`', () => {
    expect(readMetadataItems([{ name: 'a' }])).toEqual([{ name: 'a' }]);
    expect(readMetadataItems({ items: [{ name: 'b' }] })).toEqual([{ name: 'b' }]);
    expect(readMetadataItems({ items: 3 })).toEqual([]);
    expect(readMetadataItems(null)).toEqual([]);
  });

  it('narrows `data` and spots an envelope refusal under a 2xx', () => {
    expect(envelopeData({ data: { enabled: false } })).toEqual({ enabled: false });
    expect(envelopeData({ data: [1, 2] })).toEqual({});
    expect(envelopeData(null)).toEqual({});
    expect(envelopeRefused({ success: false })).toBe(true);
    expect(envelopeRefused({ success: true })).toBe(false);
    expect(envelopeRefused(null)).toBe(false);
  });
});
