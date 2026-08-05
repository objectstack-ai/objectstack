// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5225 / #5393] Every predicate write this app ships declares its bulk intent.
 *
 * ## The defect this pins
 *
 * `showcase_inquiry_purge`'s `delete_record` node deleted by the predicate
 * `{ status: 'closed' }` and declared no bulk intent. The data engine accepts a
 * write without `options.multi` only when `filter` names ONE row by a scalar
 * `id`, so every run of the flow — both the declarative endpoint
 * (`POST /api/v1/apps/showcase/inquiries/purge`) and the built-in trigger route
 * — failed on that node with
 *
 *     Node 'purge' failed: delete_record(showcase_inquiry) failed:
 *     Delete requires an ID or options.multi=true
 *
 * and reported `acted: 0`. The showcase's own coverage manifest claims
 * `delete_record` is demonstrated by this flow, so the delete half of the CRUD
 * quartet was `declared ≠ enforced` (PD #10) from the day it was written until
 * #5112's boot probes hit it.
 *
 * The fix is a DECLARATION, not a rewrite: until #5393 (PR #5485) no spelling of
 * bulk intent existed on the node config at all, which is why the third triage
 * round correctly refused to route around the engine with a
 * get→loop→delete-by-id rewrite (PD #5 workaround). With `multi` declared, the
 * one-line fix is the long-term-correct shape.
 *
 * ## Why this file sweeps instead of asserting one node
 *
 * A test naming only the purge node would go green for the wrong reason the day
 * someone adds a second predicate write. So the invariant below is stated over
 * EVERY `delete_record` / `update_record` node in `allFlows`, and it is
 * two-sided — which matters, because `multi` cuts both ways:
 *
 *   - a predicate write WITHOUT `multi: true` is refused by the engine at run
 *     time (the #5225 failure, silent in every unit test that fakes the engine);
 *   - `multi: true` with an absent or empty `filter` is a declared WHOLE-OBJECT
 *     write — every row, by declaration. Authoring-time linting for that shape
 *     is queued as #5482, and this app is meant to be its "must be zero
 *     warnings" sample, so the second side is asserted here too.
 *
 * Node configs are additionally driven through the REAL spec schemas rather than
 * inspected as plain objects: the claim is about a VALUE verdict (`multi` is
 * `true`, `filter` is a non-empty predicate), not merely about a key being an
 * authorable surface, so full `safeParse` green is the right bar.
 */

import { describe, it, expect } from 'vitest';
import { DeleteRecordConfigSchema, UpdateRecordConfigSchema } from '@objectstack/spec/automation';

import { allFlows } from '../src/automation/flows/index.js';

type NodeLike = { id?: string; type?: string; config?: Record<string, unknown> };
type FlowLike = { name?: string; nodes?: NodeLike[] };

const WRITE_SCHEMAS = {
  delete_record: DeleteRecordConfigSchema,
  update_record: UpdateRecordConfigSchema,
} as const;

type WriteNodeType = keyof typeof WRITE_SCHEMAS;

interface WriteNode {
  flow: string;
  node: string;
  type: WriteNodeType;
  config: Record<string, unknown>;
}

/**
 * Collect write nodes by walking the flow DEEPLY, not just its top-level
 * `nodes` array.
 *
 * This app nests real write nodes inside ADR-0031 structured containers — the
 * `catch` region of `showcase_task_crm_sync`'s try/catch holds an
 * `update_record`, and branch/loop bodies elsewhere hold others. A flat scan of
 * `flow.nodes` silently skips every one of them, which would leave the guard
 * below passing while the exact class of defect it exists to catch hid one
 * level down. So the walk is generic over the object graph rather than a list
 * of container key names (`try`/`catch`/`body`/`branches`/…) that a new
 * container shape could quietly fall outside of.
 */
function collectWriteNodes(flowName: string, value: unknown, out: WriteNode[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectWriteNodes(flowName, entry, out);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const node = value as NodeLike;
  const type = node.type as WriteNodeType | undefined;
  if (typeof type === 'string' && type in WRITE_SCHEMAS && node.id !== undefined) {
    out.push({
      flow: flowName,
      node: String(node.id),
      type,
      config: (node.config ?? {}) as Record<string, unknown>,
    });
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    collectWriteNodes(flowName, child, out);
  }
}

const writeNodes: WriteNode[] = [];
for (const flow of allFlows as unknown as FlowLike[]) {
  collectWriteNodes(String(flow.name), flow.nodes, writeNodes);
}

/**
 * Does this filter name exactly one row the way the engine's non-`multi` path
 * requires — a SCALAR `id`? `{ id: { $in: [...] } }` does not qualify (the
 * engine refuses it), and neither does any other predicate.
 *
 * `{recordId}` / `{record.id}` templates count: they interpolate to one scalar
 * id, and #3810 already refuses the node outright when such a template erases
 * to nothing, so a "scalar" that vanished never reaches the write.
 */
function namesOneRowById(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return false;
  const keys = Object.keys(filter as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'id') return false;
  const id = (filter as { id: unknown }).id;
  return typeof id === 'string' || typeof id === 'number';
}

function isNonEmptyPredicate(filter: unknown): boolean {
  return (
    !!filter
    && typeof filter === 'object'
    && !Array.isArray(filter)
    && Object.keys(filter as Record<string, unknown>).length > 0
  );
}

describe('[#5225] showcase predicate writes declare bulk intent', () => {
  it('the app really does ship write nodes — this suite is not vacuous', () => {
    // If a refactor drops every CRUD write node, the per-node cases below would
    // pass by iterating nothing, which is exactly how #5225 hid for so long.
    expect(writeNodes.length).toBeGreaterThan(0);
    expect(writeNodes.some((n) => n.type === 'delete_record')).toBe(true);
    expect(writeNodes.some((n) => n.type === 'update_record')).toBe(true);
  });

  it('reaches write nodes nested inside structured containers', () => {
    // `record_failure` lives in the `catch` region of `showcase_task_crm_sync`,
    // not in its top-level `nodes`. A flat walk finds everything else and misses
    // exactly this one, so naming it is what keeps the collector honest — a
    // regression to `flow.nodes` alone fails here rather than silently shrinking
    // the sweep's coverage.
    expect(writeNodes.map((n) => n.node)).toContain('record_failure');
  });

  describe.each(writeNodes)('$flow / $node ($type)', ({ type, config }) => {
    it('parses green against the real spec schema', () => {
      const result = WRITE_SCHEMAS[type].safeParse(config);
      expect(result.success ? null : JSON.stringify(result.error?.issues)).toBeNull();
    });

    it('either names one row by scalar id, or declares `multi: true`', () => {
      // The engine's rule, restated as the authoring rule. A node that satisfies
      // neither branch is the #5225 shape: it parses, it publishes, and it fails
      // on every single execution with `requires an ID or options.multi=true`.
      const single = namesOneRowById(config.filter);
      expect(single || config.multi === true).toBe(true);
    });

    it('never declares `multi: true` without a bounding filter', () => {
      // `multi: true` + absent/empty filter = a declared whole-object write. It
      // is a legal thing to author deliberately, and it is NOT something this
      // reference app should ever demonstrate by accident — #5482's lint rule
      // uses this app as its zero-warning sample.
      if (config.multi === true) {
        expect(isNonEmptyPredicate(config.filter)).toBe(true);
      }
    });
  });
});

describe('[#5225] the purge flow specifically — the node that never deleted anything', () => {
  const purge = writeNodes.find((n) => n.flow === 'showcase_inquiry_purge' && n.node === 'purge');

  it('is still the delete half of the CRUD quartet src/coverage.ts claims', () => {
    // coverage.ts names `get+delete: InquiryPurgeFlow` under flowNodeTypes. If
    // this node is ever renamed or retyped, that claim needs re-checking rather
    // than this file silently finding nothing.
    expect(purge).toBeDefined();
    expect(purge!.type).toBe('delete_record');
  });

  it('deletes closed inquiries by predicate, with bulk intent declared', () => {
    expect(purge!.config).toMatchObject({
      objectName: 'showcase_inquiry',
      filter: { status: 'closed' },
      multi: true,
    });
    // Not `{ id: … }` — the point of the node is the predicate path, so the
    // scalar-id escape must NOT be what makes the sweep above pass for it.
    expect(namesOneRowById(purge!.config.filter)).toBe(false);
  });

  it('is refused by the engine contract the moment `multi` is dropped', () => {
    // Reverse verification, direction decided up front: removing the
    // declaration must land the node back in the branch that produced
    // `Delete requires an ID or options.multi=true` / `acted: 0`. The schema
    // still accepts the stripped config — `multi` is optional by design, since
    // omitting it is a valid deliberate choice — so the regression this pins is
    // an EXECUTION one, and the sweep rule above is what catches it statically.
    const { multi: _multi, ...withoutIntent } = purge!.config;
    expect(DeleteRecordConfigSchema.safeParse(withoutIntent).success).toBe(true);
    expect(namesOneRowById(withoutIntent.filter) || withoutIntent.multi === true).toBe(false);
  });
});
