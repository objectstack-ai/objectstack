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
 *   `os validate` and publish are their own card (topic #37000, row 4).
 * - **A deployment with no knowledge service**, or one whose service is not
 *   the platform's: nothing loads the item there, so nothing is indexed.
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

/** The member of the `knowledge` service the doors ask, reached duck-typed. */
export interface KnowledgeSourceSaveAdmitter {
    admitAuthoredSource(item: unknown, context: unknown): Promise<AuthoredKnowledgeSourceVerdict>;
}

function unavailable(why: string): AuthoredKnowledgeSourceRefusal {
    return {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message:
            `The knowledge source was not saved: whether its author may search what it would index could not be ` +
            `judged (${why}). Nothing was written; try again.`,
    };
}

/**
 * The refusal of a `knowledge_source` save, or `undefined` when the save may
 * go on (the module doc says what is and is not judged).
 *
 * `resolveKnowledgeService` answers the request environment's `knowledge`
 * service, `undefined` when none is registered, and throws when one is
 * registered and cannot be resolved.
 */
export async function authoredKnowledgeSourceRefusal(input: {
    /** The metadata type saved, in any URL spelling the protocol accepts. */
    type: string;
    /** The item as the door will hand it to the protocol. */
    item: unknown;
    /** The author's execution context. */
    executionContext: unknown;
    resolveKnowledgeService: () => Promise<unknown> | unknown;
}): Promise<AuthoredKnowledgeSourceRefusal | undefined> {
    if (canonicalMetaUrlType(input.type) !== KNOWLEDGE_SOURCE_TYPE) return undefined;
    if ((input.executionContext as { isSystem?: unknown } | null | undefined)?.isSystem === true) return undefined;
    let service: unknown;
    try {
        service = await input.resolveKnowledgeService();
    } catch (err) {
        return unavailable(`the knowledge service could not be resolved: ${err instanceof Error ? err.message : String(err)}`);
    }
    const admit = (service as Partial<KnowledgeSourceSaveAdmitter> | null | undefined)?.admitAuthoredSource;
    if (typeof admit !== 'function') return undefined;
    let verdict: AuthoredKnowledgeSourceVerdict;
    try {
        verdict = await admit.call(service, input.item, input.executionContext);
    } catch (err) {
        return unavailable(err instanceof Error ? err.message : String(err));
    }
    if (!verdict || verdict.admitted === true) return undefined;
    return { status: verdict.status, code: verdict.code, message: verdict.message };
}
