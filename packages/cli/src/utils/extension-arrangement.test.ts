// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] `findExtensionArrangementRefusals` — what `os validate` and
 * `os build` hand the arrangement judge.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeExtensionArrangement`,
 * the one the save and install doors ask; the protocol's own file pins its
 * sentence. What is pinned here is which packages the walk hands it and under
 * which id: each `packages[]` entry under its own, or the stack itself under
 * `manifest.id`, every row's message EQUAL to the judge's for the same subject.
 */

import { describe, expect, it } from 'vitest';
import { judgeExtensionArrangement } from '@objectstack/metadata-protocol';
import { findExtensionArrangementRefusals } from './extension-arrangement.js';

const VENDOR = 'com.acme.partner';
const PAIR = 'com.acme.crm.custom';

const GROUPS = [{ key: 'basic', label: 'Basics', fields: ['name'] }];
const TABS = ['crm_contact', { list: 'crm_task', hidden: true }];
const extensions = [{ extend: 'crm_account', fieldGroups: GROUPS, relatedLists: TABS }];

describe('ADR-0146 D10 — the walk os validate and os build hand the arrangement judge', () => {
  it('a stack under a plain id: each arrangement key is refused once under that id, located in the stack', () => {
    const rows = findExtensionArrangementRefusals({ manifest: { id: VENDOR }, objectExtensions: extensions });
    const judged = judgeExtensionArrangement({ packageId: VENDOR, objectExtensions: extensions });
    expect(rows).toEqual([
      { path: 'objectExtensions[0].fieldGroups', code: 'VALIDATION_ERROR', key: 'fieldGroups', packageId: VENDOR, message: judged[0]!.message },
      { path: 'objectExtensions[0].relatedLists', code: 'VALIDATION_ERROR', key: 'relatedLists', packageId: VENDOR, message: judged[1]!.message },
    ]);
    expect(rows[0]!.message).toContain('`place`');
  });

  it('CONTROL: the same stack under its `.custom` id is admitted', () => {
    expect(findExtensionArrangementRefusals({ manifest: { id: PAIR }, objectExtensions: extensions })).toEqual([]);
  });

  it('CONTROL: a plain stack that writes neither key is admitted', () => {
    expect(findExtensionArrangementRefusals({
      manifest: { id: VENDOR },
      objectExtensions: [{ extend: 'crm_account', fields: { tier: { type: 'text' } }, place: [{ field: 'tier', group: 'basic' }] }],
    })).toEqual([]);
  });

  it('a `packages[]` artifact: each entry is judged under its own id, located under its entry', () => {
    const rows = findExtensionArrangementRefusals({
      manifest: { id: 'com.acme.bundle' },
      packages: [
        { manifest: { id: PAIR, objectExtensions: extensions } },
        { manifest: { id: VENDOR, objectExtensions: [{ extend: 'crm_account', relatedLists: TABS }] } },
      ],
    });
    expect(rows.map((r) => [r.path, r.packageId])).toEqual([
      ['packages[1].manifest.objectExtensions[0].relatedLists', VENDOR],
    ]);
  });

  it('a stack naming no package id is not judged', () => {
    expect(findExtensionArrangementRefusals({ objectExtensions: extensions })).toEqual([]);
  });
});
