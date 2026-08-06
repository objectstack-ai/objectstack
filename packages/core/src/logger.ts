// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { LoggerConfig, LogLevel } from '@objectstack/spec/system';
import type { Logger } from '@objectstack/spec/contracts';

// Re-export the contract type so consumers can do
// `import type { Logger } from '@objectstack/core/logger'` without also
// pulling `@objectstack/spec` into their bundle graph manually.
export type { Logger };

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
    silent: 5,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: '\x1b[36m',
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    fatal: '\x1b[35m',
    silent: '',
};

const RESET = '\x1b[0m';

/**
 * Split a field name into lowercase words on camelCase, `snake_case`,
 * `kebab-case`, dot and letter/digit boundaries.
 *
 * `apiKey` / `api_key` / `API_KEY` / `x-api-key` all tokenize to
 * `['api','key']`, while `monkey`, `keyword` and `tokenizer` stay a single
 * word. That difference is the whole point: it is what makes the redactor a
 * **word-boundary** matcher instead of the substring matcher it used to be
 * (#5573) — a plain `keys` field no longer reads as a secret.
 */
function tokenizeFieldName(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // apiKey  -> api Key
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // APIKey  -> API Key
        .replace(/([a-zA-Z])([0-9])/g, '$1 $2') // key2    -> key 2
        .split(/[^A-Za-z0-9]+/) // _ - . / space
        .filter(Boolean)
        .map((word) => word.toLowerCase());
}

/**
 * Singular form of the plural spellings the redact vocabulary actually meets
 * (`keys`, `tokens`, `secrets`, `passwords`, `passes`). Deliberately not a
 * general inflector — it only has to be right for words that end up next to a
 * redact word, and it must never turn `address`/`status` into a new word.
 */
function singularizeWord(word: string): string {
    if (/(?:ss|us|is)$/.test(word)) return word; // address / status / axis
    if (/(?:ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2); // passes / boxes
    if (/[a-z0-9]s$/.test(word)) return word.slice(0, -1); // keys / tokens
    return word;
}

/**
 * Words that mark the *secret* sense of a redact word when they are glued to
 * it with no boundary to split on: `apikey`, `accesstoken`, `clientsecret`.
 *
 * Word-boundary matching covers every field name spelled the way this repo
 * spells names (camelCase config keys / snake_case machine names — Prime
 * Directive #3), but an all-lowercase concatenation has no boundary at all, so
 * `apikey` would tokenize to one word and stop being redacted. A bare
 * "ends with `key`" rule cannot be used to rescue it, because `monkey`,
 * `turkey` and `whiskey` end with `key` too — the exact false positives #5573
 * exists to remove. So the rescue is scoped to this explicit qualifier list:
 * `<qualifier><redact word>` is a secret, anything else glued to a redact word
 * is not.
 *
 * Consequences, on purpose:
 *   - Only a **suffix** concatenation counts. `secretary` and `keyword` start
 *     with a redact word and stay clear.
 *   - An unlisted qualifier (`foobarkey`) is not redacted. The fix is to spell
 *     the field `fooBarKey` / `foo_bar_key`, which matches generically — or to
 *     add the word here.
 */
const CONCATENATED_SECRET_QUALIFIERS = new Set([
    'access',
    'account',
    'admin',
    'api',
    'app',
    'auth',
    'bearer',
    'client',
    'csrf',
    'db',
    'database',
    'encryption',
    'id',
    'jwt',
    'master',
    'oauth',
    'private',
    'public',
    'refresh',
    'root',
    'secret',
    'service',
    'session',
    'shared',
    'sign',
    'signing',
    'ssh',
    'token',
    'user',
    'webhook',
    'xsrf',
]);

/** `apikey`/`apikeys` vs `key` — see {@link CONCATENATED_SECRET_QUALIFIERS}. */
function isQualifiedConcatenation(word: string, redactWord: string): boolean {
    for (const base of [word, singularizeWord(word)]) {
        if (base.length <= redactWord.length || !base.endsWith(redactWord)) continue;
        if (CONCATENATED_SECRET_QUALIFIERS.has(base.slice(0, base.length - redactWord.length))) return true;
    }
    return false;
}

/** Does `words` contain `run` as a consecutive sub-sequence? */
function containsWordRun(words: string[], run: string[]): boolean {
    for (let i = 0; i + run.length <= words.length; i++) {
        if (run.every((word, offset) => words[i + offset] === word)) return true;
    }
    return false;
}

/**
 * Word-boundary match of one configured redact pattern against one field name,
 * both already tokenized by {@link tokenizeFieldName}.
 *
 * The plural rule is the one subtlety, and it is the maintainer's ruling on
 * #5573 made consistent with itself: a **bare** plural names a collection or a
 * count, not a secret (`keys` on a Zod `unrecognized_keys` issue, `tokens` on
 * an LLM usage record), so it is left alone; a plural **inside a compound**
 * still names the secret (`apiKeys: ['sk-…']`, `refresh_tokens`) and is
 * redacted. Singular words match everywhere, compound or not.
 */
function fieldWordsMatchPattern(nameWords: string[], patternWords: string[]): boolean {
    if (patternWords.length === 0 || nameWords.length === 0) return false;

    // A multi-word pattern (`apiKey`, `api_key`) matches a consecutive run of
    // the same words, or those words written as one concatenated token.
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

/**
 * Whether ANSI color may be written to the given stream.
 *
 * Follows the https://no-color.org convention: a non-empty `NO_COLOR` env var
 * disables color regardless of TTY, and non-TTY destinations (pipes, CI logs,
 * redirected output) always get plain text so plain-text log scanners see
 * uncolored level tags. Browser bundles have no `process`/TTY → plain text.
 */
function colorEnabled(stream: { isTTY?: boolean } | undefined): boolean {
    if (typeof process !== 'undefined') {
        const noColor = (process as any).env?.NO_COLOR;
        if (noColor !== undefined && noColor !== '') return false;
    }
    return Boolean(stream?.isTTY);
}

/**
 * Resolve a Node builtin without putting it in this module's import graph.
 *
 * This entry is deliberately browser-safe — `@objectstack/client` bundles it —
 * so `fs`/`path` must never be imported statically. A lazy `require()` used to
 * meet that bar, but esbuild rewrites it to the `__require` shim in the ESM
 * output, which throws `Dynamic require of "fs" is not supported`. Every Node
 * ESM consumer (`os serve`, `os dev`) therefore lost file logging (#3110).
 * `process.getBuiltinModule` is a plain method call — opaque to bundlers — and
 * works in both module systems.
 */
function loadNodeBuiltin<T>(id: string): T | undefined {
    if (typeof process === 'undefined') return undefined;

    const getBuiltinModule = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    if (typeof getBuiltinModule === 'function') {
        try {
            return getBuiltinModule.call(process, `node:${id}`) as T;
        } catch {
            return undefined;
        }
    }

    // Node < 20.16 / < 22.3 predates `getBuiltinModule`. Real `require` still
    // resolves in the CJS build; in the ESM build this is the shim that throws,
    // which the caller now reports rather than swallows.
    try {
        return require(id) as T;
    } catch {
        return undefined;
    }
}

export class ObjectLogger implements Logger {
    private config: Required<Omit<LoggerConfig, 'file' | 'rotation' | 'name'>> & {
        file?: string;
        rotation?: { maxSize: string; maxFiles: number };
        name?: string;
    };
    private bindings: Record<string, any>;
    /** `config.redact`, tokenized once — see {@link fieldWordsMatchPattern}. */
    private redactPatterns: string[][];
    private fileStream?: any;
    /** Only the logger that opened the stream may close it — children share it. */
    private ownsFileStream = false;
    private fileLoggingDisabled = false;

    constructor(config: Partial<LoggerConfig> = {}, bindings: Record<string, any> = {}) {
        this.config = {
            name: config.name,
            level: config.level ?? 'info',
            format: config.format ?? 'pretty',
            redact: config.redact ?? ['password', 'token', 'secret', 'key'],
            sourceLocation: config.sourceLocation ?? false,
            file: config.file,
            rotation: config.rotation ?? { maxSize: '10m', maxFiles: 5 },
        };
        this.bindings = bindings;
        this.redactPatterns = this.config.redact.map(tokenizeFieldName).filter((words) => words.length > 0);

        if (this.config.file && typeof process !== 'undefined') {
            this.openFileStream(this.config.file);
        }
    }

    private openFileStream(path: string) {
        const fs = loadNodeBuiltin<typeof import('node:fs')>('fs');
        const nodePath = loadNodeBuiltin<typeof import('node:path')>('path');
        if (!fs || !nodePath) {
            this.disableFileLogging(path, 'no filesystem access in this runtime');
            return;
        }

        try {
            fs.mkdirSync(nodePath.dirname(path), { recursive: true });
            const stream = fs.createWriteStream(path, { flags: 'a' });
            // `createWriteStream` reports open failures (EACCES, EISDIR, …)
            // asynchronously. An 'error' event with no listener is fatal to the
            // process, so file logging must degrade here rather than take the
            // host down.
            stream.on('error', (err: Error) => this.disableFileLogging(path, err.message));
            this.fileStream = stream;
            this.ownsFileStream = true;
        } catch (err) {
            this.disableFileLogging(path, (err as Error).message);
        }
    }

    /**
     * Report — once — that an explicitly configured `file` destination is not
     * being written, and stop trying.
     *
     * Deliberately not routed through `write()`: this says the logger cannot
     * honour its own config, so `level` must not filter it. The bare `catch {}`
     * this replaces is exactly how #3110 stayed hidden.
     */
    private disableFileLogging(path: string, reason: string) {
        this.fileStream = undefined;
        this.ownsFileStream = false;
        if (this.fileLoggingDisabled) return;
        this.fileLoggingDisabled = true;

        const label = this.config.name ? `[${this.config.name}] ` : '';
        const notice = `${label}logger: file logging disabled — cannot write to ${path}: ${reason}`;
        if (typeof process !== 'undefined' && (process as any).stderr) {
            (process as any).stderr.write(notice + '\n');
        } else if (typeof console !== 'undefined') {
            console.warn(notice);
        }
    }

    private isEnabled(level: LogLevel): boolean {
        return LEVEL_ORDER[level] >= LEVEL_ORDER[this.config.level];
    }

    /**
     * Whether a meta field name names one of the configured secrets.
     *
     * Until #5573 this was `lower.includes(pattern)`, which redacted every
     * field whose name merely *contained* a redact word — `keys`, `keyword`,
     * `tokens`, `monkey`, `secretary` — and replaced its value with
     * `***REDACTED***`, so the reader lost the fact AND was told a secret had
     * been withheld. Matching is now on word boundaries: `key` matches
     * `apiKey` / `api_key`, not `keys` / `monkey` / `keyword`.
     */
    private isRedactedFieldName(key: string): boolean {
        const nameWords = tokenizeFieldName(key);
        return this.redactPatterns.some((pattern) => fieldWordsMatchPattern(nameWords, pattern));
    }

    private redactSensitive(obj: any): any {
        if (!obj || typeof obj !== 'object') return obj;
        const redacted = Array.isArray(obj) ? [...obj] : { ...obj };
        for (const key in redacted) {
            if (this.isRedactedFieldName(key)) {
                redacted[key] = '***REDACTED***';
            } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
                redacted[key] = this.redactSensitive(redacted[key]);
            }
        }
        return redacted;
    }

    private write(level: LogLevel, message: string, meta?: Record<string, any>, error?: Error) {
        if (!this.isEnabled(level)) return;

        const context = this.redactSensitive({
            ...this.bindings,
            ...meta,
            ...(error ? { error: { message: error.message, stack: error.stack } } : {}),
        });

        const hasContext = Object.keys(context).length > 0;
        const ts = new Date().toISOString();

        const isErrorLevel = level === 'error' || level === 'fatal';
        const proc = typeof process !== 'undefined' ? (process as any) : undefined;
        const stream = proc ? (isErrorLevel ? proc.stderr : proc.stdout) : undefined;

        let line: string; // console output — may carry ANSI color
        let plainLine: string; // file output — never colored

        if (this.config.format === 'json') {
            line = plainLine = JSON.stringify({
                time: ts,
                level,
                ...(this.config.name ? { name: this.config.name } : {}),
                msg: message,
                ...context,
            });
        } else if (this.config.format === 'text') {
            const parts = [ts, level.toUpperCase(), message];
            if (hasContext) parts.push(JSON.stringify(context));
            line = plainLine = parts.join(' | ');
        } else {
            // pretty
            const label = this.config.name ? `[${this.config.name}] ` : '';
            const head = `${ts} ${level.toUpperCase()}`;
            let tail = ` ${label}${message}`;
            if (hasContext) tail += ` ${JSON.stringify(context)}`;
            plainLine = head + tail;
            const color = LEVEL_COLORS[level] || '';
            line = color && colorEnabled(stream) ? `${color}${head}${RESET}${tail}` : plainLine;
        }

        // Browser-safe output: prefer process streams when available, otherwise
        // fall back to console. `process` may be missing entirely (browsers) or
        // present without stdio streams (bundler shims) — both fall through to
        // console. The previous unguarded `process.stderr?.write` threw
        // `ReferenceError: process is not defined` in browsers because
        // `process` itself is the missing global, not just its `stderr` field.
        if (stream) {
            stream.write(line + '\n');
        } else if (typeof console !== 'undefined') {
            const fn =
                level === 'error' || level === 'fatal' ? console.error
                : level === 'warn' ? console.warn
                : level === 'debug' ? console.debug
                : console.log;
            fn(line);
        }

        if (this.fileStream) {
            this.fileStream.write(plainLine + '\n');
        }
    }

    debug(message: string, meta?: Record<string, any>): void {
        this.write('debug', message, meta);
    }

    info(message: string, meta?: Record<string, any>): void {
        this.write('info', message, meta);
    }

    warn(message: string, meta?: Record<string, any>): void {
        this.write('warn', message, meta);
    }

    error(message: string, errorOrMeta?: Error | Record<string, any>, meta?: Record<string, any>): void {
        this.writeErrorLike('error', message, errorOrMeta, meta);
    }

    fatal(message: string, errorOrMeta?: Error | Record<string, any>, meta?: Record<string, any>): void {
        this.writeErrorLike('fatal', message, errorOrMeta, meta);
    }

    /**
     * `error`/`fatal` dispatch — the two levels whose contract has an `Error`
     * slot in front of `meta`.
     *
     * The `Logger` contract declares `error(message, error?: Error, meta?)`, and
     * `ObjectLogger` additionally tolerates a **meta object** in the `error`
     * slot because many in-repo call sites write `logger.error(msg, { … })`.
     * That tolerance is fine; dropping a parameter the contract *declares* is
     * not, and that is what the previous dispatch did:
     *
     *     if (errorOrMeta instanceof Error) this.write(level, message, meta, errorOrMeta);
     *     else                             this.write(level, message, errorOrMeta);
     *
     * With `error === undefined` the `else` branch passed `undefined` as the
     * meta and **never read the third argument**, so every contract-shaped
     * `logger.error(msg, undefined, { … })` call rendered a bare message with
     * its diagnostics silently gone — ~15 such call sites across `metadata`,
     * `metadata-protocol`, `client` and `core/security`, plus the connector
     * reconcile seam that found this (#5575). The contract's two sibling
     * implementations (`ConsoleLogger`/`JsonLogger` in `@objectstack/observability`)
     * both honour the slot, so the contract was right and this class was the
     * outlier — declared ≠ enforced, Prime Directive #10.
     *
     * All three shapes are now honoured. When both slots carry meta, `meta`
     * (the later, more specific argument) wins on a key collision.
     */
    private writeErrorLike(
        level: 'error' | 'fatal',
        message: string,
        errorOrMeta?: Error | Record<string, any>,
        meta?: Record<string, any>,
    ): void {
        if (errorOrMeta instanceof Error) {
            this.write(level, message, meta, errorOrMeta);
            return;
        }
        const merged = errorOrMeta && meta ? { ...errorOrMeta, ...meta } : (errorOrMeta ?? meta);
        this.write(level, message, merged);
    }

    log(message: string, ...args: any[]): void {
        this.info(message, args.length > 0 ? { args } : undefined);
    }

    child(context: Record<string, any>): ObjectLogger {
        // Construct without `file`, then share the parent's stream: the
        // constructor opens eagerly, so passing `file` through would open a
        // second stream per child and immediately orphan it. That leak was
        // unreachable while #3110 kept the ESM open path dead.
        const child = new ObjectLogger({ ...this.config, file: undefined }, { ...this.bindings, ...context });
        child.config.file = this.config.file;
        child.fileStream = this.fileStream;
        return child;
    }

    withTrace(traceId: string, spanId?: string): ObjectLogger {
        return this.child({ traceId, spanId });
    }

    async destroy(): Promise<void> {
        const stream = this.fileStream;
        this.fileStream = undefined;
        // Children share the opener's stream; if they closed it too, one child's
        // teardown would end file logging for the parent and every sibling,
        // whose writes then land on a closed stream and only trip the 'error'
        // handler above.
        if (!stream || !this.ownsFileStream) return;
        this.ownsFileStream = false;
        await new Promise<void>((resolve) => stream.end(resolve));
    }
}

export function createLogger(config?: Partial<LoggerConfig>): ObjectLogger {
    return new ObjectLogger(config);
}
