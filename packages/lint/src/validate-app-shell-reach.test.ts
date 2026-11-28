// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#35143] The app shell an author ships: an app with no navigation entry, an
// object no app opens, and an object navigation opens with no list view. All
// three advisory; each pinned lit and dark, through the registry and, for the
// app, at the runtime `app` door.

import { describe, expect, it } from 'vitest';

import { authoringRulesFor, runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import {
  APP_NAVIGATION_EMPTY,
  OBJECT_UNREACHABLE_FROM_NAVIGATION,
  OBJECT_WITHOUT_VIEW,
  validateAppNavigationPresent,
  validateObjectShellReach,
} from './validate-app-shell-reach.js';

type AnyRec = Record<string, unknown>;

const objects = [
  { name: 'crm_account', label: 'Account', fields: { name: { type: 'text' } } },
  { name: 'crm_note', label: 'Note', fields: { body: { type: 'text' } } },
];
const navTo = (objectName: string) => ({ id: `nav_${objectName}`, type: 'object', label: objectName, objectName });
const accountView = { name: 'crm_account', object: 'crm_account', list: { type: 'grid', columns: ['name'] } };

describe('[#35143] app-navigation-empty', () => {
  const findings = (apps: unknown, extra: AnyRec = {}) =>
    validateAppNavigationPresent({ objects, apps, ...extra }).map((f) => [f.rule, f.severity, f.path]);

  it.each([
    ['no `navigation` key', { name: 'crm', label: 'CRM' }],
    ['an empty `navigation`', { name: 'crm', label: 'CRM', navigation: [] }],
    ['only a separator and an empty group', {
      name: 'crm',
      label: 'CRM',
      navigation: [{ id: 's', type: 'separator' }, { id: 'g', type: 'group', label: 'G', children: [] }],
    }],
    ['an area with no entry', { name: 'crm', label: 'CRM', areas: [{ id: 'a', label: 'A', navigation: [] }] }],
  ])('warns on %s', (_label, app) => {
    expect(findings([app])).toEqual([[APP_NAVIGATION_EMPTY, 'warning', 'apps[0].navigation']]);
  });

  it.each([
    ['a top-level entry', { name: 'crm', label: 'CRM', navigation: [navTo('crm_account')] }],
    ['an entry inside a group', {
      name: 'crm',
      label: 'CRM',
      navigation: [{ id: 'g', type: 'group', label: 'G', children: [navTo('crm_account')] }],
    }],
    ['an entry in an area', { name: 'crm', label: 'CRM', areas: [{ id: 'a', label: 'A', navigation: [navTo('crm_account')] }] }],
  ])('is silent with %s', (_label, app) => {
    expect(findings([app])).toEqual([]);
  });

  it('counts navigation this stack contributes into the app', () => {
    const navigationContributions = [{ app: 'crm', items: [navTo('crm_account')] }];
    expect(findings([{ name: 'crm', label: 'CRM' }], { manifest: { id: 'p', navigationContributions } })).toEqual([]);
  });

  it('is advisory on `validate` and `build`, and the hint names the fix', () => {
    for (const command of ['validate', 'build'] as const) {
      const all = runAuthoringRules(command, { normalized: { objects, apps: [{ name: 'crm', label: 'CRM' }] } });
      const { errors, advisories } = splitBySeverity(all);
      expect(advisories.map((f) => f.rule)).toContain(APP_NAVIGATION_EMPTY);
      expect(errors.map((f) => f.rule)).not.toContain(APP_NAVIGATION_EMPTY);
    }
    const [f] = validateAppNavigationPresent({ apps: [{ name: 'crm', label: 'CRM' }] });
    expect(f.hint).toContain("type: 'object'");
  });

  it('rides the runtime `app` door as an advisory, and is silent once the app has an entry', () => {
    expect(runtimeAuthoringRulesFor('app').map((r) => r.name)).toContain('validateAppNavigationPresent');
    const lit = runRuntimeAuthoringRules({ type: 'app', item: { name: 'ops_desk', label: 'Ops' }, context: { objects } });
    expect(lit.errors).toEqual([]);
    expect(lit.advisories.map((f) => f.rule)).toEqual([APP_NAVIGATION_EMPTY]);
    const fixed = runRuntimeAuthoringRules({
      type: 'app',
      item: { name: 'ops_desk', label: 'Ops', navigation: [navTo('crm_account')] },
      context: { objects },
    });
    expect(fixed.advisories.map((f) => f.rule)).not.toContain(APP_NAVIGATION_EMPTY);
  });
});

describe('[#35143] object-unreachable-from-navigation and object-without-view', () => {
  const run = (stack: AnyRec) => validateObjectShellReach(stack).map((f) => [f.rule, f.path]);
  const app = (...nav: unknown[]) => ({ name: 'crm', label: 'CRM', navigation: nav });

  it('an object no app names is a warning at the object; one navigation opens with a view is silent', () => {
    expect(run({ objects, views: [accountView], apps: [app(navTo('crm_account'))] })).toEqual([
      [OBJECT_UNREACHABLE_FROM_NAVIGATION, 'objects[1]'],
    ]);
  });

  it('reach counts entries at any depth, in areas and in contributed navigation', () => {
    const grouped = app({ id: 'g', type: 'group', label: 'G', children: [navTo('crm_note')] }, navTo('crm_account'));
    expect(run({ objects, views: [accountView, { ...accountView, name: 'n', object: 'crm_note' }], apps: [grouped] })).toEqual([]);
    const contributed = {
      objects,
      views: [accountView, { ...accountView, name: 'n', object: 'crm_note' }],
      apps: [app(navTo('crm_account'))],
      manifest: { id: 'p', navigationContributions: [{ app: 'setup', items: [navTo('crm_note')] }] },
    };
    expect(run(contributed)).toEqual([]);
  });

  it('in an assembled artifact, navigation a package contributes counts, and package objects are left to the per-package run', () => {
    const artifact = {
      objects: [objects[0]],
      views: [accountView],
      packages: [
        { manifest: { id: 'orders', navigationContributions: [{ app: 'crm', items: [navTo('crm_account')] }] } },
        { manifest: { id: 'core', apps: [app()], objects: [objects[1]] } },
      ],
    };
    expect(run(artifact)).toEqual([]);
    expect(validateAppNavigationPresent(artifact)).toEqual([]);
  });

  it('an object another object lists in `relatedLists`, or that a page navigation opens names, is not judged', () => {
    const parent = { ...objects[0], relatedLists: ['crm_note.account'] };
    const nav = { objects: [parent, objects[1]], views: [accountView], apps: [app(navTo('crm_account'))] };
    expect(run(nav)).toEqual([]);
    const objectForm = { ...objects[0], relatedLists: [{ list: 'crm_note', label: 'Notes' }] };
    expect(run({ ...nav, objects: [objectForm, objects[1]] })).toEqual([]);
    const pageEntry = { id: 'p', type: 'page', label: 'Notes', pageName: 'notes_page' };
    const page = { name: 'notes_page', regions: [{ components: [{ type: 'object:list', properties: { objectName: 'crm_note' } }] }] };
    const viaPage = { objects, views: [accountView], pages: [page], apps: [app(navTo('crm_account'), pageEntry)] };
    expect(run(viaPage)).toEqual([]);
    // A page no entry opens reaches nothing.
    expect(run({ ...viaPage, apps: [app(navTo('crm_account'))] })).toEqual([[OBJECT_UNREACHABLE_FROM_NAVIGATION, 'objects[1]']]);
  });

  it('a master-detail child and an API-disabled object are not judged; a stack with no app is not judged', () => {
    const child = { name: 'crm_note', fields: { account: { type: 'master_detail', reference: 'crm_account' } } };
    const hidden = { name: 'crm_log', enable: { apiEnabled: false }, fields: { body: { type: 'text' } } };
    expect(run({ objects: [objects[0], child, hidden], views: [accountView], apps: [app(navTo('crm_account'))] })).toEqual([]);
    expect(run({ objects })).toEqual([]);
  });

  it.each([
    ['an object `listViews` entry', { objects: [{ ...objects[0], listViews: { all: { type: 'grid', columns: ['name'] } } }] }],
    ['a `views` item', { objects: [objects[0]], views: [accountView] }],
    ['a flattened list overlay', { objects: [objects[0]], views: [{ name: 'a.x', object: 'crm_account', viewKind: 'list', columns: ['name'] }] }],
  ])('an object opened from navigation with %s has a view', (_label, stack) => {
    expect(run({ ...stack, apps: [app(navTo('crm_account'))] })).toEqual([]);
  });

  it('an object opened from navigation with no view is a warning that names the fix', () => {
    const findings = validateObjectShellReach({ objects: [objects[0]], apps: [app(navTo('crm_account'))] });
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([[OBJECT_WITHOUT_VIEW, 'warning', 'objects[0]']]);
    expect(findings[0].message).toContain('All records');
    expect(findings[0].hint).toContain('listViews:');
  });

  it('an entry that opens one record (`recordId`) shows no list, so no view is owed', () => {
    const recordEntry = { ...navTo('crm_account'), recordId: '{current_user_id}' };
    expect(run({ objects: [objects[0]], apps: [app(recordEntry)] })).toEqual([]);
  });

  it('the object `list` key is not a list view: `ObjectSchema` declares `listViews`', () => {
    const stray = { objects: [{ ...objects[0], list: { type: 'grid', columns: ['name'] } }], apps: [app(navTo('crm_account'))] };
    expect(run(stray)).toEqual([[OBJECT_WITHOUT_VIEW, 'objects[0]']]);
  });

  it('runs on all three commands as an advisory, and never at the runtime door', () => {
    for (const command of ['validate', 'build', 'lint'] as const) {
      expect(authoringRulesFor(command).map((r) => r.name)).toContain('validateObjectShellReach');
      const { errors, advisories } = splitBySeverity(
        runAuthoringRules(command, { normalized: { objects, apps: [app(navTo('crm_account'))] } }),
      );
      expect(advisories.map((f) => f.rule)).toEqual(expect.arrayContaining([OBJECT_UNREACHABLE_FROM_NAVIGATION, OBJECT_WITHOUT_VIEW]));
      expect(errors.map((f) => f.rule)).not.toContain(OBJECT_WITHOUT_VIEW);
    }
    for (const type of ['object', 'app', 'view']) {
      expect(runtimeAuthoringRulesFor(type).map((r) => r.name)).not.toContain('validateObjectShellReach');
    }
  });
});

describe('[#35143] `os explain` for the app-shell ids', () => {
  it.each([APP_NAVIGATION_EMPTY, OBJECT_UNREACHABLE_FROM_NAVIGATION, OBJECT_WITHOUT_VIEW])('%s has an entry', (rule) => {
    expect(explainRule(rule)?.paragraphs.length).toBeGreaterThan(0);
  });
});
