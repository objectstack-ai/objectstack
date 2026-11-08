// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The schema upgrade verdict (epic cloud#3652 Q3): which plan findings need
 * the installer's confirmation, and the finding set's token — the one rule
 * the install-local door and a host's install door both apply.
 */

import { describe, expect, it } from 'vitest';
import { comparePackageVersions } from './package-upgrade-plan.js';
import {
  installedRecordUnavailableVerdict,
  schemaUpgradeFindingSet,
  schemaUpgradeVerdict,
  SCHEMA_UPGRADE_CONFIRMATION_REQUIRED,
  SCHEMA_UPGRADE_CONFIRMATION_STATUS,
} from './package-upgrade-verdict.js';

type Fields = Record<string, Record<string, unknown>>;

const side = (fields: Fields) => ({ objects: [{ name: 'acme_deal', fields }] });
const verdictOf = (before: Fields, after: Fields, packageId = 'com.acme.deals') =>
  schemaUpgradeVerdict(packageId, comparePackageVersions(side(before), side(after)));

describe('which findings need confirming', () => {
  it('a suspected rename is one finding naming every candidate', () => {
    const verdict = verdictOf({ amount: { type: 'number' } }, { total: { type: 'number' } });
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]).toMatchObject({
      kind: 'suspected_rename', object: 'acme_deal', field: 'amount', type: 'number',
      candidates: [{ field: 'total', type: 'number' }],
    });
    expect(verdict.findingSet).toMatch(/^schema-upgrade:[0-9a-f]{32}$/);
  });

  it('a declared rename is no finding', () => {
    const verdict = verdictOf({ amount: { type: 'number' } }, { total: { type: 'number', renamedFrom: ['amount'] } });
    expect(verdict.findings).toEqual([]);
  });

  it('a declared rename that also changes a stored type still needs the type change confirmed', () => {
    const verdict = verdictOf({ amount: { type: 'number' } }, { total: { type: 'text', renamedFrom: ['amount'] } });
    expect(verdict.findings).toEqual([expect.objectContaining({
      kind: 'type_change', field: 'total', from: 'number', to: 'text', category: 'needs_confirm', renamedFrom: 'amount',
    })]);
  });

  it('a safe type change, a removed field and an added field are refused by nothing', () => {
    // `formula` stores no column: retyping it to a stored type loses nothing.
    expect(verdictOf({ score: { type: 'formula' } }, { score: { type: 'number' } }).findings).toEqual([]);
    expect(verdictOf({ a: { type: 'text' }, b: { type: 'text' } }, { a: { type: 'text' } }).findings).toEqual([]);
    expect(verdictOf({ a: { type: 'text' } }, { a: { type: 'text' }, b: { type: 'text' } }).findings).toEqual([]);
  });
});

describe('the finding set token', () => {
  it('is the same for the same two versions, whatever the declaration order', () => {
    const a = verdictOf({ x: { type: 'text' }, y: { type: 'text' } }, { p: { type: 'text' }, q: { type: 'text' } });
    const b = verdictOf({ y: { type: 'text' }, x: { type: 'text' } }, { q: { type: 'text' }, p: { type: 'text' } });
    expect(b.findingSet).toBe(a.findingSet);
  });

  it('names the package: the same findings on another package carry another token', () => {
    const fields: [Fields, Fields] = [{ amount: { type: 'number' } }, { total: { type: 'number' } }];
    expect(verdictOf(...fields, 'com.acme.other').findingSet).not.toBe(verdictOf(...fields).findingSet);
  });

  it('reads identities only: a sentence or a row count changes nothing', () => {
    const { findings, findingSet } = verdictOf({ amount: { type: 'number' } }, { total: { type: 'number' } });
    const read = findings.map((f) => ({ ...f, describe: 'another sentence', rows: 12 }));
    expect(schemaUpgradeFindingSet('com.acme.deals', read)).toBe(findingSet);
  });

  it('is pinned byte for byte: a token a refusal handed out keeps confirming the findings it was issued for', () => {
    // These values were minted by the install-local door's own digest before
    // it moved here. A change to the digest's input or form invalidates every
    // token already handed out, on every door: it is a change of the token
    // contract, never a refactor.
    expect(verdictOf({ amount: { type: 'number' } }, { total: { type: 'number' } }).findingSet)
      .toBe('schema-upgrade:a168d8927e7a5afc25f947ee715fa848');
    expect(schemaUpgradeFindingSet('com.acme.deals', [])).toBe('schema-upgrade:c29494e0b3b3e33a84adf0c2188baa37');
  });
});

describe('no installed side to compare', () => {
  it('is one confirmable finding, never no finding', () => {
    const verdict = installedRecordUnavailableVerdict('com.acme.deals', { kind: 'installed_record_missing', describe: 'none held' });
    expect(verdict.findings).toEqual([{ kind: 'installed_record_missing', describe: 'none held' }]);
    expect(verdict.findingSet).toBe(schemaUpgradeFindingSet('com.acme.deals', [{ kind: 'installed_record_missing', describe: '' }]));
  });
});

it('answers with the ledger code at 409', () => {
  expect(SCHEMA_UPGRADE_CONFIRMATION_REQUIRED).toBe('SCHEMA_UPGRADE_CONFIRMATION_REQUIRED');
  expect(SCHEMA_UPGRADE_CONFIRMATION_STATUS).toBe(409);
});
