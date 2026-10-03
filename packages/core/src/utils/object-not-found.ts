// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 404 an object name answers when the schema registry does not resolve it.
 *
 * One name space, two doors. The generic data door (the protocol's
 * object-existence gate) and the engine's in-process verbs (`find`, `findOne`,
 * `count`, `aggregate`, `insert`, `update`, `delete`, `validate`) resolve an
 * object name through the same registry, and a name the registry does not hold
 * is refused by both with this one envelope: `code: 'OBJECT_NOT_FOUND'`,
 * `status: 404`, and the name the caller asked for on `object`.
 *
 * Why the engine refuses too: an in-process verb used to hand an unresolved
 * name to the driver as a raw table name. Every guard keyed by a registered
 * object name then judged a name that named no object, while the driver read
 * whatever table the spelling reached. The door already refused that name, so
 * an in-process caller (a sandboxed body, an action handler, a hook) could
 * read what the door would not serve.
 *
 * Why it lives in `@objectstack/core`: ADR-0076 D2's boundary ratchet
 * (`core-boundary.ratchet.test.ts`) keeps `engine.ts` from importing
 * `@objectstack/metadata-protocol`, where the door's envelope was first
 * written. `recordNotFoundError` moved down here for the same reason, and both
 * doors call this factory rather than each spelling the envelope.
 *
 * The wire answer is the data-error classifier's (`mapDataError`,
 * `@objectstack/types`), which reads `code` and `object`; this message is the
 * operator-facing text and stays the door's original sentence.
 */
export function objectNotFoundError(object: string): Error {
    const err = new Error(`Object '${object}' not found`) as Error & {
        code?: string;
        status?: number;
        object?: string;
    };
    err.code = 'OBJECT_NOT_FOUND';
    err.status = 404;
    err.object = object;
    return err;
}
