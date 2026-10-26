/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12617: the record header draws ONE primary action and the rest as
 * secondary buttons.
 *
 * `@objectstack/spec`'s action contract says "in `record_header` the first
 * visible action becomes the primary button" and lets a renderer prefer a
 * `variant: 'primary'` action. `page:header` drew every action without a
 * declared variant with the filled style, so a header with three actions
 * showed three primaries. Now:
 *
 *   - the primary is the first action declaring `variant: 'primary'`, else the
 *     first by `order`; it leads the row and is the only filled button;
 *   - the next two inline actions are outline buttons;
 *   - a fourth folds into the `⋯`, above the host's Share / Delete;
 *   - the host's Edit stays a labelled button in the row and takes no slot;
 *   - a declared action whose `visible` holds is present, and (CONTROL) one
 *     whose `visible` fails is absent (objectui#12303).
 *
 * "Filled" and "outline" are read off the Button primitive's own variant
 * classes (`bg-primary` for Shadcn's `default`, `border-input` for `outline`).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Registers `page:header` at module scope rather than in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const LEAD = { id: 'lead-1', name: 'Mira Costa', is_converted: false, status: 'contacted' };

const HOST_ACTIONS = [
  { name: 'sys_edit', label: 'Edit', icon: 'pencil', order: 100, onClick: vi.fn() },
  { name: 'sys_share', label: 'Share', order: 110, component: 'action:menu', onClick: vi.fn() },
  { name: 'sys_delete', label: 'Delete', order: 120, variant: 'destructive', component: 'action:menu', onClick: vi.fn() },
];

function renderRecordHeader(actions: any[], record: any = LEAD) {
  return render(
    <ActionProvider>
      <RecordContextProvider
        objectName="crm_lead"
        recordId={record.id}
        data={record}
        objectSchema={{ name: 'crm_lead', label: 'Lead' }}
        headerSystemActions={HOST_ACTIONS}
      >
        <PageHeader schema={{ type: 'page:header', actions }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

const act = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  type: 'url',
  target: `https://example.com/${name}`,
  locations: ['record_header'],
  ...extra,
});

function toolbarButtons(): HTMLElement[] {
  const bar = screen.getByRole('toolbar', { name: /Page header actions/i });
  return Array.from(bar.querySelectorAll('button'));
}

const nameOf = (b: HTMLElement) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim();
const isFilled = (b: HTMLElement) => b.className.split(/\s+/).includes('bg-primary');
const isOutline = (b: HTMLElement) => b.className.split(/\s+/).includes('border-input');

async function overflowRows(): Promise<string[]> {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
  return within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((el) => (el.textContent ?? '').trim());
}

describe('page:header draws one primary action, the rest secondary (objectui#12617)', () => {
  it('three record_header actions render as one filled primary + two outline buttons, then a labelled outline Edit', () => {
    renderRecordHeader([
      act('convert_lead', 'Convert Lead'),
      act('schedule_followup', 'Schedule Follow-up'),
      act('log_call', 'Log a Call'),
    ]);
    const buttons = toolbarButtons().filter((b) => nameOf(b) !== 'More actions');
    expect(buttons.map(nameOf)).toEqual(['Convert Lead', 'Schedule Follow-up', 'Log a Call', 'Edit']);
    expect(buttons.map(isFilled)).toEqual([true, false, false, false]);
    expect(buttons.slice(1).every(isOutline)).toBe(true);
    // Edit is a labelled button, never icon-only.
    expect((buttons[3].textContent ?? '').trim()).toBe('Edit');
  });

  it('a fourth action folds into the ⋯, above the host Share / Delete; Edit stays in the row', async () => {
    renderRecordHeader([
      act('convert_lead', 'Convert Lead'),
      act('schedule_followup', 'Schedule Follow-up'),
      act('log_call', 'Log a Call'),
      act('log_meeting', 'Log a Meeting'),
    ]);
    const names = toolbarButtons().map(nameOf);
    expect(names).toEqual(['Convert Lead', 'Schedule Follow-up', 'Log a Call', 'Edit', 'More actions']);
    expect(await overflowRows()).toEqual(['Log a Meeting', 'Share', 'Delete']);
  });

  it("`variant: 'primary'` wins over `order`: it leads the row as the only filled button", () => {
    renderRecordHeader([
      act('log_call', 'Log a Call', { order: -10 }),
      act('log_meeting', 'Log a Meeting'),
      act('convert_lead', 'Convert Lead', { variant: 'primary', order: 50 }),
    ]);
    const buttons = toolbarButtons().filter((b) => nameOf(b) !== 'More actions');
    expect(buttons.map(nameOf)).toEqual(['Convert Lead', 'Log a Call', 'Log a Meeting', 'Edit']);
    expect(buttons.map(isFilled)).toEqual([true, false, false, false]);
  });

  it('a declared action whose `visible` holds is present; CONTROL: one whose `visible` fails is absent', () => {
    const gate = {
      dialect: 'cel',
      source: 'has(record.is_converted) && record.is_converted == false && record.status != "converted"',
    };
    renderRecordHeader([
      act('convert_lead', 'Convert Lead', { visible: gate }),
      act('reopen_lead', 'Reopen Lead', { visible: { dialect: 'cel', source: 'record.status == "converted"' } }),
      act('log_call', 'Log a Call'),
    ]);
    const names = toolbarButtons().map(nameOf);
    expect(names).toContain('Convert Lead');
    expect(names).not.toContain('Reopen Lead');
    // The visible gate decides presence, not rank: the surviving first action
    // is still the primary.
    const convert = toolbarButtons().find((b) => nameOf(b) === 'Convert Lead')!;
    expect(isFilled(convert)).toBe(true);
  });

  it('with no app action, the host Edit is the primary button', () => {
    renderRecordHeader([]);
    const buttons = toolbarButtons().filter((b) => nameOf(b) !== 'More actions');
    expect(buttons.map(nameOf)).toEqual(['Edit']);
    expect(isFilled(buttons[0])).toBe(true);
  });
});
