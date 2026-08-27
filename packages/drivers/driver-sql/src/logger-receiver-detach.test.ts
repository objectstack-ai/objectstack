// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12792] Log calls in `sql-driver.ts` keep their RECEIVER.
 *
 * ## The defect
 *
 * Nine sites selected a log channel by EXTRACTING the method before calling it:
 *
 * ```ts
 * (this.logger.error ?? this.logger.warn)(msg, meta);   // 8 sites
 * (this.logger.info  ?? this.logger.warn)(msg);         // 1 site
 * ```
 *
 * `a.b(…)` passes `a` as the receiver; `(a.b ?? c.d)(…)` evaluates to the bare
 * FUNCTION and then invokes it, so the call runs with `this === undefined`.
 * `@objectstack/core`'s `ObjectLogger` is a class with prototype methods and no
 * constructor binding — `error`/`fatal` reach for `this.writeErrorLike`,
 * `debug`/`info`/`warn` for `this.write` — so a host that injects one turns
 * every one of these lines into a `TypeError`.
 *
 * ## Why no existing suite in this package ever went red
 *
 * `SqlDriver.logger` defaults to an object literal of ARROW CLOSURES, and every
 * test double in this package is the same shape. A closure does not read `this`
 * and survives detachment perfectly. §0 asserts that directly, so this file
 * cannot quietly become decorative: rewrite the doubles below as object
 * literals and §0 goes red.
 *
 * ## Why the sites are worth pinning even though nothing composes an
 * `ObjectLogger` into `SqlDriver` today
 *
 * Measured on this tree: no production composition hands `SqlDriver` a logger at
 * all. The driver-sql plugin's `onEnable` builds `new SqlDriver(config)` and
 * never passes the kernel's logger; the constructor reads no `logger` key; every
 * `driver.logger = …` assignment in the repo is a test or a testkit. The one
 * production seam that CAN install one is `SqliteWasmDriver`'s constructor
 * (`if (config.logger) this.logger = config.logger`), inherited straight into
 * this class — no caller passes it yet.
 *
 * So these were latent, not live. That decides urgency, not whether: a call that
 * runs with `this === undefined` is a defect whatever today's wiring tolerates,
 * and these particular lines report durability degradation and schema drift —
 * the channel whose whole purpose is to be loud when something is wrong.
 *
 * ## What each section pins
 *
 * ⓪ the doubles (and the platform's real logger) are receiver-sensitive.
 * ① the `info` site, driven through the real dev auto-reconcile path.
 * ② the durability sites, driven through the real declared-index sync.
 * ③ a structural pin over `sql-driver.ts` itself: no detach-then-call shape
 *   survives anywhere in the file, in ANY of the four spellings the sweep
 *   measured — including the two a single-line regex cannot see.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createLogger } from '@objectstack/core';
import { SqlDriver } from './sql-driver.js';
import type { DeclaredIndexInput } from './schema-drift.js';

type Level = 'info' | 'warn' | 'error';
interface LoggedLine {
  level: Level;
  message: string;
  meta?: unknown;
}

/**
 * A CLASS whose channels dispatch through `this`, mirroring `ObjectLogger`'s
 * `this.write` / `this.writeErrorLike`.
 *
 * ⛔ Do NOT rewrite this as an object literal of arrow functions — that is
 * exactly the shape that made the defect invisible to every existing suite
 * (§0 enforces it).
 */
class ReceiverSensitiveLogger {
  readonly lines: LoggedLine[] = [];

  /** The `this.write*` analogue — the dereference that throws when detached. */
  private record(level: Level, message: string, meta?: unknown): void {
    this.lines.push({ level, message, meta });
  }

  info(message: string, meta?: unknown): void {
    this.record('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.record('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.record('error', message, meta);
  }

  at(level: Level): LoggedLine[] {
    return this.lines.filter((l) => l.level === level);
  }
}

/**
 * The reduced sink `SqlDriver.logger`'s type actually guarantees: `warn` only,
 * no `error` and no `info`. Still class-based, so the FALLBACK leg is held to
 * the same receiver standard as the primary one — a fix that bound only the
 * `error` channel would go red here.
 */
class WarnOnlyReceiverSensitiveLogger {
  readonly lines: LoggedLine[] = [];

  private record(level: Level, message: string, meta?: unknown): void {
    this.lines.push({ level, message, meta });
  }

  warn(message: string, meta?: unknown): void {
    this.record('warn', message, meta);
  }

  at(level: Level): LoggedLine[] {
    return this.lines.filter((l) => l.level === level);
  }
}

let openKnex: any;

function makeDriver(opts: Record<string, unknown> = {}): SqlDriver {
  const d = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    ...opts,
  } as never);
  openKnex = (d as unknown as { knex: unknown }).knex;
  return d;
}

const install = (driver: SqlDriver, logger: unknown): void => {
  (driver as unknown as { logger: unknown }).logger = logger;
};

afterEach(async () => {
  await (openKnex as { destroy?: () => Promise<void> } | undefined)?.destroy?.();
  openKnex = undefined;
});

// ────────────────────────────────────────────────────────────────────────────
describe('[#12792] ⓪ the doubles are receiver-sensitive (this file is non-vacuous)', () => {
  it('a class-based double THROWS when its channel is detached from the receiver', () => {
    const logger = new ReceiverSensitiveLogger();
    const detached = logger.error;
    expect(() => detached('detached call')).toThrow(TypeError);
    expect(() => detached('detached call')).toThrow(/Cannot read properties of undefined/);
    expect(() => logger.error('bound call')).not.toThrow();
    expect(logger.at('error')).toHaveLength(1);
  });

  it('the warn-only double is receiver-sensitive on the FALLBACK channel too', () => {
    const logger = new WarnOnlyReceiverSensitiveLogger();
    const detached = logger.warn;
    expect(() => detached('detached call')).toThrow(/Cannot read properties of undefined/);
    expect(() => logger.warn('bound call')).not.toThrow();
  });

  it('a CLOSURE double survives the same detachment — which is why this defect had no red test', () => {
    const seen: string[] = [];
    const closureLogger = { error: (m: string) => void seen.push(m) };
    const detached = closureLogger.error;
    expect(() => detached('detached call')).not.toThrow();
    expect(seen).toEqual(['detached call']);
  });

  /**
   * The link that makes this card real rather than stylistic: the PLATFORM's
   * own logger is receiver-sensitive, so any host that injects one is the live
   * case. Level `silent` keeps the bound call from writing anywhere — the
   * detach throws long before the level is consulted.
   *
   * If this ever goes red because `@objectstack/core` started binding its
   * channels in the constructor, delete this case — not the fix. Property-access
   * calls stay correct under either shape.
   */
  it('`@objectstack/core`s real ObjectLogger is receiver-sensitive on every channel used here', () => {
    const logger = createLogger({ level: 'silent' });
    for (const channel of ['error', 'warn', 'info'] as const) {
      const detached = logger[channel];
      expect(() => detached('detached call')).toThrow(/Cannot read properties of undefined/);
      expect(() => logger[channel]('bound call')).not.toThrow();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('[#12792] ① the dev auto-reconcile reports what it reconciled', () => {
  /**
   * Real path end to end: a declared index that is physically absent is drift
   * of category `safe`, so `autoMigrate: 'safe'` creates it and announces it on
   * the `info` channel. Physical table, real differ, real DDL — the only thing
   * supplied is the metadata the differ compares against.
   *
   * ⚠️ The site sits INSIDE the reconcile's own `try`, so before the fix the
   * `TypeError` was swallowed and re-reported as `dev auto-reconcile failed` —
   * a reconcile that SUCCEEDED, announced as a failure, with the post-reconcile
   * re-detect skipped. Both halves are asserted.
   */
  const FIELDS = { code: { type: 'string' } };
  const declaredIndex = (table: string) => [{ name: `idx_${table}_code`, fields: ['code'] }];

  const seedTableMissingItsIndex = async (table: string): Promise<void> => {
    await openKnex.schema.createTable(table, (t: any) => {
      t.string('id').primary();
      t.string('code');
    });
  };

  const reconcile = (driver: SqlDriver, table: string): Promise<void> =>
    (
      driver as unknown as {
        reconcileAndWarnDrift(
          t: string,
          f: Record<string, unknown>,
          i?: unknown[],
        ): Promise<void>;
      }
    ).reconcileAndWarnDrift(table, FIELDS, declaredIndex(table));

  it('announces the reconcile at info against a class-based logger, receiver intact', async () => {
    const driver = makeDriver({ autoMigrate: 'safe', schemaMode: 'managed' });
    await seedTableMissingItsIndex('os12792_info');
    const logger = new ReceiverSensitiveLogger();
    install(driver, logger);

    await reconcile(driver, 'os12792_info');

    const infos = logger.at('info');
    expect(infos.map((l) => l.message)).toEqual([
      expect.stringContaining('[schema-drift] auto-reconciled'),
    ]);
    expect(infos[0].message).toContain('os12792_info');
    // The index really was created — the reconcile the line reports happened.
    expect(await (driver as unknown as {
      getExistingIndexNames(t: string): Promise<Set<string>>;
    }).getExistingIndexNames('os12792_info')).toContain('idx_os12792_info_code');
    // …and the reconcile is NOT reported as having failed: that mislabel is the
    // second half of the defect, produced by the `catch` that swallowed the
    // TypeError this line used to throw.
    expect(logger.lines.some((l) => l.message.includes('dev auto-reconcile failed'))).toBe(false);
  });

  it('falls back to warn — at the same INFO meaning — for a host with no info channel', async () => {
    const driver = makeDriver({ autoMigrate: 'safe', schemaMode: 'managed' });
    await seedTableMissingItsIndex('os12792_info_fallback');
    const logger = new WarnOnlyReceiverSensitiveLogger();
    install(driver, logger);

    await reconcile(driver, 'os12792_info_fallback');

    expect(logger.at('warn').some((l) => l.message.includes('auto-reconciled'))).toBe(true);
    expect(logger.at('warn').some((l) => l.message.includes('dev auto-reconcile failed'))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('[#12792] ② the durability channel reports the unenforced constraint', () => {
  /** The #5030 shape: `COALESCE(organization_id, "__global__"), code`. */
  const NULL_SAFE_INDEX: DeclaredIndexInput = {
    name: 'uniq_os12792_dupe_organization_id_code',
    fields: ['organization_id', 'code'],
    unique: 'organization',
    nullSafeColumns: ['organization_id'],
  };
  const PHYSICAL = new Set(['id', 'organization_id', 'code']);

  /** Real duplicates, so the real `CREATE UNIQUE INDEX` is what refuses. */
  const seedDuplicates = async (table: string): Promise<void> => {
    await openKnex.schema.createTable(table, (t: any) => {
      t.string('id').primary();
      t.string('organization_id');
      t.string('code');
    });
    await openKnex(table).insert([
      { id: '1', organization_id: null, code: 'DUP' },
      { id: '2', organization_id: null, code: 'DUP' },
    ]);
  };

  const sync = (driver: SqlDriver, table: string): Promise<void> =>
    (
      driver as unknown as {
        syncDeclaredIndexes(
          t: string,
          i: DeclaredIndexInput[],
          c: Set<string>,
          tenantField?: string | null,
        ): Promise<void>;
      }
    ).syncDeclaredIndexes(table, [{ ...NULL_SAFE_INDEX }], PHYSICAL, 'organization_id');

  it('reports at error through a class-based logger instead of crashing the sync', async () => {
    const driver = makeDriver();
    await seedDuplicates('os12792_dupe');
    const logger = new ReceiverSensitiveLogger();
    install(driver, logger);

    await expect(sync(driver, 'os12792_dupe')).resolves.toBeUndefined();

    const errors = logger.at('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('cannot create NULL-safe unique index');
    expect(errors[0].message).toContain('is NOT enforced until the data is deduplicated');
  });

  it('falls back to the guaranteed warn channel for a host that ships no error channel', async () => {
    const driver = makeDriver();
    await seedDuplicates('os12792_dupe_fallback');
    const logger = new WarnOnlyReceiverSensitiveLogger();
    install(driver, logger);

    await expect(sync(driver, 'os12792_dupe_fallback')).resolves.toBeUndefined();

    const warns = logger.at('warn');
    expect(warns.some((l) => l.message.includes('is NOT enforced until the data is deduplicated'))).toBe(
      true,
    );
  });

  /**
   * The platform's OWN logger on the same real path. This is the composition
   * the card is about: nothing wires it today, and the day something does, this
   * assertion is the difference between a reported degradation and a `TypeError`
   * escaping `initObjects`.
   */
  it('survives `@objectstack/core`s real ObjectLogger on the same path', async () => {
    const driver = makeDriver();
    await seedDuplicates('os12792_dupe_real');
    install(driver, createLogger({ level: 'silent' }));

    await expect(sync(driver, 'os12792_dupe_real')).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('[#12792] ③ no detach-then-call shape survives in sql-driver.ts', () => {
  /**
   * Parsed, not grepped, and deliberately so. Both counts this card carried
   * before the fix came from single-line regexes, which are blind to a fallback
   * split across lines and blind to the two-step form entirely — and one of them
   * counted a DOCBLOCK line as a call site. An AST walk sees neither comments
   * nor line breaks, and the four shapes below are the four the sweep measured.
   */
  interface Finding {
    line: number;
    shape: string;
    text: string;
  }

  const LOG_CHANNELS = /^(debug|info|warn|error|fatal|log)$/;
  /** A receiver that is a log sink — keeps `const { error } = someResult` out. */
  const LOG_SINK = /(^|\.)logger$|(^|\.)log$|logger\b/i;

  const unwrap = (n: ts.Node): ts.Node => {
    let cur = n;
    while (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isNonNullExpression(cur)
    ) {
      cur = cur.expression;
    }
    return cur;
  };

  /** The channel reads a `??` / `||` / `?:` chain resolves to. */
  const channelReads = (node: ts.Node): ts.PropertyAccessExpression[] => {
    const n = unwrap(node);
    if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      return [...channelReads(n.left), ...channelReads(n.right)];
    }
    if (ts.isConditionalExpression(n)) {
      return [...channelReads(n.whenTrue), ...channelReads(n.whenFalse)];
    }
    if (ts.isPropertyAccessExpression(n) && LOG_CHANNELS.test(n.name.text)) return [n];
    return [];
  };

  function scan(source: string, fileName: string): Finding[] {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const found: Finding[] = [];
    const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const snippet = (n: ts.Node): string =>
      source.slice(n.getStart(sf), n.getStart(sf) + 90).split('\n')[0];
    /** Local name -> the shape that detached it, for the deferred-call pass. */
    const detachedLocals = new Map<string, string>();

    const visit = (node: ts.Node): void => {
      // ① a call whose CALLEE is a parenthesized expression: `(a.error ?? a.warn)(…)`.
      //    Immune to line breaks — this is the shape the regexes could only half see.
      if (ts.isCallExpression(node) && ts.isParenthesizedExpression(node.expression)) {
        if (channelReads(node.expression).length > 0) {
          found.push({ line: at(node), shape: 'parenthesized-callee', text: snippet(node) });
        }
      }
      // ② the two-step form: `const fn = a.error ?? a.warn;` … `fn(…)`.
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (channelReads(node.initializer).length > 0) {
          detachedLocals.set(node.name.text, 'two-step-local');
        }
      }
      // ③ destructured off a sink: `const { error } = this.logger;` … `error(…)`.
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
        const receiver = unwrap(node.initializer).getText(sf);
        if (LOG_SINK.test(receiver)) {
          for (const el of node.name.elements) {
            const key = (el.propertyName ?? el.name).getText(sf);
            if (ts.isIdentifier(el.name) && LOG_CHANNELS.test(key)) {
              detachedLocals.set(el.name.text, 'destructured-channel');
            }
          }
        }
      }
      // ④ a channel handed on as a bare callback argument: `run(this.logger.warn)`.
      if (ts.isCallExpression(node)) {
        for (const arg of node.arguments) {
          const a = unwrap(arg);
          if (
            ts.isPropertyAccessExpression(a) &&
            LOG_CHANNELS.test(a.name.text) &&
            LOG_SINK.test(unwrap(a.expression).getText(sf))
          ) {
            found.push({ line: at(a), shape: 'channel-as-callback', text: snippet(node) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    const visitCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const shape = detachedLocals.get(node.expression.text);
        if (shape) found.push({ line: at(node), shape, text: snippet(node) });
      }
      ts.forEachChild(node, visitCalls);
    };
    visitCalls(sf);

    return found;
  }

  /**
   * ⛔ A zero below is only a reading if the scanner can fire. This control
   * carries one instance of each shape — including a fallback split across
   * lines, which no single-line instrument can see — plus the two things that
   * must NOT be counted: a docblock quoting the bad shape in prose (the exact
   * miscount this card corrected in public) and the correct `if/else` spelling.
   */
  const CONTROL = [
    'class Ctl {',
    '  private logger = { warn: (m: string) => void m, error: undefined as undefined | ((m: string) => void) };',
    "  a() { (this.logger.error ?? this.logger.warn)('one line'); }",
    '  b() {',
    '    (',
    '      this.logger.error ??',
    '      this.logger.warn',
    "    )('split across lines');",
    '  }',
    "  c() { const fn = this.logger.error ?? this.logger.warn; fn('two-step'); }",
    "  d() { const { warn } = this.logger; warn('destructured'); }",
    '  e() { [1].forEach(this.logger.warn); }',
    '  /** prose: (this.logger.error ?? this.logger.warn)(…) is NOT a call site. */',
    "  ok() { if (this.logger.error) this.logger.error('bound'); else this.logger.warn('bound'); }",
    '}',
  ].join('\n');

  it('fires on all four shapes in a control sample, and on neither prose nor the correct spelling', () => {
    const found = scan(CONTROL, 'control.ts');
    expect(found.map((f) => f.shape).sort()).toEqual(
      [
        'channel-as-callback',
        'destructured-channel',
        'parenthesized-callee',
        'parenthesized-callee',
        'two-step-local',
      ].sort(),
    );
    // The prose line (13) and the correct `if/else` line (14) are both clean.
    expect(found.filter((f) => f.line >= 13)).toEqual([]);
  });

  it('sql-driver.ts contains none of them', () => {
    const source = readFileSync(new URL('./sql-driver.ts', import.meta.url), 'utf8');
    expect(
      scan(source, 'sql-driver.ts').map((f) => `${f.shape} @${f.line}: ${f.text.trim()}`),
      'every log call must go through a property access so the receiver stays bound',
    ).toEqual([]);
  });
});
