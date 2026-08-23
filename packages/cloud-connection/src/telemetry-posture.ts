// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `telemetry.allowClientErrorReporting` — the runtime's post-build permission
 * for SPA client telemetry (#10805, upstream half of cloud#1508).
 *
 * ## The injury this exists to end
 *
 * An air-gapped on-premises EE Console was measured sending 14 Sentry
 * envelopes per session to `sentry.io`, carrying IP + User-Agent PII, with no
 * way for the customer to turn it off. objectui closed one half (a build that
 * never opts in now issues no third-party request at all), and could not close
 * the other: every knob there is a Vite build-time variable that is inlined
 * into the bundle as a frozen literal, so a build that DID opt in — the hosted
 * console, and the identical artifact shipped on-prem — has no post-build off
 * switch. Editing env vars on the deployed host does nothing. The only
 * server-to-SPA channel is `GET /api/v1/runtime/config`, which this package
 * owns, so the switch has to be a key on that payload.
 *
 * ## The permission is a CONJUNCT, never a source
 *
 * The server never supplies a DSN and cannot turn telemetry ON for a build
 * that carries none. `allowClientErrorReporting: true` means only "this
 * deployment does not object to the sink your build was compiled with"; the
 * consumer still needs its own build-time DSN. Deliberate: a server that could
 * *start* a third-party data flow in someone's browser is a strictly worse
 * surface than the one being fixed. So the composed decision is
 * `Boolean(buildTimeDsn) && isClientErrorReportingAllowed(payload)`, and this
 * side owns the second conjunct only.
 *
 * ## Why a positive permission and not a negative kill switch
 *
 * Spelling it `telemetry: { disabled: true }` would have read as `undefined`
 * on every server too old to know the key, on every malformed payload, and on
 * every failed fetch — falsy, therefore "not disabled", therefore SEND. The
 * gate would be vacuous exactly where it is needed: the legacy runtimes that
 * are leaking today. Phrased as a permission that must be positively granted,
 * every one of those states collapses onto "not `true`" and denies. The
 * fail-closed reading is then a property of the VOCABULARY rather than a
 * discipline each consumer has to remember.
 *
 * The boolean is chosen over a `'allowed' | 'denied'` union for the same
 * reason: the shortest expression a consumer can write — `if (allowed)` — is
 * already the safe one, whereas the laziest string test (`!== 'denied'`) fails
 * OPEN on absence.
 *
 * ## Absence
 *
 * `RuntimeConfigPlugin` always emits the key, so absence never means "this
 * server had no opinion" — it means the payload did not come from a runtime
 * that knows about it (an older ObjectStack, a third-party host, a 404, a
 * network error). {@link isClientErrorReportingAllowed} answers `false` for
 * every one of those, and that reading is the contract, not an implementation
 * detail: see its own note for why the producer owns it.
 */

/**
 * Operator switch that grants the permission. Boolean feature flag,
 * default-off / opt-in, per the `OS_{DOMAIN}_{FEATURE}_ENABLED` rule.
 *
 * Named for the narrow thing it grants rather than for "telemetry": a later
 * sibling permission (session replay, product analytics) must be a SEPARATE
 * grant, and an operator who set a var called `OS_CONSOLE_TELEMETRY_ENABLED`
 * would reasonably read it as having already granted those too.
 */
export const CLIENT_ERROR_REPORTING_ENV = 'OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENABLED';

/**
 * The truthy vocabulary the whole repo's opt-in flags answer to
 * (`resolveAllowDevPlugin` in `@objectstack/types` states the reasoning: a
 * strict `=== '1'` fails closed on `=true`, which is safe but reads to an
 * operator as the flag being broken).
 */
const GRANT_SPELLINGS: readonly string[] = ['1', 'true', 'on', 'yes'];

/** The matching falsy vocabulary — a DELIBERATE denial, not a typo, so silent. */
const DENY_SPELLINGS: readonly string[] = ['0', 'false', 'off', 'no'];

/** Every spelling the switch accepts, in the order a diagnostic lists them. */
export const CLIENT_ERROR_REPORTING_SPELLINGS: readonly string[] = [
    ...GRANT_SPELLINGS,
    ...DENY_SPELLINGS,
];

/** What an operator's raw switch value resolved to. */
export interface TelemetryGrantReading {
    /** The permission. Fail-closed: only a recognised grant spelling is `true`. */
    readonly allowed: boolean;
    /**
     * The rejected spelling, when the operator said something outside the
     * closed set. Held rather than warned about here so the caller can report
     * it once, at mount time, where it has a logger.
     */
    readonly refused?: string;
}

const DENIED: TelemetryGrantReading = { allowed: false };
const GRANTED: TelemetryGrantReading = { allowed: true };

/**
 * Read the operator's switch through a CLOSED vocabulary.
 *
 * An unrecognised spelling is REFUSED and reported, never coerced — the same
 * discipline `asPlatformStage` applies to `branding.stage`, and for the same
 * reason: a knob that appears to work while doing nothing is how this whole
 * family of defects reaches production. Here the refusal also happens to be
 * the safe direction, but the diagnostic is what the operator needs, because
 * their intent (`=enable`, `=Y`) was to grant and nothing would have said
 * otherwise.
 *
 * Unset, empty, or whitespace-only is UNSET, not a typo: denied, and silent.
 */
export function readClientErrorReportingGrant(raw: string | undefined): TelemetryGrantReading {
    if (raw === undefined) return DENIED;
    const value = raw.trim().toLowerCase();
    if (value === '') return DENIED;
    if (GRANT_SPELLINGS.includes(value)) return GRANTED;
    if (DENY_SPELLINGS.includes(value)) return DENIED;
    return { allowed: false, refused: raw };
}

/**
 * The telemetry block served on `/api/v1/runtime/config`.
 *
 * A namespace of its own — deliberately NOT a member of `features`. That map
 * is open-ended and a host's `resolveFeatures` hook merges arbitrary keys into
 * it verbatim, so a distribution's plan policy could grant this permission by
 * returning one boolean, from code whose subject is billing tiers. A security
 * permission must have exactly one author. The separation is pinned by test.
 */
export interface RuntimeTelemetryPosture {
    /**
     * May the SPA send client error reports to the sink its build was
     * compiled with? `false` unless a runtime positively granted it.
     */
    readonly allowClientErrorReporting: boolean;
}

/**
 * The canonical fail-closed reading of a `/api/v1/runtime/config` payload.
 *
 * ## Why the producer owns the consumer's test
 *
 * "Absent reads as do-not-send" is the whole guarantee, and it is a claim
 * about code that does NOT live here — every consumer writing its own `?.`
 * chain is one `!== false` away from re-opening the leak, silently, on exactly
 * the legacy payloads the guarantee is for. So the reading ships with the
 * contract: one strict function, pinned in both directions here, rather than N
 * dialects accumulating in the consumers (Prime Directive #12).
 *
 * Accepts `unknown` on purpose. Callers hand it a parsed HTTP body, and the
 * "the fetch failed" case is spelled by passing `undefined` or `null` — so the
 * error path and the absent-key path reach the same answer through the same
 * function, instead of the error path being a `catch` block someone forgot to
 * write.
 *
 * The test is `=== true`, not truthiness: the string `'true'`, `1`, and
 * `'yes'` are payloads a consumer should not be teaching itself to accept. On
 * the wire the value is produced by `RuntimeConfigPlugin` as a real boolean.
 */
export function isClientErrorReportingAllowed(runtimeConfig: unknown): boolean {
    if (typeof runtimeConfig !== 'object' || runtimeConfig === null) return false;
    const telemetry = (runtimeConfig as { telemetry?: unknown }).telemetry;
    if (typeof telemetry !== 'object' || telemetry === null) return false;
    return (telemetry as { allowClientErrorReporting?: unknown }).allowClientErrorReporting === true;
}
