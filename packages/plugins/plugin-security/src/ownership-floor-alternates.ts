// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21729] The seam through which a plugin OTHER than this one contributes an
 * alternate match to the platform's row-level write ownership floor — keyed by
 * the contributing plugin, so the relief is registered by the code that
 * installs the gate it defers to, and exists only where that gate does.
 *
 * ## Why a seam, and why this shape
 *
 * `member_default` ships the wildcard floor `owner_only_writes` /
 * `owner_only_deletes` (`created_by == current_user.id`, domain
 * `org_member`). It is parent-blind, and it answers FIRST: an object whose row
 * authority is a tighter, parent-derived gate in another plugin gets that gate
 * pre-empted for every principal the floor binds. `sys_comment_moderation` is
 * the static cure for the one object whose gate ships with the object itself
 * (plugin-audit registers `sys_comment` and installs its gate in the same
 * `start()`), so a policy in `member_default` can never be the last word there.
 *
 * That argument does not carry to an object whose DEFINITION and GATE live in
 * different packages — `sys_attachment` is defined in `platform-objects` and
 * gated by `service-storage`. A static alternate match would stay in force in a
 * composition that registers the object without the gate, and there it WOULD
 * be the last word. The maintainer's ruling on that card: the relief is
 * contributed TOGETHER with the gate that judges it; where the gate is not
 * installed, neither is the relief, and the floor stays the last word.
 *
 * So the contributor states only WHAT it relieves — one object, one limb, the
 * rows — and this plugin decides WHERE: beside each enabled floor policy of
 * that limb, in the floor's own `positions` domain
 * (`withOwnershipFloorAlternates`, `platform-ownership-policies.ts`). A
 * contribution therefore cannot reach a principal the floor does not bind, and
 * cannot be what makes an empty write class non-empty — the two ways an
 * undomained or misplaced policy changes a principal it was never about.
 *
 * ## What a contribution is held to (each refusal is a thrown error at boot)
 *
 *  - ONE named object, never `'*'`: a wildcard relief withdraws the floor
 *    instead of relieving it, which is a decision about the floor itself.
 *  - ONE floor limb, `update` or `delete`: `all` would relieve both limbs at
 *    once, and the two are separate decisions (the ruling that admitted the
 *    `sys_comment` delete limb left its edit limb under the floor);
 *    `select`/`insert` are not limbs the floor has.
 *  - A well-formed policy: the materialized shape must parse as
 *    `RowLevelSecurityPolicySchema` (snake_case name, closed keys).
 *
 * The seam is reached through the registered `security` service as an
 * EXTENSION of the published contract (the `getMetadataReadableFields`
 * precedent beside it): `ISecurityService` lives in `packages/spec`, and a
 * contributor without a dependency on this package feature-detects the method.
 */

import { RowLevelSecurityPolicySchema } from '@objectstack/spec/security';

import type { OwnershipFloorAlternate, OwnershipFloorLimb } from './platform-ownership-policies.js';

const FLOOR_LIMBS: ReadonlySet<string> = new Set<OwnershipFloorLimb>(['update', 'delete']);

function refuse(plugin: string, detail: string): never {
  throw new Error(`[security] ownership-floor alternate from '${plugin}' refused: ${detail}`);
}

/** Validate one contributed alternate and return a frozen copy of it. */
function admitAlternate(plugin: string, raw: unknown): OwnershipFloorAlternate {
  const a = (raw ?? {}) as Partial<Record<keyof OwnershipFloorAlternate, unknown>>;
  if (typeof a.object !== 'string' || a.object.length === 0) {
    refuse(plugin, 'it names no object.');
  }
  if (a.object === '*') {
    refuse(
      plugin,
      "object '*' would withdraw the floor on every object instead of relieving it on one; name the object whose gate the relief defers to.",
    );
  }
  if (typeof a.operation !== 'string' || !FLOOR_LIMBS.has(a.operation)) {
    refuse(
      plugin,
      `operation '${String(a.operation)}' is not one floor limb; contribute 'update' or 'delete', one alternate per limb, each limb being its own decision.`,
    );
  }
  if (typeof a.using !== 'string' || a.using.trim().length === 0) {
    refuse(plugin, 'it carries no `using` predicate.');
  }
  const parsed = RowLevelSecurityPolicySchema.safeParse({
    name: a.name,
    object: a.object,
    operation: a.operation,
    using: a.using,
  });
  if (!parsed.success) {
    refuse(plugin, `it is not a well-formed row-level security policy (${parsed.error.issues.map((i) => i.message).join('; ')}).`);
  }
  return Object.freeze({
    name: a.name as string,
    object: a.object as string,
    operation: a.operation as OwnershipFloorLimb,
    using: a.using as string,
  });
}

/**
 * The contributions in force, keyed by contributing plugin. A plugin's second
 * contribution REPLACES its first (a restarted plugin does not stack copies),
 * and an empty list withdraws it.
 */
export class OwnershipFloorAlternates {
  private readonly byPlugin = new Map<string, readonly OwnershipFloorAlternate[]>();
  private flat: readonly OwnershipFloorAlternate[] = [];

  contribute(plugin: string, alternates: readonly OwnershipFloorAlternate[]): void {
    if (typeof plugin !== 'string' || plugin.length === 0) {
      throw new Error('[security] ownership-floor alternate refused: the contributing plugin is not named.');
    }
    if (!Array.isArray(alternates)) {
      refuse(plugin, 'the contribution is not a list of alternates.');
    }
    const admitted = alternates.map((a) => admitAlternate(plugin, a));
    if (admitted.length === 0) this.byPlugin.delete(plugin);
    else this.byPlugin.set(plugin, Object.freeze(admitted));
    this.flat = Object.freeze([...this.byPlugin.values()].flat());
  }

  /** Every alternate in force, in contribution order. Empty until one lands. */
  all(): readonly OwnershipFloorAlternate[] {
    return this.flat;
  }
}
