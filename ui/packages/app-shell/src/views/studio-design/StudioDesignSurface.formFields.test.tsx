// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data pillar's form-preview must not rebuild `ObjectForm`'s `fields`
 * array on every render — objectui#4574.
 *
 * Re-derived on current `origin/main` (2026-08-19, after objectui#5272 /
 * objectui#5278 both touched `packages/app-shell`): `DataPillar`'s form
 * preview (`viewMode === 'form'`, `formMode === 'preview'`) still built the
 * real runtime `ObjectForm`'s schema inline —
 *
 *   fields: readFields(objDraft.fields).entries.map((e) => e.name)
 *     .filter((n) => !STUDIO_SYSTEM_FIELD_NAMES.has(n)),
 *
 * — allocating a fresh array on every render of the pillar. `ObjectForm`
 * lists `schema.fields` in its field-generation effect's dependency array BY
 * IDENTITY (plugin-form/src/ObjectForm.tsx, the effect ending in
 * `setFormFields(generatedFields)`), so a fresh array re-runs that effect on
 * every keystroke-level re-render of the pillar.
 *
 * ## Why this is a SECOND memo, not a reuse of the grid's `gridColumns`
 *
 * `DataPillar` already memoizes an analogous array for the grid
 * (objectui#4567's `gridColumns`, keyed on `objDraft.fields`), but its filter
 * ALSO drops a field literally named `actions` (the grid pins its own
 * row-actions column). The form has no such column, so a data field named
 * `actions` must stay editable there. Sharing `gridColumns` would silently
 * change which fields the form renders — exactly what this card's scope
 * forbids. The fix is a second memo, `formFields`, with the grid's filter
 * minus the `actions` exclusion.
 *
 * ## Why this is NOT a #4567 — and what that means for the test
 *
 * Traced `ObjectForm`'s effects on current `main`
 * (plugin-form/src/ObjectForm.tsx): the field-generation effect
 * (`schema.fields` in its deps) is a pure derivation ending in
 * `setFormFields(generatedFields)` — it makes no `dataSource` call. The
 * object-schema fetch (`dataSource.getObjectSchema`, deps: `schema.objectName,
 * dataSource, hasInlineFields`) and the record load (`dataSource.findOne`,
 * gated on `schema.recordId && mode !== 'create'`) are SEPARATE effects, and
 * neither lists `schema.fields` in its dependency array. So the cost fixed
 * here is redundant recomputation (plus one extra `setFormFields` render
 * pass) — never a duplicate query. Unlike the #4567 suite
 * (`StudioDesignSurface.gridColumns.test.tsx`), this suite does NOT assert a
 * find()-count delta as its primary claim — that would prove something false,
 * since there was never a duplicate query to eliminate. It asserts IDENTITY
 * STABILITY of the `fields` array `ObjectForm` receives, plus (as a real,
 * exercised invariant rather than a vacuous one — the wrapper below still
 * renders the REAL `ObjectForm`) that no new fetch appears across re-renders
 * that don't change `objDraft.fields`. That is also the card's own "why this
 * is NOT a #4567" section, read as its test brief.
 *
 * This suite drives the REAL producer (`DataPillar`), not a reconstruction of
 * it — the defect is a property of how that component builds its schema.
 * Only the leaf consumer (`ObjectForm`) is wrapped, and only to observe the
 * `schema.fields` reference it is called with; the wrapper still renders the
 * real `ObjectForm` via `React.createElement`, so the suite still exercises
 * the real field-generation effect end to end.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'status', label: 'Status', type: 'text' },
  ],
};

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

/** find/findOne/getObjectSchema are the "no new fetch" measurement. */
function createDataSource() {
  return {
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectDef),
  };
}

/**
 * Module-scope so the `useAdapter` mock factory (hoisted) closes over the
 * binding rather than a value, and so the reference handed to the pillar is
 * STABLE across renders — an adapter that changed identity per render would
 * manufacture the very churn these tests measure. Same convention as
 * StudioDesignSurface.gridColumns.test.tsx (objectui#4567).
 */
let dataSource = createDataSource();

/**
 * Every `schema.fields` reference `ObjectForm` is called with, in render
 * order. The wrapper below still renders the REAL `ObjectForm` (via
 * `React.createElement`) — this array only records the identity of the prop
 * it was handed, it does not replace the component's own behaviour.
 */
let fieldsSnapshots: unknown[] = [];

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-form')>();
  return {
    ...actual,
    ObjectForm: (props: { schema?: { fields?: unknown } }) => {
      fieldsSnapshots.push(props.schema?.fields);
      return React.createElement(actual.ObjectForm, props as never);
    },
  };
});

import { DataPillar } from './StudioDesignSurface';
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';

beforeEach(() => {
  dataSource = createDataSource();
  fieldsSnapshots = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Long enough for the mount's own fetch to settle before a measurement. */
const SETTLE_MS = 300;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

/**
 * Renders the real pillar under a parent that can force a no-op re-render.
 * `DataPillar` is not memoized, so a parent render re-renders it — which is
 * exactly the Studio steady state the card describes (its whole schema is a
 * fresh object literal each time).
 */
function Harness(): React.ReactElement {
  const [, force] = React.useState(0);
  return (
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <button type="button" data-testid="rerender" onClick={() => force((n) => n + 1)}>
        rerender
      </button>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>
  );
}

/**
 * Mount, land on the auto-selected object's grid (the default tab — its
 * mount settling first mirrors the #4567 suite's `mountSettledGrid`), then
 * switch to Form ⇄ Preview, which is the ONLY place `DataPillar` renders the
 * real runtime `ObjectForm` (Form ⇄ Layout renders `ObjectFormDesigner`
 * instead, which does not consume this array).
 */
async function mountSettledFormPreview(): Promise<void> {
  render(<Harness />);
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled(), { timeout: 4000 });
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled(), { timeout: 4000 });
  await settle();
}

describe('Studio Data pillar form preview — `fields` keeps a stable identity (#4574)', () => {
  it('three no-op re-renders leave `schema.fields` at the SAME identity, and issue no new fetch', async () => {
    await mountSettledFormPreview();
    expect(fieldsSnapshots.length).toBeGreaterThan(0);
    const stable = fieldsSnapshots[fieldsSnapshots.length - 1];

    const findBefore = dataSource.find.mock.calls.length;
    const findOneBefore = dataSource.findOne.mock.calls.length;
    const schemaBefore = dataSource.getObjectSchema.mock.calls.length;

    // Nothing changes: same object, same fields. Before the fix each of these
    // rebuilt the inline `fields` array, handing ObjectForm a fresh reference
    // (and re-running its field-generation effect) every time.
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));
    await settle();

    // Identity stability — the card's actual claim. Every render since the
    // settled preview mount handed ObjectForm the SAME `fields` array
    // reference, not merely an equal-by-value one.
    expect(fieldsSnapshots.length).toBeGreaterThan(1);
    for (const snap of fieldsSnapshots) {
      expect(snap).toBe(stable);
    }

    // No new fetch appears. There never was a duplicate query here — asserted
    // against the REAL ObjectForm (rendered through the wrapper above), not a
    // stub, so this is an exercised invariant: the field-generation effect
    // that used to re-run on every render is a pure derivation, and the
    // schema fetch / record load are separate effects that never depended on
    // `schema.fields`. A passing find()-count-drop assertion here would prove
    // something false; this suite deliberately asserts flatness instead.
    expect(dataSource.find.mock.calls.length).toBe(findBefore);
    expect(dataSource.findOne.mock.calls.length).toBe(findOneBefore);
    expect(dataSource.getObjectSchema.mock.calls.length).toBe(schemaBefore);
  });

  /**
   * The dependency must stay LIVE, not be defeated. Mirrors the
   * must-not-change pin in StudioDesignSurface.gridColumns.test.tsx
   * (objectui#4567): "+ Add field" mutates `objDraft.fields`, so a NEW
   * `fields` identity can only arrive through the memo's live dependency. A
   * memo that froze the array (or returned a constant) would turn this red.
   *
   * objectui#12511 — Preview offers no Add field (the object header no longer
   * holds one), so the field is added from the Layout toolbar and the preview
   * is opened again. `DataPillar` itself stays mounted across the round trip,
   * so its memo is the same one: a frozen memo hands the re-mounted
   * `ObjectForm` the very array it had before, and this stays red.
   */
  it('a REAL field change still produces a NEW `fields` identity', async () => {
    await mountSettledFormPreview();
    const before = fieldsSnapshots[fieldsSnapshots.length - 1];

    fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
    await addFieldFromFormToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(
      () => {
        const after = fieldsSnapshots[fieldsSnapshots.length - 1];
        expect(after).not.toBe(before);
      },
      { timeout: 4000 },
    );
  });
});
