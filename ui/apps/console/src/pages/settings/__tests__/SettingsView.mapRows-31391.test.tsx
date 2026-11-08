// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SettingsView — a `map` setting is drawn as a table of keyed rows
 * (objectstack#31391), over the real `SettingsField` render path.
 *
 * The server half (objectstack#30208) moved `lifecycle.retention_overrides`,
 * `lifecycle.quotas` and `lifecycle.quota_defaults` to the `map` specifier: a
 * `keyColumn`, typed value `columns`, and the keys the map admits served as
 * the specifier's `options` by the namespace read. Before this card the page
 * drew those rows as "Unsupported specifier type: map".
 *
 * The fixtures are the shapes `lifecycleSettingsManifest` declares and the
 * door testkit measured on main (`settings-map-shape-30208.test.ts`): the
 * object keys served with the object's label, the refusal answered as one
 * `FieldError` with `constraint: { type: 'map', entry, column?, kind?,
 * allowed? }`, where `allowed` is the admitted keys joined by `, `.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getSettingsNamespace = vi.fn();
const saveSettingsNamespace = vi.fn();
const runSettingsAction = vi.fn();

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    getSettingsNamespace: (...a: unknown[]) => getSettingsNamespace(...a),
    saveSettingsNamespace: (...a: unknown[]) => saveSettingsNamespace(...a),
    runSettingsAction: (...a: unknown[]) => runSettingsAction(...a),
  };
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { SettingsView } from '../SettingsView';

/** The keys the object option source serves on this deployment. */
const OBJECT_OPTIONS = [
  { value: 'sys_audit_log', label: 'Audit log' },
  { value: 'sys_job_run', label: 'Job run' },
];

type Resolved = { value: unknown; source: string; locked: boolean; envVar?: string };

/** The Data Lifecycle page's three maps, as `lifecycleSettingsManifest` declares them. */
function lifecyclePayload(values: Record<string, unknown> = {}, overrides: Record<string, Partial<Resolved>> = {}) {
  const resolved: Record<string, Resolved> = {};
  const all = { retention_overrides: {}, quotas: {}, ...values };
  for (const [k, v] of Object.entries(all)) {
    resolved[k] = { value: v, source: 'default', locked: false, ...overrides[k] };
  }
  return {
    manifest: {
      namespace: 'lifecycle',
      label: 'Data Lifecycle',
      specifiers: [
        {
          type: 'map',
          key: 'retention_overrides',
          label: 'Retention overrides',
          default: {},
          keyColumn: { label: 'Object' },
          columns: [
            { name: 'maxAge', label: 'Keep rows for', kind: 'duration' },
            { name: 'expireAfter', label: 'Expire rows after', kind: 'duration' },
          ],
          options: OBJECT_OPTIONS,
        },
        {
          type: 'map',
          key: 'quotas',
          label: 'Row quotas',
          default: {},
          keyColumn: { label: 'Object' },
          columns: [{ name: 'max_rows', label: 'Max rows', kind: 'positive_integer' }],
          options: OBJECT_OPTIONS,
        },
      ],
    },
    values: resolved,
  };
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/settings/lifecycle']}>
      <Routes>
        <Route path="/settings/:namespace" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rowFor = (key: string) => document.querySelector<HTMLElement>(`[data-settings-key="${key}"]`)!;
const entryRow = (key: string, entry: string) =>
  rowFor(key).querySelector<HTMLElement>(`[data-map-entry="${entry}"]`);
const entryKeys = (key: string) =>
  Array.from(rowFor(key).querySelectorAll<HTMLElement>('[data-map-entry]')).map((r) => r.dataset.mapEntry);
const cell = (key: string, entry: string, columnLabel: string) =>
  within(entryRow(key, entry)!).getByRole('spinbutton', { name: columnLabel }) as HTMLInputElement;
/** Provider-less, `t` answers the key itself: the add picker's trigger reads its key. */
const addPicker = (key: string) => within(rowFor(key)).getByRole('combobox', { name: /mapAddRow/ });

async function pickToAdd(key: string, optionLabel: string) {
  fireEvent.click(addPicker(key));
  fireEvent.click(await screen.findByRole('option', { name: optionLabel }));
}

async function save() {
  fireEvent.click(await screen.findByRole('button', { name: /save/i }));
  await waitFor(() => expect(saveSettingsNamespace).toHaveBeenCalledTimes(1));
  return saveSettingsNamespace.mock.calls[0] as [string, Record<string, unknown>];
}

/** A `SETTINGS_VALIDATION` answer carrying one map `FieldError`, as the save door sends it. */
function mapRefusal(fieldError: Record<string, unknown>) {
  const err = new Error('Settings for lifecycle are incomplete') as Error & { status?: number; payload?: unknown };
  err.status = 400;
  err.payload = {
    success: false,
    error: {
      code: 'SETTINGS_VALIDATION',
      message: 'Settings for lifecycle are incomplete',
      details: { namespace: 'lifecycle', fields: [fieldError] },
    },
  };
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSettingsNamespace.mockResolvedValue({ values: {} });
});
afterEach(cleanup);

describe('SettingsView — a `map` setting draws its stored rows (objectstack#31391)', () => {
  it('one value column: a row per stored entry, in stored order, the cell holding the stored number', async () => {
    getSettingsNamespace.mockResolvedValue(
      lifecyclePayload({ quotas: { sys_job_run: 500000, sys_audit_log: 1000000 } }),
    );
    renderView();
    await screen.findByText('Row quotas');

    expect(entryKeys('quotas')).toEqual(['sys_job_run', 'sys_audit_log']);
    expect(cell('quotas', 'sys_audit_log', 'Max rows').value).toBe('1000000');
    // The key cell shows the served label, the header the declared key column.
    expect(within(entryRow('quotas', 'sys_audit_log')!).getByRole('combobox').textContent).toContain('Audit log');
    expect(within(rowFor('quotas')).getByRole('columnheader', { name: 'Object' })).toBeTruthy();
    // The row is drawn as keyed rows, never as the unsupported-type fallback.
    expect(rowFor('quotas').textContent).not.toMatch(/unsupportedSpecifierType/);
  });

  it('several value columns: each declared column is a cell, a duration split into its number', async () => {
    getSettingsNamespace.mockResolvedValue(
      lifecyclePayload({ retention_overrides: { sys_job_run: { maxAge: '1y', expireAfter: '30d' } } }),
    );
    renderView();
    await screen.findByText('Retention overrides');

    expect(entryKeys('retention_overrides')).toEqual(['sys_job_run']);
    expect(cell('retention_overrides', 'sys_job_run', 'Keep rows for').value).toBe('1');
    expect(cell('retention_overrides', 'sys_job_run', 'Expire rows after').value).toBe('30');
    const headers = within(rowFor('retention_overrides')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.slice(0, 3)).toEqual(['Object', 'Keep rows for', 'Expire rows after']);
  });
});

describe('SettingsView — the key picker (objectstack#31391)', () => {
  it('lists the served options and hides a key another row already uses', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quotas: { sys_audit_log: 1000000 } }));
    renderView();
    await screen.findByText('Row quotas');

    fireEvent.click(addPicker('quotas'));
    const offered = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(offered).toEqual(['Job run']);
  });

  it('with every key unused, lists every served option by its label', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload());
    renderView();
    await screen.findByText('Row quotas');

    fireEvent.click(addPicker('quotas'));
    const offered = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(offered).toEqual(['Audit log', 'Job run']);
  });

  it('a stored key the server no longer offers stays on its row, marked as not offered', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quotas: { sys_audit_logs: 10, sys_job_run: 5 } }));
    renderView();
    await screen.findByText('Row quotas');

    expect(entryKeys('quotas')).toEqual(['sys_audit_logs', 'sys_job_run']);
    expect(within(entryRow('quotas', 'sys_audit_logs')!).getByTestId('settings-map-not-offered')).toBeTruthy();
    expect(within(entryRow('quotas', 'sys_job_run')!).queryByTestId('settings-map-not-offered')).toBeNull();
  });
});

describe('SettingsView — a `map` setting is saved as the object its rows store (objectstack#31391)', () => {
  it('a duration typed as a number with the default unit is stored as the literal `90d`', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload());
    renderView();
    await screen.findByText('Retention overrides');

    await pickToAdd('retention_overrides', 'Audit log');
    fireEvent.change(cell('retention_overrides', 'sys_audit_log', 'Keep rows for'), { target: { value: '90' } });
    const [namespace, patch] = await save();

    expect(namespace).toBe('lifecycle');
    expect(patch).toEqual({ retention_overrides: { sys_audit_log: { maxAge: '90d' } } });
  });

  it('a positive integer is sent as a number, the map as an object, never as JSON text', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quotas: { sys_audit_log: 1000000 } }));
    renderView();
    await screen.findByText('Row quotas');

    fireEvent.change(cell('quotas', 'sys_audit_log', 'Max rows'), { target: { value: '2000' } });
    const [, patch] = await save();

    expect(patch).toEqual({ quotas: { sys_audit_log: 2000 } });
    expect(typeof patch.quotas).toBe('object');
    expect(typeof (patch.quotas as Record<string, unknown>).sys_audit_log).toBe('number');
  });

  it('an untouched row is sent back as stored beside an edited one, cells left empty left out', async () => {
    getSettingsNamespace.mockResolvedValue(
      lifecyclePayload({ retention_overrides: { sys_job_run: { maxAge: '1y', expireAfter: '30d' } } }),
    );
    renderView();
    await screen.findByText('Retention overrides');

    fireEvent.change(cell('retention_overrides', 'sys_job_run', 'Expire rows after'), { target: { value: '' } });
    const [, patch] = await save();

    expect(patch).toEqual({ retention_overrides: { sys_job_run: { maxAge: '1y' } } });
  });

  it('removing every row sends null (a clear), never an empty object', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quotas: { sys_audit_log: 1000000, sys_job_run: 5 } }));
    renderView();
    await screen.findByText('Row quotas');

    for (const button of within(rowFor('quotas')).getAllByRole('button', { name: /mapRemoveRow/ })) {
      fireEvent.click(button);
    }
    expect(entryKeys('quotas')).toEqual([]);
    const [, patch] = await save();

    expect(patch).toEqual({ quotas: null });
    expect(patch.quotas).not.toEqual({});
  });
});

describe('SettingsView — a refused map save marks the row it names (objectstack#31391)', () => {
  it('invalid_option: the row named by `entry` and its key picker are marked, with the server sentence', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quotas: { sys_audit_logs: 10, sys_job_run: 5 } }));
    const sentence =
      "Row quotas: 'sys_audit_logs' is not a key this setting admits. Allowed: sys_audit_log, sys_job_run.";
    saveSettingsNamespace.mockRejectedValue(
      mapRefusal({
        field: 'quotas',
        code: 'invalid_option',
        message: sentence,
        label: 'Row quotas',
        // The save door's shape: `allowed` is ONE comma-joined string, not an array.
        constraint: { type: 'map', entry: 'sys_audit_logs', allowed: 'sys_audit_log, sys_job_run' },
      }),
    );
    renderView();
    await screen.findByText('Row quotas');

    fireEvent.change(cell('quotas', 'sys_job_run', 'Max rows'), { target: { value: '6' } });
    await save();

    await waitFor(() => expect(entryRow('quotas', 'sys_audit_logs')!.dataset.invalid).toBe('true'));
    expect(entryRow('quotas', 'sys_job_run')!.dataset.invalid).toBeUndefined();
    const keyPicker = within(entryRow('quotas', 'sys_audit_logs')!).getByRole('combobox');
    expect(keyPicker.getAttribute('aria-invalid')).toBe('true');
    const alert = rowFor('quotas').querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe(sentence);
    expect(keyPicker.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('invalid_shape on a cell: the cell named by `column` is marked, not the key', async () => {
    getSettingsNamespace.mockResolvedValue(
      lifecyclePayload({ retention_overrides: { sys_job_run: { maxAge: '1y', expireAfter: '30d' } } }),
    );
    saveSettingsNamespace.mockRejectedValue(
      mapRefusal({
        field: 'retention_overrides',
        code: 'invalid_shape',
        message:
          "Retention overrides: 'sys_job_run'.expireAfter must be a duration such as 7y (a whole number followed by h, d, w or y), not a string of 4 characters.",
        constraint: { type: 'map', entry: 'sys_job_run', column: 'expireAfter', kind: 'duration' },
      }),
    );
    renderView();
    await screen.findByText('Retention overrides');

    fireEvent.change(cell('retention_overrides', 'sys_job_run', 'Expire rows after'), { target: { value: '1.5' } });
    await save();

    await waitFor(() => expect(entryRow('retention_overrides', 'sys_job_run')!.dataset.invalid).toBe('true'));
    expect(cell('retention_overrides', 'sys_job_run', 'Expire rows after').getAttribute('aria-invalid')).toBe('true');
    expect(cell('retention_overrides', 'sys_job_run', 'Keep rows for').getAttribute('aria-invalid')).toBeNull();
    expect(
      within(entryRow('retention_overrides', 'sys_job_run')!).getByRole('combobox', { name: /Job run/ }).getAttribute('aria-invalid'),
    ).toBeNull();
  });

  it('editing the map clears the mark with the sentence', async () => {
    getSettingsNamespace.mockResolvedValue(lifecyclePayload({ quotas: { sys_audit_logs: 10 } }));
    saveSettingsNamespace.mockRejectedValue(
      mapRefusal({
        field: 'quotas',
        code: 'invalid_option',
        message: "Row quotas: 'sys_audit_logs' is not a key this setting admits.",
        constraint: { type: 'map', entry: 'sys_audit_logs', allowed: 'sys_audit_log, sys_job_run' },
      }),
    );
    renderView();
    await screen.findByText('Row quotas');
    fireEvent.change(cell('quotas', 'sys_audit_logs', 'Max rows'), { target: { value: '11' } });
    await save();
    await waitFor(() => expect(entryRow('quotas', 'sys_audit_logs')!.dataset.invalid).toBe('true'));

    fireEvent.change(cell('quotas', 'sys_audit_logs', 'Max rows'), { target: { value: '12' } });

    expect(entryRow('quotas', 'sys_audit_logs')!.dataset.invalid).toBeUndefined();
    expect(rowFor('quotas').querySelector('[role="alert"]')).toBeNull();
  });
});

describe('SettingsView — a locked map (objectstack#31391)', () => {
  it('an env-pinned map renders read-only: no cell, key, add or remove control can be used', async () => {
    getSettingsNamespace.mockResolvedValue(
      lifecyclePayload(
        { quotas: { sys_audit_log: 1000000 } },
        { quotas: { source: 'env', locked: true, envVar: 'OS_LIFECYCLE_QUOTAS' } },
      ),
    );
    renderView();
    await screen.findByText('Row quotas');

    expect(cell('quotas', 'sys_audit_log', 'Max rows').disabled).toBe(true);
    expect((within(entryRow('quotas', 'sys_audit_log')!).getByRole('combobox') as HTMLButtonElement).disabled).toBe(true);
    expect((addPicker('quotas') as HTMLButtonElement).disabled).toBe(true);
    const remove = within(rowFor('quotas')).getByRole('button', { name: /mapRemoveRow/ }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    expect(entryKeys('quotas')).toEqual(['sys_audit_log']);
    expect(screen.queryByTestId('settings-unsaved-count')).toBeNull();
  });
});
