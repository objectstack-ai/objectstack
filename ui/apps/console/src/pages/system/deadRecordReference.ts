// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "The record this approval was about has been deleted" — the one signal the
 * platform actually publishes, and the copy that goes with it (objectui#7108).
 *
 * ## The ruling this serves
 *
 * Maintainer ruling 2026-08-31 (总监席第 5 场决裁批 #5), point 2, kept in the
 * language it was ruled in:
 *
 *   历史终态审批单保留 + 墓碑呈现：审计行不动；呈现层把死引用渲染为
 *   「关联记录已删除」墓碑，不再退化为裸记录 id。
 *
 * The audit rows stay; the PRESENTATION layer stops degrading a dead reference
 * to a bare record id.
 *
 * ## The signal — published upstream, consumed here, never re-derived
 *
 * `@objectstack/plugin-approvals` voids a record's still-`pending` approvals
 * when that record is deleted (objectstack#13568), and stamps the cause on the
 * row: `status: 'cancelled'` + `cancel_reason: 'record_deleted'`. The pair is
 * declared on `ApprovalRequestRow` in `@objectstack/spec` and comes back on
 * every read. That pair is the ONLY thing this module treats as "the record is
 * gone" — a deletion the server asserted, never one this console inferred.
 *
 * ## ⛔ What a failed lookup is NOT
 *
 * A record that fails to resolve is NOT evidence of a deletion, and this module
 * must never be widened to say it is. The platform fuses the two causes on
 * purpose: an RLS-invisible row and an id that names nothing both answer
 * `RECORD_NOT_FOUND` / 404, described in the framework's own words as
 * "existence non-disclosure" — 403 is deliberately not used, because answering
 * differently would confirm to a viewer that a record they may not see exists.
 * So `recordReadability`'s probe (objectui#5211) reports "this viewer cannot
 * read it" and says nothing whatsoever about why; treating its answer as a
 * deletion would report "deleted" to someone whose only problem is permissions
 * (objectstack#7345's case), asserting a deletion that may not have happened.
 * That is strictly worse than the bare id it would replace.
 *
 * ## The consequence, recorded rather than papered over
 *
 * TERMINAL rows — `approved` / `rejected` — were never cancelled (the upstream
 * cancel path names `status: 'pending'` in its `where`), so they carry no
 * `cancel_reason`, and by the paragraph above nothing else on the wire
 * separates "deleted" from "not visible" for them. They therefore get NO
 * tombstone here, on purpose. See the PR for the measurement.
 *
 * ⚠️ What they get instead is a strictly WEAKER statement, and it is not this
 * module's: objectui#8631 renders a cause-free "cannot be opened" affordance
 * for a reference that neither resolves nor carries a snapshot title. It
 * claims no deletion — see `unresolvableRecordReference`, which is reached only
 * when `isDeletedRecordReference` has already answered false.
 */

import { useMemo } from 'react';
import { useSafeFieldLabel } from '@object-ui/i18n';
import { APPROVAL_CANCEL_REASON_LABELS } from '@objectstack/spec/contracts';
import type { ApprovalRequestRow } from '../../services/approvalsApi';

/**
 * Where the platform records the cause. The tombstone's copy is the label of
 * this field's `record_deleted` option, so the string the console renders and
 * the string the platform's own admin UI renders are one authored text.
 */
export const CANCEL_REASON_OBJECT = 'sys_approval_request';
export const CANCEL_REASON_FIELD = 'cancel_reason';
export const RECORD_DELETED_REASON = 'record_deleted';

/**
 * Did the platform tell us this request's target record was deleted?
 *
 * Both halves are required. `status` alone is not enough — `cancelled` is a
 * reason CLASS on the contract, and the next platform-initiated cause extends
 * that vocabulary rather than minting its own status, so a future
 * `cancel_reason` must not silently start rendering "deleted". `cancel_reason`
 * alone is not enough either: the contract declares it "present only on rows
 * whose status is `cancelled`", so a value on any other status is a row this
 * console does not understand, not a deletion.
 */
export function isDeletedRecordReference(
  r: Pick<ApprovalRequestRow, 'status' | 'cancel_reason'> | null | undefined,
): boolean {
  return r?.status === 'cancelled' && r?.cancel_reason === RECORD_DELETED_REASON;
}

/**
 * The tombstone's text — upstream's, in both of its two forms.
 *
 * 1. The platform's own localized option label, which
 *    `@objectstack/plugin-approvals` ships and `/api/v1/i18n/translations/:locale`
 *    serves (en / ja-JP / es-ES / zh-CN today). `transformSpecTranslations`
 *    lands it at `fieldOptions.sys_approval_request.cancel_reason.record_deleted`,
 *    which is exactly what `fieldOptionLabel` resolves.
 * 2. When that bundle has not loaded (an older backend, an offline console),
 *    the contract's own authored English from `@objectstack/spec` — the very
 *    text the `en` bundle is generated from.
 *
 * ⛔ Deliberately no objectui-authored string on either path: a second copy of
 * this sentence in this repo would be a second de-facto contract, localized on
 * its own schedule, drifting from the platform's.
 *
 * ⚠️ `unresolvableRecordReference`, one file over, DOES author a console string
 * — deliberately, and without contradicting this. This rule binds a sentence
 * the PLATFORM owns and publishes as a `cancel_reason` option label; that one
 * renders an affordance the console decided on, for which no upstream option
 * label exists and (per objectui#8631's fence) none may be asked for, so it
 * forks no published text. That module's header carries the reconciliation in
 * full, so a reader meeting the two strings under opposite rules is not left to
 * assume one of them is a mistake.
 */
export function useDeadRecordReferenceLabel(): string {
  const { fieldOptionLabel } = useSafeFieldLabel();
  return useMemo(
    () => fieldOptionLabel(
      CANCEL_REASON_OBJECT,
      CANCEL_REASON_FIELD,
      RECORD_DELETED_REASON,
      APPROVAL_CANCEL_REASON_LABELS.record_deleted,
    ),
    [fieldOptionLabel],
  );
}
