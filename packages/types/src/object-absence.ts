// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isMissingTableError } from './driver-error-classification.js';

/**
 * Did a read of `readObject` fail because this stack has no such object at all —
 * the one read failure whose empty answer is the truth?
 *
 * A reader that turns a failed read into "no rows" is safe only for this case.
 * Two spellings of the same absence answer `true`, and each must be attributed
 * to `readObject`, so a failure about another object is never taken as
 * evidence about this one:
 *
 *   - the driver's missing-table refusal ({@link isMissingTableError}, asked
 *     with `readObject`): the object is registered but its table was never
 *     created;
 *   - the engine's `OBJECT_NOT_FOUND` whose `object` is `readObject`: the
 *     composition never registered the object, so the engine refused the name
 *     before asking any driver.
 *
 * Every other failure — a connection drop, a lock timeout, a permission
 * refusal, a missing-table refusal naming a different relation — is an outage,
 * and answers `false`. A caller that would otherwise answer "nobody" for it
 * must refuse instead, because an invented empty membership withholds or
 * revokes whatever that membership confers.
 *
 * One home for the predicate. The sharing and approvals recipient reads each
 * carried a copy keyed to `sys_member`, and the next membership object
 * (`sys_team_member`, `sys_user_position`) would have made the copies diverge.
 * `readObject` is required: an absence that names no object cannot be
 * attributed, and the wide verdict is the outage-swallowing shape this exists
 * to prevent.
 *
 * @param error - The value a read of `readObject` threw.
 * @param readObject - The object the caller read, by its API name.
 * @returns `true` only when the error says `readObject` itself does not exist.
 */
export function isObjectAbsentError(error: unknown, readObject: string): boolean {
  if (isMissingTableError(error, readObject)) return true;
  const refused = error as { code?: unknown; object?: unknown } | null | undefined;
  return refused?.code === 'OBJECT_NOT_FOUND' && refused.object === readObject;
}
