// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D9] Cross-organization approver targeting — resolving WHICH
 * organization's directory an approver is looked up in.
 *
 * One organization id used to do three jobs at once in `openNodeRequest`:
 * where the request row lives, where its inbox index rows live, and where its
 * approvers are looked up. The first two are the request's own organization by
 * definition. The third is not: a group CFO holds her `cfo` position in the
 * GROUP organization while the purchase order she signs off lives in the PLANT
 * organization. Binding all three together meant
 * `expandPositionUsers('cfo', <plant>)` matched nobody and the slot fell into
 * `onEmptyApprovers` — a group escalation could not be expressed at all.
 *
 * This module resolves only the third job. The request keeps living in its own
 * organization, and D2's membership union is what lets a group-side approver
 * READ it — see `assertApproversCanRead` below for why that is a precondition
 * worth checking rather than assuming.
 */

/** Cycle guard for the `parent_organization_id` walk (mirrors the BU subtree walk). */
const MAX_ORG_DEPTH = 32;

const SYSTEM_CTX = { isSystem: true } as const;

export interface ApproverOrgScopeEngine {
  find(object: string, options: any): Promise<any[]>;
}

export interface ApproverOrgScopeDeps {
  engine: ApproverOrgScopeEngine;
  /**
   * The tenancy posture in force, when the host could resolve one. `undefined`
   * means "unknown" — a stack booted without the tenancy service — and is
   * treated as permissive so a minimal test/embedded stack is not broken by a
   * guard it cannot answer.
   */
  posture?: () => string | undefined;
  logger?: { warn?: (msg: any, ...rest: any[]) => void; debug?: (msg: any, ...rest: any[]) => void };
}

/**
 * Every failure here THROWS `VALIDATION_FAILED`, matching how `expression`
 * approvers already fail (#3447 P2): an approver declaration that cannot be
 * resolved is a ROUTING BUG, never "condition not met". Silently falling back
 * to the request's own organization would be the worst option available — a
 * flow that reads as "escalate to group" would quietly approve inside the
 * plant, and the deployment that changed posture would reroute its approvals
 * with no signal at all.
 *
 * Messages name the offending value because their primary reader is the AI
 * author fixing the flow on the next validate pass.
 */
function fail(message: string): never {
  throw new Error(`VALIDATION_FAILED: ${message}`);
}

async function findOrg(
  engine: ApproverOrgScopeEngine,
  where: Record<string, unknown>,
): Promise<any | null> {
  try {
    const rows = await engine.find('sys_organization', {
      where,
      fields: ['id', 'slug', 'parent_organization_id'],
      limit: 1,
      context: SYSTEM_CTX,
    } as any);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

/** The id chain from `orgId` up to its root, inclusive. Fail-closed on cycles. */
async function ancestorChain(
  engine: ApproverOrgScopeEngine,
  orgId: string,
): Promise<string[]> {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = orgId;
  for (let depth = 0; cursor && depth < MAX_ORG_DEPTH; depth++) {
    if (seen.has(cursor)) break; // cycle in the grouping metadata — stop, do not loop
    seen.add(cursor);
    chain.push(cursor);
    const row = await findOrg(engine, { id: cursor });
    const parent = row?.parent_organization_id;
    cursor = parent ? String(parent) : null;
  }
  return chain;
}

/**
 * Resolve an approver's `organization` declaration to a concrete organization
 * id for directory lookups. Returns the request's own organization when the
 * declaration is absent — the unchanged default path, which does no reads.
 */
export async function resolveApproverDirectoryOrg(
  deps: ApproverOrgScopeDeps,
  declaration: string | null | undefined,
  requestOrgId: string | null | undefined,
  approverType: string,
  isOrgScopedType: boolean,
): Promise<string | null | undefined> {
  const declared = typeof declaration === 'string' ? declaration.trim() : '';
  if (!declared) return requestOrgId;

  // An `organization` on `user` / `field` / `manager` / `team` is not a
  // narrower routing — those types never consult an org-scoped directory, so
  // the declaration would have no effect. Refuse rather than ignore: a flow
  // author who wrote it believed it did something.
  if (!isOrgScopedType) {
    fail(
      `approver type '${approverType}' resolves people without an organization directory, `
      + `so 'organization: ${declared}' would have no effect — remove it `
      + `(ADR-0105 D9 applies to position / org_membership_level / department / expression)`,
    );
  }

  // Posture guard. ADR-0105 D9 applies to `group` only: in `isolated`, cross-org
  // approval remains system-context mirroring (cloud #2937 contract), and in
  // `single` there is no second organization to target. Refusing here — rather
  // than in a lint — is deliberate: posture is ENVIRONMENT configuration, so the
  // same portable flow metadata may be deployed into any posture and no static
  // check can see which. A deployment migrating group → isolated must fail
  // loudly instead of silently rerouting its approvals.
  const posture = deps.posture?.();
  if (posture && posture !== 'group') {
    fail(
      `cross-organization approver targeting ('organization: ${declared}') requires the `
      + `'group' tenancy posture; this deployment resolves '${posture}' (ADR-0105 D9)`,
    );
  }

  const requestOrg = requestOrgId ? String(requestOrgId) : '';
  if (!requestOrg) {
    fail(
      `'organization: ${declared}' cannot be resolved for a request that carries no `
      + `organization — cross-organization targeting needs an organization to resolve from`,
    );
  }

  const chain = await ancestorChain(deps.engine, requestOrg);

  if (declared === '$root') {
    const root = chain[chain.length - 1];
    if (root === requestOrg && chain.length === 1) {
      fail(
        `'organization: $root' resolved to the request's own organization — this organization `
        + `has no 'parent_organization_id' lineage. Declare the group hierarchy (ADR-0105 D6) `
        + `or drop the targeting`,
      );
    }
    return root;
  }

  if (declared === '$parent') {
    const parent = chain[1];
    if (!parent) {
      fail(
        `'organization: $parent' has no parent to resolve to — the request's organization is `
        + `already the root of its group (ADR-0105 D6 'parent_organization_id')`,
      );
    }
    return parent;
  }

  // A slug names one specific organization — the shape the symbols cannot
  // express (a SIBLING, e.g. a shared-services centre approving payables for
  // every plant). Slugs rather than ids because flow metadata is portable
  // across environments and organization ids are minted per deployment.
  const target = await findOrg(deps.engine, { slug: declared });
  if (!target?.id) {
    fail(
      `no organization with slug '${declared}' — 'organization' takes an organization SLUG `
      + `or a symbol ($root / $parent), never an id (ids are per-deployment, flows are portable)`,
    );
  }
  const targetId = String(target.id);
  if (targetId === requestOrg) return targetId;

  // Legality: the target must share a grouping root with the request's
  // organization. "Shares a root" rather than "is an ancestor" because the
  // sibling case is a first-class use. The rule depends only on the
  // organization tree — never on who submitted — so one flow routes identically
  // for every submitter, which is what makes a routing bug reproducible.
  const targetChain = await ancestorChain(deps.engine, targetId);
  const targetRoot = targetChain[targetChain.length - 1];
  const requestRoot = chain[chain.length - 1];
  if (!targetRoot || !requestRoot || targetRoot !== requestRoot) {
    fail(
      `organization '${declared}' is not in the same group as the request's organization `
      + `— cross-organization approval routes WITHIN one group (they must share a `
      + `'parent_organization_id' root, ADR-0105 D6/D9)`,
    );
  }
  return targetId;
}

/**
 * Drop approvers who could not READ the request they were routed to, and say
 * so.
 *
 * ADR-0105 D9 notes that reads by cross-org approvers "are covered by D2
 * (membership union)". True — but D2's union is `organization_id IN
 * accessible_org_ids`, and the request row is stamped with the REQUEST's
 * organization. So a group-side approver reaches it only if she also holds a
 * membership there. That is the intended group shape (group staff are members
 * of every plant while holding their positions in the group org — the shape the
 * ADR-0105 acceptance dogfood already models), but nothing enforces it.
 *
 * Left unchecked the failure is SILENT and expensive: routing succeeds, the
 * request and inbox rows are written, and the approver then opens a task she
 * cannot open — the wall hides the record. Filtering here converts that into
 * the empty-slate path the node already has a policy for
 * (`onEmptyApprovers`), and logs exactly who was dropped and why, so the fix
 * ("grant the membership" or "retarget") is legible without a debugger.
 */
export async function filterApproversWhoCanRead(
  deps: ApproverOrgScopeDeps,
  userIds: string[],
  requestOrgId: string | null | undefined,
  context: { approverType: string; value?: string; directoryOrgId?: string | null },
): Promise<string[]> {
  const requestOrg = requestOrgId ? String(requestOrgId) : '';
  if (!requestOrg || userIds.length === 0) return userIds;

  let members: any[] = [];
  try {
    members = await deps.engine.find('sys_member', {
      where: { organization_id: requestOrg, user_id: { $in: userIds } },
      fields: ['user_id'],
      limit: 10000,
      context: SYSTEM_CTX,
    } as any);
  } catch {
    // Membership unreadable — do NOT drop everyone on an infrastructure
    // hiccup. Routing to someone who may not see the request is recoverable
    // (an admin can grant the membership); silently emptying a live approval
    // slate is not.
    return userIds;
  }

  const canRead = new Set(
    (members ?? []).map((m: any) => String(m?.user_id ?? '')).filter(Boolean),
  );
  const dropped = userIds.filter((u) => !canRead.has(u));
  if (dropped.length === 0) return userIds;

  deps.logger?.warn?.(
    `[approvals] ADR-0105 D9: ${dropped.length} cross-organization approver(s) dropped — `
    + `they hold '${context.value ?? context.approverType}' in organization `
    + `'${context.directoryOrgId}' but no membership in the request's organization `
    + `'${requestOrg}', so the D2 union wall would hide the request from them. `
    + `Grant those users a membership in the request's organization, or retarget the approver.`,
    { dropped, requestOrganizationId: requestOrg, directoryOrganizationId: context.directoryOrgId },
  );
  return userIds.filter((u) => canRead.has(u));
}
