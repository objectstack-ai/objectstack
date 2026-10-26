// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9340 — the flow `loop` group's "Item variable" box hinted
 * `currentItem` while `LoopConfigSchema` applies a DIFFERENT identifier to the
 * omitted key.
 *
 * A `text` control's `placeholder` is drawn muted and is never written, so what
 * it states is exactly: *this is the name you get if you leave the box blank.*
 * When the box hinted one identifier and the schema applied another, an author
 * who read the hint and wrote that reference in the loop body got an
 * **unresolved reference at run time** — the box was blank, so the schema's own
 * default was the name that actually got bound.
 *
 * ⭐ The sharp part, and why the pin reads BOTH signs: the hinted identifier is
 * not INVALID. Typed into the box it is accepted and materialises verbatim
 * (pinned below). So this was never a value the contract refuses — it was a
 * hint naming something the author had to type for it to be true, in a slot
 * that means the opposite. That is the whole reason the repair is a corrected
 * hint and not a lenient parse.
 *
 * ## ⛔ What this card is NOT
 *
 *  - **`map` is out of scope.** Its twin already agreed. It is pinned here as
 *    the LIT CONTROL — a sweep arm that must redden if the twin ever drifts, so
 *    the `loop` assertions are not paired with a dead one.
 *  - **Declaring a `defaultValue` would NOT have fixed this.** The
 *    `defaultValue` doc comment on `FlowConfigField` names exactly three read
 *    sites — `controllerAdmits`, the `boolean` control, the `select` control —
 *    and a `text` control is none of them, so such a declaration is inert on
 *    screen. Wiring `text` / `number` to read it is objectui#9109's fence 4,
 *    ⛔ not this card's. Pinned below as an absence WITH a lit control, so the
 *    `undefined` is a deliberate non-declaration and not a field shape that
 *    never carries one.
 *
 * ## How the `loop` descriptor is identified — structurally, never by line
 *
 * The two rows are near-identical text and the file's line numbers have moved
 * twice already (objectui#9444, objectui#9451 both landed in it). So nothing
 * here addresses a line: every reading goes through `fieldsForNodeType(type)`,
 * the same alias-aware accessor `FlowNodeInspector` itself calls, which hands
 * back the owning group's own array. The cross-group sweep below then walks
 * EVERY node type rather than the two this card knows about, so a third group
 * growing the key is caught rather than assumed away.
 *
 * ⛔ Every expectation about the identifier is derived from the installed
 * `LoopConfigSchema` / `MapConfigSchema` at run time, never from a literal
 * restated here (AGENTS.md #9).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

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
import { fieldsForNodeType, localizeFlowFields, FLOW_NODE_CONFIG_TYPES } from './flow-node-config';
import type { MetadataSelection } from '../preview-registry';
// ⛔ The `/automation` subpath is load bearing — these read `undefined` off the
// package root, and any `.parse` on them then throws.
import { LoopConfigSchema, MapConfigSchema } from '@objectstack/spec/automation';

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

/** The key both groups spell, and the only one this card is about. */
const ITERATOR_KEY = 'iteratorVariable';

/**
 * The identifier a schema APPLIES to the omitted key, read off the installed
 * spec by parsing a config that omits it. This is the single derivation every
 * expectation below routes through — ⛔ no literal identifier appears in this
 * file's assertions.
 */
function appliedIterator(schema: { safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown> } }, base: Record<string, unknown>) {
  const parsed = schema.safeParse(base);
  expect(parsed.success, 'the base config the derivation rides on must PARSE, or the reading is dead').toBe(true);
  return parsed.data![ITERATOR_KEY];
}

// `collection` is a value slot: `@objectstack/spec` 18 refuses the `{…}` template
// there and takes a CEL value envelope (objectui#12030).
const LOOP_BASE = { collection: { dialect: 'cel', source: 'vars.leadList' } };
const MAP_BASE = { collection: { dialect: 'cel', source: 'vars.items' }, flowName: 'one_task_signoff' };

/** The spec-applied identifier per node type — the sweep's right-hand side. */
const APPLIED_BY_TYPE: Record<string, () => unknown> = {
  loop: () => appliedIterator(LoopConfigSchema, LOOP_BASE),
  map: () => appliedIterator(MapConfigSchema, MAP_BASE),
};

/* ── 1. The contract, read off the installed spec ─────────────────────────── */

describe('what the loop contract applies to an omitted `iteratorVariable` (objectui#9340)', () => {
  it('applies a real identifier — the VACUITY GUARD every row below rides on', () => {
    // If the spec stopped defaulting this key, `applied` would go `undefined`
    // and every equality in this file would pass by comparing two absences.
    // That change must REDDEN here rather than hollow out the suite quietly.
    const applied = appliedIterator(LoopConfigSchema, LOOP_BASE);
    expect(typeof applied, 'LoopConfigSchema still materialises an identifier for the omitted key').toBe('string');
    expect(String(applied).length, 'and it is not the empty string').toBeGreaterThan(0);
  });

  it('materialises it from a parse that ACCEPTS — with a refusal in the same reading', () => {
    // Both signs, one reading: the ACCEPT is what makes the REFUSE a
    // measurement rather than a schema that says no to everything, and the
    // REFUSE is what makes the ACCEPT more than a schema that says yes to
    // everything.
    const accepted = LoopConfigSchema.safeParse(LOOP_BASE);
    expect(accepted.success, 'the lit control: a loop config omitting the key is ACCEPTED').toBe(true);
    expect(
      Object.keys(accepted.data as Record<string, unknown>),
      'and the key it did not carry comes back materialised',
    ).toContain(ITERATOR_KEY);

    const bogus = LoopConfigSchema.safeParse({ ...LOOP_BASE, notAKeyOnThisShape: 'x' });
    expect(bogus.success, 'while an undeclared sibling key is REFUSED — the shape is strict').toBe(false);
  });

  it('⭐ pushes PAST the first accepted value: the WRONG hint was itself a VALID value', () => {
    // objectui#9336's lesson applied — a sibling constraint can hide behind the
    // first accept. Here what hides behind it is the card's actual mechanism:
    // the hinted identifier is not refused, it is simply not what a BLANK box
    // yields. Both readings, one test, so neither can be read alone.
    const applied = appliedIterator(LoopConfigSchema, LOOP_BASE);

    const typedWrong = LoopConfigSchema.safeParse({ ...LOOP_BASE, [ITERATOR_KEY]: 'currentItem' });
    expect(typedWrong.success, 'typed explicitly, `currentItem` is ACCEPTED — this was never an invalid value').toBe(true);
    expect(
      typedWrong.data![ITERATOR_KEY],
      'and it materialises verbatim: an author who TYPES it gets it',
    ).toBe('currentItem');
    expect(
      applied,
      'but the author who leaves the box blank — which is what a placeholder describes — gets the OTHER one',
    ).not.toBe('currentItem');

    // The value-level guard that survives behind the key-level one.
    expect(
      LoopConfigSchema.safeParse({ ...LOOP_BASE, [ITERATOR_KEY]: '' }).success,
      'and an empty identifier is refused on VALUE, not on key — a second constraint behind the first accept',
    ).toBe(false);
  });

  it('and `map` — the fenced-off twin — applies the SAME identifier (the lit control)', () => {
    expect(
      appliedIterator(MapConfigSchema, MAP_BASE),
      'map already agreed with its own hint; this card moves nothing there',
    ).toBe(appliedIterator(LoopConfigSchema, LOOP_BASE));
  });
});

/* ── 2. The descriptor table, reached through the owning group ─────────────── */

describe('the loop group hints the identifier the spec applies (objectui#9340)', () => {
  /** ⛔ Never a line number: the owning group's own array, alias-aware. */
  const iteratorRowOf = (type: string) => fieldsForNodeType(type).find((f) => f.id === ITERATOR_KEY);

  it('hints it on `loop` — with the group proven non-empty in the same reading', () => {
    const row = iteratorRowOf('loop');
    expect(row, 'the loop group still offers an Item variable control').toBeDefined();
    expect(
      row!.placeholder,
      'and its hint is the identifier LoopConfigSchema applies to the omitted key',
    ).toBe(appliedIterator(LoopConfigSchema, LOOP_BASE));
    // The lit control: the SAME lookup finds the group's other row, so the hit
    // above is not a group that went degenerate.
    expect(
      fieldsForNodeType('loop').map((f) => f.id),
      'the loop group still carries its Collection row beside it',
    ).toContain('collection');
  });

  it('reaches the same row through the `for_each` ALIAS — the accessor, not the file order', () => {
    expect(
      iteratorRowOf('for_each')?.placeholder,
      'alias-aware resolution lands on the same descriptor',
    ).toBe(iteratorRowOf('loop')?.placeholder);
  });

  it('⛔ declares NO `defaultValue` on it — with a lit control proving the slot is reachable', () => {
    // The fence the card draws: a `text` control reads `placeholder` and none of
    // the three sites the `defaultValue` doc comment names, so declaring one
    // here would be inert on screen and is ⛔ not a fix. objectui#9109 fence 4
    // owns the wiring that would make it mean something.
    expect(iteratorRowOf('loop')!.kind, 'the control is a `text` one').toBe('text');
    expect(
      iteratorRowOf('loop')!.defaultValue,
      'no inert declaration was added to call the hint fixed',
    ).toBeUndefined();
    // The lit control: descriptors in this SAME table do carry the slot, so the
    // `undefined` above is a deliberate non-declaration, not a shape that can
    // never hold one.
    const declaring = FLOW_NODE_CONFIG_TYPES.flatMap((t) => fieldsForNodeType(t)).filter((f) => f.defaultValue !== undefined);
    expect(declaring.length, 'other rows in this table DO declare a default').toBeGreaterThan(0);
  });

  it('reaches the zh-CN author too — the overlay translates the LABEL, never the hint', () => {
    // Worth one reading because it decides whether this card is one fix or two:
    // `localizeFlowFields` overlays label / help / options / columns, so the
    // placeholder is locale-invariant and the corrected hint is the only one
    // that exists. The lit control is the label, which the SAME call DOES
    // change — so a no-op overlay cannot be what makes the hint survive.
    const en = fieldsForNodeType('loop');
    const zh = localizeFlowFields('loop', en, 'zh-CN');
    const enRow = en.find((f) => f.id === ITERATOR_KEY)!;
    const zhRow = zh.find((f) => f.id === ITERATOR_KEY)!;

    expect(zhRow.label, 'the lit control: the overlay really did fire on this row').not.toBe(enRow.label);
    expect(
      zhRow.placeholder,
      'and it left the hint alone — the zh author reads the same spec-applied identifier',
    ).toBe(appliedIterator(LoopConfigSchema, LOOP_BASE));
  });

  it('sweeps EVERY node type — so a third group growing the key cannot drift unseen', () => {
    // The structural identification, generalised: walk every type the table
    // holds a group for, keep the ones whose group owns this key, and hold each against
    // the identifier ITS OWN schema applies. `map` is in here as the live lit
    // control — if the fenced-off twin ever drifts, this arm reddens.
    const offering = FLOW_NODE_CONFIG_TYPES.filter((t) => iteratorRowOf(t) !== undefined);

    expect(
      offering.length,
      'the lit control: the sweep found groups, so "none drifted" is not an empty set',
    ).toBeGreaterThan(0);
    expect(offering, 'the subject of this card is in it').toContain('loop');
    expect(offering, 'and so is the twin it fences off').toContain('map');

    for (const type of offering) {
      const derive = APPLIED_BY_TYPE[type];
      // A group growing this key with no schema mapped here is a REAL failure,
      // not a silently skipped row — that is how the third instance would hide.
      expect(derive, `no spec schema is mapped for the \`${type}\` group's \`${ITERATOR_KEY}\``).toBeDefined();
      expect(
        iteratorRowOf(type)!.placeholder,
        `the \`${type}\` group hints the identifier its own schema applies`,
      ).toBe(derive!());
    }
  });
});

/* ── 3. What the author actually sees ─────────────────────────────────────── */

describe('and the author reads the right identifier off the box (objectui#9340)', () => {
  function renderNode(type: string, config: Record<string, unknown>) {
    return render(
      <FlowNodeInspector
        type="flow"
        name="renewal"
        draft={{ nodes: [{ id: 'n1', type, label: 'N', config }], edges: [] }}
        selection={{ kind: 'node', id: 'n1' } as MetadataSelection}
        onPatch={vi.fn()}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />,
    );
  }

  /** The rendered Item-variable input of the currently-mounted loop inspector. */
  const itemVariableInput = () => {
    const label = fieldsForNodeType('loop').find((f) => f.id === ITERATOR_KEY)!.label;
    const group = screen.getByText(label).parentElement as HTMLElement;
    return group.querySelector('input') as HTMLInputElement | null;
  };

  it('draws the spec-applied identifier as the placeholder of the box when nothing is stored', () => {
    renderNode('loop', { ...LOOP_BASE });
    const input = itemVariableInput();
    expect(input, 'the lit control: this render DID draw the Item variable row').not.toBeNull();
    expect(
      input!.placeholder,
      'the muted hint names the identifier a BLANK box actually binds at run time',
    ).toBe(appliedIterator(LoopConfigSchema, LOOP_BASE));
    // And it is a hint, not a value: nothing was written into the node.
    expect(input!.value, 'the placeholder is drawn, never committed').toBe('');
  });

  it('still shows a STORED identifier verbatim — the hint is not a coercion', () => {
    // The other half of the push-past reading, on screen: `currentItem` is a
    // legitimate value an author may have typed, and correcting the HINT must
    // not rewrite it (AGENTS.md #0.1 — no lenient renderer-side rewriting).
    renderNode('loop', { ...LOOP_BASE, [ITERATOR_KEY]: 'currentItem' });
    const input = itemVariableInput();
    expect(input!.value, 'a stored identifier survives the corrected hint untouched').toBe('currentItem');
  });
});
