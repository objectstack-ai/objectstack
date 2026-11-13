// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AttachmentLifecycleLogger } from './attachment-lifecycle.js';

/**
 * Every member's object-level grant on `sys_attachment`: read, and create.
 *
 * The rows of `sys_attachment` are decided by gates, never by the object
 * grant: an insert needs edit on the parent record
 * (`installAttachmentAccessHooks`), a list, count or aggregate returns only
 * the rows whose parent record the caller can read
 * (`installAttachmentReadVisibility`), the download door serves an
 * attachments-scope file only to its uploader or a reader of a record it is
 * attached to, and an insert or re-point onto an object that has not opted in
 * to attachments (`enable.files`) is refused by the opt-in gate, which the
 * audit service installs. The object grant only opens the door to those gates. Since the
 * platform baseline (`member_default`) carries no line for this object, a
 * member who could edit a record still could not attach a file to it, nor see
 * the files already attached to it, without an app granting the object
 * explicitly.
 *
 * So this plugin grants it, as a set of its own handed to the member baseline,
 * and only where every one of those gates is present: the set is contributed
 * from the place this plugin installs its gates, after the last of them, and on
 * a kernel that lacks any of the four nothing is contributed and members stay
 * refused, loudly. A static line in a shipped set would stay in force in a
 * composition that registers the object without these gates, where the object
 * grant would decide every row; and ADR-0090 D9 rules out other packages
 * writing into the platform's own baseline set.
 *
 * What the set is, and is not:
 *  - READ and CREATE on `sys_attachment`, nothing else. No edit and no delete:
 *    a set every member holds through the `everyone` anchor carries no delete
 *    bit (ADR-0090 D5). Managing attachments (detaching, re-pointing) stays an
 *    explicit grant.
 *  - It reaches the members of a deployment that declares a member baseline,
 *    and no one else: an external member resolves its own baseline instead, an
 *    agent principal's own leg resolves none, and a deployment that declares
 *    none (`fallbackPermissionSet: null`) hands this set to no one. An agent
 *    acting for a member is bounded by that member and by its own scope
 *    (ADR-0090 D10), so it reaches what the member reaches here, within that
 *    scope.
 *  - Where the set is contributed, an object that has not opted in to
 *    attachments (`enable.files`) still refuses every attachment, and a parent
 *    record the caller cannot edit still refuses the attach
 *    (`ATTACHMENT_PARENT_ACCESS`).
 *
 * The seam is `contributePlatformBaselineSet` on the `security` service,
 * feature-detected because this package does not depend on plugin-security.
 */
export const ATTACHMENT_MEMBER_PERMISSION_SET = Object.freeze({
  name: 'storage_attachment_member',
  label: 'Attachments: read and attach (every member)',
  description:
    'Read and create on sys_attachment for every member, contributed by the storage service beside the attachment ' +
    'row gates. A member attaches a file to a record they can edit and sees the files of a record they can read.',
  objects: Object.freeze({
    sys_attachment: Object.freeze({ allowRead: true, allowCreate: true }),
  }),
} as const);

/** The contributor key: the package that registers `sys_attachment` and installs its gates. */
export const ATTACHMENT_MEMBER_GRANT_CONTRIBUTOR = 'com.objectstack.service.storage';

/**
 * Which of the attachment gates this kernel has. All four must be `true` for
 * the grant to be contributed.
 */
export interface AttachmentRowGates {
  /** The write rule: the insert, update and delete gates on `sys_attachment` rows. */
  readonly writeRule: boolean;
  /** The read-visibility middleware: list, count and aggregate see readable parents only. */
  readonly readVisibility: boolean;
  /** The download door's parent-record check, which needs an auth service and a queryable engine. */
  readonly downloadCheck: boolean;
  /** The per-object opt-in gate (`enable.files`) on the insert and re-point, which the audit service installs. */
  readonly filesOptIn: boolean;
}

/** The slice of plugin-security's `security` service this contribution uses. */
interface PlatformBaselineSetSeam {
  contributePlatformBaselineSet(
    contributor: string,
    set: typeof ATTACHMENT_MEMBER_PERMISSION_SET,
  ): { name: string; joined: boolean };
}

export type AttachmentMemberGrantOutcome =
  /** The set joined the member baseline. */
  | 'contributed'
  /** The set was admitted, and the deployment declares no member baseline, so it reaches no one. */
  | 'no-baseline'
  /** A gate is missing: nothing is contributed, said at `warn`. */
  | 'gates-incomplete'
  /** No `security` service: no object grant is enforced, nothing to contribute. */
  | 'no-security'
  /** A `security` service without the seam: members stay refused, said at `warn`. */
  | 'no-seam'
  /** The seam refused the contribution: members stay refused, said at `warn`. */
  | 'refused';

/** The names of the gates `gates` lacks, in a fixed order. */
function missingGates(gates: AttachmentRowGates): string[] {
  const missing: string[] = [];
  if (!gates.writeRule) missing.push('the attachment write rule (the engine has no hook seam)');
  if (!gates.readVisibility) missing.push('the attachment read-visibility gate (the engine has no middleware seam)');
  if (!gates.downloadCheck) {
    missing.push("the download door's parent-record check (no auth service, or an engine that cannot be queried)");
  }
  if (!gates.filesOptIn) missing.push('the per-object attachment opt-in gate, enable.files (no audit service)');
  return missing;
}

/**
 * Contribute {@link ATTACHMENT_MEMBER_PERMISSION_SET} to the member baseline,
 * when every attachment gate is present. ⛔ Call it only after the last
 * of them is installed, from the place they are installed: that pairing is the
 * maintainer's ruling, and the caller is the only place it can be kept.
 *
 * Every outcome other than `contributed` leaves members without the grant,
 * which fails CLOSED (an attach is refused `PERMISSION_DENIED`, and the
 * attachments of a record list as forbidden); the ones an operator can act on
 * are logged.
 */
export function contributeAttachmentMemberGrant(
  gates: AttachmentRowGates,
  getSecurity: () => unknown,
  logger: AttachmentLifecycleLogger,
): AttachmentMemberGrantOutcome {
  const missing = missingGates(gates);
  if (missing.length > 0) {
    logger.warn(
      '[storage] members are NOT granted attachments (read and create on sys_attachment): this kernel lacks ' +
        `${missing.join('; ')}, so the rows would be judged by the object grant alone. A member's attach is refused ` +
        'until every gate is installed.',
    );
    return 'gates-incomplete';
  }
  let security: unknown;
  try {
    security = getSecurity();
  } catch {
    security = undefined;
  }
  if (!security || typeof security !== 'object') {
    logger.debug?.('[storage] no security service — no object grant is enforced, so there is no attachment grant to contribute');
    return 'no-security';
  }
  const seam = security as Partial<PlatformBaselineSetSeam>;
  if (typeof seam.contributePlatformBaselineSet !== 'function') {
    logger.warn(
      '[storage] the security service offers no platform baseline seam (contributePlatformBaselineSet): members ' +
        'cannot attach files to the records they edit, nor see the files of the records they read, unless an app ' +
        'grants sys_attachment. Upgrade @objectstack/plugin-security to the version that ships the seam.',
    );
    return 'no-seam';
  }
  let admitted: { name: string; joined: boolean };
  try {
    admitted = seam.contributePlatformBaselineSet(ATTACHMENT_MEMBER_GRANT_CONTRIBUTOR, ATTACHMENT_MEMBER_PERMISSION_SET);
  } catch (err) {
    logger.warn(
      `[storage] the security service refused the members' attachment grant (${(err as Error)?.message ?? err}): ` +
        'members cannot attach files, nor see attachments, until this is resolved.',
    );
    return 'refused';
  }
  return admitted?.joined === false ? 'no-baseline' : 'contributed';
}
