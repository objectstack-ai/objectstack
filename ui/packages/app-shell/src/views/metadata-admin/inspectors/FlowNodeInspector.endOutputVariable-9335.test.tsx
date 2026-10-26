// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9335 — the flow `end` group offered an "Output variable" control
 * writing `config.outputVariable`, a key `EndConfigSchema` refuses BY NAME.
 *
 * `EndConfigSchema` is a STRICT object whose entire key surface is `outcome`
 * and `message`. Anything an author typed in that box therefore produced a
 * document the loader refuses (`unrecognized_keys` at parse, a 422 on save) —
 * the control could only ever make a flow unloadable, and the form gave the
 * author no way to tell which of the group's two rows had done it.
 *
 * The repair is a REMOVAL, not a lenient path: Commandment #0.1 forbids the
 * renderer growing tolerance around a contract, and adding the key to the spec
 * is a different lane. `outputVariable` is real product vocabulary — it is just
 * not an `end` node's, and an `end` node terminates rather than producing a
 * value to bind.
 *
 * ## What makes each reading a reading rather than a dead probe
 *
 * Every negative below is paired with a lit control differing in exactly one
 * way, because a zero whose control is also dead proves nothing:
 *
 *  - the spec rows print BOTH signs from one parse: `{outcome:'completed'}` is
 *    ACCEPTED in the same reading in which the `outputVariable` rows are
 *    refused, so the refusals are not a schema that refuses everything.
 *  - the descriptor absence is paired with the SAME lookup finding `outcome`
 *    and `message` in the SAME group — so the group did not go empty.
 *  - the rendered absence is paired with the IDENTICAL query finding an
 *    "Output variable" control on a `script` node one render away — so the null
 *    is a removal scoped to `end`, not a renderer that drew nothing and not a
 *    query that can never match (objectui#8350's lesson).
 *  - the "other groups keep theirs" sweep asserts a NON-EMPTY set, so "`end` is
 *    not in it" cannot pass by the set being empty.
 *
 * ## Why no `__legacy__` render-only row was left behind
 *
 * That treatment (`condition` on `decision`, the retired `script` keys) is for
 * keys the schema ACCEPTS and the runtime ignores — showing them costs nothing
 * because the document still loads. A key the schema REFUSES is different: a
 * stored one is already unloadable, and it is NOT hidden by the descriptor's
 * absence. An unowned config key falls through to the Advanced (JSON) block,
 * which auto-opens when non-empty — pinned below, together with the clear.
 *
 * ## The un-hiding (objectui#9336, which has landed)
 *
 * An unrecognized key short-circuits `EndConfigSchema`'s `superRefine`: while
 * this box existed, a `refused` end that used it reported ONLY
 * `unrecognized_keys` and NEVER the missing-`message` refusal. So this defect
 * MASKED objectui#9336's contract. Both halves of that masking are read off the
 * installed spec below.
 *
 * ⛔ Every expectation about what the schema accepts is derived from the
 * installed `EndConfigSchema` at run time, never from a literal restated here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Same doubles as the sibling flow-node suites: the engine config-schema hook
// publishes nothing (so the STATIC table is what renders), and object fields
// resolve empty.
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { fieldsForNodeType, FLOW_NODE_CONFIG_TYPES } from './flow-node-config';
import type { MetadataSelection } from '../preview-registry';
// ⛔ The `/automation` subpath is load bearing — these read `undefined` off the
// package root, and any `.parse` on them then throws.
import { EndConfigSchema, FlowNodeSchema } from '@objectstack/spec/automation';

/* ── The `meta/*` double ───────────────────────────────────────────────────
 * `FlowNodeInspector` renders `FlowReferenceField` for reference-kind keys, and
 * that field resolves options through a real `fetch` under happy-dom. Served
 * from a recorder whose `afterEach` fails on any URL outside the metadata
 * routes, so an escape to a data endpoint reds here instead of vanishing into a
 * `.catch`.
 * ────────────────────────────────────────────────────────────────────────── */
const META_PREFIX = '/api/v1/meta/';
let metaCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }),
      };
    }),
  );
});

afterEach(() => {
  expect(metaCalls.filter((url) => !routeOf(url).startsWith(META_PREFIX))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

function renderNode(type: string, config: Record<string, unknown>) {
  const onPatch = vi.fn();
  const utils = render(
    <FlowNodeInspector
      type="flow"
      name="renewal"
      draft={{ nodes: [{ id: 'n1', type, label: 'N', config }], edges: [] }}
      selection={{ kind: 'node', id: 'n1' } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { onPatch, ...utils };
}

const endFields = () => fieldsForNodeType('end');
/** The author-facing label the removed row carried; queried, never asserted present. */
const OUTPUT_VARIABLE_LABEL = 'Output variable';
const outputVariableControl = () => screen.queryByText(OUTPUT_VARIABLE_LABEL);
/** The Advanced (JSON) editor, found by the placeholder `FlowNodeInspector` gives it. */
const advancedEditor = () => screen.queryByPlaceholderText('{ }') as HTMLTextAreaElement | null;

/* ── 1. The contract, read off the installed spec ─────────────────────────── */

describe('the contract that refuses `outputVariable` on an end node (objectui#9335)', () => {
  const parse = (config: Record<string, unknown>) =>
    FlowNodeSchema.safeParse({ id: 'e', type: 'end', label: 'E', config });

  it('declares a key surface that has no room for `outputVariable`', () => {
    // THE VACUITY GUARD. Every row below is about a key being absent from a
    // contract; a spec that started declaring it would make this card's removal
    // wrong rather than right, and these rows must not pass quietly through
    // that change.
    expect(
      Object.keys((EndConfigSchema as unknown as { shape: Record<string, unknown> }).shape),
      'EndConfigSchema still declares exactly the pair, and `outputVariable` is not in it',
    ).toEqual(['outcome', 'message']);
  });

  it('refuses it BY NAME — with the accepted rows in the same reading', () => {
    // Both signs, one reading. The ACCEPTED rows are what make the REFUSED ones
    // a measurement rather than a schema that says no to everything.
    expect(parse({ outcome: 'completed' }).success, 'the lit control: `completed` alone is ACCEPTED').toBe(true);
    expect(
      parse({ outcome: 'refused', message: 'Refused: {{ record.name }} is a confirmed duplicate' }).success,
      'the second lit control: a refusal WITH its message is ACCEPTED',
    ).toBe(true);

    const withKey = parse({ outcome: 'completed', outputVariable: 'result' });
    expect(withKey.success, 'adding `outputVariable` to an otherwise accepted config REFUSES it').toBe(false);
    expect(
      withKey.error!.issues.map((i) => i.code),
      'and the refusal is by NAME — an unrecognized key, not a value complaint',
    ).toEqual(['unrecognized_keys']);
    expect(
      parse({ outputVariable: 'result' }).success,
      'and alone it is refused too — there is no config this key belongs to',
    ).toBe(false);
  });

  it('and an unrecognized key MASKS the `superRefine` — which is what objectui#9336 lost to this box', () => {
    // The un-hiding, stated as the two readings that differ in exactly one key.
    const missingMessage = parse({ outcome: 'refused' });
    expect(missingMessage.success, '`refused` with no message is refused').toBe(false);
    expect(
      missingMessage.error!.issues.map((i) => i.code),
      'and the refusal an author needs to see is the cross-field one',
    ).toEqual(['custom']);

    const masked = parse({ outcome: 'refused', outputVariable: 'result' });
    expect(masked.success, 'the same node carrying the removed key is also refused').toBe(false);
    expect(
      masked.error!.issues.map((i) => i.code),
      'but ONLY as an unrecognized key — the missing-`message` refusal never reaches the author',
    ).toEqual(['unrecognized_keys']);
    expect(
      masked.error!.issues.some((i) => i.code === 'custom'),
      'objectui#9336 stayed invisible for as long as this form could produce the key',
    ).toBe(false);
  });
});

/* ── 2. The descriptor table ──────────────────────────────────────────────── */

describe('the end group no longer offers the key (objectui#9335)', () => {
  it('declares no `outputVariable` field — and the group is not empty', () => {
    expect(
      endFields().find((f) => f.id === 'outputVariable'),
      'the end group offers no control for a key its own contract refuses by name',
    ).toBeUndefined();
    // The lit control: the SAME lookup still finds the group's real surface, so
    // the `undefined` above is a removal and not an empty / missing group.
    expect(
      endFields().map((f) => f.id),
      'the two keys EndConfigSchema declares are exactly the two this group offers',
    ).toEqual(['outcome', 'message']);
  });

  it('leaves every OTHER group that declares the key untouched', () => {
    // ⛔ The fence this card had to come past: the string occurs many times in
    // this table, and on the CRUD / script / subflow / http / map / legacy
    // groups the key IS declared by the spec and legitimate. Derived by sweep,
    // never restated as a count.
    const types = [...FLOW_NODE_CONFIG_TYPES, 'action'];
    const stillOffering = types.filter((t) => fieldsForNodeType(t).some((f) => f.id === 'outputVariable'));

    expect(
      stillOffering.length,
      'the lit control: other groups DO still declare it, so `end`’s absence is not an empty sweep',
    ).toBeGreaterThan(0);
    expect(stillOffering, 'and `end` is not one of them').not.toContain('end');
    // A named member of that set, so the sweep cannot pass on a degenerate list.
    expect(stillOffering, 'the `script` group keeps its own — the key is real vocabulary there').toContain('script');
  });
});

/* ── 3. The rendered inspector ────────────────────────────────────────────── */

describe('and the author never sees the box again (objectui#9335)', () => {
  it('draws no "Output variable" control on an end node — with the SAME query lit one render away', () => {
    renderNode('end', { outcome: 'refused', message: 'why' });
    expect(outputVariableControl(), 'the end inspector offers no Output variable row').toBeNull();
    expect(
      screen.queryByText(endFields().find((f) => f.id === 'outcome')!.label),
      'the lit control: this render DID draw the end inspector',
    ).not.toBeNull();
    cleanup();

    // The paired positive, differing in exactly one way: the node type.
    renderNode('script', { function: 'score_lead' });
    expect(
      outputVariableControl(),
      'and the IDENTICAL query finds the control on a script node — so the null above is a scoped removal',
    ).not.toBeNull();
  });

  it('does not HIDE a stored value — it falls through to Advanced, visible and clearable', () => {
    // The migration reading, stated as a render. A flow carrying this key on an
    // end node cannot have loaded under the current contract, so there is no
    // fleet of live documents to rewrite; what matters is that a document which
    // DOES carry it is not made invisible by the descriptor going away.
    const { onPatch } = renderNode('end', { outcome: 'refused', message: 'why', outputVariable: 'result' });
    expect(outputVariableControl(), 'still no typed control for the refused key').toBeNull();

    const advanced = advancedEditor();
    expect(advanced, 'the Advanced (JSON) block is on screen for the unowned key').not.toBeNull();
    expect(
      JSON.parse(advanced!.value),
      'and it carries the stored value verbatim — nothing is hidden from the author who has to clear it',
    ).toEqual({ outputVariable: 'result' });

    // Clearing it there is the whole repair path an existing document needs.
    fireEvent.change(advanced!, { target: { value: '{}' } });
    fireEvent.blur(advanced!);
    const written = onPatch.mock.calls.at(-1)![0] as { nodes: Array<Record<string, unknown>> };
    const config = written.nodes[0].config as Record<string, unknown>;
    expect('outputVariable' in config, 'clearing Advanced removes the key the contract refuses').toBe(false);
    expect(
      FlowNodeSchema.safeParse({ id: 'n1', type: 'end', label: 'Done', config }).success,
      'and what is left LOADS — the form-owned keys survived the Advanced commit',
    ).toBe(true);
  });
});
