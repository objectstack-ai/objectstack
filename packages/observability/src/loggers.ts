// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Logger } from './contracts.js';

/** Recognised log levels in increasing severity order. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    fatal: 50,
};

/** One link of an error's `cause` chain, as an error record prints it. */
interface CauseLine {
    message: string;
    /** Absent when the cause was not an `Error`, or carried none. */
    stack?: string;
}

/** How many `cause` links an error record prints before it says it stopped. */
const CAUSE_DEPTH_LIMIT = 5;

/**
 * The fields an `error` / `fatal` record carries for its `Error`: the
 * message, the stack, and — when the error wraps an original on `cause`
 * (`new Error(say, { cause })`) — `causes`, the chain under it, outermost
 * first. Without it a wrapped fault logged as the wrapper alone, and the root
 * cause was missing from the line an operator reads.
 *
 * `causes` is omitted when the chain is empty, so an unwrapped error's record
 * is byte-identical to what it was.
 */
function errorFields(error: Error): Record<string, unknown> {
    const causes = causeChain(error);
    return { error: error.message, stack: error.stack, ...(causes.length > 0 ? { causes } : {}) };
}

/**
 * The `cause` chain under an error, in the shape `faultCauseChain`
 * (`@objectstack/types`, the 5xx fault line) and `ObjectLogger`
 * (`@objectstack/core`) record: each link's message and stack, at most
 * {@link CAUSE_DEPTH_LIMIT} links, a cycle stopped at its first repeat, and a
 * last marker link whenever the chain was cut.
 *
 * A copy, not an import: this package depends on `@objectstack/spec` alone,
 * and a runtime edge to `@objectstack/types` for one helper is not worth it.
 * `__tests__/loggers.test.ts` runs a fixture set through both
 * loggers and `faultCauseChain` and fails on any drift, the field-name rule
 * for object causes included.
 *
 * ⛔ Operator-only: it feeds the log record and nothing else.
 */
function causeChain(error: Error): CauseLine[] {
    const lines: CauseLine[] = [];
    const seen = new Set<unknown>([error]);
    let current = causeOf(error);
    while (current !== undefined && current !== null) {
        if (seen.has(current)) {
            lines.push({ message: '[cause chain cycle: this link repeats an earlier one]' });
            break;
        }
        if (lines.length >= CAUSE_DEPTH_LIMIT) {
            lines.push({ message: `[cause chain truncated after ${CAUSE_DEPTH_LIMIT} links]` });
            break;
        }
        seen.add(current);
        try {
            lines.push(causeLine(current));
        } catch {
            // A link whose name, message or stack read throws ends the chain in
            // a marker; it must not cost the record.
            lines.push({ message: '[cause chain link unreadable: reading it threw]' });
            break;
        }
        current = causeOf(current);
    }
    return lines;
}

function causeOf(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) return undefined;
    try {
        return (value as { cause?: unknown }).cause;
    } catch {
        // A throwing `cause` getter ends the chain; it must not cost the record.
        return undefined;
    }
}

function causeLine(cause: unknown): CauseLine {
    if (cause instanceof Error) {
        return { message: `${cause.name}: ${cause.message}`, ...(cause.stack ? { stack: cause.stack } : {}) };
    }
    if (typeof cause === 'string') return { message: cause };
    try {
        const text = JSON.stringify(cause, (key, value) =>
            key !== '' && isDefaultRedactedFieldName(key) ? '***REDACTED***' : value,
        );
        return { message: text ?? String(cause) };
    } catch {
        return { message: String(cause) };
    }
}

/**
 * `LoggerConfig.redact`'s default words (`@objectstack/spec` `logging.zod.ts`),
 * the list `faultCauseChain` applies by default.
 */
const DEFAULT_REDACTED_WORDS = ['password', 'token', 'secret', 'key'] as const;

/**
 * The default field-name rule for an object cause, whole-word matched — a
 * copy of `faultCauseChain`'s (itself a copy of `ObjectLogger`'s matcher),
 * pinned to it by the same parity test as {@link causeChain}.
 */
function isDefaultRedactedFieldName(key: string): boolean {
    const nameWords = tokenizeFieldName(key);
    return DEFAULT_REDACTED_WORDS.some((word) => fieldWordsMatchPattern(nameWords, [word]));
}

function tokenizeFieldName(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase());
}

function singularizeWord(word: string): string {
    if (/(?:ss|us|is)$/.test(word)) return word;
    if (/(?:ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2);
    if (/[a-z0-9]s$/.test(word)) return word.slice(0, -1);
    return word;
}

/** Glued qualifiers that mark the secret sense: `apikey`, `accesstoken`, `clientsecret`. */
const CONCATENATED_SECRET_QUALIFIERS = new Set([
    'access', 'account', 'admin', 'api', 'app', 'auth', 'bearer', 'client', 'csrf', 'db', 'database',
    'encryption', 'id', 'jwt', 'master', 'oauth', 'private', 'public', 'refresh', 'root', 'secret',
    'service', 'session', 'shared', 'sign', 'signing', 'ssh', 'token', 'user', 'webhook', 'xsrf',
]);

function isQualifiedConcatenation(word: string, redactWord: string): boolean {
    for (const base of [word, singularizeWord(word)]) {
        if (base.length <= redactWord.length || !base.endsWith(redactWord)) continue;
        if (CONCATENATED_SECRET_QUALIFIERS.has(base.slice(0, base.length - redactWord.length))) return true;
    }
    return false;
}

function containsWordRun(words: string[], run: string[]): boolean {
    for (let i = 0; i + run.length <= words.length; i++) {
        if (run.every((word, offset) => words[i + offset] === word)) return true;
    }
    return false;
}

function fieldWordsMatchPattern(nameWords: string[], patternWords: string[]): boolean {
    if (patternWords.length === 0 || nameWords.length === 0) return false;
    if (patternWords.length > 1) {
        const glued = patternWords.join('');
        return (
            containsWordRun(nameWords, patternWords) ||
            nameWords.some((word) => word === glued || singularizeWord(word) === glued)
        );
    }
    const redactWord = patternWords[0];
    const isCompound = nameWords.filter((word) => /[a-z]/.test(word)).length > 1;
    return nameWords.some(
        (word) =>
            word === redactWord ||
            (isCompound && singularizeWord(word) === redactWord) ||
            isQualifiedConcatenation(word, redactWord),
    );
}

/** No-op logger — discards every message. */
export class NoopLogger implements Logger {
    debug(): void { }
    info(): void { }
    warn(): void { }
    error(): void { }
    fatal(): void { }
    child(): Logger { return this; }
}

/**
 * Console logger — pretty-printed messages for local development.
 *
 * Not suitable for production where structured JSON is required;
 * use {@link JsonLogger} there instead.
 */
export class ConsoleLogger implements Logger {
    constructor(
        private readonly opts: {
            level?: LogLevel;
            context?: Record<string, unknown>;
            sink?: { log: (s: string) => void; error: (s: string) => void };
        } = {},
    ) { }

    private get threshold(): number {
        return LEVEL_PRIORITY[this.opts.level ?? 'info'];
    }
    private get sink() {
        return this.opts.sink ?? { log: (s: string) => console.log(s), error: (s: string) => console.error(s) };
    }
    private get context(): Record<string, unknown> {
        return this.opts.context ?? {};
    }

    debug(message: string, meta?: Record<string, unknown>): void { this.emit('debug', message, meta); }
    info(message: string, meta?: Record<string, unknown>): void { this.emit('info', message, meta); }
    warn(message: string, meta?: Record<string, unknown>): void { this.emit('warn', message, meta); }
    error(message: string, error?: Error, meta?: Record<string, unknown>): void {
        this.emit('error', message, { ...(meta ?? {}), ...(error ? errorFields(error) : {}) });
    }
    fatal(message: string, error?: Error, meta?: Record<string, unknown>): void {
        this.emit('fatal', message, { ...(meta ?? {}), ...(error ? errorFields(error) : {}) });
    }
    child(context: Record<string, unknown>): Logger {
        return new ConsoleLogger({ ...this.opts, context: { ...this.context, ...context } });
    }

    private emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
        if (LEVEL_PRIORITY[level] < this.threshold) return;
        try {
            const merged = { ...this.context, ...(meta ?? {}) };
            const tail = Object.keys(merged).length ? ' ' + JSON.stringify(merged) : '';
            const line = `[${level}] ${msg}${tail}`;
            if (level === 'error' || level === 'fatal') this.sink.error(line);
            else this.sink.log(line);
        } catch {
            // Log emission must never throw.
        }
    }
}

/**
 * JSON logger — one JSON object per line on stdout (errors on stderr).
 *
 * Matches the shape that Loki / fluent-bit / Cloudflare Logpush ingest
 * by default. Every record contains `ts`, `level`, `msg`, and any
 * accumulated child-context plus per-call `meta`.
 *
 * Use this in production. Use {@link ConsoleLogger} during development
 * for human-friendly output.
 */
export class JsonLogger implements Logger {
    constructor(
        private readonly opts: {
            level?: LogLevel;
            context?: Record<string, unknown>;
            sink?: { log: (s: string) => void; error: (s: string) => void };
            /** Optional fields injected into every record (`service`, `env`, …). */
            base?: Record<string, unknown>;
            /** Wall clock for tests. */
            now?: () => Date;
        } = {},
    ) { }

    private get threshold(): number { return LEVEL_PRIORITY[this.opts.level ?? 'info']; }
    private get sink() {
        return this.opts.sink ?? { log: (s: string) => console.log(s), error: (s: string) => console.error(s) };
    }
    private get context(): Record<string, unknown> { return this.opts.context ?? {}; }
    private get base(): Record<string, unknown> { return this.opts.base ?? {}; }
    private get now(): () => Date { return this.opts.now ?? (() => new Date()); }

    debug(message: string, meta?: Record<string, unknown>): void { this.emit('debug', message, meta); }
    info(message: string, meta?: Record<string, unknown>): void { this.emit('info', message, meta); }
    warn(message: string, meta?: Record<string, unknown>): void { this.emit('warn', message, meta); }
    error(message: string, error?: Error, meta?: Record<string, unknown>): void {
        this.emit('error', message, { ...(meta ?? {}), ...(error ? errorFields(error) : {}) });
    }
    fatal(message: string, error?: Error, meta?: Record<string, unknown>): void {
        this.emit('fatal', message, { ...(meta ?? {}), ...(error ? errorFields(error) : {}) });
    }
    child(context: Record<string, unknown>): Logger {
        return new JsonLogger({ ...this.opts, context: { ...this.context, ...context } });
    }

    private emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
        if (LEVEL_PRIORITY[level] < this.threshold) return;
        try {
            const record = {
                ts: this.now().toISOString(),
                level,
                msg,
                ...this.base,
                ...this.context,
                ...(meta ?? {}),
            };
            const line = JSON.stringify(record);
            if (level === 'error' || level === 'fatal') this.sink.error(line);
            else this.sink.log(line);
        } catch {
            // Log emission must never throw.
        }
    }
}
