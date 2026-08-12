// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7735 — the two ledgered user-lifecycle routes, driven on the wire.
 *
 * `auth-route-ledger.ts` booked `POST /change-email` and `POST /delete-user` as
 * live SDK surface. Both were dead: better-auth ships `user.changeEmail` and
 * `user.deleteUser` OFF, and `plugin-auth` configured neither, so the first
 * answered 400 `CHANGE_EMAIL_DISABLED` and the second 404 — on every deployment,
 * with no switch to flip. Every existing guard stayed green throughout, because
 * better-auth REGISTERS both endpoints unconditionally: the paths resolve, the
 * enumeration finds them, and only the request itself can tell you the
 * capability behind them is off.
 *
 * The maintainer ruling of 2026-08-12 resolves the two rows in OPPOSITE
 * directions, and that is the point — the ledger's job is to state what is
 * mounted, so one row becomes true by wiring the capability and the other by
 * withdrawing the claim:
 *
 *   - `user.changeEmail` is configured ON, with better-auth's conventional
 *     verification flow (「变更需确认,策略按 better-auth 常规」);
 *   - `user.deleteUser` stays OFF and the row is de-booked to `disabled` —
 *     self-service account deletion in a B2B tenancy needs a deliberate design,
 *     not a QA card.
 *
 * So this file asserts BEHAVIOUR, at the same seam a caller uses: real
 * `AuthManager.handleRequest` over a real better-auth pipeline, against a real
 * session minted by a real sign-up. `auth-route-ledger.conformance.test.ts`
 * holds the other half — that the ledger's disposition agrees with the switch
 * the runtime reads — and the two together are what make the ledger checkable
 * rather than merely reviewed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import type { IEmailService, SendEmailResult, SendTemplateInput } from '@objectstack/spec/contracts';
import { AuthManager } from './auth-manager';

// ───────────────────────────────────────────────────────────────────────────
// Harness
// ───────────────────────────────────────────────────────────────────────────

interface MemoryRow { id: string; [column: string]: unknown }
/**
 * The index signature is load-bearing, not decoration: it is what makes this
 * type assignable to `EngineDeleteDispatchInput` / `EngineUpdateDispatchInput`,
 * so the dispatch predicates below are called with a REAL type rather than
 * through an `as any` the query-options rule (#4918) exists to refuse.
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
 * In-memory `IDataEngine`, the same shape the #4785 session-of-record harness
 * uses — with both destructive verbs pinned to ObjectQL's OWN dispatch
 * predicates (`assertEngineUpdateDispatch` / `assertEngineDeleteDispatch`)
 * rather than a hand-written approximation, so this double cannot accept a call
 * the real engine refuses (`pnpm check:engine-double-contract`, #4550/#5480).
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
      const actual = row[key];
      if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
        const operators = expected as Record<string, unknown>;
        if ('$ne' in operators) return !eq(actual, operators.$ne);
        if ('$in' in operators) return (operators.$in as unknown[]).some((v) => eq(actual, v));
      }
      return eq(actual, expected);
    });
  /** `fields` really projects — `id` always survives, as it does in ObjectQL. */
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
      const row = rows(name).find((r) => matches(r, query.where));
      return row ? project(row, query.fields) : null;
    },
    async find(name: string, query: MemoryQuery = {}): Promise<MemoryRow[]> {
      let out = rows(name).filter((r) => matches(r, query.where));
      if (query.offset) out = out.slice(query.offset);
      if (query.limit) out = out.slice(0, query.limit);
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

/** Recording email transport — every `sendTemplate` call, in order. */
function createRecordingEmailService() {
  const sent: SendTemplateInput[] = [];
  const service: IEmailService = {
    async send(): Promise<SendEmailResult> {
      return { id: 'email_send', status: 'sent' };
    },
    async sendTemplate(input: SendTemplateInput): Promise<SendEmailResult> {
      sent.push(input);
      return { id: `email_${sent.length}`, status: 'sent' };
    },
  };
  return { service, sent };
}

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-7735';
const ORIGIN = 'http://localhost:3000';
const AUTH = `${ORIGIN}/api/v1/auth`;

function makeManager(engine: MemoryEngine, emailService?: IEmailService): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    ...(emailService ? { emailService } : {}),
  } as never);
}

const signUp = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Change Email Subject' }),
    }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const post = (manager: AuthManager, path: string, cookie: string, body: unknown) =>
  manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );

const userRows = (engine: MemoryEngine): MemoryRow[] => engine.tables.get('sys_user') ?? [];

/** The body of a better-auth error response, tolerant of a non-JSON body. */
const errorBody = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text();
  try {
    return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('#7735 — POST /change-email is wired, and confirmed by email', () => {
  it('accepts the change, mails the NEW address, and changes nothing until the link is followed', async () => {
    const engine = createMemoryEngine();
    const email = createRecordingEmailService();
    const manager = makeManager(engine, email.service);

    const cookie = cookieFrom(await signUp(manager, 'before@example.com'));
    expect(cookie, 'sign-up must mint a session cookie').not.toBe('');
    email.sent.length = 0; // drop anything sign-up itself sent

    const response = await post(manager, '/change-email', cookie, {
      newEmail: 'after@example.com',
      callbackURL: '/',
    });

    // The defect was a 400 with `code: 'CHANGE_EMAIL_DISABLED'` here. Assert the
    // success envelope rather than `status !== 400`, so a DIFFERENT 400 (a
    // missing email transport, say) cannot read as the capability being on.
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ status: true });

    // Confirmation goes to the NEW address, through the same verification
    // callback sign-up uses — better-auth's single-step default, which is the
    // 「策略按 better-auth 常规」 the ruling names.
    expect(email.sent).toHaveLength(1);
    const [confirmation] = email.sent;
    expect(confirmation.template).toBe('auth.verify_email');
    expect(confirmation.to).toMatchObject({ address: 'after@example.com' });

    // …and NOTHING has changed yet. A request nobody confirms must not move the
    // identity: this assertion is what separates "verified change" from
    // "change, then send a notice about it".
    expect(userRows(engine).map((r) => r.email)).toEqual(['before@example.com']);
  });

  it('applies the change when the emailed link is followed, and marks the new address verified', async () => {
    const engine = createMemoryEngine();
    const email = createRecordingEmailService();
    const manager = makeManager(engine, email.service);

    const cookie = cookieFrom(await signUp(manager, 'old@example.com'));
    email.sent.length = 0;
    // The address is unverified at this point, so the transition below is a
    // real one. (`email_verified` is 0/1 rather than false/true because the
    // ObjectQL adapter declares `supportsBooleans: false` — better-auth encodes
    // before the engine sees it, so assert the value's TRUTH, not its spelling.)
    expect(userRows(engine)[0]!.email_verified).toBeFalsy();

    await post(manager, '/change-email', cookie, { newEmail: 'new@example.com' });

    const lastSent = email.sent[email.sent.length - 1];
    const verificationUrl = (lastSent?.data as { verificationUrl?: string } | undefined)?.verificationUrl;
    expect(typeof verificationUrl, 'the change-email mail must carry a verification link').toBe('string');

    const applied = await manager.handleRequest(new Request(verificationUrl!, { headers: { cookie } }));
    expect([200, 302]).toContain(applied.status);

    const user = userRows(engine)[0]!;
    expect(user.email).toBe('new@example.com');
    expect(user.email_verified).toBeTruthy();
  });

  it('without an email transport it refuses for the HONEST reason, not CHANGE_EMAIL_DISABLED', async () => {
    // A deployment with no mailbox cannot run a verified change — better-auth
    // says so in as many words. The distinction matters: "this deployment has
    // no email transport" is a fixable configuration statement, where
    // CHANGE_EMAIL_DISABLED said the platform does not offer the capability at
    // all, which is the sentence #7735 was filed about.
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    const cookie = cookieFrom(await signUp(manager, 'nomail@example.com'));
    const response = await post(manager, '/change-email', cookie, { newEmail: 'elsewhere@example.com' });

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(JSON.stringify(body)).not.toContain('CHANGE_EMAIL_DISABLED');
    expect(String(body.message ?? '')).toMatch(/verification email isn't enabled/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#7735 — POST /delete-user stays unwired, and the ledger says so', () => {
  it('refuses an authenticated self-delete with 404 NOT_FOUND, deleting nothing', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, createRecordingEmailService().service);

    // TWO accounts, and the SECOND one asks to be deleted. With only one, the
    // platform's break-glass guard (auth-manager.ts `before` hook: never remove
    // the last local-password login) refuses first with 409 CONFLICT, and the
    // request never reaches better-auth's disabled check — a green 409 would
    // say nothing about whether `user.deleteUser` is wired. Measured on this
    // very test: it read 409 until the second account existed.
    await signUp(manager, 'keeper@example.com');
    const cookie = cookieFrom(await signUp(manager, 'leaver@example.com'));
    expect(userRows(engine)).toHaveLength(2);

    // Rejection-class, and the discriminator has to be built rather than
    // asserted: better-auth's DISABLED branch here is
    // `APIError.fromStatus('NOT_FOUND')`, which carries **no body at all** — no
    // `code`, no message — so a lone `expect(404)` could equally be a route
    // that does not exist. The anonymous call is what separates them: the path
    // IS mounted and IS authenticated, so 401-without-a-session next to
    // 404-with-one can only be the capability switch.
    const anonymous = await manager.handleRequest(
      new Request(`${AUTH}/delete-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({}),
      }),
    );
    expect(anonymous.status, 'the route is mounted and session-guarded').toBe(401);

    const response = await post(manager, '/delete-user', cookie, { password: PASSWORD });
    expect(response.status).toBe(404);
    // Pinned as it really is, not as the envelope convention would like it:
    // an upstream version that starts sending a code here should surface as a
    // diff someone reads. Its `/delete-user/callback` half DOES carry
    // `code: NOT_FOUND` — asserted in the next test.
    expect(await errorBody(response)).toEqual({});

    // The half that matters: the account is still there.
    expect(userRows(engine).map((r) => r.email)).toEqual(['keeper@example.com', 'leaver@example.com']);
  });

  it('refuses the /delete-user/callback half too — a token cannot route around the switch', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, createRecordingEmailService().service);

    const cookie = cookieFrom(await signUp(manager, 'callback@example.com'));
    const response = await manager.handleRequest(
      new Request(`${AUTH}/delete-user/callback?token=whatever`, { headers: { cookie, origin: ORIGIN } }),
    );

    expect(response.status).toBe(404);
    expect(JSON.stringify(await errorBody(response))).toContain('NOT_FOUND');
    expect(userRows(engine).map((r) => r.email)).toEqual(['callback@example.com']);
  });
});
