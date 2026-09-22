// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 enforce-or-remove on `ConnectorSchema.connectionTimeoutMs`
// (maintainer ruling 2026-09-22, letter A — the narrower SECOND decision this
// key was owed, after the ruling that made its nine ledger siblings live left
// this one dead on a stated reason rather than by oversight). The key was
// bounded (`min(1000).max(300000)`), defaulted (`30000`), `.describe()`d and
// served back by `/meta/connector`: every signal an authoring surface can give
// said it worked.
//
// ⚠️ This is NOT the zero-mention retirement shape, and reading it as one loses
// the finding. FIVE sites outside `packages/spec` READ the key: the
// materialization fingerprint and the provider-context build in
// `services/service-automation/src/plugin.ts`, `ctx.connectionTimeoutMs` in the
// `rest` and `openapi` provider factories, and the `?? 30000` fallbacks that
// deposit it back onto the reported def. Measured across all five, every one is
// a pass-through: the value's only termini are the def `GET /connectors` echoes
// and the fingerprint that decides whether to re-materialize. Never a deadline.
// `connectorFetchOptions()` (`integration/connector-fetch-policy.ts`) is the one
// mapping from authored policy onto the platform's outbound `fetch`, and it was
// handed `{ retryConfig, requestTimeoutMs }` only. Carrying a number is not
// honouring it — ADR-0049 forbids the parsed-unmarked-unenforced state whether
// the inert value travels or sits still.
//
// The `实现` arm was unavailable, which is why the second decision came out
// `retire` rather than `enforce`: a connector's outbound call is a WHATWG
// `fetch`, whose only cancellation surface is ONE `AbortSignal` covering the
// whole operation, so nothing there observes the connect phase. Bounding
// "time until the response arrives" with this key would kill a slow-but-
// connected upstream the author meant to allow with a large `requestTimeoutMs`
// — breaking the very promise the key makes. (undici's `connectTimeout` needs a
// custom dispatcher: Node-only, and a new subsystem underneath every connector.)
// `requestTimeoutMs` — live since PR #19388, and the lit control for every
// census above — is the bound the platform can keep.
//
// Tombstoned with `retiredKey()`: `ConnectorSchema` is a non-strict `z.object`,
// so a bare deletion would be a silent strip (ADR-0104). No def leaves with it —
// the key was a bare `z.number()`, not a `ConfigSchema` shape, so
// `RETIRED_DEFS_BY_MAJOR[18]` gains nothing. Authored sources and stored rows are
// rewritten by the D2 conversion `connector-connection-timeout-ms-removed`; the
// withdrawn `ConnectorProviderContext` member, which is code with no authored
// source, leaves via the D3 semantic entry
// `connector-provider-context-connection-timeout-ms-retired`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look — the disposition
// `18.integration__Connector__errorMapping.ts` records for the same schema.
export const entry = 'integration/Connector:connectionTimeoutMs';
