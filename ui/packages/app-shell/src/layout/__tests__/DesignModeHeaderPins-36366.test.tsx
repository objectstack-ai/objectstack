// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design mode's 「Header buttons」 (objectstack#36366): drawn only while
 * the mode is on; it shows what the header pins (the object's arm, else the
 * header's own first three), moves an action between 「Pinned to header」 and
 * 「Other」, refuses a fourth with a toast, stages the change so the header
 * draws it, and 「Save」 writes it.
 *
 * Real subjects: `DesignModeHeaderPins` (and the panel it loads), `useObjectPins`,
 * `useDesignModeController`, `DesignModeProvider`, `DesignModeBar`,
 * `saveObjectPins`. The metadata client and the package doors are fakes that
 * record what is written.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) => String(o?.[name] ?? '')),
    language: 'en',
  }),
}));

const toastInfo = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { info: toastInfo, error: toastError, success: vi.fn() },
}));

const written = vi.hoisted(() => [] as Array<[string, ...unknown[]]>);
const client = vi.hoisted(() => ({
  layered: async () => ({ code: { name: 'crm_lead', label: 'Lead' } }),
  get: async () => ({}),
  save: async (...args: unknown[]) => {
    written.push(['save', ...args]);
    return {};
  },
  publish: async (...args: unknown[]) => {
    written.push(['publish', ...args]);
    return {};
  },
  reset: async () => ({}),
}));
vi.mock('../../views/metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));
vi.mock('../../views/studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () =>
    new Map([['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable: true, manifest: { version: '1.0.0' } }]]),
  ensureCustomizationPackage: async () => {
    throw new Error('not expected');
  },
}));

import { DesignModeProvider, useDesignMode, useDesignModeController } from '../designMode';
import { DesignModeBar } from '../DesignModeBar';
import { DesignModeHeaderPins, useObjectPins } from '../DesignModeHeaderPins';

const ACTIONS = [
  { name: 'convert', label: 'Convert', locations: ['record_header'], order: 1 },
  { name: 'mark_won', label: 'Mark won', locations: ['record_header'], order: 2 },
  { name: 'clone', label: 'Clone', locations: ['record_header'], order: 3 },
  { name: 'log_call', label: 'Log call', locations: ['record_more'], order: 4 },
];

function Harness({ objectDef }: { objectDef: Record<string, unknown> }) {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      {mode.active && <DesignModeBar mode={mode} />}
      <Enter />
      <HeaderReadout objectDef={objectDef} />
      <DesignModeHeaderPins objectDef={objectDef} page="record" actions={ACTIONS} />
    </DesignModeProvider>
  );
}

/** What the page header would draw: the pins `useObjectPins` answers. */
function HeaderReadout({ objectDef }: { objectDef: Record<string, unknown> }) {
  const pins = useObjectPins(objectDef);
  return <output data-testid="header-pins">{JSON.stringify(pins)}</output>;
}

function Enter() {
  const mode = useDesignMode();
  return (
    <button type="button" onClick={mode?.enter}>
      enter
    </button>
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const SERVED = { name: 'crm_lead', _packageId: 'com.acme.crm', actions: ACTIONS };

function start(objectDef: Record<string, unknown> = SERVED, enter = true) {
  render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <Harness objectDef={objectDef} />
    </MemoryRouter>,
  );
  if (enter) fireEvent.click(screen.getByText('enter'));
}

async function openPanel() {
  // The panel is loaded once the mode is on.
  fireEvent.click(await screen.findByTestId('design-header-pins'));
  await flush();
  return screen.getByTestId('design-header-pins-panel');
}

/** The ids listed in a section of the panel, in order. */
function listed(section: 'pinned' | 'other'): string[] {
  return [...screen.getByTestId(`design-header-pins-${section}`).querySelectorAll('li')].map((li) =>
    (li.getAttribute('data-testid') ?? '').slice('design-header-pin-'.length),
  );
}

const toggle = (id: string) => fireEvent.click(within(screen.getByTestId(`design-header-pin-${id}`)).getByTestId('design-header-pin-toggle'));

beforeEach(() => {
  written.length = 0;
  toastInfo.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

describe('「Header buttons」 under the design mode (objectstack#36366)', () => {
  it('is not drawn outside the mode, and the header draws the object as served', () => {
    start({ ...SERVED, pinnedActions: { record: ['clone'] } }, false);
    expect(screen.queryByTestId('design-header-pins')).toBeNull();
    expect(screen.getByTestId('header-pins').textContent).toBe('{"record":["clone"]}');
  });

  it("with no pins set it shows the header's own first three as pinned, the rest under Other, 3/3", async () => {
    start();
    await openPanel();
    expect(listed('pinned')).toEqual(['convert', 'mark_won', 'clone']);
    expect(listed('other')).toEqual(['log_call']);
    expect(screen.getByTestId('design-header-pins-pinned')).toHaveTextContent('3/3');
  });

  it('a fourth pin is refused with a toast and changes nothing', async () => {
    start();
    await openPanel();
    toggle('log_call');
    expect(toastInfo).toHaveBeenCalledWith('At most 3 buttons are pinned to the header. Unpin one first.');
    expect(listed('pinned')).toEqual(['convert', 'mark_won', 'clone']);
    expect(screen.getByTestId('design-mode-save')).toBeDisabled();
  });

  it('moving an action is staged, the header draws it at once, and 「Save」 writes the object with the new pins', async () => {
    start();
    await openPanel();
    toggle('mark_won');
    toggle('log_call');
    expect(listed('pinned')).toEqual(['convert', 'clone', 'log_call']);
    expect(screen.getByTestId('header-pins').textContent).toBe('{"record":["convert","clone","log_call"]}');
    expect(written).toEqual([]);

    fireEvent.click(screen.getByTestId('design-mode-save'));
    await flush();
    await flush();
    const [save, publish] = written;
    expect(save).toEqual([
      'save',
      'object',
      'crm_lead',
      { name: 'crm_lead', label: 'Lead', pinnedActions: { record: ['convert', 'clone', 'log_call'] } },
      { mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' },
    ]);
    expect(publish).toEqual(['publish', 'object', 'crm_lead', { packageId: 'com.acme.crm' }]);
  });

  it("an object's own pins are what the panel starts from; unpinning back to them stages nothing", async () => {
    start({ ...SERVED, pinnedActions: { record: ['log_call'] } });
    await openPanel();
    expect(listed('pinned')).toEqual(['log_call']);
    expect(screen.getByTestId('design-header-pins-pinned')).toHaveTextContent('1/3');
    toggle('convert');
    expect(screen.getByTestId('design-mode-save')).toBeEnabled();
    toggle('convert');
    expect(screen.getByTestId('design-mode-save')).toBeDisabled();
  });

  it('「Cancel」 drops the change: the header draws the object as served again', async () => {
    start({ ...SERVED, pinnedActions: { record: ['log_call'] } });
    await openPanel();
    toggle('log_call');
    expect(screen.getByTestId('header-pins').textContent).toBe('{"record":[]}');
    fireEvent.click(screen.getByTestId('design-mode-cancel'));
    await flush();
    expect(screen.getByTestId('header-pins').textContent).toBe('{"record":["log_call"]}');
    expect(written).toEqual([]);
  });
});
