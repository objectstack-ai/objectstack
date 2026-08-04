// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Declarative-endpoint POLICY fixture (#5040 E8 / #5112).
//
// Why a fixture and not the showcase: the two endpoints the showcase restores
// are the two it historically declared, and BOTH were session-gated. Growing
// an anonymous, rate-limited surface on a published example just to cover the
// policy matrix would be exactly the move Prime Directive #10 forbids in the
// other direction — demoing a shape the example never meant to have. So the
// anonymous half of ADR-0121 D6 gets its own throwaway app, whose entire
// reason to exist is to be probed.
//
// What it declares, and why each key is here:
//
//   • `authRequired: false` — the ONLY thing that opens an anonymous execution
//     entry point. Its schema default is `true`, so this is a deliberate,
//     visible act; the upgrade guide tells maintainers to grep for exactly this
//     literal before upgrading.
//   • `rateLimit: { enabled: true, … }` — D6's paired obligation. `enabled`
//     defaults to `false`, so a budget written without it meters NOTHING while
//     satisfying the letter of "declares a rateLimit"; publish rejects the
//     anonymous-without-armed-budget combination for that reason. The budget is
//     deliberately tiny (2 requests per minute) so a test can exhaust it without
//     sleeping.
//   • `cacheTtl` on the GET — proves the success-only `Cache-Control` on a
//     second, independent stack.
//
// The paths sit under `/api/v1/apps/e8policy/…` because ADR-0121 D1 confines a
// declared path to the stack's own namespace carve-out, and D2 requires that
// namespace to be declared EXPLICITLY (there is no derivation from
// `manifest.id`). A path outside the carve-out is refused at publish.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { ApiEndpoint, ApiEndpointInput } from '@objectstack/spec/api';

/** One object, so the `object_operation` endpoints have something real to read. */
export const PolicyNote = ObjectSchema.create({
  name: 'e8policy_note',
  // [ADR-0090 D1] grandfather stamp: the gate under test is the endpoint
  // policy chain, not record sharing.
  sharingModel: 'public_read_write',
  label: 'Policy Note',
  pluralLabel: 'Policy Notes',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/** Anonymous by declaration, metered by obligation (ADR-0121 D6). */
export const AnonymousMeteredEndpoint: ApiEndpoint = {
  name: 'e8policy_public_notes',
  path: '/api/v1/apps/e8policy/public-notes',
  method: 'GET',
  summary: 'Public note feed',
  description: 'Anonymous, rate-limited object_operation endpoint (ADR-0121 D6).',
  type: 'object_operation',
  target: 'e8policy_note',
  objectParams: { object: 'e8policy_note', operation: 'find' },
  authRequired: false,
  rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 2 },
  cacheTtl: 15,
};

/** The control: same object, same operation, session-gated, unmetered. */
export const SessionGatedEndpoint: ApiEndpointInput = {
  name: 'e8policy_private_notes',
  path: '/api/v1/apps/e8policy/private-notes',
  method: 'GET',
  summary: 'Session-gated note feed',
  description: 'The control for the anonymous endpoint — same target, default authRequired.',
  type: 'object_operation',
  target: 'e8policy_note',
  objectParams: { object: 'e8policy_note', operation: 'find' },
  // `authRequired` deliberately OMITTED: the schema default is `true`, and the
  // upgrade guide's central claim is that an omission is safe. This endpoint is
  // what makes that claim testable rather than asserted.
  //
  // Typed `ApiEndpointInput` rather than `ApiEndpoint` for exactly that reason:
  // `ApiEndpoint` is the schema's OUTPUT type, where `.default(true)` has
  // already been materialised and `authRequired` is therefore REQUIRED. A TS
  // author who annotates `: ApiEndpoint` cannot express the omission at all —
  // the safe-by-default shape is only writable through the input type.
};

export const endpointPolicyFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.endpoint_policy_fixture',
    namespace: 'e8policy',
    version: '0.0.0',
    type: 'app',
    name: 'Endpoint Policy Fixture',
    description: 'Single-object app whose declared endpoints exercise the ADR-0121 D6 policy matrix.',
  },
  objects: [PolicyNote],
  apis: [AnonymousMeteredEndpoint, SessionGatedEndpoint],
});
