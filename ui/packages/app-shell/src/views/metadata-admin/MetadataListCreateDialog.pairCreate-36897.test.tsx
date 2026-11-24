// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36897 — the metadata list's 「新建」 for an object and a flow.
 *
 *  - On a read-only base the item is written to the pair the ensure door
 *    answers (ADR-0146 D3), never to the base, and an object does not try to
 *    join an app menu (the pair has no app). On a writable package — the
 *    control — the door is never knocked on, the item is written to the list's
 *    package and the object joins the menu.
 *  - The object carries the organization-wide default it was given.
 *  - A flow is created from a starting point; one that watches an object
 *    writes nothing until it has one.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const save = vi.fn(async () => ({}));
vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save }),
}));

const ensure = vi.fn(async (baseId: string) => ({
  basePackageId: baseId,
  packageId: `${baseId}.custom`,
  namespace: 'hrx',
  created: true,
  writable: true,
}));
vi.mock('../studio-design/packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureCustomizationPackage: (baseId: string) => ensure(baseId),
  fetchPackages: async () => [
    { id: 'com.vendor.hr', namespace: 'hr' },
    { id: 'com.example.crm', namespace: 'crm' },
  ],
}));
const publish = vi.fn(async () => ({ ok: true }));
vi.mock('../studio-design/studioSaveBar.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishSavedItem: (...args: unknown[]) => publish(...(args as [])),
}));
vi.mock('../studio-design/StudioPillarKit.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findTakenIdentifier: async () => null,
}));
const joinMenu = vi.fn(async () => ({ kind: 'joined' }));
vi.mock('../studio-design/newObjectJoinsAppMenu.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addNewObjectToAppMenu: (...args: unknown[]) => joinMenu(...(args as [])),
}));

import { MetadataListCreateDialog } from './MetadataListCreateDialog';
import { t } from './i18n';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const L = 'en-US' as const;

function open(type: 'object' | 'flow', packageId: string, inPair: boolean) {
  const onCreated = vi.fn();
  render(
    <MetadataListCreateDialog
      type={type}
      open
      onOpenChange={() => {}}
      packageId={packageId}
      inPair={inPair}
      locale={L}
      onCreated={onCreated}
    />,
  );
  return onCreated;
}

function fill(labelKey: string, idKey: string, label: string, id: string) {
  fireEvent.change(screen.getByLabelText(t(labelKey, L)), { target: { value: label } });
  fireEvent.change(screen.getByLabelText(t(idKey, L)), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: t('engine.studio.createLive', L) }));
}

describe('list 「新建」 lands in the paired .custom package on a read-only base (objectstack#36897)', () => {
  it('an object on a read-only base: the ensure door is asked, the pair is written, its namespace names it, no menu join', async () => {
    const onCreated = open('object', 'com.vendor.hr', true);
    fireEvent.keyDown(screen.getByTestId('create-object-owd'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: t('engine.studio.settings.sharingPublicRead', L) }));
    fill('engine.studio.data.nameLabel', 'engine.studio.data.idLabel', 'Leave request', 'leave_request');
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(ensure).toHaveBeenCalledWith('com.vendor.hr');
    expect(save).toHaveBeenCalledTimes(1);
    const [type, name, body, opts] = save.mock.calls[0] as unknown as [string, string, any, any];
    expect([type, name]).toEqual(['object', 'hrx_leave_request']);
    expect(opts).toMatchObject({ mode: 'draft', packageId: 'com.vendor.hr.custom', ifNoneMatch: '*' });
    expect(body).toHaveProperty('sharingModel', 'public_read');
    expect(publish).toHaveBeenCalledWith(expect.anything(), { type: 'object', name: 'hrx_leave_request', packageId: 'com.vendor.hr.custom' }, false);
    expect(onCreated).toHaveBeenCalledWith({ name: 'hrx_leave_request', packageId: 'com.vendor.hr.custom' });
    expect(joinMenu).not.toHaveBeenCalled();
  });

  it('CONTROL — an object in a writable package: no ensure, the list package is written and the object joins its menu', async () => {
    const onCreated = open('object', 'com.example.crm', false);
    fill('engine.studio.data.nameLabel', 'engine.studio.data.idLabel', 'Lead', 'lead');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ name: 'crm_lead', packageId: 'com.example.crm' }));
    expect(ensure).not.toHaveBeenCalled();
    expect(save.mock.calls[0]?.[3]).toMatchObject({ packageId: 'com.example.crm' });
    await waitFor(() => expect(joinMenu).toHaveBeenCalledTimes(1));
  });

  it('a flow on a read-only base: from a starting point, written to the pair, born off', async () => {
    const onCreated = open('flow', 'com.vendor.hr', true);
    fireEvent.click(screen.getByTestId('create-flow-preset-manual'));
    fill('engine.studio.auto.nameLabel', 'engine.studio.auto.idLabel', 'Escalate', 'escalate');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ name: 'escalate', packageId: 'com.vendor.hr.custom' }));
    expect(ensure).toHaveBeenCalledWith('com.vendor.hr');
    const [type, , body, opts] = save.mock.calls[0] as unknown as [string, string, any, any];
    expect(type).toBe('flow');
    expect(opts).toMatchObject({ packageId: 'com.vendor.hr.custom' });
    expect(body.status).toBe('obsolete');
    expect(JSON.stringify(body)).toContain('"triggerType":"manual"');
  });

  it('a starting point that watches an object writes nothing until it has one', async () => {
    const onCreated = open('flow', 'com.vendor.hr', true);
    fireEvent.click(screen.getByTestId('create-flow-preset-record_created'));
    fill('engine.studio.auto.nameLabel', 'engine.studio.auto.idLabel', 'On hire', 'on_hire');
    expect(await screen.findByText(t('engine.studio.auto.preset.needsObject', L))).toBeInTheDocument();
    expect(ensure).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
