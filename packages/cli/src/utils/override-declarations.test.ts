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
      // [#28412, #30065, ADR-0146 D9] Declared flow and action overrides are
      // admitted (their D9 conditions are delivered).
      flows: [{ name: 'crm_flow', overrides: { package: BASE, basedOn: '1.0.0' } }],
      actions: [{ name: 'crm_call', objectName: 'crm_account', label: 'Call', overrides: { package: BASE, basedOn: '1.0.0' } }],
      pages: [{ name: 'crm_home', overrides: { package: 'com.unlisted', basedOn: '1.0.0' } }],
    });
    expect(rows.map((r) => [r.path, r.rule])).toEqual([
      ['objects[0]', 'declared_object'],
      ['pages[0]', 'declared_outside_pair'],
    ]);
  });

  it('[#30065] a declared action override is judged against the base\'s own action: a widening is refused, a narrowing admitted', () => {
    const gates = { requiredPermissions: ['crm_admin'], ai: { requiresConfirmation: true } };
    const gatedBase = pkg(BASE, [], { actions: [{ name: 'log_call', objectName: 'crm_account', label: 'Log', ...gates }] });
    const overrides = { package: BASE, basedOn: '1.0.0' };
    const wider = { name: 'log_call', objectName: 'crm_account', label: 'Ours', overrides, requiredPermissions: [], ai: { requiresConfirmation: true } };
    const narrower = { name: 'log_call', objectName: 'crm_account', label: 'Ours', overrides, ...gates, requiredPermissions: ['crm_admin', 'crm_auditor'] };
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [gatedBase, pkg(PAIR, [BASE], { actions: [wider] })],
    });
    expect(rows.map((r) => [r.path, r.code, r.rule])).toEqual([
      ['packages[1].manifest.actions[0]', 'NOT_OVERRIDABLE', 'declared_action_widens_access'],
    ]);
    expect(rows[0].message).toContain("drops 'crm_admin' from `requiredPermissions`");
    expect(findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [gatedBase, pkg(PAIR, [BASE], { actions: [narrower] })],
    })).toEqual([]);
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

  it('[#30623] an action override moved to another object is told both objects and to keep the base action\'s objectName; CONTROL: an unshipped name keeps the name sentence', () => {
    const overrides = { package: BASE, basedOn: '1.0.0' };
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [base, pkg(PAIR, [BASE], {
        actions: [
          { name: 'log_call', objectName: 'crm_lead', label: 'Ours', overrides },
          { name: 'no_such_call', objectName: 'crm_account', label: 'Ours', overrides },
        ],
      })],
    });
    expect(rows.map((r) => [r.path, r.code, r.rule])).toEqual([
      ['packages[1].manifest.actions[0]', 'NOT_OVERRIDABLE', 'declared_package_ships_no_such_item'],
      ['packages[1].manifest.actions[1]', 'NOT_OVERRIDABLE', 'declared_package_ships_no_such_item'],
    ]);
    expect(rows[0].message.split('. ')[0]).toBe(
      `'action/log_call' declares an override of '${BASE}' on object 'crm_lead', but '${BASE}' ships its action 'log_call' on object 'crm_account'`);
    expect(rows[0].message).toContain("keep the base action's `objectName: 'crm_account'` in the override");
    expect(rows[1].message.split('. ')[0]).toBe(
      `'action/no_such_call' declares an override of '${BASE}', which ships no action named 'no_such_call'`);
    expect(rows[1].message).toContain('or correct the name');
  });

  it('a pair that does not depend on its base is told to declare the dependency', () => {
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [base, pkg(PAIR, [], { dashboards: [{ name: 'crm_board', overrides: { package: BASE, basedOn: '1.0.0' } }] })],
    });
    expect(rows.map((r) => r.rule)).toEqual(['declared_package_outside_closure']);
    expect(rows[0].message).toMatch(/Declare a dependency on 'com\.acme\.crm'/);
  });

  // [#28746] An email template is one item per `(name, locale)`: the base
  // below ships `crm_welcome` in `en-US` only, so each member is judged alone.
  const templateBase = pkg(BASE, [], { emailTemplates: [{ name: 'crm_welcome', locale: 'en-US', subject: 'Welcome' }] });
  const declared = { package: BASE, basedOn: '1.0.0' } as const;

  it('[#28746] the pair declaring an override of a locale the base does not ship is refused', () => {
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [templateBase, pkg(PAIR, [BASE], {
        emailTemplates: [{ name: 'crm_welcome', locale: 'fr-FR', subject: 'Bienvenue', overrides: { ...declared } }],
      })],
    });
    expect(rows.map((r) => [r.path, r.packageId, r.rule])).toEqual([
      ['packages[1].manifest.emailTemplates[0]', PAIR, 'declared_package_ships_no_such_item'],
    ]);
  });

  it('[#28746] controls: the pair overrides the shipped locale and adds an undeclared locale of its own', () => {
    expect(findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [templateBase, pkg(PAIR, [BASE], {
        emailTemplates: [
          { name: 'crm_welcome', locale: 'en-US', subject: 'Ours', overrides: { ...declared } },
          { name: 'crm_welcome', locale: 'fr-FR', subject: 'Bienvenue' },
        ],
      })],
    })).toEqual([]);
  });

  it('[#28746] a dependent\'s template of the base\'s name collides only at a locale the base ships', () => {
    const rows = findOverrideDeclarationRefusals({
      manifest: manifest('com.acme.bundle'),
      packages: [templateBase, pkg(PARTNER, [BASE], {
        emailTemplates: [
          { name: 'crm_welcome', locale: 'en-US', subject: 'Partner' },
          { name: 'crm_welcome', locale: 'fr-FR', subject: 'Partenaire' },
        ],
      })],
    });
    expect(rows.map((r) => [r.path, r.rule])).toEqual([
      ['packages[1].manifest.emailTemplates[0]', 'undeclared_same_name'],
    ]);
  });
});
