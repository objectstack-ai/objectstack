// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Structured rendering of a THROWN value for a one-line log record — used by
 * every seam in `AutomationServicePlugin` that catches a failure and reports it
 * instead of propagating it: the four flow-binding seams (#5048) and the
 * declarative connector reconcile (#5575).
 *
 * Named for what it does rather than for its first caller: it was
 * `describeFlowBindError` in `flow-bind-diagnostics.ts` while only the flow
 * seams used it, and #5575 gave it a second, non-flow caller. Nothing here has
 * ever been flow-specific — the subject is the log pipeline, not the metadata
 * type.
 *
 * ## The defect this exists to prevent
 *
 * Every one of those seams used to render its failure by interpolating
 * `err.message` into the log MESSAGE:
 *
 *     ctx.logger.warn(`[Automation] cold-boot flow bind: failed to register ${def.name}: ${err.message}`);
 *     ctx.logger.error(`[Automation] failed to materialize connector instance '${name}': ${err.message}`);
 *
 * `registerFlow` parses with `FlowSchema`, and #4001 closed that schema — an
 * unrecognized key now **throws** instead of being dropped. A `ZodError`'s
 * `.message` is a pretty-printed JSON dump of its `issues` array, so its FIRST
 * LINE is the single character `[`, and `ObjectLogger.write()`
 * (packages/core/src/logger.ts) emits one `<ts> <LEVEL> <message>` record per
 * call — a message carrying newlines becomes several physical lines and only the
 * first carries the level head. Every line-oriented consumer downstream then
 * reads the continuation lines as garbage records with no level and no
 * timestamp: the file sink (`plainLine + '\n'` per record), `docker logs` /
 * journald into a shipper, a `grep ERROR`, and — on the `warn` seams — `serve`'s
 * boot buffer, which *drops* them outright (`BootLogCapture.offer()` keeps a
 * line only when `classifyBootLogLine` finds the head). Net effect on a boot
 * where N flows fail to bind: N warnings that name the flow and then say `[`.
 * cloud#971 survived an entire rc.1 release line behind exactly that.
 *
 * ⚠️ **`warn` and `error` do not share a downstream.** `ObjectLogger` routes
 * `debug`/`info`/`warn` to **stdout** and `error`/`fatal` to **stderr**, and
 * `serve`'s boot-quiet window wraps `process.stdout.write` only (serve.ts) — so
 * the boot buffer's line filter is reachable from the `warn` seams and NOT from
 * an `error` one, whose bytes go straight out (`os dev` inherits the child's
 * stderr). #5575's issue text attributed the connector seam's harm to that
 * buffer; the buffer never sees it. The harm there is the rest of the list
 * above — a record no line-based consumer can parse and no log query can filter
 * on — which is reason enough, and is the same #4632 principle: a mangled
 * diagnostic costs more than no diagnostic. State the mechanism you actually
 * have.
 *
 * ## The fix
 *
 * Never pass structured information through the *string* shape of an error.
 * The seams log a static, newline-free message and hand the facts to the
 * logger's `meta` argument, which every `Logger` implementation in this repo
 * serializes with `JSON.stringify` — so newlines inside a value become `\n`
 * escapes and the whole record stays on ONE physical line, whatever the format.
 *
 * On the `error` seams that means the CONTRACT's third argument
 * (`error(message, error?, meta?)`), which `ObjectLogger` silently dropped
 * whenever the second was not an `Error` — fixed in the same change as #5575,
 * because a diagnostic routed into a dropped parameter is worse than the
 * truncated one it replaced.
 *
 * ## Why the issues are re-shaped rather than forwarded verbatim
 *
 * Two measured reasons, not taste. The first has since LAPSED (#5573); the
 * second carries the decision on its own:
 *
 *   - *Historical — superseded by #5573.* `ObjectLogger` used to redact
 *     recursively by SUBSTRING: its default
 *     `redact: ['password', 'token', 'secret', 'key']` matched any field whose
 *     lowercased name merely *contained* one of them. A Zod `unrecognized_keys`
 *     issue names the offending keys in a field called `keys`, and `'keys'`
 *     contains `'key'` — so forwarding `err.issues` untouched rendered
 *     `"keys":"***REDACTED***"` and lost the one fact the reader came for.
 *     Redaction now matches on camelCase/snake_case WORD boundaries, so a bare
 *     `keys` is no longer redacted and this reason no longer holds. The rule a
 *     field added to this record is judged by today: `apiKey` / `api_key` is
 *     redacted, `keys` / `tokens` is not.
 *   - *Still load-bearing.* A Zod issue can carry the whole rejected `input`
 *     on some codes. A log record must stay bounded — the boot buffer drops
 *     any line that would overflow its budget, and a shipper truncates — which
 *     resurrects the same failure the bullet above describes: a record that has
 *     lost the fact the reader came for. This is also why the seams hand the
 *     *cause* here rather than passing the raw `Error` into the logger's
 *     `error` slot: that would ship the full multi-line dump plus a stack
 *     trace on every record.
 *
 * So the fields are named deliberately and the list is capped, with the cap
 * *declared* in the record (`issueCount`) rather than silently applied.
 */

/** Cap on how many issues one record carries — see the module docblock. */
export const MAX_LOGGED_CAUSE_ISSUES = 20;

/** One validation issue, flattened to the facts a one-line log record needs. */
export interface LoggedCauseIssue {
    /** Zod issue code, e.g. `unrecognized_keys` / `invalid_type`. */
    code: string;
    /** Dotted path to the offending node, `(root)` for the document itself. */
    path: string;
    /** Zod's own rendering — already names the expected/received detail. */
    message: string;
    /**
     * The rejected key names of an `unrecognized_keys` issue. Named
     * `unrecognized` rather than `keys` because `ObjectLogger` redacted by
     * substring when this was written; #5573 has since narrowed that to word
     * boundaries, so a field called `keys` would survive today. The name is
     * kept as-is — renaming a shipped log field back would be pure churn.
     */
    unrecognized?: string[];
}

/** The `meta` payload a reporting seam attaches to its log record. */
export interface ThrownCauseMeta {
    /** Present when the failure was a schema/validation rejection. */
    issues?: LoggedCauseIssue[];
    /**
     * Total issue count, present ONLY when it exceeds
     * {@link MAX_LOGGED_CAUSE_ISSUES} — i.e. when `issues` is a prefix.
     */
    issueCount?: number;
    /** Present when the failure was not a validation rejection. */
    error?: string;
}

/**
 * Render a Zod issue path as `nodes[0].config.visibleIf`.
 *
 * Numeric segments become `[i]` so an array index reads as one, and an empty
 * path (the document itself — where `unrecognized_keys` on the top-level object
 * lands) reads as `(root)` instead of an empty string that would look like a
 * missing field.
 */
export function formatIssuePath(path: readonly unknown[] | undefined): string {
    if (!path || path.length === 0) return '(root)';
    let out = '';
    for (const seg of path) {
        if (typeof seg === 'number') {
            out += `[${seg}]`;
        } else {
            out += out === '' ? String(seg) : `.${String(seg)}`;
        }
    }
    return out;
}

/**
 * Turn a thrown value into the structured `meta` a reporting seam logs.
 *
 * A `ZodError` is recognized by duck-typing its `issues` array rather than by
 * `instanceof z.ZodError`. That is deliberate: one throw site is
 * `FlowSchema.parse` inside `@objectstack/spec` and another is a third-party
 * connector provider factory (ADR-0097), so the error can be constructed by a
 * *different* `zod` module instance than any `instanceof` check here would hold
 * (the classic dual-package hazard), and this package declares no direct `zod`
 * dependency to check against. The shape IS the contract at this seam —
 * `issues` is what we render, so `issues` is what we test for.
 *
 * Exactly one of `issues` / `error` is populated, so a reader never has to
 * decide which of two renderings of the same failure to trust.
 */
export function describeThrownForLog(err: unknown): ThrownCauseMeta {
    const raw = (err as { issues?: unknown } | null | undefined)?.issues;
    if (Array.isArray(raw)) {
        const issues: LoggedCauseIssue[] = [];
        for (const entry of raw.slice(0, MAX_LOGGED_CAUSE_ISSUES)) {
            const issue = (entry ?? {}) as {
                code?: unknown;
                path?: unknown;
                message?: unknown;
                keys?: unknown;
            };
            const flat: LoggedCauseIssue = {
                code: typeof issue.code === 'string' ? issue.code : 'unknown',
                path: formatIssuePath(Array.isArray(issue.path) ? issue.path : undefined),
                message: typeof issue.message === 'string' ? issue.message : String(entry),
            };
            if (Array.isArray(issue.keys)) flat.unrecognized = issue.keys.map((k) => String(k));
            issues.push(flat);
        }
        return raw.length > MAX_LOGGED_CAUSE_ISSUES
            ? { issues, issueCount: raw.length }
            : { issues };
    }

    // Not a validation rejection. `String(err.message)` keeps a multi-line
    // message intact — the logger's JSON.stringify escapes the newlines, so it
    // still occupies one physical line.
    const message = (err as { message?: unknown } | null | undefined)?.message;
    return { error: message === undefined || message === null ? String(err) : String(message) };
}

/**
 * The thrown value's own text, for a message that is NOT going through the
 * line-oriented logger — today only the connector reconcile's fatal (boot) path,
 * which `throw`s and lets the kernel's failure channel print it verbatim.
 *
 * Deliberately NOT the same rendering as {@link describeThrownForLog}: a throw
 * is not a log record, so it neither needs one physical line nor a bounded
 * payload, and flattening a `ZodError` into `issues` there would *lose* detail
 * the operator can read fine in a terminal. Same cause, two audiences —
 * separated here so neither is tempted to reuse the other's shape.
 */
export function thrownMessageText(err: unknown): string {
    const message = (err as { message?: unknown } | null | undefined)?.message;
    return message === undefined || message === null ? String(err) : String(message);
}
