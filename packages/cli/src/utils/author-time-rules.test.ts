// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `judgeAuthorTimeRules`, the author-time rule stage `os verify` runs
 * first (#21323), reaches the two seams a hand-wired copy of the pipeline is
 * likeliest to drop.
 *
 * `test/verify-author-time-stage.test.ts` holds the stage to `os validate`'s
 * verdict through the real CLI, on a single-package stack. A single-package
 * stack cannot tell whether the stage folds `packages[]` into the union run
 * (#17069 — without the fold an option-B project is judged as an EMPTY stack
 * and passes) or runs the per-package pass at all (#18677 / #18778), because
 * neither changes anything when there is no `packages[]`. These cases can.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeAuthorTimeRules, VERIFY_RULE_COMMAND } from './author-time-rules.js';

/** The `where` prefix `runPerPackageAuthoringRules` puts on every finding it raises. */
const PER_PACKAGE_WHERE = /^package '[^']+' — /;

/**
 * An option-B project: no top-level `objects`, one `packages[]` entry carrying
 * an object whose `ghost` lookup points at `reference`.
 */
const optionBStack = (reference: string): Record<string, unknown> => ({
  manifest: { id: 'com.example.ob', name: 'ob', version: '1.0.0', type: 'app', namespace: 'ob' },
  packages: [
    {
      manifest: {
        id: 'com.example.ob',
        name: 'ob',
        version: '1.0.0',
        type: 'app',
        namespace: 'ob',
        objects: [
          {
            name: 'ob_order',
            label: 'Order',
            sharingModel: 'private',
            fields: {
              number: { type: 'text', label: 'Number' },
              ghost: { type: 'lookup', label: 'Ghost', reference },
            },
          },
        ],
      },
    },
  ],
});

/**
 * A two-package artifact whose union run is clean of the finding its
 * per-package run raises: `core` owns `ob_account.industry`, and only
 * `orders` displays it. Folded into one union the field has a consumer;
 * judged per package, `core` declares a field nothing in `core` reads.
 */
const perPackageOnlyStack = (): Record<string, unknown> => {
  const coreManifest = {
    id: 'com.example.obflip.core', name: 'obflip core', namespace: 'ob',
    version: '1.0.0', type: 'app', engines: { protocol: '^17' },
  };
  const coreObjects = [{
    name: 'ob_account', label: 'Account', pluralLabel: 'Accounts', sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Account Name', required: true },
      industry: { name: 'industry', type: 'text', label: 'Industry' },
    },
  }];
  const coreApps = [{
    name: 'ob_crm', label: 'OB CRM',
    navigation: [{
      id: 'sales_group', type: 'group', label: 'Sales',
      children: [{ id: 'nav_accounts', type: 'object', objectName: 'ob_account', label: 'Accounts' }],
    }],
  }];
  const ordersManifest = {
    id: 'com.example.obflip.orders', name: 'obflip orders', namespace: 'ob',
    version: '1.0.0', type: 'module', engines: { protocol: '^17' },
    dependencies: { 'com.example.obflip.core': '^1.0.0' },
  };
  const ordersObjects = [{
    name: 'ob_order', label: 'Order', pluralLabel: 'Orders', sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Order Number', required: true },
      account: { name: 'account', type: 'lookup', label: 'Account', reference: 'ob_account' },
    },
  }];
  const ordersViews = [
    { name: 'ob_account', label: 'Account List', object: 'ob_account', list: { label: 'Account List', columns: ['name', 'industry'] } },
    { name: 'ob_order', label: 'Order List', object: 'ob_order', list: { label: 'Order List', columns: ['name', 'account'] } },
  ];
  return {
    manifest: coreManifest,
    objects: [...ordersObjects, ...coreObjects],
    apps: [...coreApps],
    views: [...ordersViews],
    packages: [
      { manifest: { ...ordersManifest, objects: ordersObjects, views: ordersViews } },
      { manifest: { ...coreManifest, objects: coreObjects, apps: coreApps } },
    ],
  };
};

describe('judgeAuthorTimeRules — the stage os verify runs first (#21323)', () => {
  let configDir: string;
  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'os-author-time-rules-'));
  });
  afterAll(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('asks the registry door os validate asks', () => {
    expect(VERIFY_RULE_COMMAND).toBe('validate');
  });

  it('folds packages[] into the union run: an option-B project is not judged as an empty stack', () => {
    const refused = judgeAuthorTimeRules(VERIFY_RULE_COMMAND, optionBStack('ob_ghost_target'), configDir);
    expect(refused.refusal?.stage).toBe('rules');
    const errors = refused.refusal?.stage === 'rules' ? refused.refusal.errors : [];
    expect(errors.map((f) => [f.rule, f.path])).toContainEqual([
      'object-reference-unknown',
      'objects[0].fields.ghost.reference',
    ]);

    // Control: the same project with the lookup pointed at its own object.
    expect(judgeAuthorTimeRules(VERIFY_RULE_COMMAND, optionBStack('ob_order'), configDir).refusal).toBeNull();
  });

  it('runs the per-package pass: a finding only a package-scoped judgement raises reaches the verdict', () => {
    const verdict = judgeAuthorTimeRules(VERIFY_RULE_COMMAND, perPackageOnlyStack(), configDir);
    expect(verdict.refusal).toBeNull();
    const perPackage = verdict.advisories.filter((f) => PER_PACKAGE_WHERE.test(f.where));
    expect(perPackage.map((f) => f.rule)).toContain('field-no-consumers');
    // [#22161] The verdict no longer restates the location; the field is named in `where`.
    expect(perPackage.some((f) => f.where.includes('field "industry"'))).toBe(true);
    // ...and the union run did not raise it, so the pass is the only source.
    const union = verdict.advisories.filter((f) => !PER_PACKAGE_WHERE.test(f.where));
    expect(union.some((f) => f.rule === 'field-no-consumers' && f.where.includes('field "industry"'))).toBe(false);
  });

  it('refuses a stack that does not parse — there is no rule verdict to give about it', () => {
    const verdict = judgeAuthorTimeRules(
      VERIFY_RULE_COMMAND,
      { manifest: { id: 'com.example.bad', name: 'bad', version: '1.0.0', type: 'app', namespace: 'bad' }, objects: [{ name: 'bad_thing', fields: 'not-a-field-map' }] },
      configDir,
    );
    expect(verdict.refusal?.stage).toBe('schema');
    expect(verdict.refusal?.stage === 'schema' ? verdict.refusal.error.issues.length : 0).toBeGreaterThan(0);
  });
});
