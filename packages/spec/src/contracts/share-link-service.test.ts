// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#6430 / #6206 ruling A] Share-link contract pins — the enforcement/401 line.
//
// ## What the ruling decided
//
// The share-link visibility check must run on the FULL `ExecutionContext` (the
// complete `resolveAuthzContext` envelope: `accessible_org_ids`,
// `org_user_ids`, `systemPermissions`, `posture`, `tabPermissions`, …).
// `ShareLinkExecutionContext` — the five-field shape the route assembled — may
// keep serving the route's own 401 decision, but must never reach an
// enforcement path. ADR-0095 D2 (posture resolved once, carried, never
// re-derived at enforcement) and ADR-0105 D2 (`accessible_org_ids` IS the
// `group`-posture Layer 0 wall, absent ⇒ deny) are the anchors; #5997 and
// #6071 were the two prior assembly sites of the same family.
//
// ## What is pinned here, and what deliberately is NOT
//
// PINNED: (1) each `IShareLinkService` method that adjudicates access declares
// its context parameter as `ExecutionContext` — by TYPE IDENTITY, so
// re-narrowing it to anything (including back to `ShareLinkExecutionContext`)
// goes red; (2) a call site may state the whole envelope, which under the old
// signature was a TS2353 excess-property error on every one of the five
// dropped keys — that is this file's before-red direction; (3) the narrow type
// survives, unchanged in shape, as the route's 401 vocabulary.
//
// NOT PINNED, on purpose: there is no `@ts-expect-error` asserting that a
// `ShareLinkExecutionContext` is REJECTED by an enforcement parameter, because
// it is not. Structural subtyping makes the narrow type assignable to
// `ExecutionContext` — its five fields all exist there with compatible types,
// and nothing in `ExecutionContext` is required — so such a directive would be
// unsatisfied and fail the build. TypeScript cannot express "this optional
// field had better have been populated". A pin shaped to look like compiler
// enforcement, where only documentation exists, would read as verified and be
// worse than the honest statement, so the last case below pins the assignment
// as the legal-but-unwanted fact it is and names what actually holds the line:
// the declared parameter type, which makes any narrowing visible at the call
// site, plus the caller's obligation to pass the resolved envelope through
// whole.

import { describe, expect, it } from 'vitest';

import type { ExecutionContext } from '../kernel/execution-context.zod';
import type {
  CreateShareLinkInput,
  IShareLinkService,
  ListShareLinksFilter,
  ShareLink,
  ShareLinkExecutionContext,
} from './share-link-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;
/** Compile error when the argument is not `false`. */
type Refute<T extends false> = T;

type CreateCtx = Parameters<IShareLinkService['createLink']>[1];
type RevokeCtx = Parameters<IShareLinkService['revokeLink']>[1];
type ListCtx = Parameters<IShareLinkService['listLinks']>[1];

// Every adjudicating method takes the full envelope, by identity.
export type EnforcementTakesFullEnvelope0 = Assert<Eq<CreateCtx, ExecutionContext>>;
export type EnforcementTakesFullEnvelope1 = Assert<Eq<RevokeCtx, ExecutionContext>>;
export type EnforcementTakesFullEnvelope2 = Assert<Eq<ListCtx, ExecutionContext>>;

// …and none of them takes the route's narrow 401 shape.
export type EnforcementIsNotNarrow0 = Refute<Eq<CreateCtx, ShareLinkExecutionContext>>;
export type EnforcementIsNotNarrow1 = Refute<Eq<RevokeCtx, ShareLinkExecutionContext>>;
export type EnforcementIsNotNarrow2 = Refute<Eq<ListCtx, ShareLinkExecutionContext>>;

// The narrow type keeps exactly the five route-401 fields — it was not widened
// as a shortcut around the ruling. Widening it would recreate the subset this
// card removed, one field at a time.
export type NarrowTypeKeepsRouteShape = Assert<
  Eq<keyof ShareLinkExecutionContext, 'userId' | 'tenantId' | 'isSystem' | 'positions' | 'permissions'>
>;

/** Records what the service actually received, so no assertion is vacuous. */
function makeRecordingService(): {
  service: IShareLinkService;
  seen: ExecutionContext[];
} {
  const seen: ExecutionContext[] = [];
  const link: ShareLink = {
    id: 'shl_pin',
    token: 'tok_0123456789012345678901',
    object_name: 'contract',
    record_id: 'rec_1',
    permission: 'view',
    audience: 'link_only',
  };
  const service: IShareLinkService = {
    async createLink(_input: CreateShareLinkInput, context: ExecutionContext) {
      seen.push(context);
      return link;
    },
    async revokeLink(_idOrToken: string, context: ExecutionContext) {
      seen.push(context);
    },
    async listLinks(_filter: ListShareLinksFilter, context: ExecutionContext) {
      seen.push(context);
      return [link];
    },
    async resolveToken() {
      return null;
    },
  };
  return { service, seen };
}

describe('share-link contract — enforcement takes the full ExecutionContext (#6430)', () => {
  it('accepts the whole resolveAuthzContext envelope at an enforcement call site', async () => {
    const { service, seen } = makeRecordingService();

    // The before-red direction of this file. Written as an object LITERAL on
    // purpose: excess-property checking applies to literals, so under the old
    // `ShareLinkExecutionContext` parameter every key below the first five was
    // a TS2353 error ("does not exist in type ShareLinkExecutionContext") —
    // which is precisely why the route hand-assembled a subset instead of
    // passing what it had already resolved. Restore the narrow parameter type
    // and this call stops compiling.
    await service.createLink(
      { object: 'contract', recordId: 'rec_1' },
      {
        userId: 'usr_1',
        tenantId: 'org_plant_a',
        positions: ['sales'],
        permissions: ['standard_user'],
        // The five dimensions the trimmed envelope dropped (#6206):
        accessible_org_ids: ['org_plant_a', 'org_plant_b'],
        org_user_ids: ['usr_1', 'usr_2'],
        systemPermissions: ['manage_sharing'],
        posture: 'MEMBER',
        tabPermissions: { crm: 'visible' },
      },
    );

    const received = seen[0]!;
    // ADR-0105 D2: this set IS the `group`-posture Layer 0 wall. Its absence
    // was the blanket 403 — so its arrival is the fact worth observing.
    expect(received.accessible_org_ids).toEqual(['org_plant_a', 'org_plant_b']);
    // ADR-0095 D2: resolved once upstream, carried — never re-derived here.
    expect(received.posture).toBe('MEMBER');
    expect(received.org_user_ids).toEqual(['usr_1', 'usr_2']);
    expect(received.systemPermissions).toEqual(['manage_sharing']);
    expect(received.tabPermissions).toEqual({ crm: 'visible' });
  });

  it('carries the envelope through revokeLink and listLinks too', async () => {
    const { service, seen } = makeRecordingService();
    const envelope: ExecutionContext = {
      userId: 'usr_1',
      accessible_org_ids: ['org_plant_a'],
      posture: 'TENANT_ADMIN',
    };

    // Both are adjudicating paths: revoke authority is creator ∪ record
    // share-manager (ADR-0111 D8, probed with `context`), and the listing is
    // read under `context`.
    await service.revokeLink('shl_pin', envelope);
    await service.listLinks({ object: 'contract' }, envelope);

    expect(seen).toHaveLength(2);
    for (const received of seen) {
      expect(received.accessible_org_ids).toEqual(['org_plant_a']);
      expect(received.posture).toBe('TENANT_ADMIN');
    }
  });

  it('keeps the narrow type for the route 401 — and states why no compiler pin exists', () => {
    // Still exported, still the route's vocabulary: `userId` present ⇒ the
    // request is authenticated, absent ⇒ 401. That decision reads no
    // authorization dimension, so it needs no authorization envelope.
    const anonymous: ShareLinkExecutionContext = {};
    const authenticated: ShareLinkExecutionContext = { userId: 'usr_1', positions: ['sales'] };
    expect(anonymous.userId).toBeUndefined();
    expect(authenticated.userId).toBe('usr_1');

    // The honest half. This assignment is LEGAL and compiles — five optional
    // fields, all present in the wider type. So the enforcement boundary is
    // held by the declared parameter type and the caller's obligation, not by
    // tsc; an `@ts-expect-error` here would be unsatisfied and fail the build.
    // What the contract change buys is that the narrowing is now visible where
    // it happens — the call site names `ExecutionContext` and a reviewer can
    // see a five-field object being handed to it — instead of being hidden
    // behind a parameter type that looked purpose-built for the job.
    const widened: ExecutionContext = authenticated;
    expect(widened.userId).toBe('usr_1');
    expect(widened.accessible_org_ids).toBeUndefined();
  });
});
