// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21500] A view container that authors both a default `form` and named
// `formViews` serves its default `form` as THE default form on the object door,
// over a real boot, through `GET /api/v1/meta/view?object=OBJECT` — the read the
// console's create and edit surfaces are built from.
//
// ## The contract (triage's ruling on the card)
//
// `ViewSchema.form` is the default form and `formViews` are additional. Create
// and edit render `form`; a named form is used only where it is asked for by
// name. At this door that is: the container's `form` is served as a form-family
// item carrying `isDefault: true`, and no named form carries it. The console's
// view merge (objectui `MetadataProvider.tsx`, `applyViewItem`) makes the
// `isDefault` form item the object's `.form`, else the first form item.
//
// ## The measurement this probe was written from
//
// HotCRM's `crm_lead` container (objectstack-ai/hotcrm `0b2a9d4`,
// `src/sales/views/lead.view.ts`) authors a default `form` of type `simple`
// with no top-level `label`, a tabbed `formViews.detail_form`, and among its
// other named forms `formViews.web_to_lead` of type `simple`, also unlabelled.
// The fixture below reduces it to exactly those three forms.
//
// Measured at `origin/main` `85e29b8858`, on this harness's unscoped kernel and
// on the CLI's standalone stack (`env_local`), the door served the same items
// for the package-shipped container: `crm_lead.detail_form` with
// `isDefault: true`, then `crm_lead.web_to_lead`; no item carries the default
// `form` at all. The cause is in `expandViewContainer` (`@objectstack/spec`):
// the form family collapses the default `form` into any named form whose
// `{ type, label, columns }` signature it shares — here `web_to_lead` — and then
// stamps `isDefault` on the FIRST named form, not on the one it matched.
//
// The two-form shape (`form` + `formViews.detail_form` only) and the
// `crm_account` control (a `form` and no `formViews`) are served correctly, and
// are kept here so the probe cannot pass by serving any one fixed answer.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

interface ViewRow {
  name: string;
  object?: string;
  viewKind?: string;
  isDefault?: boolean;
  config?: { type?: string; sections?: Array<{ name?: string }> };
}

/** The default form's one section — the content only `form` authors. */
const DEFAULT_FORM_SECTION = 'intake';

const defaultForm = {
  type: 'simple',
  sections: [{
    name: DEFAULT_FORM_SECTION,
    label: 'Intake',
    columns: 2,
    fields: [{ field: 'name' }, { field: 'need_type' }, { field: 'estimated_amount' }],
  }],
};
const detailForm = {
  type: 'tabbed',
  sections: [
    { name: 'general', label: 'General', fields: [{ field: 'name' }, { field: 'email' }] },
    { name: 'address', label: 'Address', fields: [{ field: 'street' }] },
  ],
};
const webToLead = (object: string) => ({
  type: 'simple',
  data: { provider: 'object', object },
  sections: [{ name: 'contact_us', label: 'Contact us', fields: [{ field: 'name' }, { field: 'email' }] }],
});

const object = (name: string) => ObjectSchema.create({
  name,
  label: name,
  pluralLabel: name,
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    email: Field.text({ label: 'Email' }),
    street: Field.text({ label: 'Street' }),
    need_type: Field.text({ label: 'Need Type' }),
    estimated_amount: Field.number({ label: 'Estimated Amount' }),
  },
});

const fixture = defineStack({
  manifest: {
    id: 'com.example.dogfood-default-form',
    namespace: 'crm',
    version: '0.0.1',
    type: 'app',
    name: 'Default form fixture',
    engines: { protocol: '^17' },
  },
  objects: [object('crm_lead'), object('crm_contact'), object('crm_account')],
  views: [
    // HotCRM's form family: a default `form`, a tabbed named form, and a named
    // form of the default form's own type.
    { object: 'crm_lead', form: defaultForm, formViews: { detail_form: detailForm, web_to_lead: webToLead('crm_lead') } },
    // Both forms, of different types and nothing else.
    { object: 'crm_contact', form: defaultForm, formViews: { detail_form: detailForm } },
    // The control: a default form and no `formViews`.
    { object: 'crm_account', form: detailForm },
  ] as any,
});

describe('dogfood: a container\'s default `form` is the default form on the object door (#21500)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(fixture);
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** The form-family items `GET /api/v1/meta/view?object=OBJECT` serves, in served order. */
  const formItems = async (obj: string): Promise<ViewRow[]> => {
    const res = await stack.apiAs(token, 'GET', `/meta/view?object=${obj}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items?: ViewRow[] } | ViewRow[];
    const rows = Array.isArray(body) ? body : (body.items ?? []);
    return rows.filter((r) => r.viewKind === 'form');
  };
  const sectionsOf = (row: ViewRow | undefined) => (row?.config?.sections ?? []).map((s) => s.name);
  const defaults = (rows: ViewRow[]) => rows.filter((r) => r.isDefault === true);

  it('a container with a default `form` and named forms serves `form` as the one default form', async () => {
    const rows = await formItems('crm_lead');
    // Every authored form is served: the default and both named ones.
    expect(rows.map((r) => r.name).sort()).toEqual(
      ['crm_lead.detail_form', 'crm_lead.form', 'crm_lead.web_to_lead'],
    );
    // Exactly one default, and it is the default form's own content.
    expect(defaults(rows).map((r) => r.name)).toEqual(['crm_lead.form']);
    expect(sectionsOf(defaults(rows)[0])).toEqual([DEFAULT_FORM_SECTION]);
  });

  it('a container with a default `form` and one named form of another type serves `form` as the default', async () => {
    const rows = await formItems('crm_contact');
    expect(rows.map((r) => r.name).sort()).toEqual(['crm_contact.detail_form', 'crm_contact.form']);
    expect(defaults(rows).map((r) => r.name)).toEqual(['crm_contact.form']);
    expect(sectionsOf(defaults(rows)[0])).toEqual([DEFAULT_FORM_SECTION]);
  });

  it('control: a container with a default `form` and no `formViews` serves that form as the default', async () => {
    const rows = await formItems('crm_account');
    expect(rows.map((r) => r.name)).toEqual(['crm_account.form']);
    expect(defaults(rows).map((r) => r.name)).toEqual(['crm_account.form']);
    expect(sectionsOf(defaults(rows)[0])).toEqual(['general', 'address']);
  });
});
