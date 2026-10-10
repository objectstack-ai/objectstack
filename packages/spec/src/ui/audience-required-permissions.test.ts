// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22611 — a list view and a dashboard each take the platform's one audience
// key, `requiredPermissions` (ruling of record 6095014058, letter A): a list of
// capabilities, all required, with the app / navigation-item / action shape and
// meaning, and ONE describe shared by the two.
//
// Every accept pin is a full `safeParse` success (the value arm is part of what
// is declared, so "no `unrecognized_keys`" alone would stay green over a
// declaration that refused every value), and every refuse pin asserts the issue
// CODE and PATH, never a bare failure: before this change the key was refused
// as `unrecognized_keys` on both schemas, and a refusal that only says "false"
// could not tell that old refusal from the type refusal pinned here.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppSchema } from './app.zod';
import { AUDIENCE_REQUIRED_PERMISSIONS_DESCRIPTION } from './audience-required-permissions';
import { DashboardSchema } from './dashboard.zod';
import { ListViewSchema, ObjectListViewSchema, ViewItemSchema, ViewSchema } from './view.zod';

const GATE = ['clm_legal_workbench.view'];

/** A document legal on its own, per door — the baseline every case adds the key to. */
const DOORS: Record<string, { schema: z.ZodType; base: Record<string, unknown> }> = {
  'ListViewSchema': { schema: ListViewSchema, base: { type: 'grid', columns: ['name'] } },
  'ObjectListViewSchema (an object\'s `listViews` entry)': { schema: ObjectListViewSchema, base: { type: 'grid', columns: ['name'] } },
  'DashboardSchema': { schema: DashboardSchema, base: { name: 'legal_workbench', label: 'Legal Workbench', widgets: [] } },
};

const withKey = (base: Record<string, unknown>, value: unknown) => ({ ...base, requiredPermissions: value });

describe('#22611 — `requiredPermissions` on a list view and a dashboard', () => {
  for (const [door, { schema, base }] of Object.entries(DOORS)) {
    describe(door, () => {
      it('accepts a list of capabilities and keeps it verbatim', () => {
        const r = schema.safeParse(withKey(base, GATE));
        expect(r.success).toBe(true);
        expect((r.data as Record<string, unknown>).requiredPermissions).toEqual(GATE);
      });

      it('accepts the empty list, and carries NO schema default — an absent key stays absent', () => {
        const empty = schema.safeParse(withKey(base, []));
        expect(empty.success).toBe(true);
        expect((empty.data as Record<string, unknown>).requiredPermissions).toEqual([]);
        const absent = schema.safeParse(base);
        expect(absent.success).toBe(true);
        expect(absent.data as Record<string, unknown>).not.toHaveProperty('requiredPermissions');
      });

      it('refuses a non-array, a non-string member and an any-of object as TYPE errors at the key, never as unknown keys', () => {
        for (const bad of ['clm_legal_workbench.view', [1], { anyOf: GATE }] as unknown[]) {
          const r = schema.safeParse(withKey(base, bad));
          expect(r.success).toBe(false);
          const issues = r.error!.issues;
          expect(issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
          expect(issues.some((i) => i.code === 'invalid_type' && i.path[0] === 'requiredPermissions')).toBe(true);
        }
      });
    });
  }

  it('reaches the view container\'s `list` and named `listViews`, and the view item\'s `config`', () => {
    const container = ViewSchema.safeParse({
      list: { type: 'grid', columns: ['name'], requiredPermissions: GATE },
      listViews: { legal_queue: { type: 'grid', columns: ['name'], requiredPermissions: GATE } },
    });
    expect(container.success).toBe(true);
    const c = container.data as { list: { requiredPermissions?: string[] }; listViews: Record<string, { requiredPermissions?: string[] }> };
    expect(c.list.requiredPermissions).toEqual(GATE);
    expect(c.listViews.legal_queue.requiredPermissions).toEqual(GATE);

    const item = ViewItemSchema.safeParse({
      name: 'clm_contract.legal_queue',
      object: 'clm_contract',
      viewKind: 'list',
      config: { type: 'grid', data: { provider: 'object', object: 'clm_contract' }, columns: ['name'], requiredPermissions: GATE },
    });
    expect(item.success).toBe(true);
    expect((item.data as { config: { requiredPermissions?: string[] } }).config.requiredPermissions).toEqual(GATE);
  });

  it('one key, one text: both declarations are IDENTICAL — shape and describe, word for word — and carry the shared constant', () => {
    const view = ListViewSchema.shape.requiredPermissions;
    const dashboard = DashboardSchema.shape.requiredPermissions;
    const json = (s: z.ZodType) => JSON.stringify(z.toJSONSchema(s, { io: 'input' }));
    expect(json(view)).toBe(json(dashboard));
    expect(view.description).toBe(AUDIENCE_REQUIRED_PERMISSIONS_DESCRIPTION);
    expect(dashboard.description).toBe(AUDIENCE_REQUIRED_PERMISSIONS_DESCRIPTION);
  });

  it('the same SHAPE as the app\'s `requiredPermissions`: their JSON Schemas differ in the describe only', () => {
    const shapeOf = (s: z.ZodType) => {
      const { description: _describe, ...rest } = z.toJSONSchema(s, { io: 'input' }) as Record<string, unknown>;
      return rest;
    };
    const app = shapeOf(AppSchema.shape.requiredPermissions);
    expect(shapeOf(ListViewSchema.shape.requiredPermissions)).toEqual(app);
    expect(shapeOf(DashboardSchema.shape.requiredPermissions)).toEqual(app);
    // Not vacuous: the shared shape is a string array.
    expect(app).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('the describe carries the machine-read `[PLANNED` marker for the not-enforced window, and no tracker number', () => {
    // Wording is not pinned; the marker is, because a consumer parses it:
    // `markerStatus` in `scripts/liveness/check-liveness.mts` grades a row-less
    // property `planned` off `[planned`. The enforcing change deletes the clause
    // when both liveness rows flip to `live`.
    expect(AUDIENCE_REQUIRED_PERMISSIONS_DESCRIPTION).toMatch(/\[planned/i);
    // Runtime text: no tracker number reaches an author.
    expect(AUDIENCE_REQUIRED_PERMISSIONS_DESCRIPTION).not.toMatch(/#\d+/);
  });
});
