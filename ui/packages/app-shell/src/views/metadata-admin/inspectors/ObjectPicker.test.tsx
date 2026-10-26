// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11783 — the shared object picker: what it offers, in which order,
 * and when it lets a name out.
 *
 * The catalog double answers the one read the picker makes — the
 * draft-overlaid object list — with entries shaped as the platform serves
 * them: `isSystem` on code-package objects, no `isSystem` key at all on a
 * runtime-authored one, `_packageId` on each, `_draft` on a draft.
 *
 * The rows are chosen so the PLATFORM'S MARK is what is tested, not a name:
 * `sys_file` carries a platform-looking name and is served `isSystem: false`
 * (it stays up front), while `audit_trail` carries a plain name and is served
 * `isSystem: true` (it is collapsed under System).
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [
    { name: 'showcase_account', label: 'Account', isSystem: false, _packageId: 'com.example.showcase' },
    { name: 'sys_file', label: 'File', isSystem: false, _packageId: 'com.objectstack.service.storage' },
    { name: 'sys_user', label: 'User', isSystem: true, _packageId: 'com.objectstack.plugin-auth' },
    { name: 'audit_trail', label: 'Audit Trail', isSystem: true, _packageId: 'com.objectstack.audit' },
    // Runtime-authored, so served without `isSystem` — published, and a draft.
    { name: 'repairs_technician', label: 'Technician', _packageId: 'com.example.repairs' },
    { name: 'repairs_repair_ticket', label: 'Repair Ticket', _packageId: 'com.example.repairs', _draft: true },
  ];
  const previewList = vi.fn(async (_type: string) => CATALOG);
  const client = { withPreviewDrafts: vi.fn((_on: boolean) => ({ list: previewList })) };
  return { CATALOG, previewList, client };
});

vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { ObjectPicker, type ObjectPickerProps } from './ObjectPicker';
import { t } from '../i18n';

afterEach(cleanup);
beforeEach(() => {
  h.previewList.mockClear();
  h.client.withPreviewDrafts.mockClear();
});

/** Mount under Studio's route, so `:packageId` names the package being edited. */
function renderPicker(props: Partial<ObjectPickerProps> = {}, path = '/studio/com.example.repairs/data') {
  const onCommit = vi.fn();
  const picker = <ObjectPicker label="Related object" value="" onCommit={onCommit} {...props} />;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={picker} />
        <Route path="*" element={picker} />
      </Routes>
    </MemoryRouter>,
  );
  return { onCommit, input: screen.getByRole('combobox', { name: 'Related object' }) };
}

/** The object names the open list offers, top to bottom. */
function offered(): string[] {
  return screen
    .queryAllByRole('option')
    .map((o) => o.getAttribute('data-object-name'))
    .filter((n): n is string => !!n);
}

async function openList(input: HTMLElement) {
  await userEvent.click(input);
  await waitFor(() => expect(offered().length).toBeGreaterThan(0));
}

describe('ObjectPicker — what it offers (objectui#11783)', () => {
  it('offers this package first, then the other objects, and no isSystem object up front', async () => {
    const { input } = renderPicker();
    await openList(input);
    // This package (by label), then the rest (by label). `sys_file` is offered:
    // the platform does not mark it system. `sys_user` / `audit_trail` are not.
    expect(offered()).toEqual(['repairs_repair_ticket', 'repairs_technician', 'showcase_account', 'sys_file']);
    // The package's objects sit in their own group, ahead of the others.
    const groups = screen.getAllByRole('group');
    expect(groups[0]).toContainElement(document.querySelector('[data-object-name="repairs_technician"]') as HTMLElement);
    expect(groups[1]).toContainElement(document.querySelector('[data-object-name="showcase_account"]') as HTMLElement);
  });

  it('offers the package draft object, labelled from its draft and marked as a draft', async () => {
    const { input } = renderPicker();
    await openList(input);
    const draft = document.querySelector('[data-object-name="repairs_repair_ticket"]') as HTMLElement;
    expect(draft).toHaveTextContent('Repair Ticket');
    expect(draft).toHaveTextContent(t('engine.inspector.draftSuffix', 'en-US'));
    const published = document.querySelector('[data-object-name="repairs_technician"]') as HTMLElement;
    expect(published).not.toHaveTextContent(t('engine.inspector.draftSuffix', 'en-US'));
  });

  it('opening the collapsed System group offers the isSystem objects', async () => {
    const { input } = renderPicker();
    await openList(input);
    await userEvent.click(document.querySelector('[data-system-toggle]') as HTMLElement);
    expect(offered()).toEqual(expect.arrayContaining(['sys_user', 'audit_trail']));
  });

  it('a search reaches a System object without opening the group, and choosing it commits it', async () => {
    const { input, onCommit } = renderPicker();
    await openList(input);
    await userEvent.type(input, 'user');
    expect(offered()).toEqual(['sys_user']);
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.click(document.querySelector('[data-object-name="sys_user"]') as HTMLElement);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('sys_user');
  });

  it('with no package in scope, no object is grouped as this package', async () => {
    const { input } = renderPicker({}, '/setup/metadata/object/x');
    await openList(input);
    expect(screen.getAllByRole('group')).toHaveLength(2); // the objects, then System
    expect(offered()).toEqual(['showcase_account', 'sys_file', 'repairs_repair_ticket', 'repairs_technician']);
  });
});

describe('ObjectPicker — when a name leaves it (objectui#11783)', () => {
  it('typing commits nothing; Enter commits the typed name once', async () => {
    const { input, onCommit } = renderPicker();
    await userEvent.click(input);
    await userEvent.type(input, 'repairs_repair_ticket');
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('repairs_repair_ticket');
  });

  it('Enter keeps a value that names no object, exactly as typed', async () => {
    const { input, onCommit } = renderPicker();
    await userEvent.click(input);
    // `{{` is user-event's escape for one literal `{`.
    await userEvent.type(input, '{{{{trigger.object}}');
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('{{trigger.object}}');
  });

  it('blur commits what was typed; a focus that typed nothing commits nothing', async () => {
    const { input, onCommit } = renderPicker({ value: 'showcase_account' });
    await userEvent.click(input);
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, 'sys_file');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('sys_file');
  });

  it('Escape abandons the typing', async () => {
    const { input, onCommit } = renderPicker({ value: 'showcase_account' });
    await userEvent.click(input);
    await userEvent.type(input, '_x');
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveValue('showcase_account');
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('reads the catalog once, from the draft-overlaid list, and never while typing', async () => {
    const { input } = renderPicker();
    await openList(input);
    await userEvent.type(input, 'repairs_repair_ticket');
    expect(h.client.withPreviewDrafts).toHaveBeenCalledWith(true);
    expect(h.previewList).toHaveBeenCalledTimes(1);
    expect(h.previewList).toHaveBeenCalledWith('object');
  });
});
