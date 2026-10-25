import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';
import React from 'react';

registerAllFields();

/**
 * ADR-0092 D4 — managed-object edit affordance gating.
 *
 * Non-`platform` lifecycle buckets (config / system / append-only /
 * better-auth) blanket-disable every form field by default. When an object
 * OPENS per-record editing for the mode via `userActions.{edit,create}`, the
 * blanket lock lifts and each field's own `readonly` flag decides — so a
 * `managedBy:'better-auth'` object like sys_user can expose `name`/`image`
 * while keeping `email`/`role` read-only. The server-side write guard is the
 * real boundary; this is UX only.
 */
describe('ObjectForm — managed-object edit affordance (ADR-0092 D4)', () => {
  const sysUserFields = {
    name: { type: 'text', label: 'Name', readonly: false },
    image: { type: 'url', label: 'Profile Image', readonly: false },
    email: { type: 'email', label: 'Email', readonly: true },
    role: { type: 'text', label: 'Role', readonly: true },
  };

  const record = { id: 'u1', name: 'Dev Admin', email: 'a@b.c', role: 'user', image: '' };
  const dsFor = (schema: any): any => ({
    getObjectSchema: vi.fn().mockResolvedValue(schema),
    findOne: vi.fn().mockResolvedValue(record),
    getRecord: vi.fn().mockResolvedValue(record),
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    query: vi.fn(),
  });

  const renderEdit = (schema: any) =>
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: schema.name, mode: 'edit', recordId: 'u1' } as any}
        dataSource={dsFor(schema)}
      />,
    );

  const renderCreate = (schema: any) =>
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: schema.name, mode: 'create' } as any}
        dataSource={dsFor(schema)}
      />,
    );

  async function inputByName(container: HTMLElement, name: string): Promise<HTMLInputElement> {
    return waitFor(() => {
      const el = container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
      if (!el) throw new Error(`${name} input not yet rendered`);
      return el;
    });
  }

  it('better-auth object WITH userActions.edit: editable (readonly:false) field becomes an enabled input', async () => {
    const schema = { name: 'sys_user', managedBy: 'better-auth', userActions: { edit: true }, fields: sysUserFields };
    const { container } = renderEdit(schema);

    // The profile field the affordance opens (readonly:false) is now editable —
    // the blanket managed-object lock no longer applies. (readonly:true fields
    // like email/role are excluded from the edit form by the existing
    // readonly-field mechanism, so they can never be edited here either.)
    const name = await inputByName(container, 'name');
    expect(name.disabled).toBe(false);
    // No readonly field leaks in as an enabled input.
    expect(container.querySelector('input[name="email"]:not([disabled])')).toBeNull();
    expect(container.querySelector('input[name="role"]:not([disabled])')).toBeNull();
  });

  it('better-auth object WITHOUT userActions.edit: blanket lock disables the field (backward compat)', async () => {
    const schema = { name: 'sys_session', managedBy: 'better-auth', fields: sysUserFields };
    const { container } = renderEdit(schema);

    const name = await inputByName(container, 'name');
    expect(name.disabled).toBe(true); // no affordance override → blanket lock applies even to readonly:false
  });

  it('platform object: fields editable regardless (unchanged behavior)', async () => {
    const schema = { name: 'crm_lead', managedBy: 'platform', fields: { name: { type: 'text', label: 'Name' } } };
    const { container } = renderEdit(schema);
    const name = await inputByName(container, 'name');
    expect(name.disabled).toBe(false);
  });

  // ADR-0103 alignment (objectui#2712 follow-up): the blanket lock now routes
  // through the SAME shared `resolveEffectiveCrudAffordances` policy detail/grid use, so
  // an admin-editable `config` bucket (sys_webhook, sys_permission_set, …) is
  // editable in the form too — it was previously over-locked as "non-platform".
  it('config object: editable (resolved config.edit === true, matches detail/grid)', async () => {
    const schema = { name: 'sys_webhook', managedBy: 'config', fields: { name: { type: 'text', label: 'Name', readonly: false } } };
    const { container } = renderEdit(schema);
    const name = await inputByName(container, 'name');
    expect(name.disabled).toBe(false);
  });

  // Create mode keys off the resolved `create` affordance (not `edit`): an
  // engine-owned system object stays locked, while one that opened
  // `userActions.create` (e.g. Notification Preferences) unlocks.
  it('create mode: engine-owned system locked, userActions.create unlocks', async () => {
    // `engine-owned`, not the residual `'system'`: protocol 17 split that
    // bucket (objectstack#3355), so `'system'` now falls through to the
    // default-writable branch and pins nothing.
    const locked = renderCreate({ name: 'sys_automation_run', managedBy: 'engine-owned', fields: { name: { type: 'text', label: 'Name', readonly: false } } });
    expect((await inputByName(locked.container, 'name')).disabled).toBe(true);

    const open = renderCreate({ name: 'sys_notification_preference', managedBy: 'engine-owned', userActions: { create: true }, fields: { name: { type: 'text', label: 'Name', readonly: false } } });
    expect((await inputByName(open.container, 'name')).disabled).toBe(false);
  });
});
