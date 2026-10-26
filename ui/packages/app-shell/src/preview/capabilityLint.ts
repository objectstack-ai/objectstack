/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pre-publish capability-reference lint (ADR-0066 ⑨).
 *
 * `requiredPermissions` on objects/fields/apps/actions is a free capability
 * string; a typo fails CLOSED at runtime (safe) but silently — nothing tells
 * the author the referenced capability is registered nowhere. The framework
 * ships `validateCapabilityReferences` in `@objectstack/lint` (a pure
 * `(stack) => findings[]` rule); this module runs it over the PENDING DRAFTS
 * before publish and returns advisory warnings.
 *
 * Progressive enhancement: the rule exists in `@objectstack/lint` ≥ 12.7.
 * Against an older installed lint package the feature-detect finds nothing
 * and the pass is a silent no-op — no code change needed when the dependency
 * is bumped. Any failure (network, import, rule throw) is swallowed: the lint
 * must NEVER break or block publishing (it is advisory by design — a
 * capability may legitimately be provided by another installed package).
 */

import { stripReadDecorations } from '@objectstack/spec/kernel';

interface PendingDraft {
  type: string;
  name: string;
  packageId: string | null;
}

interface CapabilityFinding {
  severity: string;
  rule: string;
  where: string;
  path: string;
  message: string;
  hint?: string;
}

type CapabilityRule = (stack: Record<string, unknown>) => CapabilityFinding[];

/** Draft types whose bodies participate in the capability-reference graph. */
const LINTED_DRAFT_TYPES = new Set(['object', 'app', 'action']);

/** Feature-detect the rule on the installed `@objectstack/lint`. */
async function loadRule(): Promise<CapabilityRule | null> {
  try {
    const mod: any = await import('@objectstack/lint');
    return typeof mod?.validateCapabilityReferences === 'function'
      ? (mod.validateCapabilityReferences as CapabilityRule)
      : null;
  } catch {
    return null;
  }
}

/**
 * Run the capability-reference lint over the pending drafts. Returns
 * human-readable warning strings (empty = clean or lint unavailable).
 *
 * The author-time "known capability" set the rule resolves against is the
 * union of built-in platform capabilities, every capability the environment's
 * registry serves (`defineCapability` declarations, the `stack.capabilities`
 * source the rule reads), and every `systemPermissions` grant on the
 * environment's permission sets (published ∪ pending permission drafts) — so
 * the assembled pseudo-stack includes the PUBLISHED catalog, not just drafts.
 *
 * @param ruleOverride test seam — inject the rule instead of feature-detecting.
 */
export async function lintDraftCapabilityReferences(
  client: {
    getDraft?: (type: string, name: string, opts?: Record<string, unknown>) => Promise<unknown>;
    list?: (type: string, opts?: Record<string, unknown>) => Promise<unknown>;
  },
  pending: PendingDraft[],
  ruleOverride?: CapabilityRule | null,
): Promise<string[]> {
  try {
    const rule = ruleOverride !== undefined ? ruleOverride : await loadRule();
    if (!rule) return [];

    const linted = pending.filter((d) => LINTED_DRAFT_TYPES.has(d.type));
    if (linted.length === 0) return [];

    // Read decorations do not reach the rule (objectui#8181). MEASURED: neither
    // `validateSecurityPosture` nor `validateCapabilityReferences` moves its
    // verdict on a decorated body today (control: an object with no
    // `sharingModel` fires `security-owd-unset` in both directions), so this is
    // defence in depth rather than a fix. It is here because the alternative is
    // leaving one more verbatim copy of the unwrap that omits the strip, which
    // is the shape objectui#8181 exists to end: the rule should read the
    // document the AUTHOR wrote, so a future rule that enumerates keys cannot
    // inherit the defect. The key list is the spec's, never a local copy; the
    // ADR-0010 protection envelope is not on it and survives.
    const unwrap = (raw: unknown): Record<string, unknown> | null => {
      const item = (raw as { item?: unknown })?.item ?? raw;
      return item && typeof item === 'object'
        ? (stripReadDecorations(item) as Record<string, unknown>)
        : null;
    };

    const bodies = await Promise.all(
      linted.map((d) =>
        client
          .getDraft?.(d.type, d.name, d.packageId ? { packageId: d.packageId } : undefined)
          .then(unwrap)
          .catch(() => null) ?? Promise.resolve(null),
      ),
    );

    // Declaration side: published permission sets ∪ pending permission drafts
    // (granting a capability via systemPermissions is what declares it).
    const publishedPerms = await (client.list?.('permission', {}) as Promise<unknown[]>)
      ?.then((rows) => (Array.isArray(rows) ? rows.map(unwrap).filter(Boolean) : []))
      .catch(() => []) ?? [];
    const permDrafts = await Promise.all(
      pending
        .filter((d) => d.type === 'permission')
        .map((d) =>
          client
            .getDraft?.(d.type, d.name, d.packageId ? { packageId: d.packageId } : undefined)
            .then(unwrap)
            .catch(() => null) ?? Promise.resolve(null),
        ),
    );
    // Declaration side: the capabilities the registry serves
    // (`GET /api/v1/meta/capability`, objectui#7611). A capability declared
    // with `defineCapability` and granted by no permission set is still
    // declared; leaving this source out of the pseudo-stack told the author it
    // "resolves nowhere" when the rule itself would have resolved it.
    const capabilities = await (client.list?.('capability', {}) as Promise<unknown[]>)
      ?.then((rows) => (Array.isArray(rows) ? rows.map(unwrap).filter(Boolean) : []))
      .catch(() => []) ?? [];

    const stack: Record<string, unknown> = {
      objects: bodies.filter((b, i) => b && linted[i].type === 'object'),
      apps: bodies.filter((b, i) => b && linted[i].type === 'app'),
      actions: bodies.filter((b, i) => b && linted[i].type === 'action'),
      permissions: [...publishedPerms, ...permDrafts.filter(Boolean)],
      capabilities,
    };

    return rule(stack)
      .filter((f) => f && f.severity === 'warning')
      .map((f) => `${f.where}: ${f.message}`);
  } catch {
    return []; // advisory — never break publish
  }
}
