// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21520, #21594] The stored-metadata family's boundary for app-authored bodies.
 *
 * The family's tables (`sys_metadata` / `sys_metadata_history`, the set
 * `isStoredMetadataBodyObject` answers for) are reached by an app-authored body
 * through the metadata API only: the metadata protocol is their one writer,
 * where a change is validated and its provenance recorded, and their one
 * reader, which serves each definition in its read projection. A sandboxed
 * body — a hook body, an action body or a job body, whether it came from a
 * code bundle, an installed artifact or the metadata door — may not touch
 * those tables any other way:
 *
 *  - **Binding** a body hook to a family table is refused at registration
 *    ({@link storedMetadataBodyHookBindingRefusal}, consulted by
 *    `hookBodyRunnerFactory` — the one point every body hook passes through
 *    to become a handler, whichever door bound it).
 *  - **Writing** a family table through a body's `ctx.api` is refused before
 *    the write runs ({@link storedMetadataBodyWriteRefusal}, consulted by the
 *    reader-context seam's body write layer).
 *  - **Reading** a family table through a body's `ctx.api` is refused before
 *    the read runs ({@link storedMetadataBodyReadRefusal}, consulted by the
 *    seam's body read layer), whatever the read's query names.
 *  - **Being handed** a family row as an action's subject record (`ctx.record`,
 *    which the `/actions` door loads before dispatch) is refused before the
 *    body runs ({@link storedMetadataBodySubjectRecordRefusal}, consulted by
 *    `actionBodyRunnerFactory` — the one point every action body passes
 *    through to run, whichever door bound it).
 *
 * Platform code is outside this boundary: the metadata protocol and its own
 * readers and writers, the platform's internal hooks (registered as code,
 * never as a body) and host code a deployer registers all reach the store
 * through their own imports, never through a sandboxed body's API.
 *
 * Every refusal carries the standard catalog's `PERMISSION_DENIED` / 403: the
 * condition is that this author context is not permitted the operation on this
 * table, which is the catalog member's meaning, and the ledger's own admission
 * rule sends a generic permission condition to the standard member rather than
 * to a registered synonym. What the author does instead is the prescription,
 * carried in the message.
 */

import { isStoredMetadataBodyObject, STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';

/** The code and status both refusals carry (ADR-0112 envelope). */
export const STORED_METADATA_BODY_BOUNDARY_CODE = 'PERMISSION_DENIED';
export const STORED_METADATA_BODY_BOUNDARY_STATUS = 403;

/** The prescription the binding and write refusals end with: the door an author changes metadata through. */
const PRESCRIPTION =
    'Change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`, the metadata protocol), '
    + 'where it is validated and its provenance is recorded. Elevation (`runAs`, a system context) does not '
    + 'change this.';

/** The prescription the read refusal ends with: the door an author reads metadata through. */
const READ_PRESCRIPTION =
    'Read metadata through the metadata API (`GET /api/v1/meta/:type/:name`, the metadata protocol, and '
    + '`GET /api/v1/meta/:type/:name/history` for its versions). Elevation (`runAs`, a system context) does not '
    + 'change this.';

function refusal(message: string, object: string, operation: string, prescription: string = PRESCRIPTION): Error {
    const err = new Error(`${message} ${prescription}`) as Error & Record<string, unknown>;
    err.code = STORED_METADATA_BODY_BOUNDARY_CODE;
    err.status = STORED_METADATA_BODY_BOUNDARY_STATUS;
    err.object = object;
    err.operation = operation;
    return err;
}

/** The hook target as a list of names (a string target is a list of one). */
function hookTargets(target: unknown): string[] {
    const names = Array.isArray(target) ? target : [target];
    return names.filter((name): name is string => typeof name === 'string');
}

/**
 * The family tables a hook's `object` target NAMES. The wildcard `'*'` names
 * none of them: a wildcard body hook binds, and its body is simply never run
 * for a family table's event (see `hookBodyRunnerFactory`).
 */
export function storedMetadataFamilyTargetsOf(target: unknown): string[] {
    return hookTargets(target).filter((name) => isStoredMetadataBodyObject(name));
}

/** Whether a hook's target admits every object (`'*'`), the family's tables among them. */
export function isWildcardHookTarget(target: unknown): boolean {
    return hookTargets(target).includes('*');
}

/**
 * The refusal for binding a body hook whose target names a family table, or
 * `undefined` when it names none. Thrown by the body runner at registration,
 * so the binder records it against the hook and the hook is never registered.
 */
export function storedMetadataBodyHookBindingRefusal(hook: { name?: unknown; object?: unknown }): Error | undefined {
    const named = storedMetadataFamilyTargetsOf(hook?.object);
    if (named.length === 0) return undefined;
    const hookName = typeof hook?.name === 'string' ? hook.name : '(unnamed)';
    return refusal(
        `Hook '${hookName}' was not bound: its body targets ${named.map((n) => `'${n}'`).join(', ')}, a table of `
        + 'stored metadata, and an app-authored hook body may not be bound to one.',
        named[0],
        'bind',
    );
}

/**
 * The refusal for a sandboxed body's write verb on a family table, or
 * `undefined` for any other object. Thrown before the write runs, whatever its
 * payload or predicate, so a refused write changes nothing and answers the
 * same way whatever it names.
 */
export function storedMetadataBodyWriteRefusal(object: string, verb: string): Error | undefined {
    if (!isStoredMetadataBodyObject(object)) return undefined;
    return refusal(
        `Cannot ${verb} '${object}' from an app-authored body: the write was not run. '${object}' holds stored `
        + 'metadata, and a body may not write it directly.',
        object,
        verb,
    );
}

/**
 * [#21594] The refusal for a sandboxed body's read verb on a family table, or
 * `undefined` for any other object. Thrown before the read runs, whatever its
 * query names (a filter, a sort, a grouping, a search, a projection, or none),
 * so a refused read reaches no row and answers the same way whatever it asks:
 * it serves nothing, and it is no oracle on what the table holds.
 */
export function storedMetadataBodyReadRefusal(object: string, verb: string): Error | undefined {
    if (!isStoredMetadataBodyObject(object)) return undefined;
    return refusal(
        `Cannot ${verb} '${object}' from an app-authored body: the read was not run. '${object}' holds stored `
        + 'metadata, and a body may not read it directly.',
        object,
        verb,
        READ_PRESCRIPTION,
    );
}

/**
 * [#21594] The refusal for an action body that would be handed a family row as
 * its subject record, or `undefined` for any other object. The `/actions` door
 * loads an action's subject record before it dispatches, through the generic
 * data door, so an action declared on a family table — or an object-less one
 * addressed under it — would otherwise reach its body with a family row as
 * `ctx.record`. Thrown before the body runs, so the body is handed nothing of
 * the row; a host code handler's subject record is not judged here.
 */
export function storedMetadataBodySubjectRecordRefusal(object: string, action: string): Error | undefined {
    if (!isStoredMetadataBodyObject(object)) return undefined;
    return refusal(
        `Action '${action}' was not run: its subject record is a row of '${object}', which holds stored `
        + 'metadata, and an app-authored body may not be handed one.',
        object,
        'record',
        READ_PRESCRIPTION,
    );
}

/** The family's table names, for messages and logs that list them. */
export function storedMetadataFamilyTableList(): string {
    return [...STORED_METADATA_BODY_OBJECTS].map((n) => `'${n}'`).join(', ');
}
