// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27864 — the New Permission Set form asks for the Label first, and requires it.
 *
 * The form opened on Name (the API name) with an optional Label below it, so an
 * administrator typed a machine name first and could save a set with no human
 * label, while the Console's create form derives `name` from the label. The
 * Identity section now lists `label` first and required, with `name` after it.
 *
 * `required` on a form row is a layout flag the renderer reads: the set's
 * schema still accepts a set with no label, which the last case pins so that a
 * later move of the accept set is a deliberate edit, not a form side effect.
 */

import { describe, expect, it } from 'vitest';

import { METADATA_FORM_REGISTRY } from '../system/metadata-form-registry';
import { permissionForm } from './permission.form';
import { PermissionSetSchema } from './permission.zod';

type Row = { field: string; required?: boolean; helpText?: string };

const sections = (permissionForm.sections ?? []) as Array<{ label?: string; fields?: Array<Row | string> }>;
const identity = sections.find((s) => s.label === 'Identity');
const rows = (identity?.fields ?? []).map((f) => (typeof f === 'string' ? { field: f } : f)) as Row[];
const row = (key: string) => rows.find((r) => r.field === key);

describe('permission-set form — Label first and required, Name after it', () => {
  it('is the form `/meta/types` serves for the permission kind', () => {
    expect(METADATA_FORM_REGISTRY.permission).toBe(permissionForm);
  });

  it('opens on the Identity section, whose first two rows are label then name', () => {
    expect(sections[0]?.label).toBe('Identity');
    expect(rows.slice(0, 2).map((r) => r.field)).toEqual(['label', 'name']);
  });

  it('lists label before name across the whole form', () => {
    const order = sections.flatMap((s) => (s.fields ?? []).map((f) => (typeof f === 'string' ? f : f.field)));
    expect(order.indexOf('label')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('label')).toBeLessThan(order.indexOf('name'));
  });

  it('requires the label, and still requires the name', () => {
    expect(row('label')?.required).toBe(true);
    expect(row('name')?.required).toBe(true);
    // CONTROL: a neighbouring optional row is not swept into `required`.
    expect(row('description')?.required).toBeUndefined();
  });

  it("the name's help says it comes from the label", () => {
    expect(row('name')?.helpText).toMatch(/derived from the label/i);
    expect(row('name')?.helpText).toMatch(/snake_case/);
  });

  it('moves no accept set: the schema still parses a set with no label', () => {
    const r = PermissionSetSchema.safeParse({ name: 'crm_sales_rep', objects: {} });
    expect(r.success).toBe(true);
    // CONTROL: the same parse with a label is also clean.
    expect(PermissionSetSchema.safeParse({ name: 'crm_sales_rep', label: 'Sales Rep', objects: {} }).success).toBe(true);
  });
});
