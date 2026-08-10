// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'declarative-apis-endpoints-live',
  surface: 'stack.apis[] (every declared ApiEndpoint — REVIEW REQUIRED BEFORE UPGRADING)',
  replacement:
    'the same declarations, re-read as LIVE HTTP routes: `path` moved under '
    + '`/api/v1/apps/<manifest.namespace>/<subpath>`, and every entry that declares '
    + '`authRequired: false` re-confirmed as an intentionally anonymous endpoint carrying '
    + '`rateLimit: { enabled: true, … }`',
  reason:
    'This is the one protocol-17 entry that turns metadata ON rather than off, so read it '
    + 'as a SECURITY review item and not as a rename. Before 17 the declarative endpoint '
    + 'surface executed NOTHING: no route was mounted for a declared `path`, no matcher '
    + 'existed, and every key — `authRequired` included — parsed green and gated nothing '
    + '(#4936, which refused a non-empty `apis:` outright for exactly that reason). '
    + 'Protocol 17 ships the executor (#5040) and narrows that refusal to a per-endpoint '
    + 'publish gate: an endpoint that PASSES the gate is mounted and serves real traffic as '
    + 'soon as the stack is published. So an `apis:` block written against an older major — '
    + 'or one restored from a pre-#4936 source, or authored from a doc that predates the '
    + 'refusal — changes meaning without changing a byte: what used to be inert '
    + 'documentation becomes an execution entry point into the data and automation '
    + 'pipelines. Nothing about that transition can be applied mechanically, because the '
    + 'judgment it needs is "did the author of this endpoint mean for the internet to reach '
    + 'it?" — and the one key where a wrong answer is unrecoverable is `authRequired`. Its '
    + 'schema default is `true`, so an omission is SAFE and needs no review; an EXPLICIT '
    + '`authRequired: false` is the only thing that opens anonymous access, and under '
    + 'ADR-0121 D6 it now also requires an armed `rateLimit` (`enabled: true` — the key '
    + 'defaults to `false`, so a budget written without it meters nothing) or the stack '
    + 'refuses to publish. ⚠️ If you author endpoints in TypeScript, annotate them with '
    + '`ApiEndpoint` — the AUTHOR state — so that omitting `authRequired` compiles: '
    + '`const e: ApiEndpoint = { name, path, method, type, target }` is legal and is the '
    + 'safe shape this paragraph prescribes. `ApiEndpointParsed` is the POST-parse type '
    + '(defaults materialized, ADR-0122), where `authRequired` is required — annotating a '
    + 'declaration with it forces you to write the key out, and being made to think about a '
    + 'key whose only unrecoverable value is `false` is the one thing this entry is trying '
    + 'to avoid (#5227). Hold a parse RESULT with `ApiEndpointParsed`; write declarations '
    + 'as `ApiEndpoint`. Grep every `apis:` entry for `authRequired: false` before you '
    + 'upgrade, delete the ones that were never meant to be public, and arm a budget on the '
    + 'ones that were. The path move is the mechanical-looking half and is still yours: '
    + 'ADR-0121 D1/D2 confine a declared path to your own namespace carve-out '
    + '(`/api/v1/apps/<namespace>/…`), the namespace comes from an explicit '
    + '`manifest.namespace` with no derivation fallback, and the subpath is the only part '
    + 'you name — rewriting it for you would silently change a URL third parties call.',
  acceptanceCriteria:
    'You have READ every entry of every `apis:` block, not just the ones that fail to '
    + 'publish. Concretely: (1) each declared `path` is '
    + '`/api/v1/apps/<your manifest.namespace>/<subpath>` and the stack declares that '
    + '`manifest.namespace` explicitly; (2) every entry declaring `authRequired: false` is '
    + 'one you INTEND to be reachable without a session, and each carries '
    + '`rateLimit: { enabled: true, windowMs, maxRequests }` — entries that were not '
    + 'intended to be anonymous have the key removed so the safe default (`true`) applies; '
    + '(3) `objectstack validate` passes, which also proves no endpoint declares a shape '
    + '17.x cannot execute (`type: script` / `proxy`, mapping `transform`, an '
    + '`object_operation` missing `objectParams`, `cacheTtl` on a non-GET method, '
    + '`inputMapping` on find/get/delete, or two endpoints claiming one METHOD + path); and '
    + '(4) after publishing, each endpoint answers as you expect — an anonymous request to '
    + 'a session-only endpoint returns 401 rather than data.',
};
