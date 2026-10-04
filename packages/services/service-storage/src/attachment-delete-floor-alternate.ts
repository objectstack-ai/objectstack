// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AttachmentLifecycleLogger } from './attachment-lifecycle.js';

/**
 * The parent-editor delete limb of the attachment gate, made reachable (#21729).
 *
 * `installAttachmentAccessHooks` declares the delete rule: the caller must be
 * the uploader OR hold edit on the parent record. The platform's ownership
 * floor (`member_default`'s `owner_only_deletes`: `created_by ==
 * current_user.id`, domain `org_member`) is a second, PARENT-BLIND answer to
 * the same question, and it runs first — so for every org member the floor
 * refused a parent editor's delete of someone else's attachment before the
 * gate was consulted, and the parent-editor half of the declared rule never
 * ran. `sys_comment` had the same defect and the same cure
 * (`sys_comment_moderation`); the attachment cure differs in one respect, and
 * the maintainer's ruling turns on it.
 *
 * `sys_comment`'s gate ships with the object (plugin-audit registers both in
 * one `start()`), so its alternate match can live statically in
 * `member_default`. `sys_attachment` is DEFINED in `platform-objects` and
 * GATED here; a static alternate match would stay in force in a composition
 * that registers the object without this plugin, and there it would be the
 * last word on attachment deletes. Ruled: the alternate match is contributed
 * TOGETHER with the gate that judges it — registered beside
 * `installAttachmentAccessHooks`, delete limb only — so where this plugin's
 * gate is not installed the relief is not either, and the floor stays the last
 * word.
 *
 * What the alternate match is, and is not:
 *  - `id != null` is every row of `sys_attachment`, said plainly. The
 *    parent-editor rule is not expressible as a row predicate (the authority
 *    lives on the PARENT record, resolved through the sharing service's
 *    `canEdit`, and RLS has no join), so the policy does not re-implement the
 *    rule — it stops the floor answering for this object on this limb, and the
 *    gate keeps deciding. A non-uploader who cannot edit the parent is still
 *    refused, by the gate, with `ATTACHMENT_DELETE_DENIED`.
 *  - DELETE only. The edit limb (`owner_only_writes` vs the gate's
 *    `beforeUpdate`) is a separate decision on the same floor and is NOT
 *    relieved here: a parent editor still cannot PATCH another user's
 *    attachment row.
 *  - It carries no `positions`: plugin-security places it beside the floor
 *    policy it relieves, in that policy's own domain (`org_member` as shipped),
 *    so it reaches exactly the principals the floor binds and changes nobody
 *    else's delete scope.
 *
 * The seam is `contributeOwnershipFloorAlternates` on the `security` service —
 * an extension of the published contract, feature-detected because this
 * package does not depend on plugin-security.
 */
export const ATTACHMENT_PARENT_EDITOR_DELETE = Object.freeze({
  name: 'sys_attachment_parent_editor_delete',
  object: 'sys_attachment',
  operation: 'delete',
  using: 'id != null',
} as const);

/** The contributor key — the same package id the gate registers its hooks under. */
export const ATTACHMENT_FLOOR_ALTERNATE_CONTRIBUTOR = 'com.objectstack.service.storage';

/** The slice of plugin-security's `security` service this contribution uses. */
interface OwnershipFloorAlternateSeam {
  contributeOwnershipFloorAlternates(
    plugin: string,
    alternates: ReadonlyArray<typeof ATTACHMENT_PARENT_EDITOR_DELETE>,
  ): void;
}

export type AttachmentFloorAlternateOutcome =
  /** The alternate match is in force. */
  | 'contributed'
  /** No `security` service: no row-level floor is enforced, nothing to relieve. */
  | 'no-security'
  /** A `security` service without the seam: the floor stays, said once at `warn`. */
  | 'no-seam'
  /** The seam refused the contribution: the floor stays, said once at `warn`. */
  | 'refused';

/**
 * Contribute {@link ATTACHMENT_PARENT_EDITOR_DELETE}. ⛔ Call it only where
 * `installAttachmentAccessHooks` has just installed the gate — that pairing is
 * the ruling, and the caller is the only place it can be kept.
 *
 * Every outcome other than `contributed` leaves the floor in force, which
 * fails CLOSED (a parent editor's delete of another user's attachment is
 * refused); the two the operator can act on are logged.
 */
export function contributeAttachmentDeleteFloorAlternate(
  getSecurity: () => unknown,
  logger: AttachmentLifecycleLogger,
): AttachmentFloorAlternateOutcome {
  let security: unknown;
  try {
    security = getSecurity();
  } catch {
    security = undefined;
  }
  if (!security || typeof security !== 'object') {
    logger.debug?.(
      '[storage] no security service — no row-level ownership floor is enforced, so the attachment delete gate has nothing to be pre-empted by',
    );
    return 'no-security';
  }
  const seam = security as Partial<OwnershipFloorAlternateSeam>;
  if (typeof seam.contributeOwnershipFloorAlternates !== 'function') {
    logger.warn(
      '[storage] the security service offers no ownership-floor alternate seam (contributeOwnershipFloorAlternates): ' +
        "a user who can edit a record cannot delete another user's attachment on it — the platform's created_by " +
        'delete floor refuses before the attachment gate runs. Upgrade @objectstack/plugin-security to the version ' +
        'that ships the seam.',
    );
    return 'no-seam';
  }
  try {
    seam.contributeOwnershipFloorAlternates(ATTACHMENT_FLOOR_ALTERNATE_CONTRIBUTOR, [ATTACHMENT_PARENT_EDITOR_DELETE]);
  } catch (err) {
    logger.warn(
      `[storage] the security service refused the attachment delete alternate (${(err as Error)?.message ?? err}): ` +
        "a user who can edit a record cannot delete another user's attachment on it until this is resolved.",
    );
    return 'refused';
  }
  return 'contributed';
}
