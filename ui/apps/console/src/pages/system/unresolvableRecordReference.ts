// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "This record cannot be opened" — the CAUSE-FREE affordance for an approval
 * reference the console can neither name nor open (objectui#8631).
 *
 * ## The defect, and the one thing this may say about it
 *
 * A terminal (`approved` / `rejected`) approval row whose target record does
 * not resolve degraded to the opaque record id: `record_title` is absent, so
 * the reference slot fell through to `formatIdentity(record_id)` and showed a
 * truncated identifier that means nothing to an approver.
 *
 * The triage ruling on objectui#8631 is a NEUTRAL affordance — correct whether
 * the record was deleted or is merely not visible — together with an explicit
 * fence, quoted here in its own words:
 *
 *   ⛔ Do not attempt to distinguish "deleted" from "not visible." That
 *   distinction is an existence oracle … ⛔ Do not ask upstream for a field
 *   that separates them as part of this card.
 *
 * So this module's copy asserts exactly one thing, and it is a fact about the
 * AFFORDANCE rather than about the record: there is nothing here to open. It
 * never says deleted, never says permissions, and nothing a reader can infer
 * from it separates the two — which is why it is safe on a reference whose
 * cause the platform deliberately does not publish.
 *
 * ## Why this is a SECOND, WEAKER branch and not a widened `isDeletedRecordReference`
 *
 * `isDeletedRecordReference` answers for the class the platform itself FLAGS
 * (`status: 'cancelled'` + `cancel_reason: 'record_deleted'`), and its module
 * forbids widening it to a failed lookup in as many words. Nothing here
 * touches it: the tombstone keeps precedence, and this branch is reached only
 * for a row the server flagged nothing about. Order matters both ways — a row
 * the platform DID flag must keep saying what the platform said, and a row it
 * did not must never borrow that sentence.
 *
 * ## ⛔ Why this is console-authored copy, when the tombstone deliberately is not
 *
 * `deadRecordReference.ts` refuses to author a string, and its reason —
 * "a second copy of this sentence in this repo would be a second de-facto
 * contract, localized on its own schedule, drifting from the platform's" — is
 * about a sentence the PLATFORM owns: the tombstone renders the `cancel_reason`
 * option label that `@objectstack/plugin-approvals` ships and localizes, so
 * re-typing it here would fork a published text.
 *
 * This sentence has no such original. `APPROVAL_CANCEL_REASON_LABELS` declares
 * exactly one option (`record_deleted`) and there is no `cancel_reason` for
 * "unresolvable" — nor may this card ask for one, by the fence quoted above.
 * ⇒ there is no upstream text to mirror and therefore no contract to fork; the
 * two rules point the same way and only look opposite. An affordance the
 * console decided to render is copy the console owns, and it goes through this
 * repo's own i18n catalogue in every locale that catalogue maintains, exactly
 * like the rest of this page's strings.
 *
 * ## The two instruments this reads, and neither is widened
 *
 * 1. `recordReadability`'s probe (objectui#5211) — a list read issued as the
 *    signed-in viewer, whose answer FUSES "deleted" and "not visible" because
 *    the platform's read path fuses them on purpose (existence
 *    non-disclosure). That fusion is the reason the probe can drive cause-free
 *    copy and could never drive a cause. It is consulted here exactly as the
 *    row already consults it for the link; nothing asks it for more than it
 *    reports.
 * 2. The row's own `record_title`, from the request's payload snapshot the
 *    approver was already given. A row that HAS one keeps it (objectui#5211's
 *    ruling: the title still shows, only the link is suppressed) — there is no
 *    degradation to remove and replacing a business identifier with this
 *    sentence would delete information rather than add it.
 */

import { useMemo } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ApprovalRequestRow } from '../../services/approvalsApi';
import { isDeletedRecordReference } from './deadRecordReference';

/** The fields of an approval row this decision reads. */
export type UnresolvableReferenceRow = Pick<
  ApprovalRequestRow,
  'status' | 'cancel_reason' | 'record_title'
>;

/**
 * Is this reference one the console can neither NAME nor OPEN?
 *
 * Both halves are required, and each rules out a case the affordance would be
 * wrong for:
 *
 *   - `unreadable` — the viewer's own probe answered, and the target is not in
 *     its answer. Unknown is not enough: the probe fails open by design, so an
 *     unanswered or failed probe leaves today's behaviour in place rather than
 *     announcing that a perfectly reachable record cannot be opened.
 *   - no `record_title` — the snapshot carries no business identifier, so the
 *     only thing left to render is the opaque id. With one, the row already
 *     reads as history and is left alone.
 *
 * A row the platform flagged as a deletion is not this class: it keeps the
 * tombstone, which says something stronger because the server asserted it.
 */
export function isUnresolvableRecordReference(
  r: UnresolvableReferenceRow | null | undefined,
  unreadable: boolean,
): boolean {
  if (!r) return false;
  if (isDeletedRecordReference(r)) return false;
  if (typeof r.record_title === 'string' && r.record_title.trim() !== '') return false;
  return unreadable;
}

/**
 * The affordance's text, from this repo's catalogue.
 *
 * The inline default is the `en` value verbatim — `check:i18n-keys` fails when
 * the two disagree — and the other nine packs carry their own translation, so
 * no locale reads English here.
 */
export function useUnresolvableRecordReferenceLabel(): string {
  const { t } = useObjectTranslation();
  return useMemo(
    () => String(t('approvalsInbox.recordUnresolvable', {
      defaultValue: 'This record cannot be opened',
    })),
    [t],
  );
}
