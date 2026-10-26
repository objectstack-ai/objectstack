// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Every node shape the flow designer SEEDS must survive the spec's own
 * loader** (#3316).
 *
 * The designer does not only render authored metadata — it *produces* it. Two
 * places mint a brand-new node before the author has touched anything:
 *
 * 1. `defaultNodeExtras()` (`flow-canvas-parts.tsx`), spread into every node
 *    added from the palette or inserted on an edge (`FlowCanvas` `addNode` /
 *    `insertOnEdge`).
 * 2. `addReviseLoop()` (`FlowCanvas.tsx`), the one-click ADR-0044 revision
 *    loop, which writes its `wait` node inline.
 *
 * When a spec property is retired via `retiredKey()` (`z.never().optional()`)
 * a seed still writing it is not "an extra key that gets stripped" — it is a
 * hard `FlowNodeSchema.parse()` error, so the designer emits metadata its own
 * runtime refuses and publish 422s on a flow the author never edited. That is
 * exactly what `waitEventConfig.onTimeout` did between spec 17 (framework
 * #4158) and #3316: the label overrides for the retired keys were dropped from
 * `i18n.ts`, and the hand-written form dropped the fields
 * (`inspectors/flow-node-config.ts`), but the two *seed* sites kept writing
 * `onTimeout: 'fail'`.
 *
 * This file is the ratchet that makes the NEXT retirement land red here
 * instead of at publish time. It renders (rather than staying a pure `.test.ts`
 * in the cheap `unit` project) because the second producer only exists inside
 * a React callback — and keeping both producers in one file is the point: the
 * #3316 failure mode was fixing the visible consumer and missing the other.
 *
 * **Two criteria, deliberately different** (key-vs-value reachability):
 *
 * - The spec-structured sibling blocks (`waitEventConfig` / `connectorConfig` /
 *   `boundaryConfig`) are strict objects and their seeds are complete, so the
 *   assertion is full `safeParse` green on the whole node — a *value* verdict.
 * - The `config`-rooted seeds (`approval` / `notify` / `http`) are invisible to
 *   `FlowNodeSchema`, whose `config` is a permissive `z.record()`; and they are
 *   deliberately PARTIAL (an author still supplies notify's `title`, http's
 *   `url`), so demanding full parse green would assert something the seed never
 *   promised. Their assertion is therefore key-level: every seeded key must be
 *   a live, declared key of the spec's published node-config Zod — never a
 *   `[REMOVED]` tombstone.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Automation from '@objectstack/spec/automation';
// The Zod wrapper-key vocabulary — one list, read by the `.mjs` CI gates that
// walk the same internals (objectui#6923, ruled 2026-08-31).
import { ZOD_WRAPPER_KEYS } from '@object-ui/test-support';
import { FlowCanvas } from './FlowCanvas';
import { NODE_PALETTE, defaultNodeExtras, defaultNodeLabel } from './flow-canvas-parts';

afterEach(cleanup);

/**
 * objectui#4701 — same escape as objectui#4699 (`FlowCanvas.test.tsx`),
 * different file: the single `render(<FlowCanvas />)` below (in the
 * revision-loop describe block) pulls in `useFlowNodePalette` →
 * `useActionDescriptors`, which fires a real `GET ${apiBase()}/automation/
 * actions` on mount and aborts it on unmount. This vitest `dom` project's
 * happy-dom answers `fetch` with its own `http`-core-backed polyfill (not
 * undici), so with nothing listening the abort races a real socket and Node
 * prints an unhandled `Error: socket hang up` / `ECONNRESET`. None of the
 * assertions in this file exercise the server overlay, so answer the
 * endpoint with "engine absent" (404) — the same degrade
 * `useActionDescriptors` already falls back from — instead of letting a
 * real connection open.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(String(url)).toBe('/api/v1/automation/actions');
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface ZodIssue {
  path: PropertyKey[];
  message: string;
}
interface ZodLike {
  shape?: Record<string, { description?: string } | undefined>;
  unwrap?: () => ZodLike;
  safeParse: (value: unknown) => { success: boolean; error?: { issues: ZodIssue[] } };
}

const spec = Automation as unknown as Record<string, ZodLike | undefined>;
const FlowNodeSchema = spec.FlowNodeSchema!;

/** Unwrap `.optional()` / `.default()` wrappers down to the object schema. */
function unwrapped(schema: ZodLike | undefined): ZodLike | undefined {
  let cur = schema;
  for (let i = 0; cur && !cur.shape && typeof cur.unwrap === 'function' && i < 5; i++) {
    cur = cur.unwrap();
  }
  return cur;
}

/**
 * The object shape behind a schema that may be wrapped in a pipe/effect.
 *
 * `unwrapped()` walks `.optional()`/`.default()` only, and cannot get past a
 * `ZodPipe` or refinement wrapper — which exposes neither `.shape` nor
 * `.unwrap`. `FlowNodeSchema` became one in @objectstack/spec 17.0.0-rc.6, so
 * the `FlowNodeSchema.shape?.[block]` reads below silently became `undefined`
 * and `liveKeys` failed on its own "expected a Zod object schema" guard. The
 * blocks are unchanged upstream, so this restores the access path rather than
 * the expectation. Same repair, same reason, as
 * `inspectors/flow-node-config.spec-reconciliation.test.ts`.
 */
function objectShape(schema: unknown, depth = 0): Record<string, ZodLike | undefined> | null {
  const s = schema as Record<string, unknown> | undefined;
  if (!s || depth > 8) return null;
  if (s.shape) return s.shape as Record<string, ZodLike | undefined>;
  const def = (s._def ?? s.def) as Record<string, unknown> | undefined;
  if (!def) return null;
  if (def.shape) return def.shape as Record<string, ZodLike | undefined>;
  for (const key of ZOD_WRAPPER_KEYS) {
    const found = def[key] ? objectShape(def[key], depth + 1) : null;
    if (found) return found;
  }
  return null;
}

/** `FlowNodeSchema`'s block shape, resolved through any wrapper (see above). */
const flowNodeShape = objectShape(FlowNodeSchema);

/**
 * Keys a Zod object schema declares as LIVE authoring surface. `retiredKey()`
 * tombstones stay in the shape so their rejection can carry the upgrade
 * prescription (spec `shared/retired-key.ts` marks them `[REMOVED]`), but they
 * are not authorable — the same filter `flow-node-config.spec-reconciliation`
 * uses, for the same reason: counting them would false-pass exactly this drift.
 */
function liveKeys(schema: ZodLike | undefined): string[] {
  const shape = unwrapped(schema)?.shape;
  expect(shape, 'expected a Zod object schema exposing .shape').toBeDefined();
  return Object.keys(shape ?? {})
    .filter((k) => {
      const description = shape![k]?.description;
      return !(typeof description === 'string' && description.startsWith('[REMOVED]'));
    })
    .sort();
}

/** Tombstoned (retired) keys of a Zod object schema — never authorable. */
function retiredKeys(schema: ZodLike | undefined): string[] {
  const shape = unwrapped(schema)?.shape ?? {};
  return Object.keys(shape)
    .filter((k) => {
      const description = shape[k]?.description;
      return typeof description === 'string' && description.startsWith('[REMOVED]');
    })
    .sort();
}

/** Readable `safeParse` failure — the spec's own prescription, verbatim. */
function explain(result: { success: boolean; error?: { issues: ZodIssue[] } }): string {
  if (result.success) return 'ok';
  return (result.error?.issues ?? [])
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

/**
 * Node types whose seeds this file covers: everything the palette offers, plus
 * the `defaultNodeExtras` branches reachable from outside it (`start` / `end`
 * bootstrap nodes, `boundary_event` attached by the
 * boundary affordance). Driven off `NODE_PALETTE` so a palette entry added
 * without a spec-valid seed fails here rather than at publish.
 */
const SEEDED_TYPES: string[] = [
  ...new Set([...NODE_PALETTE.map((p) => p.type), 'start', 'end', 'boundary_event']),
];

describe('designer node seeds ↔ spec FlowNodeSchema (#3316)', () => {
  it.each(SEEDED_TYPES)(
    '`%s`: a freshly added node parses as a spec FlowNode',
    (type) => {
      // Exactly what `FlowCanvas.addNode` builds before the author edits it.
      const node = { id: 'node_1', type, label: defaultNodeLabel(type), ...defaultNodeExtras(type) };
      const result = FlowNodeSchema.safeParse(node);
      expect(result.success, `${type} seed rejected by FlowNodeSchema:\n${explain(result)}`).toBe(true);
    },
  );

  it('seeds no key the spec has retired in a structured sibling block', () => {
    // The direct #3316 ratchet, with a message that names the offender: the
    // next `retiredKey()` on one of these blocks fails HERE, pointing at the
    // seed, rather than as an opaque `invalid_type: never` at publish time.
    const BLOCKS = ['waitEventConfig', 'connectorConfig', 'boundaryConfig'] as const;
    const offenders: string[] = [];
    for (const type of SEEDED_TYPES) {
      const extras = defaultNodeExtras(type) as Record<string, unknown>;
      for (const block of BLOCKS) {
        const seeded = extras[block];
        if (!seeded || typeof seeded !== 'object') continue;
        const retired = retiredKeys(flowNodeShape?.[block]);
        const live = liveKeys(flowNodeShape?.[block]);
        for (const key of Object.keys(seeded as Record<string, unknown>)) {
          if (retired.includes(key)) offenders.push(`${type}.${block}.${key} (retired in spec)`);
          else if (!live.includes(key)) offenders.push(`${type}.${block}.${key} (not declared by spec)`);
        }
      }
    }
    expect(offenders, 'designer seeds writing non-authorable keys').toEqual([]);
  });

  it('`wait` seeds the timer flavor WITH a duration — no retired timeout keys', () => {
    // Pinned by name because this is the shape #3316 found in the field: the
    // wait node has NO timeout (framework#4158), it resumes when its timer
    // elapses or its signal arrives. Through `@objectstack/spec` 17.4.0
    // `timerDuration` was the author's to fill; 17.5.0 refuses a timer wait
    // without one (it would park the run forever), so the seed carries the
    // spec's own example value, ruled by the maintainer on objectui#11088
    // (decision 2 = A) and changeable there (objectui#11073).
    expect(defaultNodeExtras('wait')).toEqual({ waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' } });
    // …and the refusal it answers is real, on the same instrument: the old seed
    // is refused at `waitEventConfig.timerDuration` by name.
    const oldSeed = Automation.FlowNodeSchema.safeParse({
      id: 'w', type: 'wait', label: 'Wait', waitEventConfig: { eventType: 'timer' },
    });
    expect(oldSeed.success).toBe(false);
    expect(oldSeed.success ? [] : oldSeed.error.issues.map((i) => i.path.join('.'))).toContain(
      'waitEventConfig.timerDuration',
    );
  });

  it('the config-rooted seeds write only live keys of the spec node-config Zods', () => {
    // Key-level, not full-parse: these seeds are deliberately partial (notify
    // has no `title` yet, http no `url`) and `FlowNodeSchema.config` is a
    // permissive record that cannot see them at all.
    const CASES: ReadonlyArray<{ type: string; schema: string }> = [
      { type: 'approval', schema: 'ApprovalNodeConfigSchema' },
      { type: 'notify', schema: 'NotifyConfigSchema' },
      { type: 'http', schema: 'HttpConfigSchema' },
    ];
    for (const { type, schema } of CASES) {
      const zod = spec[schema];
      // Feature-detected: a spec that predates the export skips rather than
      // false-passing (it arms itself on the next `@objectstack/spec` bump).
      if (!zod) continue;
      const seeded = Object.keys((defaultNodeExtras(type).config ?? {}) as Record<string, unknown>);
      expect(seeded.length, `${type}: expected a config-rooted seed`).toBeGreaterThan(0);
      const live = liveKeys(zod);
      expect(
        seeded.filter((k) => !live.includes(k)),
        `${type}: seeded config keys that ${schema} does not declare as live`,
      ).toEqual([]);
    }
  });
});

describe('FlowCanvas one-click revision loop ↔ spec FlowNodeSchema (#3316)', () => {
  it('the wait node the revision-loop button creates parses as a spec FlowNode', () => {
    const patches: Array<Record<string, unknown>> = [];
    render(
      <FlowCanvas
        nodes={[{ id: 'appr', type: 'approval', label: 'Manager approval' }]}
        edges={[]}
        editable
        designMode
        selectedId={null}
        onSelect={() => {}}
        onPatch={(partial) => patches.push(partial)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add revision loop' }));

    expect(patches, 'the revision-loop button must emit one patch').toHaveLength(1);
    const nodes = patches[0]!.nodes as Array<Record<string, unknown>>;
    const waitNode = nodes.find((n) => n.type === 'wait');
    expect(waitNode, 'the patch must add a wait node').toBeDefined();

    const result = FlowNodeSchema.safeParse(waitNode);
    expect(
      result.success,
      `revision-loop wait node rejected by FlowNodeSchema:\n${explain(result)}`,
    ).toBe(true);
    // The signal flavor is the point of the affordance — assert it survived.
    expect(waitNode!.waitEventConfig).toEqual({ eventType: 'signal', signalName: 'revision' });
  });
});
