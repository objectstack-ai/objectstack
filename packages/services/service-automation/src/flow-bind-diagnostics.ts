// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Structured rendering for the failures the flow-binding seams report (#5048).
 *
 * ## The defect this exists to prevent
 *
 * Every flow-bind seam in `AutomationServicePlugin` used to render its failure
 * by interpolating `err.message` into a single-line `logger.warn`:
 *
 *     ctx.logger.warn(`[Automation] cold-boot flow bind: failed to register ${def.name}: ${err.message}`);
 *
 * `registerFlow` parses with `FlowSchema`, and #4001 closed that schema — an
 * unrecognized key now **throws** instead of being dropped. A `ZodError`'s
 * `.message` is a pretty-printed JSON dump of its `issues` array, so its FIRST
 * LINE is the single character `[`. Two properties of the log pipeline then
 * conspire to destroy the rest of it:
 *
 *   1. `ObjectLogger.write()` (packages/core/src/logger.ts) emits one
 *      `<ts> <LEVEL> <message>` record per call; a message carrying newlines
 *      becomes several physical lines, and only the first carries the level
 *      prefix.
 *   2. `serve`'s boot-diagnostic buffer (packages/cli/src/utils/boot-log-capture.ts)
 *      is line-oriented: `BootLogCapture.offer()` keeps a line only when
 *      `classifyBootLogLine` finds a `<ts> <LEVEL>` head on it. Every
 *      continuation line of a multi-line message fails that test and is
 *      dropped outright.
 *
 * Net effect on a boot where N flows fail to bind: N warnings that name the
 * flow and then say `[`. cloud#971 survived an entire rc.1 release line behind
 * exactly that — the second defect made the first one invisible.
 *
 * ## The fix
 *
 * Never pass structured information through the *string* shape of an error.
 * The seams now log a static, newline-free message and hand the facts to the
 * logger's `meta` argument, which every `Logger` implementation in this repo
 * serializes with `JSON.stringify` — so newlines inside a value become `\n`
 * escapes and the whole record stays on ONE physical line, which is exactly
 * what the boot capture retains. Same discipline as #4632: a truncated
 * diagnostic costs more than no diagnostic.
 *
 * ## Why the issues are re-shaped rather than forwarded verbatim
 *
 * Two measured reasons, not taste:
 *
 *   - `ObjectLogger` redacts recursively by substring: its default
 *     `redact: ['password', 'token', 'secret', 'key']` matches any field whose
 *     lowercased name *contains* one of them. A Zod `unrecognized_keys` issue
 *     names the offending keys in a field called `keys`, and `'keys'` contains
 *     `'key'` — forwarding `err.issues` untouched therefore renders
 *     `"keys":"***REDACTED***"`, i.e. it loses the one fact the reader came
 *     for. The field is named `unrecognized` here so the key names survive.
 *   - A Zod issue can carry the whole rejected `input` on some codes. A boot
 *     warning must stay bounded; the boot capture drops any line that would
 *     overflow its budget, which would resurrect the very failure mode above.
 *
 * So the fields are named deliberately and the list is capped, with the cap
 * *declared* in the record (`issueCount`) rather than silently applied.
 */

/** Cap on how many issues one warning carries — see the module docblock. */
export const MAX_LOGGED_FLOW_BIND_ISSUES = 20;

/** One validation issue, flattened to the facts a one-line log record needs. */
export interface FlowBindIssue {
    /** Zod issue code, e.g. `unrecognized_keys` / `invalid_type`. */
    code: string;
    /** Dotted path to the offending node, `(root)` for the flow document itself. */
    path: string;
    /** Zod's own rendering — already names the expected/received detail. */
    message: string;
    /**
     * The rejected key names of an `unrecognized_keys` issue. Named
     * `unrecognized` rather than `keys` so `ObjectLogger`'s substring redactor
     * does not replace it with `***REDACTED***`.
     */
    unrecognized?: string[];
}

/** The `meta` payload a flow-bind seam attaches to its warning. */
export interface FlowBindErrorMeta {
    /** Present when the failure was a schema/validation rejection. */
    issues?: FlowBindIssue[];
    /**
     * Total issue count, present ONLY when it exceeds
     * {@link MAX_LOGGED_FLOW_BIND_ISSUES} — i.e. when `issues` is a prefix.
     */
    issueCount?: number;
    /** Present when the failure was not a validation rejection. */
    error?: string;
}

/**
 * Render a Zod issue path as `nodes[0].config.visibleIf`.
 *
 * Numeric segments become `[i]` so an array index reads as one, and an empty
 * path (the flow document itself — where `unrecognized_keys` on the top-level
 * object lands) reads as `(root)` instead of an empty string that would look
 * like a missing field.
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
 * Turn a thrown value into the structured `meta` for a flow-bind warning.
 *
 * A `ZodError` is recognized by duck-typing its `issues` array rather than by
 * `instanceof z.ZodError`. That is deliberate: the throw site is
 * `FlowSchema.parse` inside `@objectstack/spec`, so the error can be
 * constructed by a *different* `zod` module instance than any `instanceof`
 * check here would hold (the classic dual-package hazard), and this package
 * declares no direct `zod` dependency to check against. The shape IS the
 * contract at this seam — `issues` is what we render, so `issues` is what we
 * test for.
 *
 * Exactly one of `issues` / `error` is populated, so a reader never has to
 * decide which of two renderings of the same failure to trust.
 */
export function describeFlowBindError(err: unknown): FlowBindErrorMeta {
    const raw = (err as { issues?: unknown } | null | undefined)?.issues;
    if (Array.isArray(raw)) {
        const issues: FlowBindIssue[] = [];
        for (const entry of raw.slice(0, MAX_LOGGED_FLOW_BIND_ISSUES)) {
            const issue = (entry ?? {}) as {
                code?: unknown;
                path?: unknown;
                message?: unknown;
                keys?: unknown;
            };
            const flat: FlowBindIssue = {
                code: typeof issue.code === 'string' ? issue.code : 'unknown',
                path: formatIssuePath(Array.isArray(issue.path) ? issue.path : undefined),
                message: typeof issue.message === 'string' ? issue.message : String(entry),
            };
            if (Array.isArray(issue.keys)) flat.unrecognized = issue.keys.map((k) => String(k));
            issues.push(flat);
        }
        return raw.length > MAX_LOGGED_FLOW_BIND_ISSUES
            ? { issues, issueCount: raw.length }
            : { issues };
    }

    // Not a validation rejection. `String(err.message)` keeps a multi-line
    // message intact — the logger's JSON.stringify escapes the newlines, so it
    // still occupies one physical line.
    const message = (err as { message?: unknown } | null | undefined)?.message;
    return { error: message === undefined || message === null ? String(err) : String(message) };
}
