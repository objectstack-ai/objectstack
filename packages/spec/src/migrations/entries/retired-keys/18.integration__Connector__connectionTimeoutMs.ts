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
// the finding. Measured with `git grep -n connectionTimeoutMs SHA -- .
// ':!packages/spec'` at `origin/main`: THIRTEEN non-test source occurrences over
// seven files in five packages — SIX READS (openapi-connector.ts:242,
// openapi-provider.ts:193, rest-connector.ts:134, rest-provider.ts:64,
// plugin.ts:307, plugin.ts:1589), FOUR TYPE DECLARATIONS
// (openapi-connector.ts:135, rest-connector.ts:47, plugin.ts:291,
// plugin.ts:339), and THREE surviving hardcoded `30000` writes
// (mcp-connector.ts:247, slack-connector.ts:94, plugin.ts:1782).
//
// ⭐ The card's own Leg-2 table — "five non-spec mentions, all writes of a
// hardcoded 30000" — was CORRECT at the SHA it cited and dated (0870fb5418:
// exactly those five, line for line). It is STALE, not false; b929e0a662, the
// PR the card itself flagged as pending, is what moved it. ⛔ Do not re-cite
// either reading without its tree: a census is a count plus the commit it was
// taken against.
//
// Measured across all six reads, every one is a pass-through: the value's only
// termini are the def `GET /connectors` echoes and the fingerprint that decides
// whether to re-materialize. Never a deadline.
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
// `requestTimeoutMs` — the lit control for every census above — is the bound
// the platform can keep. Its live record is cited as the code rather than as a
// card number on purpose: the PR that made it live has been DELETED from the
// board (probed: minted, absent, and the web endpoint 404s), so the only
// durable anchor is `integration/connector-fetch-policy.ts`, where
// `connectorFetchOptions()` maps the key onto `resilientFetch`'s per-attempt
// `timeoutMs`, pinned by `connector-fetch-policy.test.ts`.
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
// ⭐ RETIRED-DEFAULT RESIDUE: the `acceptRetiredDefaultResidue` stage IS owed
// here, and is adopted — `{ connectionTimeoutMs: 30000 }` on both carriers
// (#12840, maintainer ruling 2026-08-28; the class rule lives in
// `shared/retired-key.ts`). The discriminator across the three siblings is
// whether a released toolchain MATERIALIZED the default into something that is
// later re-parsed — `security/ObjectPermission:allowPurge` adopted the stage
// for exactly that reason, `kernel/PluginQualityMetrics:securityScan` did not
// because the key carried no default of its own, and
// `api/ListInstalledPackagesRequest:limit` did not because nothing ever parses
// through that schema so its `.default(50)` was never materialized anywhere.
//
// This key is in the FIRST bucket, measured across two builds rather than
// argued: on the base build `ObjectStackSchema.parse({ connectors: [{ name,
// label, type }] })` returns an entry carrying `connectionTimeoutMs: 30000`
// (emitted keys: authentication, connectionTimeoutMs, enabled, label, name,
// requestTimeoutMs, status, type — the author typed three), and feeding that
// exact object back to the tombstoned build is refused at
// `connectors.0.connectionTimeoutMs`.
//
// ⛔ The presence of a D2 conversion does NOT discharge this obligation, and
// reading it that way is the trap: `security/ObjectPermission:allowPurge` has
// BOTH a D2 (`permission-allow-restore-purge-removed`, in the same step-18
// chain) AND the residue stage. The reason is the SECOND door — the fact
// `liveness/connector.json` opens its `_note` with: besides the authoring
// doors, `AutomationEngine.registerConnector` parses `ConnectorSchema` for a def
// a PLUGIN or an ADR-0097 provider factory builds IN CODE. No conversion runs
// there. A connector package still compiled against 17.x carries the
// materialized `30000` in that def literal — all four shipped connectors did,
// which is what the card counted as its hardcoded writes — so without this
// stage a 17.x plugin fails registration on a value its author never typed.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look — the disposition
// `18.integration__Connector__errorMapping.ts` records for the same schema.
export const entry = 'integration/Connector:connectionTimeoutMs';
