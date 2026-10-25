/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A navigation separator carries only the spec separator's keys, and the
 * wizard draft carries no `layout` (objectui#10867).
 *
 * `wizardDraftToAppSchema` feeds `client.meta.saveItem('app', …)`, which the
 * platform judges with `@objectstack/spec`'s strict `AppSchema`. The spec's
 * separator branch declares `type`, `id` and `order`; objectui's
 * `NavigationItem` required a `label` on every item, so every separator the
 * Studio wrote carried one and the save was refused (`unrecognized_keys`
 * `['label']` at `navigation.N`). `NavigationItem` is now a union whose
 * separator arm admits exactly the spec's keys.
 *
 * The compile-time halves (`@ts-expect-error`, `satisfies`) run under
 * `tsc -p tsconfig.test.json`; the runtime halves under vitest.
 */

import { describe, it, expect } from 'vitest';
import {
  AppSchema as SpecAppSchema,
  NavigationItemSchema as SpecNavigationItemSchema,
} from '@objectstack/spec/ui';
import { menuItemToNavigationItem, wizardDraftToAppSchema } from '../index';
import type { AppWizardDraft, NavigationItem } from '../index';

/** The spec's issues for a document, as `code` plus the path and keys it names. */
const specIssues = (doc: unknown) => {
  const r = SpecAppSchema.safeParse(doc);
  return r.success
    ? null
    : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), keys: (i as { keys?: string[] }).keys }));
};

const OBJECT_ENTRY: NavigationItem = { id: 'account', type: 'object', label: 'Accounts', objectName: 'account' };
const GROUP_ENTRY: NavigationItem = { id: 'group_1', type: 'group', label: 'New Group', children: [] };

/** A draft the way `AppCreationWizard` builds it, with one separator. */
const DRAFT: AppWizardDraft = {
  name: 'acme_crm',
  title: 'Acme CRM',
  objects: [],
  navigation: [OBJECT_ENTRY, { id: 'separator_1', type: 'separator' }, GROUP_ENTRY],
  branding: { primaryColor: '#2563eb' },
};

describe('objectui#10867 — a separator carries only `type`, `id` and `order`', () => {
  it('a wizard draft with a separator converts to a document the spec `AppSchema` accepts', () => {
    expect(specIssues(wizardDraftToAppSchema(DRAFT))).toBeNull();
  });

  it('CONTROL — the separator the wizard used to write is refused at its own path', () => {
    const doc = {
      ...wizardDraftToAppSchema(DRAFT),
      navigation: [OBJECT_ENTRY, { id: 'separator_1', type: 'separator', label: '' }, GROUP_ENTRY],
    };
    expect(specIssues(doc)).toEqual([{ code: 'unrecognized_keys', path: 'navigation.1', keys: ['label'] }]);
  });

  it('`menuItemToNavigationItem` maps a legacy separator to the spec separator shape', () => {
    const item = menuItemToNavigationItem({ type: 'separator', label: 'Section' });
    expect(item).toEqual({ id: 'migrated_0', type: 'separator' });
    expect(SpecNavigationItemSchema.safeParse(item).success).toBe(true);
  });

  it('a `label` on a separator is a compile error; a bare separator is not', () => {
    // @ts-expect-error — a separator admits only `type`, `id` and `order`.
    const labelled: NavigationItem = { id: 'sep', type: 'separator', label: '' };
    const bare: NavigationItem = { id: 'sep', type: 'separator', order: 3 };
    expect(labelled.type).toBe(bare.type);
  });

  it('CONTROL — an entry still requires its `id`; its `label` is optional since objectui#9868', () => {
    // INVERTED by objectui#9868 — this line carried `@ts-expect-error — an entry
    // without a label`. `@objectstack/spec` 17.5.0 made an entry's `label`
    // optional (absent ⇒ inherited from its target at render time), so an
    // unlabelled entry compiles now, while a labelled SEPARATOR above still
    // does not.
    const unlabelled: NavigationItem = { id: 'account', type: 'object', objectName: 'account' };
    // @ts-expect-error — an entry without an `id`: identity is still required.
    const anonymous: NavigationItem = { type: 'object', objectName: 'account', label: 'Accounts' };
    expect(unlabelled.type).toBe(anonymous.type);
  });
});

describe('objectui#10867 — the wizard draft carries no `layout`', () => {
  it('`layout` is not a key of `AppWizardDraft`', () => {
    const noLayout = false satisfies 'layout' extends keyof AppWizardDraft ? true : false;
    // @ts-expect-error — the Layout control persisted nothing and was removed with this member.
    const withLayout: AppWizardDraft = { ...DRAFT, layout: 'sidebar' };
    expect(noLayout).toBe(false);
    expect(withLayout.name).toBe('acme_crm');
  });
});
