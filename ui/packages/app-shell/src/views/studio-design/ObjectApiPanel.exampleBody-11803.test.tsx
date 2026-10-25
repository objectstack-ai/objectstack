// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's API tab shows an example create body the server would accept —
 * objectui#11803.
 *
 * The defect: the example typed every field it did not list by name as
 * `"string"` (a select, a location, a time), gave a multi-valued field a single
 * value, and stopped at the first 8 writable fields in served order, so a
 * required field declared after them was missing from a body that is then
 * refused.
 *
 * The copied-cURL case is the other half of the card, and it is GREEN on the
 * pre-fix tree too: the `Authorization` header was already there. It pins that
 * the half stays done, not that this change did it.
 *
 * The oracle is `@objectstack/spec`'s field-value contract,
 * `valueSchemaFor(def, 'stored')` — the shape the record write path accepts
 * per field type — rather than a list of expected literals: every value the
 * panel shows must parse green under it.
 *
 * The fixtures are the showcase app's own objects in the shape the `/meta`
 * read serves them: the columns `applySystemFields` injects come FIRST
 * (`{ ...additions, ...schema.fields }`), the search companion `__search`
 * last, and the injected definitions copy the platform's literals
 * (`TENANT_SCOPE_FIELD_DEF`, `AUDIT_FIELD_DEFS`, `OWNER_FIELD_DEF`,
 * `OWNING_BUSINESS_UNIT_FIELD_DEF`, `provisionSearchCompanion`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { valueSchemaFor, type ValueShapeFieldDef } from '@objectstack/spec/data';
import { isValueDomainMember, type ValueDomain } from '@objectstack/spec/shared';

import { ObjectApiPanel } from './ObjectApiPanel';

type Def = Record<string, unknown>;

/** The columns the platform injects ahead of the authored fields, in that order. */
const INJECTED_AHEAD: Record<string, Def> = {
  organization_id: {
    type: 'lookup', reference: 'sys_organization', label: 'Organization',
    required: false, hidden: true, readonly: true, system: true,
  },
  created_at: { type: 'datetime', label: 'Created At', required: false, readonly: true, system: true },
  created_by: { type: 'lookup', reference: 'sys_user', label: 'Created By', required: false, readonly: true, system: true },
  updated_at: { type: 'datetime', label: 'Last Modified At', required: false, readonly: true, system: true },
  updated_by: { type: 'lookup', reference: 'sys_user', label: 'Last Modified By', required: false, readonly: true, system: true },
  owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', required: false, readonly: false, system: true },
  owning_business_unit_id: {
    type: 'lookup', reference: 'sys_business_unit', label: 'Owning Business Unit',
    required: false, hidden: true, readonly: true, system: true,
  },
};

const SEARCH_COMPANION: Def = {
  type: 'text', label: 'Search Index', required: false, hidden: true, readonly: true, system: true, searchable: false,
};

function served(authored: Record<string, Def>): Record<string, Def> {
  return { ...INJECTED_AHEAD, ...authored, __search: SEARCH_COMPANION };
}

/** showcase `account.object.ts`, authored fields in declaration order. */
const ACCOUNT_FIELDS: Record<string, Def> = {
  name: { type: 'text', label: 'Account Name', required: true, searchable: true, maxLength: 200 },
  industry: {
    type: 'select', label: 'Industry', trackHistory: true,
    options: [
      { label: 'Technology', value: 'technology', default: true },
      { label: 'Finance', value: 'finance' },
      { label: 'Healthcare', value: 'healthcare' },
      { label: 'Retail', value: 'retail' },
    ],
  },
  annual_revenue: {
    type: 'currency', label: 'Annual Revenue', min: 0,
    currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' },
  },
  website: { type: 'url', label: 'Website' },
  hq: { type: 'location', label: 'Headquarters' },
  status: {
    type: 'select', label: 'Lifecycle', required: true, trackHistory: true,
    options: [
      { label: 'Prospect', value: 'prospect', default: true, color: '#94A3B8' },
      { label: 'Active', value: 'active', color: '#10B981' },
      { label: 'Churned', value: 'churned', color: '#EF4444' },
    ],
  },
  sales_region: {
    type: 'select', label: 'Sales Region',
    options: [
      { label: 'AMER', value: 'amer', default: true },
      { label: 'EMEA', value: 'emea' },
      { label: 'APAC', value: 'apac' },
    ],
  },
  signed_on: { type: 'date', label: 'Customer Since' },
  tax_id: { type: 'text', label: 'Tax ID (EIN)', maxLength: 20 },
  support_config: { type: 'json', label: 'Support Config' },
  churn_reason: { type: 'text', label: 'Churn Reason', maxLength: 500 },
  billing_email: { type: 'text', label: 'Billing Email', maxLength: 200 },
};

/** showcase `field-zoo.object.ts`: one field per type, in declaration order. */
const ZOO_FIELDS: Record<string, Def> = {
  name: { type: 'text', label: 'Name', required: true, searchable: true, maxLength: 200 },
  f_textarea: { type: 'textarea', label: 'Textarea' },
  f_email: { type: 'email', label: 'Email', searchable: true },
  f_url: { type: 'url', label: 'URL' },
  f_phone: { type: 'phone', label: 'Phone' },
  f_password: { type: 'password', label: 'Password (masked on read)' },
  f_secret: { type: 'secret', label: 'Secret (encrypted at rest)' },
  f_markdown: { type: 'markdown', label: 'Markdown' },
  f_html: { type: 'html', label: 'HTML' },
  f_richtext: { type: 'richtext', label: 'Rich Text' },
  f_number: { type: 'number', label: 'Number', min: 0, max: 1000 },
  f_currency: { type: 'currency', label: 'Currency', min: 0 },
  f_percent: { type: 'percent', label: 'Percent', min: 0, max: 100, defaultValue: 50 },
  f_date: { type: 'date', label: 'Date' },
  f_datetime: { type: 'datetime', label: 'Date / Time' },
  f_time: { type: 'time', label: 'Time' },
  f_boolean: { type: 'boolean', label: 'Boolean' },
  f_toggle: { type: 'toggle', label: 'Toggle', defaultValue: false },
  f_select: { type: 'select', label: 'Select', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }] },
  f_multiselect: { type: 'multiselect', label: 'Multi', options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }] },
  f_radio: { type: 'radio', label: 'Radio', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
  f_checkboxes: { type: 'checkboxes', label: 'Checkboxes', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
  f_tags: { type: 'tags', label: 'Tags' },
  f_lookup: { type: 'lookup', label: 'Lookup → Account', reference: 'showcase_account' },
  f_lookups: { type: 'lookup', label: 'Lookup → Accounts (multiple)', reference: 'showcase_account', multiple: true },
  f_master_detail: { type: 'master_detail', label: 'Master-Detail → Project', reference: 'showcase_project', required: true },
  f_tree: { type: 'tree', label: 'Tree (self-reference)', reference: 'showcase_field_zoo' },
  f_user: { type: 'user', label: 'User → sys_user (single)', reference: 'sys_user' },
  f_users: { type: 'user', label: 'Users (multiple)', reference: 'sys_user', multiple: true },
  f_image: { type: 'image', label: 'Image' },
  f_file: { type: 'file', label: 'File' },
  f_avatar: { type: 'avatar', label: 'Avatar' },
  f_video: { type: 'video', label: 'Video' },
  f_audio: { type: 'audio', label: 'Audio' },
  f_formula: { type: 'formula', label: 'Formula', expression: 'record.f_number * 2' },
  f_autonumber: { type: 'autonumber', label: 'Auto Number' },
  f_composite: { type: 'composite', label: 'Composite (embedded object)' },
  f_repeater: { type: 'repeater', label: 'Repeater (embedded array)' },
  f_record: { type: 'record', label: 'Record (name-keyed map)' },
  f_location: { type: 'location', label: 'Location (GPS)' },
  f_address: { type: 'address', label: 'Address' },
  f_code: { type: 'code', label: 'Code Editor', language: 'json' },
  f_json: { type: 'json', label: 'JSON' },
  f_color: { type: 'color', label: 'Color' },
  f_rating: { type: 'rating', label: 'Rating', max: 5 },
  f_slider: { type: 'slider', label: 'Slider', min: 0, max: 100, step: 5 },
  f_signature: { type: 'signature', label: 'Signature' },
  f_qrcode: { type: 'qrcode', label: 'QR / Barcode' },
  f_progress: { type: 'progress', label: 'Progress', min: 0, max: 100 },
  f_vector: { type: 'vector', label: 'Embedding Vector', dimensions: 1536 },
};

const COMPUTED = new Set(['f_formula', 'f_autonumber']);

/** The example body the panel shows, parsed back from its `<pre>`. */
function shownBody(fields: unknown): Record<string, unknown> {
  const { container } = render(<ObjectApiPanel name="showcase_account" draft={{ fields }} />);
  const pre = container.querySelector('pre');
  return pre ? (JSON.parse(pre.textContent ?? '{}') as Record<string, unknown>) : {};
}

function storedParse(def: Def, value: unknown) {
  return valueSchemaFor(def as unknown as ValueShapeFieldDef, 'stored').safeParse(value);
}

afterEach(() => {
  cleanup();
});

describe('ObjectApiPanel example body: values the write path accepts (objectui#11803)', () => {
  it('a select shows a declared option code and a location a coordinates object (showcase Account)', () => {
    const body = shownBody(served(ACCOUNT_FIELDS));
    expect(body.industry).toBe('technology');
    expect(body.status).toBe('prospect');
    expect(body.sales_region).toBe('amer');
    expect(body.hq).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
    for (const [name, value] of Object.entries(body)) {
      const def = served(ACCOUNT_FIELDS)[name];
      expect(storedParse(def, value).success, `${name} = ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('every non-computed field type shows a value its stored-form contract accepts (showcase field zoo)', () => {
    for (const [name, def] of Object.entries(ZOO_FIELDS)) {
      const body = shownBody({ [name]: def });
      cleanup();
      if (COMPUTED.has(name)) {
        expect(body, name).not.toHaveProperty(name);
        continue;
      }
      expect(body, name).toHaveProperty(name);
      const parsed = storedParse(def, body[name]);
      expect(parsed.success, `${name} (${String(def.type)}) = ${JSON.stringify(body[name])}`).toBe(true);
    }
  });

  it('a multi-valued field shows an array of one element', () => {
    const body = shownBody({
      f_lookups: ZOO_FIELDS.f_lookups,
      f_multiselect: ZOO_FIELDS.f_multiselect,
      f_tags: ZOO_FIELDS.f_tags,
      f_files: { type: 'file', label: 'Files', multiple: true },
    });
    expect(body.f_lookups).toEqual([expect.any(String)]);
    expect(body.f_multiselect).toEqual(['red']);
    expect(body.f_tags).toEqual([expect.any(String)]);
    expect(body.f_files).toEqual([expect.any(String)]);
  });

  it("the value stays inside the field's declared bounds and value domain", () => {
    const body = shownBody({
      floor: { type: 'number', label: 'Floor', min: 5 },
      ceiling: { type: 'number', label: 'Ceiling', max: -3 },
      code: { type: 'text', label: 'Code', maxLength: 3 },
      long: { type: 'text', label: 'Long', minLength: 10 },
      zone: { type: 'text', label: 'Zone', valueDomain: 'iana_time_zone' },
      currency: { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' },
      country: { type: 'text', label: 'Country', valueDomain: 'iso_3166_alpha2' },
    });
    expect(body.floor).toBe(5);
    expect(body.ceiling).toBe(-3);
    expect(String(body.code).length).toBeLessThanOrEqual(3);
    expect(String(body.long).length).toBeGreaterThanOrEqual(10);
    const domains: Array<[string, ValueDomain]> = [
      ['zone', 'iana_time_zone'],
      ['currency', 'iso_4217_currency'],
      ['country', 'iso_3166_alpha2'],
    ];
    for (const [name, domain] of domains) {
      expect(isValueDomainMember(domain, String(body[name])), name).toBe(true);
    }
  });
});

describe('ObjectApiPanel example body: which fields it lists (objectui#11803)', () => {
  it('lists a required field declared after the eighth writable field (showcase field zoo)', () => {
    const body = shownBody(served(ZOO_FIELDS));
    expect(body).toHaveProperty('f_master_detail');
    expect(Object.keys(body).slice(0, 2)).toEqual(['name', 'f_master_detail']);
  });

  it('puts required fields first, then the object\'s own fields before the platform\'s, and names the rest', () => {
    const fields = served(ACCOUNT_FIELDS);
    const body = shownBody(fields);
    const keys = Object.keys(body);
    expect(keys.slice(0, 2)).toEqual(['name', 'status']);
    // Read-only, hidden and computed columns are never in a create body.
    for (const skipped of ['organization_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'owning_business_unit_id', '__search']) {
      expect(keys).not.toContain(skipped);
    }
    // Every writable field is either shown or named as left out — none vanishes.
    const omitted = ['tax_id', 'support_config', 'churn_reason', 'billing_email', 'owner_id'];
    expect(screen.getByText(new RegExp(omitted.join(', ')))).toBeInTheDocument();
    const writable = Object.entries(fields)
      .filter(([, d]) => d.readonly !== true && d.hidden !== true)
      .map(([n]) => n);
    expect([...keys, ...omitted].sort()).toEqual([...writable].sort());
  });

  it('every required field is listed even when there are more of them than the cap', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`req_${i}`, { type: 'text', label: `Required ${i}`, required: true }]),
    );
    const body = shownBody({ opt: { type: 'text', label: 'Optional' }, ...fields });
    expect(Object.keys(body).sort()).toEqual(Object.keys(fields).sort());
  });
});

describe('ObjectApiPanel copied cURL (objectui#11803)', () => {
  it('carries the Authorization header and the example body', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fields = served(ACCOUNT_FIELDS);
    const body = shownBody(fields);
    // The second endpoint row is the create (POST) call.
    fireEvent.click(screen.getAllByTitle('Copy as cURL')[1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('-X POST');
    expect(copied).toMatch(/-H 'Authorization: Bearer [^']+'/);
    expect(copied).toContain(`-d '${JSON.stringify(body)}'`);
  });
});
