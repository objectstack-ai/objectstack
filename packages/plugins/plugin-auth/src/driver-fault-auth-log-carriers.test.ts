// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21274] A driver error on an auth-table write leaves no bound value in the
 * server log, through any carrier the auth library writes.
 *
 * The engine's own log line for a failed write has been redacted since #8682,
 * but the error it propagated was the driver's raw one. The auth library logs
 * what it catches, and its logger was measured printing the failing statement
 * and its bound values — credential-class columns among them — through three
 * carriers: its own error line, its server-error line, and the error object's
 * properties. The cut now runs where the error leaves the engine
 * (`redactPropagatedDriverFault` in `@objectstack/objectql`); ⛔ nothing in
 * this package's adapter or its logger wiring was changed for it, because a
 * per-consumer patch would leave the class open for the next logger.
 *
 * ## How a driver error is forced, honestly
 *
 * A UNIQUE index is added to `sys_user.name` after the schema is synced, and a
 * seeded user already holds the sentinel as its name. Two auth-table writes
 * then carry the sentinel as a bound value and are refused BY THE DATABASE:
 *
 *  - **sign-up**, the user insert: the library logs `Failed to create user`
 *    with the error object (its error line), then answers 422;
 *  - **update-user**, the profile update: unwrapped by the library, so its
 *    router's error handler logs the error's name with the error object (its
 *    server-error line), and answers 500.
 *
 * Both reach the engine as a unique violation, so what leaves it is the
 * `DuplicateRecordError` envelope with the driver error on `cause` — the
 * carrier the library prints in full. Per dialect, the sentinel rides a
 * different property of that driver error: SQLite's `message` and `stack`
 * (knex inlines the bound values), MySQL's `message`, `stack`, `sql` and
 * `sqlMessage`, Postgres' `detail` (its message binds by placeholder).
 *
 * ## Dialect cells
 *
 * SQLite always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. Each live cell owns one schema (Postgres) or database (MySQL),
 * created before and dropped after.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { format, inspect } from 'node:util';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';

/** The caller's value. Synthetic; asserted ABSENT from every carrier. */
const S = 'SENTINEL-21274-BOUND-VALUE';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-carriers';
const PASSWORD = 'S3cure!Passw0rd-carriers';

/** The live cells' own namespace: a Postgres schema, a MySQL database. */
const LIVE_NAMESPACE = 'os_lv_plugin_auth_driver_fault_carriers';

/** Declared locally with only the columns the audience gate reads (the sibling suites' precedent). */
const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

interface Cell {
  readonly id: 'sqlite' | 'pg' | 'mysql';
  readonly env: string | null;
  readonly url: string | undefined;
  /** The dialect's code for a unique violation, as the driver error carries it. */
  readonly uniqueCode: string;
  /** The database's own words for it, which must survive the cut. */
  readonly diagnostic: string;
  /** The forced index's key: MySQL stores `name` as TEXT, which takes a prefix length. */
  readonly nameKey: string;
  /** Prepare the cell's namespace; returns the driver config to run in it. */
  readonly provision: () => Promise<Record<string, unknown>>;
  readonly teardown: () => Promise<void>;
}

function adminDriver(config: Record<string, unknown>): SqlDriver {
  return new SqlDriver(config as never);
}

function mysqlUrlFor(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;

const CELLS: readonly Cell[] = [
  {
    id: 'sqlite',
    env: null,
    url: 'sqlite',
    uniqueCode: 'SQLITE_CONSTRAINT_UNIQUE',
    nameKey: 'name',
    diagnostic: 'UNIQUE constraint failed: sys_user.name',
    provision: async () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    teardown: async () => {},
  },
  {
    id: 'pg',
    env: 'OS_TEST_POSTGRES_URL',
    url: PG_URL,
    uniqueCode: '23505',
    nameKey: 'name',
    diagnostic: 'duplicate key value violates unique constraint',
    provision: async () => {
      const admin = adminDriver({ client: 'pg', connection: PG_URL });
      try {
        await admin.getKnex().raw(`drop schema if exists ${LIVE_NAMESPACE} cascade`);
        await admin.getKnex().raw(`create schema ${LIVE_NAMESPACE}`);
      } finally {
        await admin.disconnect();
      }
      return { client: 'pg', connection: PG_URL, searchPath: [LIVE_NAMESPACE] };
    },
    teardown: async () => {
      const admin = adminDriver({ client: 'pg', connection: PG_URL });
      try {
        await admin.getKnex().raw(`drop schema if exists ${LIVE_NAMESPACE} cascade`);
      } finally {
        await admin.disconnect();
      }
    },
  },
  {
    id: 'mysql',
    env: 'OS_TEST_MYSQL_URL',
    url: MYSQL_URL,
    uniqueCode: 'ER_DUP_ENTRY',
    nameKey: 'name(191)',
    diagnostic: 'Duplicate entry [value redacted] for key',
    provision: async () => {
      const admin = adminDriver({ client: 'mysql2', connection: MYSQL_URL });
      try {
        await admin.getKnex().raw(`drop database if exists ${LIVE_NAMESPACE}`);
        await admin.getKnex().raw(`create database ${LIVE_NAMESPACE}`);
      } finally {
        await admin.disconnect();
      }
      return { client: 'mysql2', connection: mysqlUrlFor(MYSQL_URL!, LIVE_NAMESPACE) };
    },
    teardown: async () => {
      const admin = adminDriver({ client: 'mysql2', connection: MYSQL_URL });
      try {
        await admin.getKnex().raw(`drop database if exists ${LIVE_NAMESPACE}`);
      } finally {
        await admin.disconnect();
      }
    },
  },
];

const SYSTEM = { context: { isSystem: true } } as never;

interface RecordedCall {
  readonly level: string;
  readonly args: unknown[];
}

interface RecordingLogger {
  readonly calls: RecordedCall[];
  readonly [method: string]: unknown;
}

/** A logger that keeps every call, so each line can be rendered and searched. */
function recordingLogger(): RecordingLogger {
  const calls: RecordedCall[] = [];
  const push = (level: string) => (...args: unknown[]) => void calls.push({ level, args });
  const logger: RecordingLogger = {
    calls,
    trace: push('trace'), fatal: push('fatal'),
    debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
    child: () => logger,
  };
  return logger;
}

/**
 * Every line a call would print: `util.format` is how `console` renders its
 * arguments, and each Error argument is additionally inspected with its hidden
 * fields shown — stricter than any logger, so nothing can sit where only a
 * differently-configured logger would look.
 */
function renderCall(args: readonly unknown[]): string {
  const hidden = args
    .filter((a) => a !== null && typeof a === 'object')
    .map((a) => inspect(a, { depth: 8, showHidden: true }));
  return [format(...args), ...hidden].join('\n');
}

interface Captured {
  readonly console: RecordedCall[];
  readonly engine: RecordingLogger;
  readonly manager: RecordingLogger;
}

/** Run `fn` with the auth library's console carriers captured. */
async function capturingConsole<T>(fn: () => Promise<T>): Promise<{ result: T; lines: Array<{ level: string; args: unknown[] }> }> {
  const lines: Array<{ level: string; args: unknown[] }> = [];
  const spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push({ level, args })),
  );
  try {
    return { result: await fn(), lines };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

for (const cell of CELLS) {
  describe.skipIf(!cell.url)(
    `[#21274] a driver error on an auth-table write reaches no logger with its bound values — ${cell.id}${cell.url ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let captured: Captured;
      const responses: Record<string, { status: number; body: string }> = {};

      beforeAll(async () => {
        const config = await cell.provision();
        const engineLogger = recordingLogger();
        engine = new ObjectQL({ logger: engineLogger } as never);
        const driver = new SqlDriver(config as never);
        engine.registerDriver(driver, true);
        await engine.init();
        for (const object of authIdentityObjects) {
          engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
        }
        engine.registry.registerObject(sysPermissionSet as never, '@objectstack/plugin-security');
        engine.registry.registerObject(sysUserPermissionSet as never, '@objectstack/plugin-security');
        await engine.syncSchemas();

        // The seeded holder of the sentinel, then the constraint the two writes
        // below will meet in the DATABASE — not in any check of ours.
        await engine.insert('sys_user', { id: 'usr_holder', email: 'holder@corp.example', name: S }, SYSTEM);
        await driver.getKnex().raw(`create unique index sys_user_name_forced_unique on sys_user (${cell.nameKey})`);
        await engine.insert(
          'sys_permission_set',
          { id: 'ps_member_default', name: 'member_default', label: 'member_default', active: true },
          SYSTEM,
        );
        for (const email of ['first@corp.example', 'second@corp.example']) {
          await engine.insert(
            'sys_invitation',
            {
              id: `inv_${email.split('@')[0]}`,
              email,
              status: 'pending',
              organization_id: 'org_carriers',
              role: 'member',
              inviter_id: 'usr_holder',
              expires_at: new Date(Date.now() + 3_600_000),
            },
            SYSTEM,
          );
        }

        const managerLogger = recordingLogger();
        const manager = new AuthManager({
          secret: SECRET,
          baseUrl: BASE,
          dataEngine: engine as never,
          logger: managerLogger,
        } as never);
        // Boot writes (better-auth's plugin init hooks) settle outside the window.
        await manager.getAuthInstance();

        // A member whose profile update will be refused.
        const first = await manager.handleRequest(
          new Request(`${AUTH}/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ email: 'first@corp.example', password: PASSWORD, name: 'First Member' }),
          }),
        );
        expect(first.status, `the setup sign-up must succeed: ${await first.clone().text()}`).toBe(200);
        const cookie = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

        const engineLineCount = engineLogger.calls.length;
        const managerLineCount = managerLogger.calls.length;
        const { lines } = await capturingConsole(async () => {
          // Write 1 — sign-up's user insert carries the sentinel as `name`.
          const signUp = await manager.handleRequest(
            new Request(`${AUTH}/sign-up/email`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', origin: BASE },
              body: JSON.stringify({ email: 'second@corp.example', password: PASSWORD, name: S }),
            }),
          );
          responses.signUp = { status: signUp.status, body: await signUp.text() };
          // Write 2 — update-user's profile update carries the sentinel as `name`.
          const update = await manager.handleRequest(
            new Request(`${AUTH}/update-user`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', origin: BASE, cookie },
              body: JSON.stringify({ name: S }),
            }),
          );
          responses.update = { status: update.status, body: await update.text() };
        });
        captured = {
          console: lines,
          engine: { ...engineLogger, calls: engineLogger.calls.slice(engineLineCount) },
          manager: { ...managerLogger, calls: managerLogger.calls.slice(managerLineCount) },
        };
      }, 60_000);

      afterAll(async () => {
        try {
          await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
        } finally {
          await cell.teardown();
        }
      }, 60_000);

      it('both writes were refused by the database (non-vacuity)', () => {
        expect(responses.signUp.status).toBe(422);
        expect(responses.update.status).toBe(500);
        const engineWarns = captured.engine.calls.filter((c) => c.level === 'warn').map((c) => String(c.args[0]));
        expect(engineWarns).toContain('Insert operation failed');
        expect(engineWarns).toContain('Update operation failed');
      });

      it("the library's error line and its server-error line carry no bound value", () => {
        const errorLines = captured.console.filter((l) => l.level === 'error');
        expect(errorLines.map((l) => format(...l.args)).some((t) => t.includes('Failed to create user'))).toBe(true);
        expect(errorLines.map((l) => format(...l.args)).some((t) => t.includes('DuplicateRecordError'))).toBe(true);
        for (const line of captured.console) {
          expect(renderCall(line.args).includes(S), `console.${line.level} carries the caller's value`).toBe(false);
        }
      });

      it("the error object's properties carry no bound value, while its class, code and diagnostic survive", () => {
        const errors = captured.console
          .flatMap((l) => l.args)
          .filter((a): a is Error & Record<string, unknown> => a instanceof Error);
        for (const error of errors) {
          expect(inspect(error, { depth: 8, showHidden: true }).includes(S)).toBe(false);
        }
        // One envelope per refused write at least: sign-up's, and update-user's.
        const envelopes = errors.filter((e) => e.name === 'DuplicateRecordError');
        expect(envelopes.length).toBeGreaterThanOrEqual(2);
        for (const error of envelopes) {
          expect(error.code).toBe('DUPLICATE_RECORD');
          const cause = error.cause as Error & { code?: unknown };
          expect(cause).toBeInstanceOf(Error);
          expect(cause.code).toBe(cell.uniqueCode);
          expect(cause.message).toContain(cell.diagnostic);
        }
      });

      it("control: the engine's own WARN lines are the redacted ones, and no other log carries the value", () => {
        for (const call of [...captured.engine.calls, ...captured.manager.calls]) {
          expect(renderCall(call.args).includes(S), `${call.level} ${String(call.args[0])}`).toBe(false);
        }
        const writeWarns = captured.engine.calls.filter(
          (c) => c.level === 'warn' && /^(Insert|Update) operation failed$/.test(String(c.args[0])),
        );
        for (const warn of writeWarns) {
          const meta = warn.args[1] as { error: { message: string } };
          expect(meta.error.message).toContain('[statement and bound values redacted]');
        }
      });

      it('the HTTP answers carry no bound value', () => {
        expect(responses.signUp.body.includes(S)).toBe(false);
        expect(responses.update.body.includes(S)).toBe(false);
      });
    },
  );
}
