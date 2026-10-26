// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data pillar's grid refetches when the plugin ObjectView's
 * `renderListView` slot signals a mutation — objectui#4549.
 *
 * The slot emits its refresh signal on TWO keys carrying ONE number: plugin-view's
 * ObjectView holds a single `refreshKey` useState and hands it to the slot both as
 * `schema.refreshTrigger` (plugin-view/src/ObjectView.tsx:1057) and as a bare
 * `refreshKey` argument (:1063). Only the first is a real input — `ListView` lists
 * `schema.refreshTrigger` in its fetch effect's dependency array
 * (plugin-list/src/ListView.tsx:1609), whereas `refreshKey` is a prop of neither
 * `ListView` nor anything it renders, which is the dead forward objectui#4528
 * measured and removed.
 *
 * So the Data pillar was never missing the refresh: `renderStudioGridList` spreads
 * the slot schema into ListView's schema, and `refreshTrigger` rides that spread.
 * These tests pin that live channel, because severing it would be invisible by
 * inspection — the Studio grid re-renders constantly anyway (its schema is a fresh
 * object literal every render), so "the list looks like it updates" either way.
 *
 * The harness mimics the producer exactly — ONE counter feeding both keys — since
 * that is the only combination plugin-view can emit; bumping one while holding the
 * other fixed would measure an input that does not exist. The last test pins that
 * lockstep against the real plugin-view ObjectView, so the harness cannot drift
 * away from the contract it stands in for.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { ObjectView as PluginObjectView } from '@object-ui/plugin-view';
import { renderStudioGridList } from './StudioDesignSurface';

const objectSchema = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'status', label: 'Status', type: 'text' },
  ],
};

/**
 * Hoisted so its identity is stable across renders. ListView derives its expand
 * fields from `schema.columns`, and that derivation is in the fetch effect's
 * dependency chain by IDENTITY — so a fresh array literal per render refetches on
 * every render, regardless of the refresh signal. Studio really does hand it a
 * fresh array (StudioDesignSurface's `table.fields` is rebuilt inline), so that is
 * a real defect, but a separate one: it is upstream of this slot and would mask
 * the value-vs-render distinction these tests exist to measure. Filed separately.
 */
const STABLE_COLUMNS = ['name', 'status'];

function createDataSource() {
  const find = vi.fn(async () => []);
  return {
    find,
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectSchema),
  };
}

/**
 * The slot payload plugin-view's ObjectView builds, reduced to the keys that
 * matter here. `counter` stands in for its single `refreshKey` state, which feeds
 * both keys. The schema object is rebuilt per call on purpose: the real producer
 * hands the slot a fresh literal every render, so a mechanism keyed on object
 * identity rather than on the VALUE would refetch on every render.
 */
function slotPayload(counter: number, dataSource: unknown) {
  return {
    schema: {
      type: 'list-view',
      objectName: 'showcase_task',
      columns: STABLE_COLUMNS,
      refreshTrigger: counter,
    } as Record<string, unknown>,
    dataSource,
  };
}

/** Drives the slot the way plugin-view's ObjectView drives it. */
function Harness({ dataSource }: { dataSource: unknown }): React.ReactElement {
  const [counter, setCounter] = React.useState(0);
  const [, forceRender] = React.useState(0);
  return (
    <div>
      <button type="button" data-testid="bump" onClick={() => setCounter((n) => n + 1)}>
        bump
      </button>
      <button type="button" data-testid="rerender" onClick={() => forceRender((n) => n + 1)}>
        rerender
      </button>
      {renderStudioGridList(slotPayload(counter, dataSource))}
    </div>
  );
}

/** Long enough for the mount's own fetch to settle before a measurement. */
const SETTLE_MS = 250;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Studio Data pillar grid — the renderListView slot refresh signal', () => {
  it('refetches when the slot bumps its refresh signal', async () => {
    const ds = createDataSource();
    const { getByTestId } = render(<Harness dataSource={ds} />);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await settle();
    const before = ds.find.mock.calls.length;

    fireEvent.click(getByTestId('bump'));

    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(before));
  });

  it('keys off the signal VALUE, not renders — a re-render carrying the same value does not refetch', async () => {
    const ds = createDataSource();
    const { getByTestId } = render(<Harness dataSource={ds} />);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await settle();
    const before = ds.find.mock.calls.length;

    // Three renders, each handing the slot a fresh schema literal with an
    // unchanged counter — the Studio's steady state.
    fireEvent.click(getByTestId('rerender'));
    fireEvent.click(getByTestId('rerender'));
    fireEvent.click(getByTestId('rerender'));
    await settle();

    expect(ds.find.mock.calls.length).toBe(before);
  });

  it('the plugin ObjectView emits the refresh signal on schema.refreshTrigger, in lockstep with the slot refreshKey', async () => {
    const seen: { refreshTrigger: unknown; refreshKey: unknown }[] = [];
    const ds = createDataSource();

    render(
      <PluginObjectView
        schema={{ type: 'object-view', objectName: 'showcase_task' } as never}
        dataSource={ds as never}
        renderListView={(props: Record<string, unknown>) => {
          const s = props.schema as Record<string, unknown>;
          seen.push({ refreshTrigger: s?.refreshTrigger, refreshKey: props.refreshKey });
          return <div data-testid="slot" />;
        }}
      />,
    );

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));

    // The dead `refreshKey` argument is still emitted by the producer (this card
    // only stops the Studio consumer from declaring a parameter it cannot use).
    // Both keys must carry the one counter, which is what lets the harness above
    // drive `refreshTrigger` alone and still be faithful to the real slot.
    for (const s of seen) {
      expect(typeof s.refreshTrigger).toBe('number');
      expect(s.refreshTrigger).toBe(s.refreshKey);
    }
  });
});
