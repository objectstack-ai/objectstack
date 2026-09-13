// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package's console shim, in one place.
 *
 * [#8850] Lifted out of `rest-server.ts` unchanged when the ADR-0112
 * error/fault-classification prologue moved to `error-response.ts`: both files
 * log through it, and the alternative — a second copy of the same two lines —
 * is the "two spellings of one thing" shape this repo pays for repeatedly. It
 * is deliberately NOT re-exported from the package index: an internal shim, not
 * a logging API.
 *
 * ── The declared level seam (#15484) ──────────────────────────────────────
 *
 * Every fault this package reports goes through `logError`, and `logError`
 * hands its varargs — an `Error` object among them — straight to
 * `console.error`, which Node formats with the error's full stack and its
 * `[cause]` chain. Measured on one green `packages/rest` run: 2,095 indented
 * `at ` frame lines, 36.7% of the captured output, and 100% of them arrive
 * through this file (1,197 from `error-response.ts`, 841 from
 * `rest-server.ts`, 57 from `cause` chains).
 *
 * ⛔ That volume is NOT a defect and the frames are NOT dead weight. They are
 * read, and the repo pins that they are read: at `logWithheldServerFault` the
 * client is told nothing and the log is the operator's only copy of the driver
 * text — which lives on `error.cause` and is printed only because a whole
 * `Error` is passed; at `logUnexpectedRouteError` the frames are the only
 * location diagnostic a bare `TypeError` has. Four assertions across
 * `rest-5xx-message-sanitization.test.ts` and `rest-expected-error-logging.test.ts`
 * hold that, by asserting the IDENTITY of the `Error` reaching `console.error`
 * (#5437 / #4886 / #5489). ⛔ Do not "quieten" this shim by formatting the
 * `Error` down to a string or a summary — that is the repair those pins exist
 * to stop, and it deletes from the LOG what was deliberately withheld from the
 * CLIENT.
 *
 * So the seam is a DECLARATION, not a quieter product: `OS_REST_LOG` names a
 * level, exactly as `OS_REGISTRY_LOG` does for `@objectstack/objectql`'s
 * `SchemaRegistry`, with the same five-level vocabulary and the same shipped
 * `'info'` default. ⛔ The shipped default is unchanged and must stay
 * unchanged: a reported fault keeps printing the full `Error` — message,
 * `cause` chain and frames — for every real caller. Suppression is only ever
 * something a HARNESS opts into, declared where a gate can read it
 * (`scripts/check-rest-log-declared.mjs`), never the product's default.
 *
 * An operator learns the variable from `packages/rest/README.md`, from this
 * block, and from `docs/audits/2026-09-test-log-volume-census.md`; an
 * unrecognised value falls back to the default rather than silently silencing
 * anything, which is the same failure direction `OS_REGISTRY_LOG` chose.
 */

/**
 * The levels `OS_REST_LOG` accepts — deliberately the same vocabulary as
 * `@objectstack/objectql`'s `REGISTRY_LOG_LEVELS`, so the two declarations are
 * one contract with two populations rather than two ad-hoc environment
 * variables. Ordered loudest-first; `scripts/check-rest-log-declared.mjs`
 * READS this array rather than copying it.
 */
export const REST_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

/** One of {@link REST_LOG_LEVELS}. */
export type RestLogLevel = (typeof REST_LOG_LEVELS)[number];

/**
 * The SHIPPED default — what every real caller gets when `OS_REST_LOG` is
 * unset or unrecognised. ⛔ Never lower this to quieten a log: at any level
 * below `'warn'` this package stops reporting faults it is the only reporter
 * of. `rest-log-declared-level-seam.test.ts` pins it.
 */
export const REST_LOG_DEFAULT_LEVEL: RestLogLevel = 'info';

/** Emission threshold per level: a site emits when its own rank <= the level's. */
const LEVEL_RANK: Readonly<Record<RestLogLevel, number>> = {
    debug: 4, info: 3, warn: 2, error: 1, silent: 0,
};

/** `logError`'s rank, and `logWarn`'s — a site speaks while the level reaches it. */
const ERROR_RANK = LEVEL_RANK.error;
const WARN_RANK = LEVEL_RANK.warn;

/**
 * The level in force right now.
 *
 * Read from the environment on every call, not memoised at module load: a
 * harness that declares the level through vitest's `env` block, and a test that
 * restores the shipped default around one assertion, both have to be observed
 * by a module that may already be imported. This is a fault path — it runs once
 * per reported fault, never per request.
 */
export function restLogLevel(): RestLogLevel {
    const raw = String((globalThis as any).process?.env?.OS_REST_LOG ?? '').toLowerCase();
    return (REST_LOG_LEVELS as readonly string[]).includes(raw)
        ? (raw as RestLogLevel)
        : REST_LOG_DEFAULT_LEVEL;
}

// Node-safe logger — avoids importing 'console' which is absent from ES2020 lib typings.
export const logError = (...args: unknown[]) => {
    if (LEVEL_RANK[restLogLevel()] < ERROR_RANK) return;
    (globalThis as any).console?.error(...args);
};
export const logWarn = (...args: unknown[]) => {
    if (LEVEL_RANK[restLogLevel()] < WARN_RANK) return;
    ((globalThis as any).console?.warn ?? (globalThis as any).console?.error)?.(...args);
};
