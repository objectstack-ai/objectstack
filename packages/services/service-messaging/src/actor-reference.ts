// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import { renderValidationMessage } from '@objectstack/spec/system';
import { validationFailure } from '@objectstack/types';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';
import { USER_OBJECT } from './recipient-locale.js';

/** The column every fan-out row records its actor in — a lookup to `sys_user`. */
const ACTOR_FIELD = 'actor_id';

/**
 * [#21913] The dangling-actor refusal, kept at the producer.
 *
 * The fan-out writes (`writeEvent`'s `sys_notification` row, the inbox
 * channel's `sys_inbox_message` row) carry the explicit system opt-in, and the
 * engine skips its referential-integrity check for an `isSystem` write
 * (`ObjectQL.assertReferencesResolve`; row 23 of the `isSystem` census page).
 * Before the opt-in these writes ran with no context, so an `actor_id` naming
 * no `sys_user` row was REFUSED. A flow's notify node authors that value, and a
 * declared reference the runtime cannot honour must stay a loud refusal, not a
 * stored dangling id. So the check the engine no longer runs is run here, with
 * the engine's own answer, before the write:
 *
 *  - the same probe — `findOne(sys_user, { where: { id }, fields: ['id'] })`
 *    under the elevated context the engine's probe used for a context-less
 *    write;
 *  - the same verdict — refuse only when the probe RAN and found nothing; a
 *    probe that cannot run (no `sys_user` object, a throwing store) lets the
 *    write through, as the engine's fail-open does;
 *  - the same answer — `VALIDATION_FAILED` carrying one `reference_not_found`
 *    finding on `actor_id`, whose message is rendered from the same catalog
 *    entry and the field's declared label. It is built by `validationFailure`
 *    (`@objectstack/types`), the shared constructor for the shape every door
 *    serves as `400 VALIDATION_FAILED`, so this package stamps no code of its
 *    own. The differential pin holds it equal to the engine's refusal over a
 *    real engine.
 *
 * A write that names no actor (`null`, `undefined`, `''`) is unchanged: the
 * engine never checked an empty reference either.
 */
export async function assertActorReferenceResolves(
    data: IDataEngine,
    object: string,
    actorId: unknown,
): Promise<void> {
    if (actorId === null || actorId === undefined || actorId === '' || typeof actorId === 'object') return;
    let found: unknown;
    try {
        found = await data.findOne(
            USER_OBJECT,
            { where: { id: actorId }, fields: ['id'] },
            { context: FAN_OUT_SYSTEM_CONTEXT },
        );
    } catch {
        return;
    }
    if (found) return;
    throw actorReferenceNotFound(data, object, String(actorId));
}

/** The engine's `ValidationError` for one unresolved `actor_id`, field for field. */
function actorReferenceNotFound(data: IDataEngine, object: string, value: string): Error {
    const def = (data as { getSchema?: (name: string) => { fields?: Record<string, { label?: string }> } | undefined })
        .getSchema?.(object)?.fields?.[ACTOR_FIELD];
    const declared = def?.label?.trim();
    const label = declared && declared.length > 0 ? declared : ACTOR_FIELD;
    const constraint = { target: USER_OBJECT };
    const message = renderValidationMessage({
        messageKey: 'reference_not_found',
        label,
        field: ACTOR_FIELD,
        params: { ...constraint, value },
    });
    return validationFailure(message, [{ field: ACTOR_FIELD, code: 'reference_not_found', message, label, constraint, value }]);
}
