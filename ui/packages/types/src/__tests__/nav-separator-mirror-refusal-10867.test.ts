/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The zod mirror refuses a separator key the spec's separator does not declare
 * (objectui#10867).
 *
 * `NavigationItemSchema` is one flat object, so it declares `label`, `icon` and
 * the rest for every item type, and its refinement's separator branch used to
 * return early. `objectui validate` therefore passed `{ type: 'separator',
 * label }`, which `@objectstack/spec`'s strict separator branch (`type`, `id`,
 * `order`) refuses, so the platform's save door answered 422. The branch now
 * refuses every key outside the set it reads off the spec's own separator arm.
 *
 * Pinned on both published faces: `safeValidateSchema` (the tolerant node face)
 * and `StrictAnyComponentSchema` (the strict authoring face), plus the mirror
 * itself.
 */

import { describe, it, expect } from 'vitest';
import { NavigationItemSchema as SpecNavigationItemSchema } from '@objectstack/spec/ui';
import { NavigationItemSchema } from '../zod/app.zod';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';

type Issue = { code: string; path: string; message: string };
const issuesOf = (r: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }): Issue[] | null =>
  r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));

const app = (navigation: unknown[]) => ({ type: 'app', name: 'acme_crm', label: 'Acme CRM', navigation });
const OBJECT_ENTRY = { id: 'account', type: 'object', label: 'Accounts', objectName: 'account' };
const LABELLED = { id: 'sep_1', type: 'separator', label: 'Section' };
const BARE = { id: 'sep_1', type: 'separator' };

describe('objectui#10867 — a separator `label` is refused on every published face', () => {
  it('`safeValidateSchema` refuses it with one issue at the label, naming the fix', () => {
    const issues = issuesOf(safeValidateSchema(app([OBJECT_ENTRY, LABELLED])));
    expect(issues).not.toBeNull();
    const atLabel = issues!.filter((i) => i.path.endsWith('navigation.1.label'));
    expect(atLabel).toHaveLength(1);
    expect(atLabel[0].code).toBe('custom');
    expect(atLabel[0].message).toContain('drop `label`');
  });

  it('the strict authoring face refuses it too', () => {
    const issues = issuesOf(StrictAnyComponentSchema.safeParse(app([OBJECT_ENTRY, LABELLED])));
    expect(issues).not.toBeNull();
    expect(issues!.some((i) => i.path.endsWith('navigation.1.label') && i.code === 'custom')).toBe(true);
  });

  it('the mirror refuses every entry-only key on a separator, each at its own path', () => {
    const issues = issuesOf(NavigationItemSchema.safeParse({ ...BARE, label: 'Section', icon: 'Minus', pinned: true }));
    expect(issues!.map((i) => [i.code, i.path])).toEqual([
      ['custom', 'label'],
      ['custom', 'icon'],
      ['custom', 'pinned'],
    ]);
  });

  it('CONTROL — a bare `{ id, type: separator }` (and one with `order`) is accepted by both faces and the spec', () => {
    for (const separator of [BARE, { ...BARE, order: 3 }]) {
      expect(issuesOf(safeValidateSchema(app([OBJECT_ENTRY, separator])))).toBeNull();
      expect(issuesOf(StrictAnyComponentSchema.safeParse(app([OBJECT_ENTRY, separator])))).toBeNull();
      expect(SpecNavigationItemSchema.safeParse(separator).success).toBe(true);
    }
  });

  it('CONTROL — the spec refuses the same `label`, so the faces now agree with it', () => {
    expect(SpecNavigationItemSchema.safeParse(LABELLED).success).toBe(false);
  });

  it('CONTROL — an entry keeps its `label`, so the refusal is scoped to the separator', () => {
    expect(issuesOf(safeValidateSchema(app([OBJECT_ENTRY])))).toBeNull();
  });
});
