// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The measurement that retired `FORWARD_COMPAT_FLOW_NODE_TYPES` (objectui#6982).
 *
 * That shim existed because the published `@objectstack/spec` `FlowNodeSchema`
 * declared `type` as a CLOSED enum, which spuriously rejected the `approval` and
 * `connector_action` nodes the running server accepts. It filtered exactly one
 * thing out of the flow gate's issue list: an issue addressed to `nodes.N.type`
 * whose node's own `type` was one of those two strings.
 *
 * ADR-0019 P2 opened that field to a validated non-empty string and has since
 * reached npm. Re-measured on the resolved spec (17.2.0, what pnpm installs for
 * the `^17.0.0` pin), the shim had become UNREACHABLE — not merely redundant:
 *
 *  - the node types it named parse clean, so the gate emits no `nodes.N.type`
 *    issue for them at all, and the filter had nothing to drop;
 *  - the one issue that path still yields is `too_small` on the empty string,
 *    and the shim already KEPT that one (its `nodeTypeAt` returns `''`, which is
 *    falsy), so deleting the shim moves no verdict.
 *
 * These pins are what make that deletion falsifiable. If a future spec re-closes
 * `FlowNodeSchema.type` — the exact condition the shim was built for — the first
 * test here goes red and names the premise that came back, instead of authors
 * rediscovering it as "the flow editor rejects approval nodes".
 *
 * ⛔ Do not relax these into `expect(res.ok).toBe(true)` on a single node type:
 * the open-string reading is the claim, and one accepted literal cannot
 * distinguish "the enum opened" from "the enum happens to list that literal".
 */

import { describe, it, expect } from 'vitest';
import { validateMetadataDraft } from './clientValidation';

/**
 * A flow that differs from a clean one only in its single node's `type` — plus,
 * for a type whose own contract requires a sibling block, that block.
 *
 * `@objectstack/spec` 17.5.0 refuses a `connector_action` node without a
 * `connectorConfig` naming the connector and the action (objectui#11073). That
 * is a refusal about the NODE's config, addressed to `nodes.N.connectorConfig`,
 * ⛔ not a re-closed `type` enum — the next case pins exactly that — so the
 * type-only fixture carries the block its type requires. 17.7.0 does the same
 * for `approval` (objectstack#21893): the build doors judge its `config`
 * against `ApprovalNodeConfigSchema`, which requires `approvers`, and refuse it
 * at `nodes.N.config.approvers` — so that fixture carries one approver
 * (objectui#11717).
 */
const REQUIRED_SIBLING: Record<string, Record<string, unknown>> = {
  approval: { config: { approvers: [{ type: 'user', value: 'usr_approver' }] } },
  connector_action: { connectorConfig: { connectorId: 'slack', actionId: 'post_message' } },
};
const flowWithNodeType = (type: unknown, extra: Record<string, unknown> = REQUIRED_SIBLING[type as string] ?? {}) => ({
  name: 'f1',
  label: 'F1',
  type: 'autolaunched',
  nodes: [{ id: 'n1', type, label: 'N1', ...extra }],
  edges: [],
});

describe('flow node `type` is an open string — the shim premise, re-measured', () => {
  it.each([
    ['approval', 'the durable-pause approval node (ADR-0019)'],
    ['connector_action', 'the connector-provided extension point'],
    ['zzz_made_up_node_type', 'an arbitrary string no enum would list'],
  ])('accepts node type %j — %s', async (nodeType) => {
    const res = await validateMetadataDraft('flow', flowWithNodeType(nodeType));
    // The third case is what makes this an OPEN-string pin rather than an
    // "is this literal in the enum" pin: an enum that merely gained the two
    // real node types would still reject it.
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('refuses a `connector_action` with no `connectorConfig` at that block — never at `type` (17.5.0)', async () => {
    // The new refusal, pinned where it lands. If it were addressed to
    // `nodes.0.type` the open-string premise above would be back in doubt.
    const res = await validateMetadataDraft('flow', flowWithNodeType('connector_action', {}));
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path);
    expect(paths).toEqual(['nodes.0.connectorConfig']);
    expect(paths).not.toContain('nodes.0.type');
  });

  it('refuses an `approval` with no `approvers` at that config key — never at `type` (17.7.0)', async () => {
    // The same shape as the row above, one release later (objectstack#21893).
    const res = await validateMetadataDraft('flow', flowWithNodeType('approval', {}));
    expect(res.ok).toBe(false);
    const paths = res.issues.map((i) => i.path);
    expect(paths).toEqual(['nodes.0.config.approvers']);
    expect(paths).not.toContain('nodes.0.type');
  });

  it('still rejects an EMPTY node type, and that issue was never suppressed', async () => {
    const res = await validateMetadataDraft('flow', flowWithNodeType(''));
    expect(res.ok).toBe(false);
    // The surviving `nodes.N.type` issue. The deleted shim kept this one too
    // (`nodeTypeAt` returned the falsy `''`), so this verdict is unchanged by
    // the removal — that is precisely why the removal is behaviour-preserving.
    expect(res.issues.map((i) => i.path)).toContain('nodes.0.type');
  });

  it('still rejects a NON-STRING node type', async () => {
    const res = await validateMetadataDraft('flow', flowWithNodeType(123));
    expect(res.ok).toBe(false);
    // Also unchanged by the removal: `nodeTypeAt` returned `undefined` for a
    // non-string, so the shim kept this issue as well.
    expect(res.issues.map((i) => i.path)).toContain('nodes.0.type');
  });
});
