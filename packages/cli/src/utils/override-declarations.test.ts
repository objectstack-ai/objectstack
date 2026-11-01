// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D2, #28410] `findOverrideDeclarationRefusals` — the WALK `os
 * validate` runs the override write gate's judge over.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeOverrideWrite`, the
 * function the publish doors ask; the protocol's own file pins its sentences.
 * What is pinned here is which items the walk hands the judge, under which
 * package and against which closure: every row's message is asserted EQUAL to
 * the judge's answer for the same subject, never re-spelled.
 */

import { describe, expect, it } from 'vitest';
import { judgeOverrideWrite } from '@objectstack/metadata-protocol';
import { findOverrideDeclarationRefusals } from './override-declarations.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const PARTNER = 'com.acme.partner';

const manifest = (id: string, dependencies: string[] = []) => ({
  id, name: id, version: '1.0.0', type: 'app',
  ...(dependencies.length ? { dependencies: Object.fromEntries(dependencies.map((d) => [d, '*'])) } : {}),
});
const pkg = (id: string, dependencies: string[], collections: Record<string, unknown>) =>
  ({ manifest: { ...manifest(id, dependencies), ...collections } });

const base = pkg(BASE, [], {
  dashboards: [{ name: 'crm_board', label: 'Board' }],
  pages: [{ name: 'crm_home', label: 'Home' }],
  actions: [{ name: 'log_call', objectName: 'crm_account', label: 'Log' }],
});

const judged = (type: string, name: string, packageId: string, item: unknown, dependencies: string[], shippers: string[]) => {
  const v = judgeOverrideWrite({ type, name, packageId, item }, { dependencies, shippers });
  if (v.verdict !== 'refuse') throw new Error(`expected a refusal, got ${v.verdict}`);
  return v.message;
};

describe('#28410 — findOverrideDeclarationRefusals walks the artifact under the publish door\'s judge', () => {
  it('a partner\'s item bearing a name the base in its closure ships is refused, in the judge\'s words', () => {
    const item = { name: 'crm_board', label: 'Mine' };
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [base, pkg(PARTNER, [BASE], { dashboards: [item] })],
    });
    expect(rows).toEqual([{
      path: 'packages[1].manifest.dashboards[0]',
      code: 'NOT_OVERRIDABLE',
      rule: 'undeclared_same_name',
      packageId: PARTNER,
      message: judged('dashboard', 'crm_board', PARTNER, item, [BASE], [BASE]),
    }]);
  });

  it('the closure is transitive through the artifact\'s packages', () => {
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [base, pkg('com.acme.mid', [BASE], {}), pkg(PARTNER, ['com.acme.mid'], { pages: [{ name: 'crm_home' }] })],
    });
    expect(rows.map((r) => [r.packageId, r.rule])).toEqual([[PARTNER, 'undeclared_same_name']]);
  });

  it('controls: a package outside the closure, an own name, and an action on another object are not refused', () => {
    expect(findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [
        base,
        pkg('com.other', [], { dashboards: [{ name: 'crm_board' }] }),
        pkg(PARTNER, [BASE], {
          dashboards: [{ name: 'partner_board' }],
          actions: [{ name: 'log_call', objectName: 'partner_lead', label: 'Log' }],
        }),
      ],
    })).toEqual([]);
  });

  it('the pair\'s declared override is admitted; its undeclared same name is told to declare or rename', () => {
    const declared = { name: 'crm_board', overrides: { package: BASE, basedOn: '1.0.0' } };
    const undeclared = { name: 'crm_home' };
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [base, pkg(PAIR, [BASE], { dashboards: [declared], pages: [undeclared] })],
    });
    expect(rows).toEqual([{
      path: 'packages[1].manifest.pages[0]',
      code: 'NOT_OVERRIDABLE',
      rule: 'undeclared_same_name',
      packageId: PAIR,
      message: judged('page', 'crm_home', PAIR, undeclared, [BASE], [BASE]),
    }]);
    expect(rows[0].message).toMatch(/Declare it/);
  });

  it('a one-package .custom stack whose base is installed elsewhere: declarations are judged, the shipped name is left to the door', () => {
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest(PAIR, [BASE]),
      dashboards: [{ name: 'crm_board', overrides: { package: BASE, basedOn: '1.0.0' } }],
      objects: [{ name: 'crm_account', overrides: { package: BASE, basedOn: '1.0.0' } }],
      flows: [{ name: 'crm_flow', overrides: { package: BASE, basedOn: '1.0.0' } }],
      pages: [{ name: 'crm_home', overrides: { package: 'com.unlisted', basedOn: '1.0.0' } }],
    });
    expect(rows.map((r) => [r.path, r.rule])).toEqual([
      ['objects[0]', 'declared_object'],
      ['flows[0]', 'declared_flow_not_yet_available'],
      ['pages[0]', 'declared_outside_pair'],
    ]);
  });

  it('a dependent carrying `overrides` is refused, and a declaration of an item the base does not ship is refused', () => {
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [
        base,
        pkg(PARTNER, [BASE], { dashboards: [{ name: 'crm_board', overrides: { package: BASE, basedOn: '1.0.0' } }] }),
        pkg(PAIR, [BASE], { dashboards: [{ name: 'no_such_board', overrides: { package: BASE, basedOn: '1.0.0' } }] }),
      ],
    });
    expect(rows.map((r) => [r.packageId, r.rule])).toEqual([
      [PARTNER, 'declared_outside_pair'],
      [PAIR, 'declared_package_ships_no_such_item'],
    ]);
  });

  it('a pair that does not depend on its base is told to declare the dependency', () => {
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [base, pkg(PAIR, [], { dashboards: [{ name: 'crm_board', overrides: { package: BASE, basedOn: '1.0.0' } }] })],
    });
    expect(rows.map((r) => r.rule)).toEqual(['declared_package_outside_closure']);
    expect(rows[0].message).toMatch(/Declare a dependency on 'com\.acme\.crm'/);
  });
});
