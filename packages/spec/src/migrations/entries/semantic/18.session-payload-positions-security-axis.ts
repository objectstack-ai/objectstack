// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'session-payload-positions-security-axis',
  surface: 'GET /api/v1/auth/get-session -> user.positions[] (and the client CEL root `current_user.positions` bound from it)',
  replacement:
    'the SAME key, carrying the SECURITY positions — the set `/auth/me/permissions` reports '
    + 'and `resolveUserAuthzGrants` resolves. A reader that wanted the better-auth role '
    + 'scalar reads `user.role`, which is unchanged and still published',
  reason:
    'A MEANING change, not a rename: no key moved, so nothing in this entry can be found by '
    + 'grepping for a removed spelling — which is exactly why it needs a ledger row. '
    + '`customSession` built `user.positions` from the better-auth `sys_user.role` scalar '
    + 'split on commas, PLUS the active membership mapped to `org_*`, PLUS `platform_admin`, '
    + 'and read NOTHING from `sys_user_position` (ADR-0057 D4), the source of truth for '
    + 'custom positions. The Console binds that array straight through as the CEL root '
    + '`current_user` (objectui `expressionUser.ts`: `positions: user.positions ?? []`), so '
    + 'an `action.visible` / `visibleWhen` / nav `visible` narrowed by a business position '
    + 'answered FALSE for EVERYONE, including the user who genuinely held it. '
    + '⭐ The failure was silent and in the invisible direction: the root was bound and the '
    + 'key was present, so `has(current_user.positions)` was true and CEL raised nothing — '
    + 'the predicate simply returned FALSE. A predicate that FAULTS fails OPEN in the shell '
    + 'and would have shown the button; a successful FALSE shows nothing and reports '
    + 'nothing. The documented example `\'org_admin\' in current_user.positions` kept working '
    + 'throughout, because `org_admin` is the one name that sits on BOTH axes — which is why '
    + 'no example, test or doc could reveal the split. '
    + 'This was a DECLARED contract being violated rather than an ambiguous name: '
    + '`EvalUserSchema` already specified `positions` as "built-in identity names + position '
    + 'names", exposed to "every predicate surface (server formula, server RLS, client UI '
    + 'gates) ... with an identical shape" so a predicate "evaluates identically wherever it '
    + 'is written". `/auth/me/permissions` and every server-side evaluator '
    + '(`ExecutionContext.positions`) already resolved the security axis; the session '
    + 'payload was the one producer that did not, because it derived the value itself '
    + 'instead of asking the authority `resolve-authz-context.ts` reserves that job for. '
    + '⚠️ NO renamed auth-role array accompanies this, and that is a measured disposition '
    + 'rather than an omission: everything the old union contributed beyond the security '
    + 'axis was the `sys_user.role` scalar\'s own tokens, and that scalar is ALREADY '
    + 'published unchanged as `user.role` — the single exception ADR-0090 D3\'s "role" word '
    + 'ban carves out for third-party schema. Minting a `roles` array would revive the exact '
    + 'banned identifier `check:role-word` ratchets against, to publish information the '
    + 'payload already carries. Maintainer ruling 2026-09-05 (#15136, director decision '
    + 'batch #39 item 2, verbatim 「同意」): option A, one name, one meaning. ADR-0068 D1/D2, '
    + 'ADR-0090 D3/D5, ADR-0057 D4.',
  acceptanceCriteria:
    'No predicate and no client reader treats `current_user.positions` / '
    + '`session.user.positions` as the better-auth role scalar. Audit every authored '
    + '`visible` / `visibleWhen` / RLS predicate that names `current_user.positions` and '
    + 'classify each comparand: a real `sys_position` name, a built-in identity name '
    + '(`platform_admin` / `org_owner` / `org_admin` / `org_member`), or `everyone` needs NO '
    + 'change and starts working where it silently answered FALSE before; a comparand that '
    + 'was only ever a `sys_user.role` token (`user`, and `admin` — note `admin` is NOT a '
    + 'built-in identity name; a membership `admin` is projected as `org_admin`) either '
    + 'moves to `user.role`, or — the supported route — becomes a real position assigned '
    + 'through `sys_user_position`, the governed ADR-0090 D12 channel. '
    + '⚠️ Verify against a REAL session rather than a fixture, and assert the axis by a name '
    + 'that exists on ONE side only: `org_admin` sits on both and cannot discriminate, which '
    + 'is precisely how this defect survived its own documented example. Sign in as a user '
    + 'holding a custom position, read `GET /api/v1/auth/get-session`, and assert that '
    + 'position is in `user.positions` and that the payload agrees set-for-set with `GET '
    + '/api/v1/auth/me/permissions`. '
    + 'Assert the absence of a role-scalar token by VALUE rather than by the predicate\'s '
    + 'verdict: a gate that reads `false` cannot tell "the name is gone" from "the name was '
    + 'never there", and both of those from a faulting predicate, which fails OPEN in the '
    + 'shell and renders anyway. A deployment that stored business role names in '
    + '`sys_user.role` instead of assigning positions is the one that must act; a name in '
    + '`sys_member.role` is still projected, so membership-derived names are unaffected.',
};
