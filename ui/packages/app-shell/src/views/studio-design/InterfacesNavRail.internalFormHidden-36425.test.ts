// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#36425 — the Studio Interfaces 视图 group no
 * longer lists an internal create / edit form (the object's default form or
 * its `OBJECT.create` form), which the console no longer loads. A public form
 * (`sharing.enabled === true`) stays listed, and so does a named form an
 * action of type `form` opens. The same test as the lint rule
 * `form-view-internal-not-loaded`.
 *
 * Reads the published rows through the real `loadPackageSurfaces`, the merge
 * the Interfaces pillar draws its rail from.
 */
import { describe, expect, it, vi } from 'vitest';
// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import { loadPackageSurfaces, viewBindingOf, type PackageSurfaceClient } from './packageSurfaces';
import { offNavViewIsInternalForm } from './InterfacesNavRail';

const sections = [{ label: 'Main', fields: ['name'] }];
const ROWS: Array<Record<string, unknown>> = [
  { name: 'account.form', object: 'account', viewKind: 'form', isDefault: true, config: { sections } },
  { name: 'account.create', object: 'account', viewKind: 'form', config: { sections } },
  { name: 'lead.contact_us', object: 'lead', viewKind: 'form', isDefault: true, config: { sections, sharing: { enabled: true, publicLink: 'contact-us' } } },
  { name: 'lead.qualify', object: 'lead', viewKind: 'form', config: { sections } },
  { name: 'account.all', object: 'account', viewKind: 'list', isDefault: true, config: {} },
];

function client(): PackageSurfaceClient {
  return {
    list: vi.fn(async () => ROWS),
    listDrafts: vi.fn(async () => []) as unknown as PackageSurfaceClient['listDrafts'],
  };
}

describe('Studio Interfaces leaves out internal forms, keeps public and named ones (#36425)', () => {
  it('the default and the create form of an object are internal; nothing else is', async () => {
    const rail = await loadPackageSurfaces(client(), 'com.qa.app', 'view');
    const hidden = rail.filter(offNavViewIsInternalForm).map((s) => s.name);
    const listed = rail.filter((s) => !offNavViewIsInternalForm(s)).map((s) => s.name);
    expect(hidden).toEqual(['account.form', 'account.create']);
    expect(listed).toEqual(['lead.contact_us', 'lead.qualify', 'account.all']);
  });

  it('CONTROL: a public form is listed wherever it sits; sharing turned off makes it internal', () => {
    const publicDefault = viewBindingOf({ name: 'x.form', object: 'x', viewKind: 'form', isDefault: true, sharing: { enabled: true } });
    expect(offNavViewIsInternalForm(publicDefault)).toBe(false);
    const sharingOff = viewBindingOf({ name: 'x.form', object: 'x', viewKind: 'form', isDefault: true, config: { sharing: { enabled: false } } });
    expect(offNavViewIsInternalForm(sharingOff)).toBe(true);
  });

  it('CONTROL: a draft-only view (no body) stays listed', () => {
    expect(offNavViewIsInternalForm({})).toBe(false);
  });
});
