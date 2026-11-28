// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K4, guard two] The request environment's `knowledge` service, as
 * the dispatcher's `knowledge_source` save doors hand it to
 * `authoredKnowledgeSourceRefusal` (`@objectstack/metadata-core`): the `/meta`
 * save, the MCP draft save and the package duplicate.
 *
 * The classified lookup, never the `resolveService` probe, and its two quiet
 * misses told apart:
 *
 *  - an instance → the service, which the predicate asks;
 *  - nothing registered under the name → `undefined`: the deployment runs no
 *    knowledge service, and the predicate's refusal says so and names the
 *    stack's `requires` as the remedy;
 *  - a registration that serves no instance in the request's scope (a host's
 *    scoped `knowledge` factory) → `knowledgeServiceNotInScope`: the
 *    deployment does run one, so the predicate answers its own sentence and
 *    does not send the author to the stack. The platform's
 *    `KnowledgeServicePlugin` registers a plain instance, so its own service
 *    never reaches this.
 *
 * A registered service that cannot be resolved rejects, and the predicate
 * answers that `503`. A deps with no `classifyServiceOrLoud` (a host's own,
 * a test double) is read through `resolveServiceOrLoud` as before: both misses
 * are then the no-service answer.
 */

import { KNOWLEDGE_SOURCE_ADMISSION_SERVICE, knowledgeServiceNotInScope } from '@objectstack/metadata-core';
import type { DomainHandlerDeps } from './domain-handler-registry.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

export async function resolveKnowledgeServiceForSave(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<unknown> {
    if (typeof deps.classifyServiceOrLoud !== 'function') {
        return deps.resolveServiceOrLoud(context, KNOWLEDGE_SOURCE_ADMISSION_SERVICE, context.environmentId);
    }
    const answer = await deps.classifyServiceOrLoud(context, KNOWLEDGE_SOURCE_ADMISSION_SERVICE, context.environmentId);
    if (answer.outcome === 'resolved') return answer.value;
    if (answer.outcome === 'no-instance-in-scope') return knowledgeServiceNotInScope(answer.scopeId);
    return undefined;
}
