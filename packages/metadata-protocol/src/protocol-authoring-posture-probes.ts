// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 26] The runtime authoring gate's deployment-posture probes, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole: the
 * four reads of THIS deployment that `assertRuntimeAuthoringRules` hands the
 * gate on every write.
 *
 *  - `orgWallEnforced` — does the configured tenancy posture wall
 *    organizations (#6285)? Unreadable reads as walled.
 *  - `tenancyPostureInForce` — the posture the `tenancy` service reports in
 *    force, for the public-form intake advisory (#21476).
 *  - `rlsMembershipResolverKeys` — the membership keys the mounted RLS
 *    resolver declares.
 *  - `hierarchyResolverMounted` — is a hierarchy resolver mounted (#26188)?
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same service keys, the
 * same `try`s and the same answers when a read throws.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body delegates here. Three read
 * the constructor-supplied `getServicesRegistry` field, handed over as a
 * getter ({@link AuthoringPostureProbesHost}), as
 * `protocol-metadata-service-read.ts` hands that field over, so each reads the
 * registry at call time — a resolver registered after this protocol is
 * assembled is seen by the next write. `orgWallEnforced` reads no member, so
 * its stub calls the plain function. The callers — the closures in
 * `assertRuntimeAuthoringRules`'s stub — keep calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imported it; four of those names had no other reader there and left its
 * imports, with the comments that explained them. Nothing re-exports this
 * module, so the published surface does not move.
 */

import type { TenancyPosture } from '@objectstack/spec/security';
// [#6285] ADR-0105 D1's authority on "does this deployment wall organizations?".
// `resolveMultiOrgEnabled()` is DEMOTED and its own doc comment says answering
// this question with it is a bug (cloud#1020, #5233) — so the posture, and only
// the posture, is what the runtime authoring gate is told.
import { postureEnforcesWall } from '@objectstack/spec/security';
import { resolveTenancyPosture } from '@objectstack/types';
import {
    // [#21476] The posture IN FORCE, read off the `tenancy` service the one way
    // the anonymous form doors read it — the runtime authoring gate's input for
    // its public-form intake advisory (see `tenancyPostureInForce()`).
    anonymousFormIntakePosture,
} from '@objectstack/metadata-core';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import { HIERARCHY_SCOPE_RESOLVER_SERVICE } from './runtime-authoring-gate.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's type on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface AuthoringPostureProbesHost {
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
}

/** The body of `ObjectStackProtocolImplementation#orgWallEnforced`; the method's docblock there is its contract. */
export function orgWallEnforced(): boolean {
    try {
        return postureEnforcesWall(resolveTenancyPosture());
    } catch {
        return true;
    }
}

/** The body of `ObjectStackProtocolImplementation#tenancyPostureInForce`; the method's docblock there is its contract. */
export function tenancyPostureInForce(this: Pick<AuthoringPostureProbesHost, 'getServicesRegistry'>): TenancyPosture | undefined {
    try {
        return anonymousFormIntakePosture(this.getServicesRegistry?.().get('tenancy'));
    } catch {
        return undefined;
    }
}

/** The body of `ObjectStackProtocolImplementation#rlsMembershipResolverKeys`; the method's docblock there is its contract. */
export function rlsMembershipResolverKeys(this: Pick<AuthoringPostureProbesHost, 'getServicesRegistry'>): readonly string[] | undefined {
    const registry = this.getServicesRegistry?.();
    if (!registry) return undefined;
    let resolver: unknown;
    try {
        resolver = registry.get(RLS_MEMBERSHIP_RESOLVER_SERVICE);
    } catch {
        return undefined;
    }
    if (resolver === undefined || resolver === null) return [];
    const keys = (resolver as { keys?: unknown }).keys;
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) return undefined;
    return keys as readonly string[];
}

/** The body of `ObjectStackProtocolImplementation#hierarchyResolverMounted`; the method's docblock there is its contract. */
export function hierarchyResolverMounted(this: Pick<AuthoringPostureProbesHost, 'getServicesRegistry'>): boolean | undefined {
    const registry = this.getServicesRegistry?.();
    if (!registry) return undefined;
    try {
        const resolver = registry.get(HIERARCHY_SCOPE_RESOLVER_SERVICE);
        return resolver !== undefined && resolver !== null;
    } catch {
        return undefined;
    }
}
