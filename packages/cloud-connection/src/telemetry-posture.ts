// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `telemetry.errorReporting` — the client error-reporting SOURCE, served by
 * the operator's own runtime (#12681, superseding the #10805 permission).
 *
 * ## The injury this exists to end
 *
 * An air-gapped on-premises EE Console was measured sending 14 Sentry
 * envelopes per session to `sentry.io`, carrying IP + User-Agent PII, with no
 * way for the customer to turn it off. The first fix (#10805) shipped a
 * runtime PERMISSION and left the SOURCE where it was: a build-time
 * `VITE_SENTRY_DSN` inlined into the published bundle. That closed the leak
 * and opened a different hole, which the maintainer named on 2026-08-27,
 * verbatim and untranslated:
 *
 * > 「我是一个开发平台呀，我的用户并不会去构建我的前端，我理解这种应该在服务端传进去。」
 *
 * ObjectStack's users consume a PREBUILT console. They cannot set a build-time
 * key, so under the two-key gate a self-hosting operator could not enable
 * client error reporting at all: the permission was reachable and the source
 * was not. Both halves now live on `GET /api/v1/runtime/config`, which this
 * package owns, so the operator configures telemetry in exactly one place.
 *
 * ## The DSN's presence IS the grant
 *
 * There is no separate boolean. A runtime that serves a DSN is asking for
 * reports; a runtime that serves none is not. That is not a shorthand — it is
 * what removes the failure mode the two-key shape had: with a permission and a
 * source configured in different places, "permission on, no DSN" and "DSN in,
 * permission off" are two silent dead states that look identical from the
 * browser. One knob cannot disagree with itself.
 *
 * The fail-closed direction survives the collapse for free, and more robustly
 * than the boolean managed. The grant is now "a non-empty DSN string reached
 * me", so every indeterminate state — an older runtime that never heard of the
 * key, a third-party host, a 404, a network error, a malformed body, a payload
 * that has not arrived yet — carries no DSN and therefore denies. A boolean
 * needed `=== true` and a written argument about why `disabled: true` would
 * have been vacuous; a source needs neither, because absence of a source is
 * not a value that can be misread.
 *
 * ## Everything that must travel with the DSN travels WITH it
 *
 * {@link ClientErrorReportingConfig} is a CLOSED enumeration, served as one
 * object, and it is closed for the same reason the DSN moved: a knob the
 * platform user cannot reach is a knob that does not exist for them. The
 * previous shape scattered these across build-time `VITE_SENTRY_*` variables,
 * where a prebuilt-console consumer could set none of them — including
 * `sendDefaultPii`, the one that decides whether IP + User-Agent leave the
 * network. Relocating them is not new surface; it is the same surface moved to
 * the side that can actually operate it.
 *
 * One knob deliberately did NOT move: `VITE_SENTRY_RELEASE`. A release
 * identifies WHICH BUNDLE produced a stack trace and has to match the source
 * maps that bundle's pipeline uploaded. That is a property of the build, and a
 * server cannot know which console build it is serving. It stays build-time in
 * objectui, and it is the only `VITE_SENTRY_*` knob that does.
 *
 * ## Malformed is REFUSED, never coerced
 *
 * The strictness precedent this file already set for the retired boolean, and
 * that `asPlatformStage` sets for `branding.stage`: a knob that appears to work
 * while doing nothing is how this whole family of defects reaches production.
 * Every refusal below is reported once at mount time, naming the knob, the
 * value and the accepted form — see {@link TelemetryRefusal}.
 *
 * Refusal always lands on the SAFER value, which is what decides whether a bad
 * knob takes down the whole block or only itself:
 *
 *  - a malformed **DSN** refuses the whole block — there is no safe default for
 *    a source, and serving none is the safe direction;
 *  - a malformed **sendDefaultPii** falls back to `false`, a malformed sample
 *    rate to its documented default. Silencing error reporting because of a
 *    typo in an unrelated volume knob would be strictness pointed away from
 *    the hazard.
 */

/**
 * The DSN — the source, and therefore the grant. Follows the
 * `OS_{DOMAIN}_{FEATURE}_{KNOB}` rule and keeps the
 * `..._CLIENT_ERROR_REPORTING_...` family the retired boolean established, so
 * the replacement reads as the same knob rather than as a new one.
 *
 * Named for the narrow thing it configures rather than for the vendor: a
 * later sibling capability (session replay of every session, product
 * analytics) must be a SEPARATE knob, and an operator who set something called
 * `OS_TELEMETRY_SENTRY_*` would reasonably read it as having configured those
 * too. It also keeps a vendor out of an operator-facing contract that a
 * self-hosted or DSN-compatible sink satisfies equally well.
 */
export const CLIENT_ERROR_REPORTING_DSN_ENV = 'OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN';

/** Opt in to attaching IP address + User-Agent to events. */
export const CLIENT_ERROR_REPORTING_PII_ENV = 'OS_TELEMETRY_CLIENT_ERROR_REPORTING_SEND_DEFAULT_PII';

/** The `environment` tag on emitted events (`production`, `staging`, ...). */
export const CLIENT_ERROR_REPORTING_ENVIRONMENT_ENV = 'OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENVIRONMENT';

/** Fraction of transactions sampled for performance tracing. */
export const CLIENT_ERROR_REPORTING_TRACES_RATE_ENV = 'OS_TELEMETRY_CLIENT_ERROR_REPORTING_TRACES_SAMPLE_RATE';

/** Fraction of ERROR sessions recorded as session replays. */
export const CLIENT_ERROR_REPORTING_REPLAY_RATE_ENV = 'OS_TELEMETRY_CLIENT_ERROR_REPORTING_REPLAY_SAMPLE_RATE';

/**
 * Default transaction sampling. Carried here rather than left to the consumer
 * so the served object is complete: a consumer filling in its own default is a
 * consumer that has an opinion the operator cannot override.
 */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Default session-replay sampling: OFF. Replay records what the user did, so
 * it is the most privacy-bearing knob in the set and must be the deliberate
 * choice of the deployment that wants it — never an inherited default of the
 * deployment that does not.
 */
export const DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE = 0;

/**
 * The truthy vocabulary the whole repo's opt-in flags answer to
 * (`resolveAllowDevPlugin` in `@objectstack/types` states the reasoning: a
 * strict `=== '1'` fails closed on `=true`, which is safe but reads to an
 * operator as the flag being broken).
 */
const GRANT_SPELLINGS: readonly string[] = ['1', 'true', 'on', 'yes'];

/** The matching falsy vocabulary — a DELIBERATE denial, not a typo, so silent. */
const DENY_SPELLINGS: readonly string[] = ['0', 'false', 'off', 'no'];

/** Every spelling a boolean knob accepts, in the order a diagnostic lists them. */
export const TELEMETRY_BOOLEAN_SPELLINGS: readonly string[] = [
    ...GRANT_SPELLINGS,
    ...DENY_SPELLINGS,
];

/**
 * The client error-reporting configuration served on
 * `/api/v1/runtime/config`, as ONE object.
 *
 * A CLOSED enumeration. Anything an operator cannot set here, they cannot set
 * at all — which is the point, and also the reason to keep the set small: each
 * key is an operator-facing contract that has to keep working.
 */
export interface ClientErrorReportingConfig {
    /**
     * The sink. Non-empty by construction: this object is served only when a
     * well-formed DSN resolved, so a consumer holding one is holding a grant.
     */
    readonly dsn: string;
    /** May IP address + User-Agent be attached to events? Opt-in. */
    readonly sendDefaultPii: boolean;
    /**
     * The `environment` tag. Optional because there is a sensible client-side
     * answer when the operator has no opinion (the SPA's own build mode), and
     * inventing one here would assert something this side does not know.
     */
    readonly environment?: string;
    /** Transaction sampling, `0`..`1`. */
    readonly tracesSampleRate: number;
    /** Error-session replay sampling, `0`..`1`. */
    readonly replaysOnErrorSampleRate: number;
}

/**
 * The telemetry block served on `/api/v1/runtime/config`.
 *
 * A namespace of its own — deliberately NOT a member of `features`. That map
 * is open-ended and a host's `resolveFeatures` hook merges arbitrary keys into
 * it verbatim, so a distribution's plan policy could hand out a telemetry sink
 * from code whose subject is billing tiers. A security-bearing configuration
 * must have exactly one author. The separation is pinned by test.
 *
 * The block itself is ALWAYS served; `errorReporting` is present only when a
 * DSN resolved. That pair of facts is deliberate and is what a single `curl`
 * has to be able to distinguish:
 *
 *   `{"telemetry":{}}`                    this runtime knows the key and has no DSN
 *   no `telemetry` key at all             this payload did not come from a runtime
 *                                         that knows the key
 *
 * Both deny. Serving an explicit `errorReporting: null` for the first case was
 * rejected: it is a second spelling of a state absence already expresses, and a
 * consumer would have to handle both anyway — the older-runtime case cannot be
 * spelled by a runtime that does not exist yet.
 */
export interface RuntimeTelemetryPosture {
    /** The sink and its knobs. Absent means no client error reporting. */
    readonly errorReporting?: ClientErrorReportingConfig;
}

/**
 * One knob the operator got wrong, held for a single mount-time diagnostic.
 *
 * Held rather than warned about at construction: the constructor has no
 * logger, and a silently dropped operator knob is exactly the thing that must
 * not be invisible from the SPA end.
 */
export interface TelemetryRefusal {
    /** The env var name, so the operator can grep their own configuration. */
    readonly env: string;
    /** What they said, DSN-redacted — see {@link redactDsn}. */
    readonly value: string;
    /** The accepted form, phrased for someone fixing it right now. */
    readonly accepted: string;
    /** What the runtime did instead, so silence is never left unexplained. */
    readonly consequence: string;
}

/** What an operator's raw telemetry configuration resolved to. */
export interface ClientErrorReportingReading {
    /**
     * The resolved configuration, or `undefined` for "serve no
     * `errorReporting` block" — unset, or a DSN that was refused.
     */
    readonly config?: ClientErrorReportingConfig;
    /** Everything refused along the way. Empty on the ordinary paths. */
    readonly refusals: readonly TelemetryRefusal[];
}

/**
 * The raw, untyped configuration as it arrives from a host option or an env
 * var, before any of it is believed.
 *
 * Every field is `unknown` on purpose. Env vars are strings, host options are
 * typed, and a JS host outside the type system can hand over anything at all;
 * one validating reader for all three doors is what keeps the doors from
 * disagreeing.
 */
export interface ClientErrorReportingSource {
    readonly dsn?: unknown;
    readonly sendDefaultPii?: unknown;
    readonly environment?: unknown;
    readonly tracesSampleRate?: unknown;
    readonly replaysOnErrorSampleRate?: unknown;
}

/**
 * Render a DSN safe to put in a log line: the public key is masked, the shape
 * is kept.
 *
 * A Sentry public key is designed to be public — it ships inside the browser
 * bundle — so this is not a secret-protection measure. It is a
 * log-aggregation hygiene measure: boot logs travel further than the
 * configuration they quote, and an operator diagnosing a refusal needs the
 * SHAPE of what they typed (scheme, host, project path), never the key.
 *
 * The regex runs whether or not the value parses as a URL, because the values
 * reaching this function are by definition the ones that did not parse.
 */
export function redactDsn(raw: string): string {
    const masked = raw.replace(/\/\/[^/@\s]*@/, '//***@');
    return masked.length > 120 ? `${masked.slice(0, 120)}…` : masked;
}

/** Read a boolean knob through the closed vocabulary. `undefined` = unset. */
function readBoolean(
    value: unknown,
    env: string,
    consequence: string,
    refusals: TelemetryRefusal[],
): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    // A real boolean from a typed host is the one shape needing no vocabulary.
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') {
        refusals.push({
            env,
            value: String(value),
            accepted: TELEMETRY_BOOLEAN_SPELLINGS.join(', '),
            consequence,
        });
        return undefined;
    }
    const normalised = value.trim().toLowerCase();
    // Unset, empty or whitespace-only is UNSET, not a typo: silent.
    if (normalised === '') return undefined;
    if (GRANT_SPELLINGS.includes(normalised)) return true;
    if (DENY_SPELLINGS.includes(normalised)) return false;
    refusals.push({
        env,
        value,
        accepted: TELEMETRY_BOOLEAN_SPELLINGS.join(', '),
        consequence,
    });
    return undefined;
}

/** Read a `0`..`1` sample rate. `undefined` = unset. */
function readSampleRate(
    value: unknown,
    env: string,
    fallback: number,
    refusals: TelemetryRefusal[],
): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    // `Number('')` is 0 and `Number(' ')` is 0 — both would read as "sample
    // nothing", which is a plausible-looking answer to a question the operator
    // never answered. Handled above so this stays a real parse.
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
    refusals.push({
        env,
        value: String(value),
        accepted: 'a number between 0 and 1 inclusive',
        consequence: `falling back to the default of ${fallback}`,
    });
    return undefined;
}

/**
 * Validate a DSN, or explain why not.
 *
 * The checks are the ones every real DSN passes and every typo fails —
 * deliberately not a vendor-format parser, which would refuse a valid
 * self-hosted or DSN-compatible sink and hand the operator a defect this card
 * exists to remove.
 *
 * One check is not shape policing but a leak guard: a DSN carrying a PASSWORD
 * (the deprecated Sentry *secret* key) must never be served, because this
 * payload is read by every browser that loads the Console. An operator pasting
 * a legacy secret-bearing DSN would be publishing that secret to every visitor,
 * and the value looks entirely ordinary while doing it.
 */
function readDsn(value: unknown, refusals: TelemetryRefusal[]): string | undefined {
    const CONSEQUENCE = 'no telemetry.errorReporting block is served and the Console sends no error reports';
    const ACCEPTED = 'an http(s) DSN of the form https://PUBLIC_KEY@HOST/PROJECT_ID';
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
        refusals.push({
            env: CLIENT_ERROR_REPORTING_DSN_ENV,
            value: String(value),
            accepted: ACCEPTED,
            consequence: CONSEQUENCE,
        });
        return undefined;
    }
    const dsn = value.trim();
    // Unset is unset: denied, and silent. An operator who never configured
    // telemetry is not making a mistake, and a warning on every boot is a
    // muted warning.
    if (dsn === '') return undefined;

    const refuse = (accepted: string): undefined => {
        refusals.push({
            env: CLIENT_ERROR_REPORTING_DSN_ENV,
            value: redactDsn(dsn),
            accepted,
            consequence: CONSEQUENCE,
        });
        return undefined;
    };

    let url: URL;
    try {
        url = new URL(dsn);
    } catch {
        return refuse(ACCEPTED);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return refuse(ACCEPTED);
    if (!url.hostname) return refuse(ACCEPTED);
    if (!url.username) return refuse('a DSN carrying a public key, as in https://PUBLIC_KEY@HOST/PROJECT_ID');
    if (url.password) {
        return refuse(
            'a DSN with NO secret after the public key — this payload is read by every browser that '
            + 'loads the Console, so a secret-bearing (legacy) DSN would publish that secret. Reissue '
            + 'the DSN without it',
        );
    }
    // The project id: the last non-empty path segment.
    const projectId = url.pathname.split('/').filter(Boolean).pop();
    if (!projectId) return refuse('a DSN ending in a project id, as in https://PUBLIC_KEY@HOST/PROJECT_ID');
    return dsn;
}

/**
 * Resolve the operator's raw configuration into the object to serve.
 *
 * Pure, and takes its input rather than reading `process.env`, so the whole
 * refusal matrix is testable without a live environment — the half of the
 * retired boolean's design that was worth keeping.
 */
export function readClientErrorReportingConfig(
    source: ClientErrorReportingSource,
): ClientErrorReportingReading {
    const refusals: TelemetryRefusal[] = [];

    const dsn = readDsn(source.dsn, refusals);

    const sendDefaultPii = readBoolean(
        source.sendDefaultPii,
        CLIENT_ERROR_REPORTING_PII_ENV,
        'IP address and User-Agent stay OFF',
        refusals,
    );
    const tracesSampleRate = readSampleRate(
        source.tracesSampleRate,
        CLIENT_ERROR_REPORTING_TRACES_RATE_ENV,
        DEFAULT_TRACES_SAMPLE_RATE,
        refusals,
    );
    const replaysOnErrorSampleRate = readSampleRate(
        source.replaysOnErrorSampleRate,
        CLIENT_ERROR_REPORTING_REPLAY_RATE_ENV,
        DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE,
        refusals,
    );

    let environment: string | undefined;
    if (source.environment !== undefined && source.environment !== null) {
        if (typeof source.environment === 'string') {
            environment = source.environment.trim() || undefined;
        } else {
            refusals.push({
                env: CLIENT_ERROR_REPORTING_ENVIRONMENT_ENV,
                value: String(source.environment),
                accepted: 'a non-empty string',
                consequence: 'the Console tags events with its own build mode instead',
            });
        }
    }

    // No DSN, no block. Note the knob refusals are still reported: an operator
    // who mis-set a sample rate AND never set a DSN has two things to fix, and
    // hearing about one of them is how the second stays hidden.
    if (dsn === undefined) return { refusals };

    return {
        config: {
            dsn,
            sendDefaultPii: sendDefaultPii === true,
            ...(environment !== undefined ? { environment } : {}),
            tracesSampleRate: tracesSampleRate ?? DEFAULT_TRACES_SAMPLE_RATE,
            replaysOnErrorSampleRate: replaysOnErrorSampleRate ?? DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE,
        },
        refusals,
    };
}

/**
 * The canonical fail-closed reading of a `/api/v1/runtime/config` payload.
 *
 * ## Why the producer owns the consumer's read
 *
 * "No DSN means do not send" is the whole guarantee, and it is a claim about
 * code that does NOT live here — every consumer writing its own `?.` chain is
 * one loose truthiness check away from re-opening the leak, silently, on
 * exactly the legacy payloads the guarantee is for. So the reading ships with
 * the contract: one strict function, pinned in both directions here, rather
 * than N dialects accumulating in the consumers (Prime Directive #12).
 *
 * Accepts `unknown` on purpose. Callers hand it a parsed HTTP body, and the
 * "the fetch failed" case is spelled by passing `undefined` or `null` — so the
 * error path and the absent-key path reach the same answer through the same
 * function, instead of the error path being a `catch` block someone forgot to
 * write.
 *
 * ## What it re-validates, and what it deliberately does not
 *
 * The DSN is accepted as any non-empty string. It is NOT re-run through the
 * producer's full shape check: a server that serves a working DSN this reader
 * quietly discards would be the two-places-disagreeing failure this card
 * exists to delete, one layer down. `Sentry.init` is the authority on whether
 * its own DSN parses.
 *
 * The single exception is a DSN carrying a PASSWORD, which is refused here as
 * well as at the producer. That check is not shape policing — its failure mode
 * is a secret published to every browser that loads the page, and this reader
 * is the last thing standing between an untrusted payload and that outcome.
 * A well-behaved ObjectStack runtime never serves one, so the check can only
 * fire against a third-party host.
 *
 * The knobs travelling with the DSN are re-derived defensively: only a real
 * `true` opts into PII, and only a finite `0`..`1` moves a sample rate. A
 * consumer should not be taught that `'true'` or `'yes'` on the wire opens a
 * data flow.
 */
export function readClientErrorReporting(runtimeConfig: unknown): ClientErrorReportingConfig | null {
    if (typeof runtimeConfig !== 'object' || runtimeConfig === null) return null;
    const telemetry = (runtimeConfig as { telemetry?: unknown }).telemetry;
    if (typeof telemetry !== 'object' || telemetry === null) return null;
    const block = (telemetry as { errorReporting?: unknown }).errorReporting;
    if (typeof block !== 'object' || block === null) return null;

    const raw = block as Record<string, unknown>;
    if (typeof raw.dsn !== 'string') return null;
    const dsn = raw.dsn.trim();
    if (dsn === '') return null;
    if (carriesSecret(dsn)) return null;

    return {
        dsn,
        sendDefaultPii: raw.sendDefaultPii === true,
        ...(typeof raw.environment === 'string' && raw.environment.trim()
            ? { environment: raw.environment.trim() }
            : {}),
        tracesSampleRate: sampleRateOr(raw.tracesSampleRate, DEFAULT_TRACES_SAMPLE_RATE),
        replaysOnErrorSampleRate: sampleRateOr(
            raw.replaysOnErrorSampleRate,
            DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE,
        ),
    };
}

/** Does this DSN carry a secret after the public key? See the reader's note. */
function carriesSecret(dsn: string): boolean {
    try {
        return new URL(dsn).password !== '';
    } catch {
        // Unparseable here means `Sentry.init` will reject it too. Not this
        // function's question, and answering `true` would silently discard it
        // for the wrong stated reason.
        return false;
    }
}

/** A finite `0`..`1` rate, or the default. Never a coerced string. */
function sampleRateOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
        ? value
        : fallback;
}
