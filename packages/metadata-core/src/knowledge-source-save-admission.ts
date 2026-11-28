// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K4, guard two] Source admission at save: a `knowledge_source` is
 * saved only when its AUTHOR may themselves search what it would index.
 *
 * ## What is asked, and of whom
 *
 * The knowledge service's search-time gates (`knowledge-source-admission.ts`
 * in `@objectstack/service-knowledge`): the object's package is not disabled,
 * the API serves the object for `search`, a system object opts into AI reads,
 * and the caller may QUERY every field the source would put in its index. At
 * search they decide which sources a caller's search reaches. Here the same
 * gates are asked once, for the authoring principal, before the item is
 * written — so nobody builds an index over an object or a field they could
 * not have searched, and has the embedder sent text they may not read.
 *
 * ## Why the doors ask, through this one function
 *
 * The verdict needs the author's execution context, and the metadata protocol
 * is handed only an actor id. So each door that saves an item asks, right
 * after its capability gates and before the protocol writes: `PUT
 * /meta/:type/:name` on both transports and the MCP draft save. The gates
 * themselves stay with the knowledge service, reached by the duck-typed
 * member {@link KnowledgeSourceSaveAdmitter.admitAuthoredSource}; the doors'
 * packages do not depend on that package.
 *
 * ## What is not judged here
 *
 * - **Any other type**, and **the engine's own write** (`isSystem`: a package
 *   install, a seed, a migration): the gates that need no principal at
 *   `os validate` and publish are their own card (topic #37000, row 4). A
 *   system write is never refused here, a deployment with no knowledge
 *   service included: the boot names such an item and its remedy
 *   (`knowledge-source-unserved.ts` in `@objectstack/objectql`).
 * - **A registered knowledge service that is not the platform's** (one with
 *   no `admitAuthoredSource`, a host-mounted one for example): it answers for
 *   its own sources, and the save goes on.
 *
 * ## A deployment with no knowledge service
 *
 * Refused, not judged (ADR-0078 §1: a declaration that never takes effect is
 * an error). Nothing loads, indexes or searches a `knowledge_source` there,
 * and nothing mounts the service while the process runs: it is composed at
 * boot, from `requires: ['knowledge']` in the stack. So an author's save there
 * would be kept and never served, and the Studio, REST or MCP author would
 * never see the boot line that says so. The refusal tells them at the save,
 * with the remedy: declare the token, restart, then save
 * ({@link noKnowledgeServiceRefusal}). `503 SERVICE_UNAVAILABLE`: the save
 * needs a service this deployment does not run, the code the knowledge
 * service answers at index and search for a store that is not mounted.
 * Nothing was written.
 *
 * ## A knowledge service registered, with no instance in this scope
 *
 * A host can register `knowledge` per environment, as a scoped factory that
 * answers no instance for some of them. The deployment does run a knowledge
 * service then, so the sentence above would be false, and its remedy (the
 * stack's `requires`) is not the fix: the host's registration decides. A door
 * whose lookup tells that miss apart answers it as
 * {@link knowledgeServiceNotInScope}, and the save is refused with its own
 * sentence ({@link noKnowledgeServiceInScopeRefusal}), the same status and
 * code. The platform's `KnowledgeServicePlugin` registers a plain instance,
 * so its own service never reaches this.
 *
 * ## The door's wording
 *
 * The sentences name the save's remedy (save the source again, nothing was
 * written). A door that copies sources rather than saves one, the package
 * duplicate, asks with `door: 'duplicate'` and gets its caller's remedy
 * (duplicate the package again) and no "nothing was written" of its own: that
 * door's prefix says once that nothing was copied.
 *
 * ## Fail direction
 *
 * Access-narrowing, so it fails closed: a knowledge service that cannot be
 * resolved, or a verdict that throws, refuses the save `503
 * SERVICE_UNAVAILABLE`. Nothing was written.
 */

import { canonicalMetaUrlType } from '@objectstack/spec/meta-spelling';

/** The kernel service name the knowledge service registers under. */
export const KNOWLEDGE_SOURCE_ADMISSION_SERVICE = 'knowledge';

/** The metadata type judged. */
const KNOWLEDGE_SOURCE_TYPE = 'knowledge_source';

/** An ADR-0112 coded refusal of a save. */
export interface AuthoredKnowledgeSourceRefusal {
    status: number;
    code: string;
    message: string;
}

/** The verdict {@link KnowledgeSourceSaveAdmitter.admitAuthoredSource} answers. */
export type AuthoredKnowledgeSourceVerdict =
    | { admitted: true }
    | ({ admitted: false } & AuthoredKnowledgeSourceRefusal);

/**
 * Which door asks, for the remedy its caller is told: `save` (the default) for
 * a door that saves one item, `duplicate` for the package duplicate, which
 * copies a package's sources.
 */
export type KnowledgeSourceSaveDoor = 'save' | 'duplicate';

/** Brand of {@link knowledgeServiceNotInScope}, shared across copies of this module. */
const NOT_IN_SCOPE = Symbol.for('@objectstack/metadata-core/knowledge-service-not-in-scope');

/**
 * What a door's `resolveKnowledgeService` answers when a `knowledge`
 * registration exists and the lookup made in the request's scope produced no
 * instance (a host's scoped factory that serves no service for that
 * environment). Built by {@link knowledgeServiceNotInScope}.
 */
export interface KnowledgeServiceNotInScope {
    readonly [NOT_IN_SCOPE]: true;
    /** The scope the lookup was made in: the request's environment. */
    readonly scopeId: string;
}

/** The answer a door's lookup gives for a scope-relative miss of the `knowledge` service. */
export function knowledgeServiceNotInScope(scopeId: string): KnowledgeServiceNotInScope {
    return Object.freeze({ [NOT_IN_SCOPE]: true as const, scopeId });
}

function isKnowledgeServiceNotInScope(value: unknown): value is KnowledgeServiceNotInScope {
    return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[NOT_IN_SCOPE] === true;
}

/** The member of the `knowledge` service the doors ask, reached duck-typed. */
export interface KnowledgeSourceSaveAdmitter {
    admitAuthoredSource(item: unknown, context: unknown): Promise<AuthoredKnowledgeSourceVerdict>;
}

/** The remedy and the no-op each door's caller is told. */
const DOOR_WORDING: Readonly<Record<KnowledgeSourceSaveDoor, { notDone: string; retry: string; nothingDone: string }>> = {
    save: { notDone: 'was not saved', retry: 'save the source again', nothingDone: ' Nothing was written.' },
    duplicate: { notDone: 'cannot be copied', retry: 'duplicate the package again', nothingDone: '' },
};

function sourceSubject(item: unknown): string {
    const name = (item as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' && name !== '' ? `The knowledge source '${name}'` : 'The knowledge source';
}

function unavailable(why: string, door: KnowledgeSourceSaveDoor): AuthoredKnowledgeSourceRefusal {
    const wording = DOOR_WORDING[door];
    return {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message:
            `The knowledge source ${wording.notDone}: whether its author may search what it would index could not be ` +
            `judged (${why}).` + (door === 'save' ? ' Nothing was written; try again.' : ' Duplicate the package again.'),
    };
}

/**
 * The refusal of an author's `knowledge_source` save on a deployment that
 * registers no knowledge service: what is wrong, and what makes the save take
 * effect. The service is mounted at boot from the stack's `requires`, never
 * while the process runs, so the remedy is ordered: the token, a restart, then
 * the save.
 */
function noKnowledgeServiceRefusal(item: unknown, door: KnowledgeSourceSaveDoor): AuthoredKnowledgeSourceRefusal {
    const wording = DOOR_WORDING[door];
    return {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message:
            `${sourceSubject(item)} ${wording.notDone}: this deployment runs no knowledge service, so nothing would ` +
            "load, index or search it. Add requires: ['knowledge'] to the stack (or, on a host that composes its own " +
            'kernel, KnowledgeServicePlugin from @objectstack/service-knowledge and a knowledge store), restart the ' +
            `server, then ${wording.retry}: the service is mounted when the server starts, never while it runs.` +
            wording.nothingDone,
    };
}

/**
 * The refusal of an author's `knowledge_source` save where a `knowledge`
 * registration exists and answers no instance for the request's environment
 * (a host's scoped factory). The deployment does run a knowledge service, so
 * the stack's `requires` is not the remedy: the host's registration decides
 * which environments it serves.
 */
function noKnowledgeServiceInScopeRefusal(
    item: unknown,
    scopeId: string,
    door: KnowledgeSourceSaveDoor,
): AuthoredKnowledgeSourceRefusal {
    const wording = DOOR_WORDING[door];
    return {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message:
            `${sourceSubject(item)} ${wording.notDone}: the knowledge service registered on this deployment serves ` +
            `no instance for environment '${scopeId}', so nothing would load, index or search it there. The host's ` +
            `knowledge service registration decides which environments it serves; once it serves '${scopeId}', ` +
            `${wording.retry}.` + wording.nothingDone,
    };
}

/**
 * The refusal of a `knowledge_source` save, or `undefined` when the save may
 * go on (the module doc says what is and is not judged).
 *
 * `resolveKnowledgeService` answers the request environment's `knowledge`
 * service, `undefined` when none is registered (an author's save is then
 * refused), {@link knowledgeServiceNotInScope} when one is registered and
 * serves no instance in the request's scope (refused, with its own sentence),
 * and throws when one is registered and cannot be resolved.
 */
export async function authoredKnowledgeSourceRefusal(input: {
    /** The metadata type saved, in any URL spelling the protocol accepts. */
    type: string;
    /** The item as the door will hand it to the protocol. */
    item: unknown;
    /** The author's execution context. */
    executionContext: unknown;
    resolveKnowledgeService: () => Promise<unknown> | unknown;
    /** The door that asks, for its caller's remedy; `save` when absent. */
    door?: KnowledgeSourceSaveDoor;
}): Promise<AuthoredKnowledgeSourceRefusal | undefined> {
    if (canonicalMetaUrlType(input.type) !== KNOWLEDGE_SOURCE_TYPE) return undefined;
    if ((input.executionContext as { isSystem?: unknown } | null | undefined)?.isSystem === true) return undefined;
    const door: KnowledgeSourceSaveDoor = input.door ?? 'save';
    let service: unknown;
    try {
        service = await input.resolveKnowledgeService();
    } catch (err) {
        return unavailable(`the knowledge service could not be resolved: ${err instanceof Error ? err.message : String(err)}`, door);
    }
    if (service === undefined || service === null) return noKnowledgeServiceRefusal(input.item, door);
    if (isKnowledgeServiceNotInScope(service)) return noKnowledgeServiceInScopeRefusal(input.item, service.scopeId, door);
    const admit = (service as Partial<KnowledgeSourceSaveAdmitter>).admitAuthoredSource;
    if (typeof admit !== 'function') return undefined;
    let verdict: AuthoredKnowledgeSourceVerdict;
    try {
        verdict = await admit.call(service, input.item, input.executionContext);
    } catch (err) {
        return unavailable(err instanceof Error ? err.message : String(err), door);
    }
    if (!verdict || verdict.admitted === true) return undefined;
    return { status: verdict.status, code: verdict.code, message: verdict.message };
}
