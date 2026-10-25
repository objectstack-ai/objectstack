// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rendered "inactive values retained" affordance (objectui#6499, Option C).
 *
 * The predicate is pinned in `flow-node-config.inactiveRetained.test.ts`; this
 * file pins what the AUTHOR sees, because the whole ruling is about what is
 * visible on screen. A hidden-but-stored dependent value keeps rendering — the
 * ruling forbids deleting it — so the only thing that can tell the author it is
 * inert is this notice beside it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';

/* ── The `meta/object` double (objectui#7307) ─────────────────────────
 * `FlowNodeInspector` renders `FlowReferenceField` for every reference-kind key
 * on the selected node, and that field resolves its combobox options through
 * `useMetadataListOptions` — `MetadataClient.list(type)`, i.e.
 * `GET /api/v1/meta/object` over the authenticated wrapper, which resolves the
 * GLOBAL `fetch` at call time (`packages/auth/src/createAuthenticatedFetch.ts`,
 * the bare `await fetch(input, ...)`). Under happy-dom that global is a real HTTP
 * client and the document URL defaults to `http://localhost:3000`, so the
 * relative path resolved to a live socket. Traced from the guard's attribution
 * point: `FlowReferenceField.tsx:389` → `metadata-client.ts:764` → that wrapper.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on, carried
 * by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx` and by
 * this burn-down's earlier batches. Deliberately NOT a blanket network stub: it
 * records every URL it is handed and `afterEach` fails on any URL outside the
 * route it serves, so an escape to somewhere else reds here instead of vanishing
 * into the hook's `.catch`.
 *
 * What it answers, and why that changes no assertion here: an EMPTY registry, in
 * the `{ type, items: [] }` envelope the server sends and `MetadataClient.list`
 * parses (it also accepts a bare array; both parse to the same rows). Empty is
 * load-bearing — the failing request landed in the hook's `.catch`, which sets
 * `{ options: [], loading: false }`, so an empty registry yields byte-identical
 * output to what these cases have always rendered, while a seeded one would put
 * options into every reference combobox in the tree. The route is matched on the
 * PATHNAME because `MetadataClient.list` appends `?package=` / `?preview=draft`
 * for scoped callers; the full URL is what gets recorded.
 *
 * `headers` is part of the answer, not decoration: the authenticated wrapper
 * reads `response.headers.get('set-auth-token')` on every API call before the
 * caller ever sees the body.
 * ──────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = '/api/v1/meta/object';

/**
 * `GET /api/v1/meta/position` — the approver picker's candidate list since
 * `@objectstack/spec` 18 binds the `position` approver to the metadata registry
 * (objectstack#22710, objectui#12030). An approval node's inspector asks it on
 * mount, so the double serves it as an empty registry too; every OTHER route is
 * still an escape the teardown below refuses.
 */
const META_POSITION_ROUTE = '/api/v1/meta/position';
const SERVED_ROUTES = [META_OBJECT_ROUTE, META_POSITION_ROUTE];

/** Every URL this file's renders handed the global `fetch`, in request order. */
let metaCalls: string[] = [];

/** The route key of a recorded URL: its pathname, without the scope query. */
const routeOf = (url: string) => url.split('?')[0];

/** Serve `GET /api/v1/meta/object` and `/meta/position` as empty registries; record everything. */
function installMetaObjectDouble() {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      const route = routeOf(url);
      if (!SERVED_ROUTES.includes(route)) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      const type = route.slice(route.lastIndexOf('/') + 1);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type, items: [] }) };
    }),
  );
}

beforeEach(installMetaObjectDouble);

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into `useMetadataListOptions`'s `.catch`.
  expect(metaCalls.filter((url) => !SERVED_ROUTES.includes(routeOf(url)))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch` — this replaces the bare
  // `afterEach(cleanup)` that used to stand here, it does not drop it. Vitest
  // runs `afterEach` hooks in reverse registration order, so this file's
  // teardown runs before the root setup's RTL cleanup: unstubbing first would
  // leave the tree mounted with the real global back in place, and a mount
  // effect settling in that window escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

function draftWith(config: Record<string, unknown>, type = 'approval') {
  return { nodes: [{ id: 'gate', type, label: 'Gate', config }], edges: [] };
}

function renderInspector(draft: Record<string, unknown>, readOnly = false) {
  const onPatch = vi.fn();
  const utils = render(
    <FlowNodeInspector
      type="flow"
      name="renewal"
      draft={draft}
      selection={{ kind: 'node', id: 'gate' } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={readOnly}
      locale="en-US"
    />,
  );
  return { onPatch, ...utils };
}

const notices = () => screen.queryAllByTestId('inactive-retained');

describe('the affordance appears exactly when a value is hidden-but-stored', () => {
  it('appears for the escalation residue the card measured', () => {
    // enable → fill → toggle back off → save. The stored payload the UI has
    // been manufacturing: `{ enabled: false, timeoutHours: 24 }`.
    renderInspector(draftWith({ escalation: { enabled: false, timeoutHours: 24 } }));
    const found = notices();
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toMatch(/kept, not in effect/i);
    expect(found[0].textContent).toMatch(/controlling field is off/i);
    expect(found[0].getAttribute('data-inactive-retained')).toBe('controller-off');
    // The value itself is still on screen and still stored — nothing pruned.
    expect(screen.getByDisplayValue('24')).toBeInTheDocument();
  });

  it('does NOT appear when the controller is on — same stored value', () => {
    renderInspector(draftWith({ escalation: { enabled: true, timeoutHours: 24 } }));
    expect(notices()).toHaveLength(0);
    expect(screen.getByDisplayValue('24')).toBeInTheDocument(); // control: the field IS rendered
  });

  it('does NOT appear when the controller is off and nothing is stored', () => {
    renderInspector(draftWith({ escalation: { enabled: false } }));
    expect(notices()).toHaveLength(0);
    expect(screen.queryByDisplayValue('24')).not.toBeInTheDocument();
  });

  it('does NOT appear on a node with no gated fields at all', () => {
    renderInspector(draftWith({ objectName: 'contract', outputVariable: 'r' }, 'create_record'));
    expect(notices()).toHaveLength(0);
  });

  it('appears once per retained dependent, not once for the group', () => {
    renderInspector(draftWith({ escalation: { enabled: false, timeoutHours: 24, escalateTo: 'sre-lead' } }));
    expect(notices()).toHaveLength(2);
  });

  it('uses the no-controller wording for a `__legacy__` render-only key', () => {
    renderInspector({ nodes: [{ id: 'gate', type: 'decision', label: 'Gate', config: { condition: 'amount > 10000' } }], edges: [] });
    const found = notices();
    expect(found).toHaveLength(1);
    expect(found[0].getAttribute('data-inactive-retained')).toBe('no-controller');
    expect(found[0].textContent).toMatch(/nothing activates this field/i);
    // and NOT the controller wording — there is no toggle to point at
    expect(found[0].textContent).not.toMatch(/controlling field is off/i);
  });
});

describe('clearing is deliberate, author-initiated, and goes through the ordinary field commit', () => {
  it('offers a clear button that removes the retained key', () => {
    const { onPatch } = renderInspector(draftWith({ escalation: { enabled: false, timeoutHours: 24 } }));
    const clear = within(notices()[0]).getByRole('button', { name: /clear value/i });
    fireEvent.click(clear);
    const patched = onPatch.mock.calls.at(-1)![0] as any;
    // The retained key is gone. This row used to go on "the controller the
    // author actually set stays" and pin `{ enabled: false }` — the stub
    // `ApprovalNodeConfigSchema` refuses for its missing `timeoutHours`.
    // objectui#11660 (triage 6003792818, rule 4): with its last retained value
    // cleared, the block would hold nothing but its switch, and the author's
    // OFF survives as no block — which the spec reads as off too. A block that
    // still held another value would be kept, `enabled: false` and all.
    expect(patched.nodes[0].config?.escalation).toBeUndefined();
  });

  it('does not clear anything until the author clicks — rendering is a read', () => {
    const { onPatch } = renderInspector(draftWith({ escalation: { enabled: false, timeoutHours: 24 } }));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('offers no clear button in a read-only inspector', () => {
    renderInspector(draftWith({ escalation: { enabled: false, timeoutHours: 24 } }), true);
    expect(notices()).toHaveLength(1); // the author can still SEE the state
    expect(within(notices()[0]).queryByRole('button', { name: /clear value/i })).toBeNull();
  });
});

describe('assertions that must NOT move', () => {
  it('an ordinary live field renders with no notice and no clear button', () => {
    renderInspector(draftWith({ escalation: { enabled: true, timeoutHours: 24 } }));
    expect(screen.queryByRole('button', { name: /clear value/i })).toBeNull();
    expect(notices()).toHaveLength(0);
  });

  it('the retained value survives a re-render — the affordance never prunes on its own', () => {
    const draft = draftWith({ escalation: { enabled: false, timeoutHours: 24 } });
    const { onPatch, rerender } = renderInspector(draft);
    rerender(
      <FlowNodeInspector
        type="flow"
        name="renewal"
        draft={draft}
        selection={{ kind: 'node', id: 'gate' } as MetadataSelection}
        onPatch={onPatch}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />,
    );
    expect(onPatch).not.toHaveBeenCalled();
    expect((draft as any).nodes[0].config.escalation).toEqual({ enabled: false, timeoutHours: 24 });
  });
});
