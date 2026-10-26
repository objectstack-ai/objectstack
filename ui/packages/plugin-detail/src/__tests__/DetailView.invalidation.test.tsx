/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression guard for objectui#2269 (AGENTS.md Commandment #8: "refresh
 * data, don't rebuild UI").
 *
 * DetailView self-fetches its record. After a write, the host used to bump a
 * `key=` to REMOUNT it — which re-ran the fetch but also nuked scroll /
 * collapsed sections / in-progress inline edits. The fix: DetailView
 * subscribes to the data-invalidation bus and REFETCHES IN PLACE. This test
 * pins that contract so a future change can't silently regress to
 * remount-on-save:
 *   - a matching `notifyDataChanged` re-runs findOne and renders fresh data,
 *   - the component instance is NOT remounted (a persistent mount marker
 *     survives),
 *   - a non-matching change does nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';
import { notifyDataChanged } from '@object-ui/react';
import type { DetailViewSchema } from '@object-ui/types';

const OBJECT_SCHEMA = {
  name: 'contact',
  fields: { name: { type: 'text', label: 'Name' } },
};

function makeDataSource(nameByCall: string[]) {
  let call = 0;
  const findOne = vi.fn(async () => ({ id: 'C-1', name: nameByCall[Math.min(call++, nameByCall.length - 1)] }));
  return {
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
    findOne,
  } as any;
}

const schema: DetailViewSchema = {
  type: 'detail-view',
  objectName: 'contact',
  resourceId: 'C-1',
  fields: [{ name: 'name', label: 'Name' }],
};

/**
 * A mount marker that persists in module scope so we can tell "refetched in
 * place" (marker stable) from "remounted" (marker id changes). Rendered as a
 * sibling so it shares DetailView's mount lifecycle under the same parent.
 */
let markerMounts = 0;
function MountMarker() {
  React.useEffect(() => { markerMounts += 1; }, []);
  return null;
}

/**
 * objectui#3339 — this file's schema carries `objectName` + `resourceId`, so
 * every render mounts `useRecordEditable` twice (update + delete). With no
 * `SchemaRendererProvider` in the tree the hook falls back to the GLOBAL fetch
 * (by design, for standalone embeds), which under happy-dom is a REAL request
 * to the default origin — 8 live `POST /api/v1/security/explain` calls per run,
 * failing fire-and-forget into `connect ECONNREFUSED 127.0.0.1:3000` on stderr
 * while the suite stayed green.
 *
 * Answer the probe from a double rather than the network. `visible: true`
 * reproduces the old observable behaviour exactly (the hook fails open on a
 * failed request), so the refetch-in-place contract below is unchanged — the
 * shape of the probe itself is asserted in `DetailView.test.tsx`.
 */
function installExplainDouble() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
}

describe('DetailView — refetch in place on data invalidation (objectui#2269)', () => {
  beforeEach(() => {
    markerMounts = 0;
    __clearRecordEditableCache();
    installExplainDouble();
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('re-runs findOne and renders fresh data when its record is invalidated, without remounting', async () => {
    const ds = makeDataSource(['Ada', 'Ada Lovelace']);
    render(
      <>
        <MountMarker />
        <DetailView schema={schema} dataSource={ds} />
      </>,
    );

    await waitFor(() => expect(screen.getAllByText('Ada').length).toBeGreaterThan(0));
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(markerMounts).toBe(1);

    // A write to this record lands on the bus (what a save/action does now).
    await act(async () => { notifyDataChanged({ objectName: 'contact', recordId: 'C-1' }); });

    await waitFor(() => expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0));
    expect(ds.findOne).toHaveBeenCalledTimes(2); // refetched
    expect(markerMounts).toBe(1); // NOT remounted — the whole point
  });

  it('ignores changes to other records / objects', async () => {
    const ds = makeDataSource(['Ada', 'SHOULD_NOT_APPEAR']);
    render(<DetailView schema={schema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByText('Ada').length).toBeGreaterThan(0));

    await act(async () => {
      notifyDataChanged({ objectName: 'contact', recordId: 'OTHER' });
      notifyDataChanged({ objectName: 'invoice' });
    });

    // No refetch — the fetch stays at its first call.
    await new Promise((r) => setTimeout(r, 50));
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('SHOULD_NOT_APPEAR')).not.toBeInTheDocument();
  });
});
