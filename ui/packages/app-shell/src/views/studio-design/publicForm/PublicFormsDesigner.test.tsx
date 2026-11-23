// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36444 — Studio's public form designer, over a metadata client
 * double: the HotCRM acceptance walk on the CRM example's lead form.
 *
 *  - the object's public forms are listed (a published one, and one only drafted);
 *  - editing an installed app's form (make Phone required, remove Title, change
 *    the title) saves a draft in its customization package, declaring the
 *    override, then publishes it there; the app's own package is never written;
 *  - removing a field the object requires is refused, with the reason;
 *  - a new form (four fields) is drafted where the object is edited;
 *  - an address another form uses is refused, and nothing can be saved;
 *  - the preview renders the form being edited;
 *  - a form the app ships cannot be deleted; a form of a writable package can.
 *
 * The runtime form renderer is stubbed: it renders the sections it is given.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('@object-ui/plugin-form', () => ({
  ObjectForm: ({ schema }: { schema: { sections: Array<{ label?: string; fields: Array<{ field: string; required?: boolean }> }> } }) => (
    <div data-testid="preview-form">
      {schema.sections.map((s, i) => (
        <section key={i} data-testid="preview-section">
          {s.label && <h4>{s.label}</h4>}
          {s.fields.map((f) => (
            <span key={f.field} data-testid={`preview-field-${f.field}`} data-required={f.required ? 'true' : 'false'}>
              {f.field}
            </span>
          ))}
        </section>
      ))}
    </div>
  ),
}));
vi.mock('../../../assistant/assistantBus.js', () => ({ emitMetadataRefresh: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The package list the designer's list reads once (`markShippedOff`): the CRM app installed read-only, a writable own package.
vi.mock('../packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () =>
    new Map([
      ['com.example.crm', { writable: false, manifest: { id: 'com.example.crm', version: '4.0.0' } }],
      ['com.acme.sales', { writable: true, manifest: { id: 'com.acme.sales', version: '1.0.0' } }],
    ]),
}));

import { PublicFormsDesigner } from './PublicFormsDesigner';

afterEach(cleanup);

const BASE = 'com.example.crm';
const PAIR = 'com.example.crm.custom';

const lead = {
  name: 'crm_lead',
  fields: {
    name: { type: 'text', label: 'Lead Name', required: true },
    company: { type: 'text', label: 'Company' },
    email: { type: 'email', label: 'Email', required: true },
    phone: { type: 'phone', label: 'Phone' },
    title: { type: 'text', label: 'Title' },
    score: { type: 'formula', label: 'Score' },
  },
};

const contactUs = () => ({
  name: 'crm_lead.web_to_lead',
  object: 'crm_lead',
  viewKind: 'form',
  config: {
    type: 'simple',
    data: { provider: 'object', object: 'crm_lead' },
    sections: [
      {
        name: 'contact_us',
        label: 'Contact us',
        columns: 1,
        fields: [{ field: 'name', required: true }, { field: 'company' }, { field: 'email', required: true }, { field: 'phone' }, { field: 'title' }],
      },
    ],
    sharing: { enabled: true, publicLink: '/forms/contact-us', allowAnonymous: true },
  },
});

const drafted = {
  name: 'crm_lead.event_rsvp',
  object: 'crm_lead',
  viewKind: 'form',
  label: 'Event RSVP',
  config: {
    data: { provider: 'object', object: 'crm_lead' },
    sections: [{ name: 'main', fields: [{ field: 'name', required: true }, { field: 'email', required: true }] }],
    sharing: { enabled: true, publicLink: '/forms/event-rsvp', allowAnonymous: true },
  },
};

function clientDouble(opts: { owner?: string; appDoc?: Record<string, unknown> } = {}) {
  const owner = opts.owner ?? BASE;
  const appDoc = opts.appDoc ?? contactUs();
  return {
    list: vi.fn(async () => [
      { ...contactUs(), _packageId: owner },
      { name: 'crm_lead.form', object: 'crm_lead', viewKind: 'form', config: { sections: [] }, _packageId: owner },
      { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list', config: {}, _packageId: owner },
      { ...contactUs(), name: 'crm_account.signup', object: 'crm_account', config: { ...contactUs().config, data: { provider: 'object', object: 'crm_account' }, sharing: { enabled: false, allowAnonymous: true, publicLink: '/forms/signup' } }, _packageId: owner },
    ]),
    listDrafts: vi.fn(async () => [{ type: 'view', name: 'crm_lead.event_rsvp', packageId: owner }]),
    getDraft: vi.fn(async () => drafted),
    layered: vi.fn(async (_t: string, name: string) =>
      name === 'crm_lead.web_to_lead' ? { code: appDoc, effective: { ...contactUs(), _packageId: owner }, draft: null } : { code: null, effective: null, draft: drafted },
    ),
    save: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({})),
    reset: vi.fn(async () => ({})),
  };
}

const customization = () => ({
  base: BASE,
  baseLabel: 'CRM',
  basedOn: '4.0.0',
  walled: false,
  pairId: null,
  ensure: vi.fn(async () => PAIR),
  ensurePackage: vi.fn(),
  marks: { state: 'loaded' } as never,
});

function renderDesigner(client: ReturnType<typeof clientDouble>, extra: Partial<React.ComponentProps<typeof PublicFormsDesigner>> = {}) {
  const onDraftSaved = vi.fn();
  render(
    <PublicFormsDesigner
      objectName="crm_lead"
      objectDef={lead}
      client={client as never}
      packageId={BASE}
      readOnly
      customization={customization() as never}
      publishNonce={0}
      onDraftSaved={onDraftSaved}
      locale="en"
      previewDataSource={null}
      leading={<span>Form surface</span>}
      formRoute="/f"
      {...extra}
    />,
  );
  return { onDraftSaved };
}

describe('Studio public form designer (objectstack#36444)', () => {
  it('lists the object\'s public forms: published ones and ones only drafted, not internal forms or another object\'s', async () => {
    renderDesigner(clientDouble());
    const list = await screen.findByTestId('public-forms-list');
    await within(list).findByTestId('public-form-item-crm_lead.web_to_lead');
    expect(within(list).getByTestId('public-form-item-crm_lead.event_rsvp')).toHaveTextContent('Draft');
    expect(within(list).queryByTestId('public-form-item-crm_lead.form')).toBeNull();
    expect(within(list).queryByTestId('public-form-item-crm_account.signup')).toBeNull();
  });

  it('lists a form its installed app ships switched off as off, even when this environment\'s customization switches it on', async () => {
    const shippedOff = { ...contactUs(), config: { ...contactUs().config, sharing: { enabled: false, publicLink: '/forms/contact-us', allowAnonymous: true } } };
    renderDesigner(clientDouble({ appDoc: shippedOff }));
    const row = await screen.findByTestId('public-form-item-crm_lead.web_to_lead');
    await waitFor(() => expect(row).toHaveTextContent('Off (its app ships it off)'));
    expect(row).not.toHaveTextContent(/\bOn\b/);
  });

  it('edits an installed app\'s form as a customization: Phone required, Title removed, a new title; then publishes it there', async () => {
    const user = userEvent.setup();
    const client = clientDouble();
    const custom = customization();
    const { onDraftSaved } = (() => {
      const onDraftSaved = vi.fn();
      render(
        <PublicFormsDesigner
          objectName="crm_lead"
          objectDef={lead}
          client={client as never}
          packageId={BASE}
          readOnly
          customization={custom as never}
          publishNonce={0}
          onDraftSaved={onDraftSaved}
          locale="en"
          previewDataSource={null}
          leading={null}
        />,
      );
      return { onDraftSaved };
    })();
    await user.click(await screen.findByTestId('public-form-item-crm_lead.web_to_lead'));
    await screen.findByTestId('public-form-title');

    await user.click(screen.getByTestId('public-form-required-phone'));
    await user.click(screen.getByTestId('public-form-remove-title'));
    const title = screen.getByTestId('public-form-title');
    await user.clear(title);
    await user.type(title, 'Talk to sales');

    // The live preview follows the edit.
    expect(screen.getByTestId('public-form-preview-title')).toHaveTextContent('Talk to sales');
    expect(screen.getByTestId('preview-field-phone')).toHaveAttribute('data-required', 'true');
    expect(screen.queryByTestId('preview-field-title')).toBeNull();

    await user.click(screen.getByTestId('public-form-save'));
    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
    expect(custom.ensure).toHaveBeenCalled();
    const [type, name, body, options] = client.save.mock.calls[0] as unknown as [string, string, any, any];
    expect([type, name]).toEqual(['view', 'crm_lead.web_to_lead']);
    expect(options).toMatchObject({ mode: 'draft', packageId: PAIR, surface: 'studio', ifNoneMatch: '*' });
    expect(body.overrides).toEqual({ package: BASE, basedOn: '4.0.0' });
    expect(body._packageId).toBeUndefined();
    expect(body.label).toBe('Talk to sales');
    expect(body.config.title).toBe('Talk to sales');
    expect(body.config.sections[0].fields).toEqual([
      { field: 'name', required: true },
      { field: 'company' },
      { field: 'email', required: true },
      { field: 'phone', required: true },
    ]);
    expect(body.config.sharing).toEqual({ enabled: true, publicLink: '/forms/contact-us', allowAnonymous: true });
    expect(onDraftSaved).toHaveBeenCalledWith({ type: 'view', name: 'crm_lead.web_to_lead' });

    await user.click(await screen.findByTestId('public-form-publish'));
    await waitFor(() => expect(client.publish).toHaveBeenCalledWith('view', 'crm_lead.web_to_lead', { packageId: PAIR }));
    // Nothing is ever written to the app's own package.
    for (const call of [...client.save.mock.calls, ...client.publish.mock.calls] as unknown as unknown[][]) {
      expect(JSON.stringify(call)).not.toContain(`"packageId":"${BASE}"`);
    }
  });

  it('refuses to remove a field the object requires, and says why', async () => {
    const user = userEvent.setup();
    renderDesigner(clientDouble());
    await user.click(await screen.findByTestId('public-form-item-crm_lead.web_to_lead'));
    await user.click(await screen.findByTestId('public-form-remove-email'));
    expect(screen.getByTestId('public-form-notice')).toHaveTextContent('“Email” cannot be removed: the object requires it');
    expect(screen.getByTestId('public-form-field-email')).toBeInTheDocument();
    // And it stays required: its box is checked and cannot be cleared.
    expect(screen.getByTestId('public-form-required-email')).toBeChecked();
    expect(screen.getByTestId('public-form-required-email')).toBeDisabled();
  });

  it('creates a new form with four fields, drafted where the object is edited', async () => {
    const user = userEvent.setup();
    const client = clientDouble({ owner: 'com.acme.sales' });
    renderDesigner(client, { readOnly: false, customization: null, packageId: 'com.acme.sales' });
    await screen.findByTestId('public-form-item-crm_lead.web_to_lead');
    await user.click(screen.getByTestId('public-form-new'));
    await user.type(screen.getByTestId('public-form-create-title'), 'Demo signup');
    expect(screen.getByTestId('public-form-create-address')).toHaveValue('demo-signup');
    await user.click(screen.getByTestId('public-form-create-confirm'));

    // Starts with the fields the object requires; two more are added.
    expect(screen.getByTestId('public-form-field-name')).toBeInTheDocument();
    expect(screen.getByTestId('public-form-field-email')).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('public-form-add-field-main'), 'company');
    await user.selectOptions(screen.getByTestId('public-form-add-field-main'), 'phone');
    // A formula is never offered.
    expect(within(screen.getByTestId('public-form-add-field-main')).queryByText('Score')).toBeNull();

    await user.click(screen.getByTestId('public-form-save'));
    await waitFor(() => expect(client.save).toHaveBeenCalledTimes(1));
    const [, name, body, options] = client.save.mock.calls[0] as unknown as [string, string, any, any];
    expect(name).toBe('crm_lead.demo_signup');
    expect(options).toMatchObject({ mode: 'draft', packageId: 'com.acme.sales', ifNoneMatch: '*' });
    expect(body).toMatchObject({ name: 'crm_lead.demo_signup', object: 'crm_lead', viewKind: 'form', label: 'Demo signup' });
    expect(body.config.sections[0].fields.map((f: { field: string }) => f.field)).toEqual(['name', 'email', 'company', 'phone']);
    expect(body.config.sharing).toEqual({ enabled: true, allowAnonymous: true, publicLink: '/forms/demo-signup' });
    expect(body.overrides).toBeUndefined();
  });

  it('refuses an address another form uses, switched off or not, and saves nothing', async () => {
    const user = userEvent.setup();
    const client = clientDouble();
    renderDesigner(client);
    await screen.findByTestId('public-form-item-crm_lead.web_to_lead');
    await user.click(screen.getByTestId('public-form-new'));
    await user.type(screen.getByTestId('public-form-create-title'), 'Contact us');
    expect(screen.getByTestId('public-form-create-address-problem')).toHaveTextContent('Another form already uses this address');
    expect(screen.getByTestId('public-form-create-confirm')).toBeDisabled();
    // The address of a switched-off form of another object is taken too.
    await user.clear(screen.getByTestId('public-form-create-address'));
    await user.type(screen.getByTestId('public-form-create-address'), 'signup');
    expect(screen.getByTestId('public-form-create-confirm')).toBeDisabled();

    // An existing form moved onto another's address cannot be saved.
    await user.click(screen.getByTestId('public-form-item-crm_lead.web_to_lead'));
    const address = await screen.findByTestId('public-form-address');
    await user.clear(address);
    await user.type(address, 'event-rsvp');
    expect(screen.getByTestId('public-form-address-problem')).toHaveTextContent('crm_lead.event_rsvp');
    expect(screen.getByTestId('public-form-save')).toBeDisabled();
    expect(client.save).not.toHaveBeenCalled();
  });

  it('groups fields into a named section', async () => {
    const user = userEvent.setup();
    renderDesigner(clientDouble());
    await user.click(await screen.findByTestId('public-form-item-crm_lead.web_to_lead'));
    await user.click(await screen.findByTestId('public-form-add-section'));
    const sections = within(screen.getByTestId('public-form-sections')).getAllByTestId(/^public-form-section-label-/);
    expect(sections).toHaveLength(2);
    await user.clear(sections[1]);
    await user.type(sections[1], 'About you');
    expect(screen.getAllByTestId('preview-section')).toHaveLength(2);
    expect(screen.getByText('About you', { selector: 'h4' })).toBeInTheDocument();
  });

  it('does not delete a form the app ships; deletes one of a writable package', async () => {
    const user = userEvent.setup();
    renderDesigner(clientDouble());
    await user.click(await screen.findByTestId('public-form-item-crm_lead.web_to_lead'));
    expect(await screen.findByTestId('public-form-delete-shipped')).toHaveTextContent('switch it off in Setup');
    cleanup();

    const own = clientDouble({ owner: 'com.acme.sales' });
    renderDesigner(own, { readOnly: false, customization: null, packageId: 'com.acme.sales' });
    await user.click(await screen.findByTestId('public-form-item-crm_lead.web_to_lead'));
    await user.click(await screen.findByTestId('public-form-delete'));
    await user.click(screen.getByTestId('public-form-delete-yes'));
    await waitFor(() => expect(own.reset).toHaveBeenCalledWith('view', 'crm_lead.web_to_lead', { packageId: 'com.acme.sales' }));
  });
});
