// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Phone-number OTP with no deliverable SMS service, driven on the wire.
 *
 * `POST /phone-number/send-otp` on a deployment that turned the phoneNumber
 * plugin on but has no SMS service to deliver the code (none wired, or a
 * log-only transport in production) used to answer **500 with a null body**:
 * `deliverPhoneOtp` threw a plain `Error`, and better-call (better-auth's
 * router) maps ONLY an `APIError` to a real status — everything else takes its
 * `console.error` + `500 / null` branch. The login page then had nothing to
 * branch on and showed a generic failure, while the quota wall in the same
 * function already answered with a typed `APIError`.
 *
 * The refusal is now `400` with `code: 'SMS_SERVICE_REQUIRED'`, registered for
 * `@objectstack/plugin-auth` in the ADR-0112 error-code ledger beside its email
 * sibling `EMAIL_SERVICE_REQUIRED` (which the identity import answers at 400
 * for the same "a delivery service is not configured" condition).
 *
 * This file asserts at the seam a caller uses: real `AuthManager.handleRequest`
 * over a real better-auth pipeline. The console's phone-number client reads the
 * top-level `code` and `message` of exactly this body, so the status, the code
 * and the absence of the one-time code from the message are all pinned here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ErrorCode } from '@objectstack/spec/api';
import { AuthManager } from './auth-manager';

// ───────────────────────────────────────────────────────────────────────────
// Harness
// ───────────────────────────────────────────────────────────────────────────

interface MemoryRow { id: string; [column: string]: unknown }
/**
 * The index signature makes this assignable to the engine dispatch inputs, so
 * the predicates below are called with a real type rather than through a cast.
 */
interface MemoryQuery {
  where?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
  offset?: number;
  multi?: boolean;
  [option: string]: unknown;
}

/**
 * In-memory `IDataEngine`, the shape `change-email-delete-user-wiring.test.ts`
 * uses — both destructive verbs pinned to ObjectQL's OWN dispatch predicates
 * (`pnpm check:engine-double-contract`), so this double cannot accept a call
 * the real engine refuses.
 */
function createMemoryEngine() {
  const tables = new Map<string, MemoryRow[]>();
  const rows = (name: string): MemoryRow[] => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: unknown, b: unknown): boolean =>
    a instanceof Date || b instanceof Date
      ? new Date(a as string).getTime() === new Date(b as string).getTime()
      : a === b;
  const matches = (row: MemoryRow, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
      const actual = row[key];
      if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
        const operators = expected as Record<string, unknown>;
        if ('$ne' in operators) return !eq(actual, operators.$ne);
        if ('$in' in operators) return (operators.$in as unknown[]).some((v) => eq(actual, v));
      }
      return eq(actual, expected);
    });
  const project = (row: MemoryRow, fields?: string[]): MemoryRow => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out = { id: row.id } as MemoryRow;
    for (const field of fields) if (field in row) out[field] = row[field];
    return out;
  };
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: Record<string, unknown>): Promise<MemoryRow> {
      const row = { ...data, id: (data.id as string) ?? `row_${++seq}` } as MemoryRow;
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, query: MemoryQuery = {}): Promise<MemoryRow | null> {
      assertEngineFindOnePredicate(name, query);
      const row = rows(name).find((r) => matches(r, query.where));
      return row ? project(row, query.fields) : null;
    },
    async find(name: string, query: MemoryQuery = {}): Promise<MemoryRow[]> {
      let out = rows(name).filter((r) => matches(r, query.where));
      // The caller's bounds, applied after the filter and by PRESENCE: a
      // `limit: 0` is a bound of zero rows, not an absent one.
      if (typeof query.offset === 'number') out = out.slice(query.offset);
      if (typeof query.limit === 'number') out = out.slice(0, query.limit);
      return out.map((r) => project(r, query.fields));
    },
    async count(name: string, query: MemoryQuery = {}): Promise<number> {
      return rows(name).filter((r) => matches(r, query.where)).length;
    },
    async update(name: string, data: Record<string, unknown>, options?: MemoryQuery): Promise<MemoryRow | null> {
      assertEngineUpdateDispatch(data, options);
      const row = rows(name).find((r) => r.id === data.id);
      if (!row) return null;
      Object.assign(row, data);
      return { ...row };
    },
    async delete(name: string, options: MemoryQuery = {}): Promise<number> {
      assertEngineDeleteDispatch(options);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, options.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
}

type MemoryEngine = ReturnType<typeof createMemoryEngine>;

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ORIGIN = 'http://localhost:3000';
const AUTH = `${ORIGIN}/api/v1/auth`;
const PHONE = '+15550100';

function makeManager(engine: MemoryEngine, smsService?: unknown): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { phoneNumber: true },
    ...(smsService ? { smsService } : {}),
  } as never);
}

/**
 * An SMS service whose transport is the log-only fallback: wired, but
 * `isConfigured()` is false. Outside production that still prints the message
 * (local OTP flows stay testable); in production it delivers nothing, so the
 * OTP surface must refuse exactly as if no service were wired.
 */
function createLogOnlySmsService() {
  const sent: unknown[] = [];
  return {
    sent,
    service: {
      async send(input: unknown) {
        sent.push(input);
        return { id: 'sms_log', status: 'sent' };
      },
      isConfigured: () => false,
    },
  };
}

const sendOtp = (manager: AuthManager, phoneNumber: string = PHONE) =>
  manager.handleRequest(
    new Request(`${AUTH}/phone-number/send-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ phoneNumber }),
    }),
  );

/** The body as the console's phone-number client reads it: JSON, or nothing. */
const jsonBody = async (response: Response): Promise<Record<string, unknown> | null> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown> | null;
  } catch {
    return { raw: text };
  }
};

/** The one-time codes better-auth stored for `phone` — what must never leak. */
const storedOtpCodes = (engine: MemoryEngine, phone: string = PHONE): string[] =>
  [...engine.tables.values()]
    .flat()
    .filter((row) => row.identifier === phone && typeof row.value === 'string')
    .map((row) => String(row.value).split(':')[0])
    .filter(Boolean);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST /phone-number/send-otp without a deliverable SMS service', () => {
  it('no SMS service wired: answers 400 SMS_SERVICE_REQUIRED, never a bare 500', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    const response = await sendOtp(manager);
    const body = await jsonBody(response);

    expect(response.status, JSON.stringify(body)).toBe(400);
    expect(body?.code).toBe('SMS_SERVICE_REQUIRED');
    // The code on the wire is a member of the ADR-0112 vocabulary, not an
    // unregistered spelling (which would fail `ApiErrorSchema` parse).
    expect(ErrorCode.safeParse(body?.code).success).toBe(true);
    // The message names the missing capability, so a client with no mapping
    // for the code still shows the reason instead of a generic failure.
    expect(String(body?.message)).toMatch(/SMS/);
  });

  it('the refusal never carries the one-time code better-auth stored', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    const response = await sendOtp(manager);
    const text = await response.text();

    // better-auth stores the fresh code BEFORE invoking the send callback, so
    // a code exists at the moment of refusal; it reaches only an SMS body.
    const codes = storedOtpCodes(engine);
    expect(codes.length, 'better-auth stores the code before the send callback').toBeGreaterThan(0);
    for (const code of codes) expect(text).not.toContain(code);
  });

  it('production with a log-only SMS transport: the same 400 SMS_SERVICE_REQUIRED, and nothing is sent', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const engine = createMemoryEngine();
    const sms = createLogOnlySmsService();
    const manager = makeManager(engine, sms.service);

    const response = await sendOtp(manager);
    const body = await jsonBody(response);

    expect(response.status, JSON.stringify(body)).toBe(400);
    expect(body?.code).toBe('SMS_SERVICE_REQUIRED');
    expect(sms.sent).toHaveLength(0);
  });

  it('request-password-reset for a REGISTERED number still answers {status:true} — no existence oracle', async () => {
    const engine = createMemoryEngine();
    // A phone-carrying account, so the route reaches the send callback (an
    // unregistered number returns before it, and would prove nothing).
    await engine.insert('sys_user', {
      id: 'usr_phone_reset',
      email: 'u-phone-reset@placeholder.invalid',
      name: 'Phone Reset Subject',
      phone_number: PHONE,
      phone_number_verified: true,
    });
    const manager = makeManager(engine);
    // Pass-through spy: proves the route REACHED the refusing send for this
    // registered number, rather than returning early as it does for an
    // unregistered one.
    const deliver = vi.spyOn(manager as any, 'deliverPhoneOtp');

    const response = await manager.handleRequest(
      new Request(`${AUTH}/phone-number/request-password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ phoneNumber: PHONE }),
      }),
    );

    // better-auth runs this send through `runInBackgroundOrAwait`, which logs a
    // throw and answers success — so the refusal cannot leak, by status or
    // body, whether the number belongs to an account.
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(deliver).toHaveBeenCalledTimes(1);
    await expect(deliver.mock.results[0]?.value).rejects.toMatchObject({
      statusCode: 400,
      body: { code: 'SMS_SERVICE_REQUIRED' },
    });
  });

  it('outside production a log-only transport still delivers (the refusal is production-only for it)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const engine = createMemoryEngine();
    const sms = createLogOnlySmsService();
    const manager = makeManager(engine, sms.service);

    const response = await sendOtp(manager);

    expect(response.status, await response.clone().text()).toBe(200);
    expect(sms.sent).toHaveLength(1);
  });
});
