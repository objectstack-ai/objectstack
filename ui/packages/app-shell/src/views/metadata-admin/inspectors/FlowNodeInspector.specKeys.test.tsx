// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **FlowNodeInspector writes only keys `FlowNodeSchema` accepts** (objectui#6287).
 *
 * The inspector used to offer a "Description" text field that committed
 * `node.description`. `FlowNodeSchema` is `.strict()` (objectstack#4001) and
 * refuses that key BY NAME:
 *
 *     FlowNodeSchema.safeParse({ id, type, label, description, config })
 *       -> unrecognized_keys: ["description"]
 *
 * By this package's own established reading of that mechanism, the cost is not
 * untidiness — it is an unsavable draft: "the key surfaces as
 * `unrecognized_keys` in the live client validation and as a 422 on save"
 * (`flow-canvas-layout.withCanonicalGeometry`, on the identical `ui` case).
 * So the field did not merely describe a shape the contract refuses, it
 * PRODUCED one, on every keystroke.
 *
 * ## Why the obvious pins are ghosts, and what this file pins instead
 *
 * Dropping `description?` from a local `interface` proves nothing on its own,
 * for two independent reasons measured on this card:
 *
 * 1. The node the inspector edits is typed `InspectorFlowNode` (the exported shape
 *    `locateFlowNode` returns), NOT the inspector's own module-local
 *    declaration — so narrowing only the local copy changes no read.
 * 2. Both shapes carry a deliberately load-bearing `[k: string]: unknown`
 *    index signature (the canvas round-trips node properties it does not
 *    itself understand, and dropping them on save would be data loss). An
 *    index signature absorbs every excess property, so an object literal
 *    carrying `description` type-checks in BOTH worlds: a `@ts-expect-error`
 *    negative test does not go red before the fix, it goes red AFTER it, as an
 *    unused directive. Measured, not assumed.
 *
 * The two assertions below survive both traps:
 *
 * - **Compile time**: the DECLARED members of `InspectorFlowNode` — index signature
 *   stripped — must be a subset of the spec's own `FlowNode` keys. That closes
 *   the whole class rather than the one key: any future member added to the
 *   read type that the contract refuses turns this red.
 * - **Runtime**: what the inspector actually EMITS must parse clean through the
 *   real `FlowNodeSchema`, including for a stored node that already carries
 *   `description` — which heals on the author's first edit, exactly as the
 *   retired `ui` geometry does.
 *
 * Both are guarded against lying: the type assertions carry `IsAny` /
 * non-empty-key-set probes (a degenerate probe passes every assignability test
 * while proving nothing — objectstack#4171), and the runtime assertions carry a
 * positive control proving this really is the strict schema and that the
 * queries used to prove a control ABSENT can find controls that are present.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as Automation from '@objectstack/spec/automation';
import type { FlowNode as SpecFlowNode } from '@objectstack/spec/automation';
import type { InspectorFlowNode } from './flow-nested-selection';

// Same stubs the sibling suite uses: the engine config-schema hook is empty so
// the hardcoded field groups render, and the field catalog resolves without a
// network client.
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';

/* ── The `meta/object` double (objectui#7307) ───────────────────
 * `FlowNodeInspector` renders `FlowReferenceField` for every reference-kind key
 * on the selected node, and that field resolves its combobox options through
 * `useMetadataListOptions` (`FlowReferenceField.tsx:638`) -> `MetadataClient.list(type)`,
 * i.e. `GET /api/v1/meta/object` over the authenticated wrapper, which resolves
 * the GLOBAL `fetch` at call time (`packages/auth/src/createAuthenticatedFetch.ts`,
 * the bare `await fetch(input, ...)`). Under happy-dom that global is a real HTTP
 * client and the document URL defaults to `http://localhost:3000`, so the relative
 * path resolved to a live socket: measured on `fc32921aa`, three escapes to
 * `http://localhost:3000/api/v1/meta/object`, one per render, while this file
 * stayed green — which is objectui#6640 exactly.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on, carried
 * by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx` and by
 * this burn-down's earlier batches, most recently the sibling
 * `FlowNodeInspector.inactiveRetained.test.tsx`. Deliberately NOT a blanket
 * network stub: it records every URL it is handed and `afterEach` fails on any URL
 * outside the route it serves, so an escape to somewhere else reds here instead of
 * vanishing into the hook's `.catch`.
 *
 * What it answers, and why that changes no assertion here: an EMPTY registry, in
 * the `{ type, items: [] }` envelope the server sends and `MetadataClient.list`
 * parses (it also accepts a bare array; both parse to the same rows). Empty is
 * load-bearing — the failing request landed in the hook's `.catch`, which sets
 * `{ options: [], loading: false }`, so an empty registry yields byte-identical
 * output to what these cases have always rendered, while a seeded one would put
 * options into every reference combobox in the tree. This file asserts on the
 * ABSENCE of a `Description` control and on what `onPatch` emits, so seeding
 * options would be a silent change of subject. The route is matched on the
 * PATHNAME because `MetadataClient.list` appends `?package=` / `?preview=draft`
 * for scoped callers; the full URL is what gets recorded.
 *
 * `headers` is part of the answer, not decoration: the authenticated wrapper
 * reads `response.headers.get('set-auth-token')` on every API call before the
 * caller ever sees the body.
 * ─────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = '/api/v1/meta/object';

/** Every URL this file's renders handed the global `fetch`, in request order. */
let metaCalls: string[] = [];

/** The route key of a recorded URL: its pathname, without the scope query. */
const routeOf = (url: string) => url.split('?')[0];

/** Serve `GET /api/v1/meta/object` as an empty registry; record everything. */
function installMetaObjectDouble() {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      if (routeOf(url) !== META_OBJECT_ROUTE) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type: 'object', items: [] }) };
    }),
  );
}

beforeEach(installMetaObjectDouble);

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into `useMetadataListOptions`'s `.catch`.
  expect(metaCalls.filter((url) => routeOf(url) !== META_OBJECT_ROUTE)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch` — this replaces the bare
  // `afterEach(cleanup)` that used to stand here, it does not drop it. Vitest
  // runs `afterEach` hooks in reverse registration order, so this file's
  // teardown runs before the root setup's RTL cleanup: unstubbing first would
  // leave the tree mounted with the real global back in place, and a mount
  // effect settling in that window escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

interface ZodIssue {
  code?: string;
  keys?: string[];
  path: PropertyKey[];
  message: string;
}
interface ZodLike {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: ZodIssue[] } };
}
const spec = Automation as unknown as Record<string, ZodLike | undefined>;
const FlowNodeSchema = spec.FlowNodeSchema!;

const explain = (r: { success: boolean; error?: { issues: ZodIssue[] } }) =>
  r.success ? '' : JSON.stringify(r.error?.issues ?? [], null, 1);

/**
 * A draft whose first node ALREADY carries the refused key — the state an
 * author reached with the old Description field, and the one that must heal.
 */
function makeDraft() {
  return {
    nodes: [
      { id: 'greet', type: 'screen', label: 'Greet', description: 'says hello', config: { title: 'Hi' } },
      { id: 'done', type: 'end', label: 'Done' },
    ],
    edges: [{ source: 'greet', target: 'done' }],
  };
}

function renderInspector(selection: MetadataSelection, draft: Record<string, unknown> = makeDraft()) {
  const onPatch = vi.fn();
  const utils = render(
    <FlowNodeInspector
      type="flow"
      name="welcome"
      draft={draft}
      selection={selection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { onPatch, ...utils };
}

const lastPatch = (onPatch: ReturnType<typeof vi.fn>) => onPatch.mock.calls.at(-1)![0] as any;

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * The DECLARED members of a type — its index signature removed.
 *
 * `keyof InspectorFlowNode` is `string | number` while the index signature is there,
 * which is why the naive key comparison cannot see this defect at all.
 */
type Declared<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

describe('the node read type declares no key FlowNodeSchema refuses (#6287)', () => {
  it('is pinned at compile time', () => {
    type DeclaredNodeKeys = keyof Declared<InspectorFlowNode>;
    type SpecNodeKeys = keyof SpecFlowNode;

    // Guard against a degenerate probe: were either side `any`, or the
    // index-signature strip to leave nothing behind, every assertion below
    // would pass while measuring nothing.
    type _SpecNotAny = Assert<Equal<IsAny<SpecFlowNode>, false>>;
    type _LocalNotAny = Assert<Equal<IsAny<InspectorFlowNode>, false>>;
    type _StripLeftKeys = Assert<Equal<Equal<DeclaredNodeKeys, never>, false>>;
    type _SpecHasKeys = Assert<Extends<'label', SpecNodeKeys>>;
    // …and that the strip really removed the index signature: `description`
    // is assignable to the RAW type in both worlds (that is the ghost), so a
    // comparison that still saw the index signature could never go red.
    type _IndexSignatureGone = Assert<Equal<Extends<'anyStringAtAll', DeclaredNodeKeys>, false>>;

    // THE PIN. Not "is compatible with" — no declared member may be a key the
    // strict contract refuses. `description` is what made this red.
    type _NoRefusedKey = Assert<Equal<Exclude<DeclaredNodeKeys, SpecNodeKeys>, never>>;

    expect(true).toBe(true);
  });
});

describe('what FlowNodeInspector emits parses through the real FlowNodeSchema (#6287)', () => {
  it('the schema under test is the strict one that refuses `description`', () => {
    // Blind-instrument guard: if this parse ever SUCCEEDS, every assertion
    // below is vacuous and the premise of #6287 has moved.
    const refused = FlowNodeSchema.safeParse({ id: 'greet', type: 'screen', label: 'Greet', description: 'x' });
    expect(refused.success).toBe(false);
    const issue = refused.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, explain(refused)).toBeDefined();
    expect(issue!.keys).toContain('description');
    // …and that the same node WITHOUT it parses, so the refusal is about the
    // key and not about the rest of the fixture.
    expect(FlowNodeSchema.safeParse({ id: 'greet', type: 'screen', label: 'Greet' }).success).toBe(true);
  });

  it('offers no control that writes a key the contract refuses', () => {
    renderInspector({ kind: 'node', id: 'greet' });
    // Positive control for the query itself: the fields that SHOULD be there
    // are found by the same lookup that must come up empty below.
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
    expect(screen.getByLabelText('ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).toBeNull();
  });

  it('heals a stored node that already carries `description` on the first edit', () => {
    const { onPatch } = renderInspector({ kind: 'node', id: 'greet' });
    fireEvent.change(screen.getByDisplayValue('Greet'), { target: { value: 'Greet the user' } });
    const node = lastPatch(onPatch).nodes[0];
    expect(node.label).toBe('Greet the user'); // the edit itself landed
    expect(node.config).toEqual({ title: 'Hi' }); // unrelated keys survive
    expect('description' in node).toBe(false);
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success, explain(parsed)).toBe(true);
  });

  it('heals through the config-field write path too', () => {
    const { onPatch } = renderInspector({ kind: 'node', id: 'greet' });
    // The screen node's `title` config field — a different write path
    // (`setField` -> loc.write) than the top-level label edit above.
    fireEvent.change(screen.getByDisplayValue('Hi'), { target: { value: 'Hello' } });
    const node = lastPatch(onPatch).nodes[0];
    expect(node.config.title).toBe('Hello');
    const parsed = FlowNodeSchema.safeParse(node);
    expect(parsed.success, explain(parsed)).toBe(true);
  });
});
