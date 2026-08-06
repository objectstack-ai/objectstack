import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger, ObjectLogger } from './logger';

describe('ObjectLogger', () => {
    let logger: ObjectLogger;

    beforeEach(() => {
        logger = createLogger();
    });

    afterEach(async () => {
        await logger.destroy();
    });

    describe('Basic Logging', () => {
        it('should create a logger with default config', () => {
            expect(logger).toBeDefined();
            expect(logger.info).toBeDefined();
            expect(logger.debug).toBeDefined();
            expect(logger.warn).toBeDefined();
            expect(logger.error).toBeDefined();
        });

        it('should log info messages', () => {
            expect(() => logger.info('Test message')).not.toThrow();
        });

        it('should log debug messages', () => {
            expect(() => logger.debug('Debug message')).not.toThrow();
        });

        it('should log warn messages', () => {
            expect(() => logger.warn('Warning message')).not.toThrow();
        });

        it('should log error messages', () => {
            const error = new Error('Test error');
            expect(() => logger.error('Error occurred', error)).not.toThrow();
        });

        it('should log with metadata', () => {
            expect(() => logger.info('Message with metadata', { userId: '123', action: 'login' })).not.toThrow();
        });
    });

    describe('Configuration', () => {
        it('should respect log level configuration', async () => {
            const warnLogger = createLogger({ level: 'warn' });
            
            // These should not throw but might not output anything
            expect(() => warnLogger.debug('Debug message')).not.toThrow();
            expect(() => warnLogger.info('Info message')).not.toThrow();
            expect(() => warnLogger.warn('Warning message')).not.toThrow();
            
            await warnLogger.destroy();
        });

        it('should support different formats', async () => {
            const jsonLogger = createLogger({ format: 'json' });
            const textLogger = createLogger({ format: 'text' });
            const prettyLogger = createLogger({ format: 'pretty' });
            
            expect(() => jsonLogger.info('JSON format')).not.toThrow();
            expect(() => textLogger.info('Text format')).not.toThrow();
            expect(() => prettyLogger.info('Pretty format')).not.toThrow();
            
            await jsonLogger.destroy();
            await textLogger.destroy();
            await prettyLogger.destroy();
        });

        it('should redact sensitive keys', async () => {
            const logger = createLogger({ redact: ['password', 'apiKey'] });
            
            // This should work without exposing the password
            expect(() => logger.info('User login', { 
                username: 'john',
                password: 'secret123',
                apiKey: 'key-12345'
            })).not.toThrow();
            
            await logger.destroy();
        });
    });

    describe('Child Loggers', () => {
        it('should create child logger with context', () => {
            const childLogger = logger.child({ service: 'api', requestId: '123' });
            
            expect(childLogger).toBeDefined();
            expect(() => childLogger.info('Child log message')).not.toThrow();
        });

        it('should support trace context', () => {
            const tracedLogger = logger.withTrace('trace-123', 'span-456');
            
            expect(tracedLogger).toBeDefined();
            expect(() => tracedLogger.info('Traced message')).not.toThrow();
        });
    });

    describe('Environment Detection', () => {
        it('should detect Node.js environment', async () => {
            // This test runs in Node.js, so logger should detect it
            const nodeLogger = createLogger({ format: 'json' });
            expect(() => nodeLogger.info('Node environment')).not.toThrow();
            await nodeLogger.destroy();
        });
    });

    describe('Compatibility', () => {
        it('should support console.log compatibility', () => {
            expect(() => logger.log('Compatible log')).not.toThrow();
        });
    });

    describe('Color emission (no-color.org)', () => {
        const ANSI = '\x1b[';
        let stdoutChunks: string[];
        let stderrChunks: string[];
        const originalNoColor = process.env.NO_COLOR;
        const originalStdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
        const originalStderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

        const setTTY = (stream: NodeJS.WriteStream, value: boolean) => {
            Object.defineProperty(stream, 'isTTY', { value, configurable: true });
        };

        // Assert on the single write() chunk carrying our message, so unrelated
        // writes to the shared process streams (e.g. the test runner's own
        // reporter output) can never leak into the assertions.
        const chunkWith = (chunks: string[], text: string) =>
            chunks.find((c) => c.includes(text)) ?? '';

        beforeEach(() => {
            stdoutChunks = [];
            stderrChunks = [];
            vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: any) => {
                stdoutChunks.push(String(chunk));
                return true;
            }) as any);
            vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: any) => {
                stderrChunks.push(String(chunk));
                return true;
            }) as any);
            delete process.env.NO_COLOR;
        });

        afterEach(() => {
            vi.restoreAllMocks();
            if (originalNoColor === undefined) delete process.env.NO_COLOR;
            else process.env.NO_COLOR = originalNoColor;
            const restoreTTY = (stream: NodeJS.WriteStream, desc?: PropertyDescriptor) => {
                if (desc) Object.defineProperty(stream, 'isTTY', desc);
                else delete (stream as any).isTTY;
            };
            restoreTTY(process.stdout, originalStdoutTTY);
            restoreTTY(process.stderr, originalStderrTTY);
        });

        it('colorizes pretty output on an interactive TTY by default', () => {
            setTTY(process.stdout, true);
            logger.info('tty message');
            const line = chunkWith(stdoutChunks, 'tty message');
            expect(line).toContain('\x1b[32m'); // info = green
            expect(line).toContain('\x1b[0m');
            expect(line).toContain('INFO');
        });

        it('emits no ANSI codes when NO_COLOR is set to any non-empty value', () => {
            setTTY(process.stdout, true);
            for (const value of ['1', 'true', '0']) {
                stdoutChunks.length = 0;
                process.env.NO_COLOR = value;
                logger.info('no color message');
                const line = chunkWith(stdoutChunks, 'no color message');
                expect(line).not.toContain(ANSI);
                expect(line).toMatch(/INFO no color message/);
            }
        });

        it('treats an empty NO_COLOR as unset', () => {
            setTTY(process.stdout, true);
            process.env.NO_COLOR = '';
            logger.info('still colored');
            expect(chunkWith(stdoutChunks, 'still colored')).toContain(ANSI);
        });

        it('emits no ANSI codes when the stream is not a TTY (piped/CI output)', () => {
            setTTY(process.stdout, false);
            logger.info('piped message');
            const line = chunkWith(stdoutChunks, 'piped message');
            expect(line).not.toContain(ANSI);
            expect(line).toMatch(/INFO piped message/);
        });

        it('gates error/fatal color on stderr TTY-ness and NO_COLOR', () => {
            setTTY(process.stdout, false);
            setTTY(process.stderr, true);
            logger.error('boom');
            expect(chunkWith(stderrChunks, 'boom')).toContain('\x1b[31m'); // error = red

            stderrChunks.length = 0;
            process.env.NO_COLOR = '1';
            logger.error('boom again');
            const line = chunkWith(stderrChunks, 'boom again');
            expect(line).not.toContain(ANSI);
            expect(line).toMatch(/ERROR boom again/);
        });

        it('never writes ANSI codes to the file destination', () => {
            setTTY(process.stdout, true);
            const fileChunks: string[] = [];
            (logger as any).fileStream = {
                write: (chunk: string) => fileChunks.push(String(chunk)),
                end: (cb: () => void) => cb(),
            };
            logger.info('file message');
            expect(chunkWith(stdoutChunks, 'file message')).toContain(ANSI); // console keeps color…
            const fileLine = chunkWith(fileChunks, 'file message');
            expect(fileLine).not.toContain(ANSI); // …the file copy stays plain
            expect(fileLine).toMatch(/INFO file message/);
        });
    });

    // ── the contract's `meta` slot on error/fatal (#5575) ───────────────────
    //
    // `Logger.error(message, error?: Error, meta?)` declares THREE parameters.
    // `ObjectLogger` dispatches by shape so a meta object may also ride in the
    // `error` slot — but until #5575 the `error === undefined` branch never read
    // the third argument at all, so the contract-shaped
    // `logger.error(msg, undefined, { … })` rendered a bare message and dropped
    // every fact. ~15 call sites in `metadata`/`metadata-protocol`/`client`/
    // `core/security` write exactly that shape, and both sibling `Logger`
    // implementations (`ConsoleLogger`/`JsonLogger`) honour it — the drop was
    // this class's alone.
    describe('error/fatal honour the contract meta slot (#5575)', () => {
        const stderrChunks: string[] = [];
        let restore: () => void;

        beforeEach(() => {
            stderrChunks.length = 0;
            const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((c: string | Uint8Array) => {
                stderrChunks.push(String(c));
                return true;
            }) as never);
            restore = () => spy.mockRestore();
        });
        afterEach(() => restore());

        /** The single JSON record written by `fn`. */
        const recordOf = (fn: (log: ObjectLogger) => void): Record<string, unknown> => {
            const log = createLogger({ level: 'error', format: 'json' });
            fn(log);
            const lines = stderrChunks.join('').split('\n').filter(Boolean);
            expect(lines, 'one call must write exactly one physical line').toHaveLength(1);
            return JSON.parse(lines[0]) as Record<string, unknown>;
        };

        it('delivers `meta` from the THIRD slot when the error slot is undefined', () => {
            const record = recordOf((log) =>
                log.error('reconcile failed', undefined, {
                    issues: [{ code: 'unrecognized_keys', unrecognized: ['visibleIf'] }],
                }),
            );
            expect(record.msg).toBe('reconcile failed');
            // Pre-#5575 this whole field was absent: the record was `{msg}` only.
            expect(record.issues).toEqual([{ code: 'unrecognized_keys', unrecognized: ['visibleIf'] }]);
        });

        it('still accepts a meta object in the error slot (the tolerated shape)', () => {
            const record = recordOf((log) => log.error('reconcile failed', { connector: 'billing' }));
            expect(record.connector).toBe('billing');
        });

        it('merges both slots, with the later `meta` winning a collision', () => {
            const record = recordOf((log) =>
                log.error('both', { connector: 'billing', stage: 'auth' }, { stage: 'materialize' }),
            );
            expect(record.connector).toBe('billing');
            expect(record.stage).toBe('materialize');
        });

        it('keeps rendering an Error in the error slot alongside third-slot meta', () => {
            const record = recordOf((log) => log.error('boom', new Error('upstream down'), { connector: 'billing' }));
            expect(record.connector).toBe('billing');
            expect((record.error as { message?: string }).message).toBe('upstream down');
        });

        it('writes no context at all when neither slot is given', () => {
            const record = recordOf((log) => log.error('bare'));
            expect(Object.keys(record).sort()).toEqual(['level', 'msg', 'time']);
        });

        it('applies the same three shapes to fatal', () => {
            const record = recordOf((log) => log.fatal('fatal meta', undefined, { connector: 'billing' }));
            expect(record.level).toBe('fatal');
            expect(record.connector).toBe('billing');
        });
    });

    // #5573 — the redactor matched by SUBSTRING, so every field whose name
    // merely contained `password`/`token`/`secret`/`key` was replaced with
    // `***REDACTED***`: `keys`, `keyword`, `tokens`, `monkey`, `secretary`.
    // That is worse than dropping the field, because `***REDACTED***` tells the
    // reader a secret was withheld when there never was one. Matching is now on
    // camelCase/snake_case word boundaries (maintainer ruling, option A).
    describe('redaction matches whole words, not substrings (#5573)', () => {
        const stdoutChunks: string[] = [];

        beforeEach(() => {
            stdoutChunks.length = 0;
            vi.spyOn(process.stdout, 'write').mockImplementation(((c: string | Uint8Array) => {
                stdoutChunks.push(String(c));
                return true;
            }) as never);
        });
        afterEach(() => vi.restoreAllMocks());

        /** The one JSON record `meta` renders to, under `redact` (default table when omitted). */
        const recordOf = (meta: Record<string, unknown>, redact?: string[]): Record<string, unknown> => {
            stdoutChunks.length = 0;
            const log = createLogger({ level: 'info', format: 'json', ...(redact ? { redact } : {}) });
            log.info('probe', meta);
            const lines = stdoutChunks.join('').split('\n').filter(Boolean);
            expect(lines, 'one call must write exactly one physical line').toHaveLength(1);
            return JSON.parse(lines[0]) as Record<string, unknown>;
        };

        /** What the redactor did to a field of this name, carrying a marker value. */
        const verdictFor = (field: string, redact?: string[]): 'redacted' | 'kept' => {
            const value = recordOf({ [field]: 'MARKER-VALUE' }, redact)[field];
            return value === '***REDACTED***' ? 'redacted' : 'kept';
        };

        // The half that must NOT regress: a real secret stays redacted whatever
        // convention it is spelled in. Every entry here was redacted before the
        // change too — this matrix is the guard that word boundaries did not buy
        // precision by losing coverage.
        const REAL_SECRETS = [
            // the redact words themselves
            'password', 'token', 'secret', 'key',
            // camelCase
            'apiKey', 'accessToken', 'refreshToken', 'secretKey', 'privateKey', 'publicKey',
            'clientSecret', 'sessionToken', 'bearerToken', 'signingKey', 'encryptionKey',
            'passwordHash', 'dbPassword', 'sshKey', 'jwtSecret',
            // snake_case
            'api_key', 'access_token', 'refresh_token', 'secret_key', 'private_key',
            'client_secret', 'user_password', 'auth_token',
            // SCREAMING_SNAKE and kebab (headers, env vars)
            'API_KEY', 'OS_AUTH_SECRET', 'x-api-key', 'x-refresh-token',
            // all-lowercase / all-caps concatenation — no boundary to split on
            'apikey', 'APIKEY', 'accesstoken', 'clientsecret', 'privatekey',
            // plural, inside a compound: `apiKeys: ['sk-…']` is still secrets
            'apiKeys', 'api_keys', 'accessTokens', 'clientSecrets', 'userPasswords', 'apikeys',
        ];

        it.each(REAL_SECRETS)('still redacts %s', (field) => {
            expect(verdictFor(field)).toBe('redacted');
        });

        // The other half: the symptom this issue was filed for. Every entry was
        // `***REDACTED***` before the change.
        const NOT_SECRETS = [
            // #5573's own repro: Zod's `unrecognized_keys` issue names the keys in `keys`
            'keys', 'keyword', 'keywords', 'keyboard', 'monkey', 'tokens', 'tokenizer', 'secretary',
            // other English words ending in a redact word
            'donkey', 'turkey', 'whiskey', 'hockey',
            // dispatcher-plugin.ts renamed `key` -> `keyedBy` to dodge the redactor,
            // and the substring rule ate that too ('keyedby'.includes('key')).
            'keyedBy',
            'tokenizerName',
        ];

        it.each(NOT_SECRETS)('no longer redacts %s', (field) => {
            expect(verdictFor(field)).toBe('kept');
        });

        // Honest residual, pinned rather than left for the next reader to
        // discover: word boundaries cannot tell the *sense* of a word apart.
        // A field whose words include the SINGULAR `token`/`key` is still
        // redacted even when it is plainly a counter, and so is a compound
        // plural (the `apiKeys` rule, applied to `promptTokens`). Both were
        // redacted before this change as well — nothing regressed — but
        // neither is fixed by it. Narrowing further needs the maintainer:
        // it would mean ranking `prompt` against `api` as a qualifier.
        it.each(['tokenCount', 'promptTokens', 'completionTokens'])(
            'still redacts %s — word boundaries do not disambiguate word SENSE',
            (field) => {
                expect(verdictFor(field)).toBe('redacted');
            },
        );

        it('keeps a nested `keys` field readable — the exact #5573 repro', () => {
            const record = recordOf({
                issues: [{ code: 'unrecognized_keys', keys: ['visibleIf'], path: ['nodes', 0] }],
            });
            expect(record.issues).toEqual([
                { code: 'unrecognized_keys', keys: ['visibleIf'], path: ['nodes', 0] },
            ]);
        });

        it('still reaches a secret nested several levels down', () => {
            const record = recordOf({ connector: { auth: { apiKey: 'sk-live-123', mode: 'header' } } });
            expect(record.connector).toEqual({ auth: { apiKey: '***REDACTED***', mode: 'header' } });
        });

        // Bare plurals are collections or counts, not secrets — that is the
        // maintainer's ruling on `keys`/`tokens`, applied uniformly. The
        // plural only names a secret once something qualifies it (`apiKeys`,
        // above). Pinned because it is a deliberate coverage change, not an
        // oversight: a host that does log a bare `passwords` list opts back in
        // with `redact: [..., 'passwords']`.
        it('leaves a BARE plural alone, and honours an explicit opt-in for it', () => {
            expect(verdictFor('passwords')).toBe('kept');
            expect(verdictFor('secrets')).toBe('kept');
            expect(verdictFor('passwords', ['password', 'passwords'])).toBe('redacted');
        });

        it('honours a host-configured multi-word pattern, without widening it to its parts', () => {
            expect(verdictFor('apiKey', ['apiKey'])).toBe('redacted');
            expect(verdictFor('api_key', ['apiKey'])).toBe('redacted');
            expect(verdictFor('apikey', ['apiKey'])).toBe('redacted');
            // `apiKey` is the configured secret; a plain `key` is not one.
            expect(verdictFor('key', ['apiKey'])).toBe('kept');
        });
    });
});
