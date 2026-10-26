// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12326 — the package OWD overview names the master the runtime
 * derives, and its save leaves a `controlled_by_parent` object savable.
 *
 * Since `@objectstack/spec` 18 (objectstack#23100, ADR-0055 §1) the master is
 * the ONE `master_detail` declared `required: true`; zero or two or more derive
 * none. The row shows that master, or says there is none. Switching a row to
 * `controlled_by_parent` sets `required: true` on its `master_detail` fields in
 * the saved draft, as the per-object Settings tab does. The installed spec's
 * `ObjectSchema` is the oracle for the saved body.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
import { t, tFormat } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

const NO_MASTER = t('engine.studio.owd.byParentNoMaster', 'en-US');
const CBP_LABEL = t('engine.studio.settings.sharingControlledByParent', 'en-US');

type Body = Record<string, unknown>;

function makeClient(objects: Record<string, Body>, saved: Array<{ name: string; body: Body }>) {
  return {
    list: async (type: string) =>
      type === 'object' ? Object.entries(objects).map(([name, body]) => ({ name, label: body.label ?? name })) : [],
    listDrafts: async () => [],
    layered: async (_type: string, name: string) => ({ effective: objects[name] ?? {}, code: null }),
    getDraft: async () => null,
    save: async (_type: string, name: string, body: Body) => {
      saved.push({ name, body });
      objects[name] = body;
      return body;
    },
  } as unknown as React.ComponentProps<typeof PackageOwdOverviewPanel>['client'];
}

function renderPanel(objects: Record<string, Body>) {
  const saved: Array<{ name: string; body: Body }> = [];
  render(<PackageOwdOverviewPanel client={makeClient(objects, saved)} packageId="com.example.crm" locale="en-US" />);
  return { saved };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const cbp = (fields: Body): Body => ({ name: 'crm_case', label: 'Case', sharingModel: 'controlled_by_parent', fields });

describe('PackageOwdOverviewPanel — the master shown is the one the runtime derives (objectui#12326)', () => {
  const SHAPES: Array<[string, Body, string | undefined]> = [
    ['one required master', { account: { type: 'master_detail', reference: 'crm_account', required: true } }, 'crm_account'],
    ['one master without required', { account: { type: 'master_detail', reference: 'crm_account' } }, undefined],
    [
      'two required masters',
      {
        account: { type: 'master_detail', reference: 'crm_account', required: true },
        contact: { type: 'master_detail', reference: 'crm_contact', required: true },
      },
      undefined,
    ],
  ];

  it.each(SHAPES)('%s', async (_label, fields, master) => {
    // The oracle: the spec accepts exactly the shapes a master is shown for.
    expect(ObjectSchema.safeParse(cbp(fields)).success).toBe(master !== undefined);
    renderPanel({ crm_case: cbp(fields) });
    const cell = await screen.findByTestId('owd-master-crm_case');
    expect(cell).toHaveTextContent(
      master ? tFormat('engine.studio.owd.byParent', 'en-US', { master }) : NO_MASTER,
    );
  });
});

describe('PackageOwdOverviewPanel — switching a row to controlled_by_parent (objectui#12326)', () => {
  it('saves its master required, and the saved object parses', async () => {
    const body: Body = {
      name: 'crm_case',
      label: 'Case',
      sharingModel: 'private',
      fields: { account: { type: 'master_detail', reference: 'crm_account' } },
    };
    // The control leg: switching only the model is refused.
    expect(ObjectSchema.safeParse({ ...body, sharingModel: 'controlled_by_parent' }).success).toBe(false);

    const { saved } = renderPanel({ crm_case: body });
    await screen.findByTestId('owd-row-crm_case');
    fireEvent.keyDown(screen.getByTestId('owd-internal-crm_case'), { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: CBP_LABEL }));

    // Before the save, the row already names the master it will derive.
    expect(screen.getByTestId('owd-master-crm_case')).toHaveTextContent(
      tFormat('engine.studio.owd.byParent', 'en-US', { master: 'crm_account' }),
    );

    fireEvent.click(screen.getByTestId('owd-save'));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0].body.sharingModel).toBe('controlled_by_parent');
    expect((saved[0].body.fields as Record<string, Body>).account.required).toBe(true);
    expect(ObjectSchema.safeParse(saved[0].body).success).toBe(true);
  });

  it('a row with two master-detail fields shows no master before the save', async () => {
    renderPanel({
      crm_case: {
        name: 'crm_case',
        label: 'Case',
        sharingModel: 'private',
        fields: {
          account: { type: 'master_detail', reference: 'crm_account' },
          contact: { type: 'master_detail', reference: 'crm_contact' },
        },
      },
    });
    await screen.findByTestId('owd-row-crm_case');
    fireEvent.keyDown(screen.getByTestId('owd-internal-crm_case'), { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: CBP_LABEL }));
    expect(screen.getByTestId('owd-master-crm_case')).toHaveTextContent(NO_MASTER);
  });
});
