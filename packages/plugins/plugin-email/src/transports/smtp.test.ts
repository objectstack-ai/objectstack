// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// SmtpTransport — option mapping, lazy loading and loud failure (#5087).
// nodemailer is mocked here so the assertions are about what WE hand it; the
// real library (and the real wire bytes) are exercised in smtp.wire.test.ts.

import net from 'node:net';
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  SmtpTransport,
  smtpOptionsFromMailSettings,
  SMTP_CONNECT_POLICY_REFUSED_TRANSPORT_OPTIONS,
  SMTP_CONNECT_POLICY_NO_SOCKET,
  type SmtpConnectPolicy,
} from './smtp.js';
import { formatInvalidSmtpPortNotice } from './smtp-port-contract.js';
import { makeTransport } from './index.js';
import { normalizeMessage } from '../email-service.js';

const nm = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: nm.createTransport },
  createTransport: nm.createTransport,
}));

const MSG = {
  to: ['rcpt@example.test'],
  from: 'ObjectStack <no-reply@example.test>',
  subject: 'Hi',
  text: 'hello',
};

beforeEach(() => {
  nm.createTransport.mockReset();
  nm.sendMail.mockReset();
  nm.createTransport.mockImplementation(() => ({ sendMail: nm.sendMail, close: nm.close }));
  nm.sendMail.mockResolvedValue({ messageId: '<abc@smtp>', response: '250 2.0.0 Ok: queued' });
});

describe('SmtpTransport — construction', () => {
  it('refuses to exist without a host (never a silent no-op transport)', () => {
    expect(() => new SmtpTransport({ host: '' })).toThrow(/host is required/);
    expect(() => new SmtpTransport({ host: '   ' })).toThrow(/host is required/);
    expect(() => new SmtpTransport({} as never)).toThrow(/host is required/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => new SmtpTransport({ host: 'smtp.x', port: 0 })).toThrow(/invalid port/);
    expect(() => new SmtpTransport({ host: 'smtp.x', port: 99999 })).toThrow(/invalid port/);
  });

  it('does NOT load nodemailer until the first send', async () => {
    const t = new SmtpTransport({ host: 'smtp.x' });
    expect(nm.createTransport).not.toHaveBeenCalled();
    await t.send(MSG);
    expect(nm.createTransport).toHaveBeenCalledTimes(1);
    // ...and reuses the transporter afterwards.
    await t.send(MSG);
    expect(nm.createTransport).toHaveBeenCalledTimes(1);
  });
});

describe('SmtpTransport — TLS / auth option mapping', () => {
  it('defaults to :587 with a REQUIRED STARTTLS upgrade', async () => {
    await new SmtpTransport({ host: 'smtp.example.com' }).send(MSG);
    expect(nm.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
    }));
  });

  it('uses implicit TLS (SMTPS) on :465', async () => {
    await new SmtpTransport({ host: 'smtp.exmail.qq.com', port: 465 }).send(MSG);
    expect(nm.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 465,
      secure: true,
      requireTLS: false,
    }));
  });

  it('secure=false connects in the clear (opportunistic STARTTLS only)', async () => {
    await new SmtpTransport({ host: 'smtp.x', port: 25, secure: false }).send(MSG);
    expect(nm.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 25,
      secure: false,
      requireTLS: false,
    }));
  });

  it('sends auth only when a user is configured', async () => {
    await new SmtpTransport({ host: 'smtp.x' }).send(MSG);
    expect(nm.createTransport.mock.calls[0][0]).not.toHaveProperty('auth');

    nm.createTransport.mockClear();
    await new SmtpTransport({ host: 'smtp.x', user: 'u@x', password: 'p' }).send(MSG);
    expect(nm.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      auth: { user: 'u@x', pass: 'p' },
    }));
  });

  it('lets transportOptions override the derived options (escape hatch)', async () => {
    await new SmtpTransport({
      host: 'smtp.x',
      port: 2525,
      transportOptions: { secure: true, pool: true },
    }).send(MSG);
    expect(nm.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 2525,
      secure: true,
      pool: true,
    }));
  });

  it('describe() reports the connection without the password', () => {
    const d = new SmtpTransport({ host: 'smtp.x', user: 'u@x', password: 'sekrit' }).describe();
    expect(d).toMatchObject({
      host: 'smtp.x', port: 587, auth: { user: 'u@x' }, disableFileAccess: true, disableUrlAccess: true,
    });
    expect(JSON.stringify(d)).not.toContain('sekrit');
  });
});

describe('SmtpTransport — send', () => {
  it('maps every NormalizedEmailMessage field onto the nodemailer envelope', async () => {
    await new SmtpTransport({ host: 'smtp.x' }).send({
      to: ['a@x.test', 'b@x.test'],
      from: 'From <f@x.test>',
      cc: ['c@x.test'],
      bcc: ['d@x.test'],
      replyTo: 'r@x.test',
      subject: 'S',
      text: 'T',
      html: '<p>H</p>',
      headers: { 'X-Trace': '42' },
      attachments: [{ filename: 'a.txt', content: 'body', contentType: 'text/plain', cid: 'cid1' }],
    });
    expect(nm.sendMail).toHaveBeenCalledWith({
      from: 'From <f@x.test>',
      to: ['a@x.test', 'b@x.test'],
      cc: ['c@x.test'],
      bcc: ['d@x.test'],
      replyTo: 'r@x.test',
      subject: 'S',
      text: 'T',
      html: '<p>H</p>',
      headers: [{ key: 'X-Trace', value: '42' }],
      attachments: [{ filename: 'a.txt', content: 'body', contentType: 'text/plain', cid: 'cid1' }],
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it('hands nodemailer the headers map as an explicit list, one name/value entry per key, in order', async () => {
    await new SmtpTransport({ host: 'smtp.x' }).send({
      ...MSG,
      headers: { 'X-Trace': '42', 'X-Campaign': 'q4' },
    });
    expect(nm.sendMail.mock.calls[0][0].headers).toEqual([
      { key: 'X-Trace', value: '42' },
      { key: 'X-Campaign', value: 'q4' },
    ]);
  });

  it('surfaces the SMTP server error verbatim (authentication failure is LOUD)', async () => {
    nm.sendMail.mockRejectedValueOnce(
      new Error('Invalid login: 535 Error: authentication failed'),
    );
    await expect(new SmtpTransport({ host: 'smtp.x' }).send(MSG))
      .rejects.toThrow(/535 Error: authentication failed/);
  });

  it('does not cache a failed transporter construction', async () => {
    nm.createTransport.mockImplementationOnce(() => { throw new Error('bad config'); });
    const t = new SmtpTransport({ host: 'smtp.x' });
    await expect(t.send(MSG)).rejects.toThrow(/bad config/);
    // A settings fix must take effect on the next send, not stick to the error.
    await expect(t.send(MSG)).resolves.toMatchObject({ messageId: '<abc@smtp>' });
  });

  it('rejects a send the server accepted without a Message-ID', async () => {
    nm.sendMail.mockResolvedValueOnce({ response: '250 ok' });
    await expect(new SmtpTransport({ host: 'smtp.x' }).send(MSG))
      .rejects.toThrow(/no Message-ID/);
  });

  it('returns the transport result', async () => {
    const res = await new SmtpTransport({ host: 'smtp.x' }).send(MSG);
    expect(res).toEqual({ messageId: '<abc@smtp>', response: '250 2.0.0 Ok: queued' });
  });
});

describe('makeTransport(provider="smtp")', () => {
  it('builds an SmtpTransport from providerOptions', () => {
    const t = makeTransport({ provider: 'smtp', options: { host: 'smtp.x', port: 465 } });
    expect(t).toBeInstanceOf(SmtpTransport);
  });

  it('throws instead of degrading to LogTransport when the host is missing', () => {
    expect(() => makeTransport({ provider: 'smtp', options: {} }))
      .toThrow(/requires a host/);
    expect(() => makeTransport({ provider: 'smtp' })).toThrow(/requires a host/);
  });
});

describe('smtpOptionsFromMailSettings', () => {
  it('maps the mail namespace keys onto the transport options', () => {
    expect(smtpOptionsFromMailSettings({
      smtp_host: 'smtp.163.com',
      smtp_port: 465,
      smtp_secure: true,
      smtp_user: 'ops@163.com',
      smtp_password: 'pw',
      provider: 'smtp',
      from_email: 'ops@163.com',
    })).toEqual({
      host: 'smtp.163.com',
      port: 465,
      secure: true,
      user: 'ops@163.com',
      password: 'pw',
    });
  });

  it('coerces the string forms that arrive through the OS_MAIL_* env door', () => {
    expect(smtpOptionsFromMailSettings({ smtp_host: ' smtp.x ', smtp_port: '2525', smtp_secure: 'false' }))
      .toEqual({ host: 'smtp.x', port: 2525, secure: false });
    expect(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_secure: '0' }).secure).toBe(false);
    expect(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_secure: 'true' }).secure).toBe(true);
  });

  it('reports an unset host as empty rather than inventing one', () => {
    expect(smtpOptionsFromMailSettings({}).host).toBe('');
    expect(smtpOptionsFromMailSettings({ smtp_host: '   ' }).host).toBe('');
    expect(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x' })).toEqual({ host: 'smtp.x' });
  });

  // Commit 56c5b1dbe — `absent` vs `present but unreadable`, which this function used to
  // collapse into one bucket. A port that could not be read was DELETED here,
  // and `SmtpTransport` then applied its built-in 587: a configured `abc`
  // became a working-looking connection nobody chose, and `describe()`
  // reported 587 as though it had been selected. The refusal already exists
  // one layer down; this function's only job is to stop hiding the value from
  // it, so these three buckets are pinned TOGETHER — pinning the refusal
  // alone would leave the two fall-back buckets free to drift into it, and
  // turning `smtp_port: ''` into a refusal breaks working deployments.
  describe('absent vs present-but-unreadable (#13190)', () => {
    it('omits `port` when the setting is ABSENT — 587 remains a legitimate default', () => {
      const opts = smtpOptionsFromMailSettings({ smtp_host: 'smtp.x' });
      expect(opts).not.toHaveProperty('port');
      expect(new SmtpTransport(opts).describe().port).toBe(587);
    });

    it("keeps `smtp_port: ''` in the absent bucket — an empty field means 'not set'", () => {
      const opts = smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: '' });
      expect(opts).not.toHaveProperty('port');
      expect(new SmtpTransport(opts).describe().port).toBe(587);
    });

    it('passes a present-but-unreadable port through so the guard refuses it by name', () => {
      const opts = smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: 'abc' });
      // The key must SURVIVE the mapping — dropping it is the defect, and a
      // transport built from these options is the thing that must not exist.
      expect(opts).toHaveProperty('port');
      expect(Number.isNaN(opts.port as number)).toBe(true);
      // Asserted through the contract module's own generator (#12993), never a
      // re-spelled `(expected 1-65535)`: a bare `.toThrow()` here would also
      // pass on the unrelated `host is required` refusal two lines above it.
      expect(() => new SmtpTransport(opts)).toThrow(formatInvalidSmtpPortNotice(NaN));
    });

    it('refuses every unreadable form, and still maps every readable one', () => {
      for (const unreadable of ['abc', 'Infinity', '12x', {}, []] as unknown[]) {
        const opts = smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: unreadable });
        expect(() => new SmtpTransport(opts), `smtp_port=${JSON.stringify(unreadable)}`).toThrow(
          /SmtpTransport: invalid port/,
        );
      }
      // Unchanged in both directions: a readable in-range port still arrives,
      // and a readable out-of-range one was already refused before this fix.
      expect(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: '465' }).port).toBe(465);
      expect(new SmtpTransport(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: 465 }))
        .describe().port).toBe(465);
      expect(() => new SmtpTransport(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: '99999' })))
        .toThrow(formatInvalidSmtpPortNotice(99999));
    });

    it('refuses a READABLE but FRACTIONAL port by name, without a second door (#13189)', () => {
      // The bucket commit 56c5b1dbe never had to name, because the guard below it
      // admitted the value: `'587.5'` is present, readable, finite and inside
      // `1-65535`, so it mapped straight through and died at SEND time under
      // `RangeError: Port should be >= 0 and < 65536` — a TCP rule, naming no
      // part of Settings → Mail → Port. Commit 33fbd3566 made the guard test
      // integrality, so it is refused at construction now, in this
      // transport's own sentence, carrying what the operator actually typed.
      const opts = smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: '587.5' });

      // ⛔ The mapping still PASSES IT THROUGH. Commit 56c5b1dbe's rule is that this
      // function hides nothing from the guard and adds no parallel refusal of
      // its own; commit 33fbd3566 changed which numbers the guard refuses, not where
      // the refusal lives. A repair that started rejecting here instead would
      // pass the next line and quietly rebuild the second door.
      expect(opts, 'the mapping dropped the key instead of passing it down')
        .toHaveProperty('port');
      expect(opts.port).toBe(587.5);

      expect(() => new SmtpTransport(opts)).toThrow(formatInvalidSmtpPortNotice(587.5));
    });

    it('leaves the three buckets #13190 pinned exactly where they were (#13189)', () => {
      // Narrowing WHICH numbers the guard accepts must not move a value out
      // of the fall-back buckets — that is the interaction between the two
      // cards, and getting it wrong breaks working deployments rather than
      // fixing anything. Absent and `''` still mean "not set"; unreadable is
      // still refused; a readable in-range INTEGER still maps.
      expect(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x' })).not.toHaveProperty('port');
      expect(new SmtpTransport(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x' }))
        .describe().port).toBe(587);

      expect(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: '' }))
        .not.toHaveProperty('port');
      expect(new SmtpTransport(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: '' }))
        .describe().port).toBe(587);

      expect(() => new SmtpTransport(
        smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: 'abc' }),
      )).toThrow(formatInvalidSmtpPortNotice(NaN));

      expect(new SmtpTransport(smtpOptionsFromMailSettings({ smtp_host: 'smtp.x', smtp_port: '2525' }))
        .describe().port).toBe(2525);

      // ⭐ And the default this all falls back to is itself an integer, so
      // the narrowing cannot have made the out-of-the-box state refuse
      // itself — the one way a change like this bricks every deployment at
      // once, asserted rather than assumed.
      expect(Number.isInteger(
        new SmtpTransport({ host: 'smtp.x' }).describe().port,
      ), 'the built-in default port is not an integer').toBe(true);
    });
  });
});

// ── A host's connect policy ─────────────────────────────────────────────────
//
// The rule: a host can decide where every SMTP transport may connect. The
// policy is nodemailer's `getSocket`, applied after `transportOptions`, and a
// `transportOptions` key that would take the connection out of its hands is
// refused at construction while a policy is set. Without a policy, the options
// handed to nodemailer are exactly what they were before the policy existed.

describe('SmtpTransport — a host connect policy', () => {
  // The host's own relay: an admitting policy opens a real socket to it and hands it back.
  let relay: net.Server;
  let relayPort = 0;
  beforeAll(async () => {
    relay = net.createServer((s) => s.on('error', () => {}));
    await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
    relayPort = (relay.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  });

  /** A policy that records what it was asked; it refuses with `answer`, else admits with a socket it opened. */
  function policy(answer: Error | null = null) {
    const seen: Array<{ host?: string; port?: number }> = [];
    const connect: SmtpConnectPolicy = {
      getSocket(request, callback) {
        seen.push({ host: request.host, port: request.port });
        if (answer) return callback(answer);
        const socket = net.connect(relayPort, '127.0.0.1');
        const onError = (err: Error) => callback(err);
        socket.once('error', onError);
        socket.once('connect', () => {
          socket.removeListener('error', onError);
          callback(null, { connection: socket });
        });
      },
    };
    return { connect, seen };
  }

  /** Call the `getSocket` nodemailer was handed, the way nodemailer does before it connects. */
  function dial(options: Record<string, unknown>): Promise<Error | 'admitted' | 'no hook'> {
    const getSocket = options.getSocket;
    if (typeof getSocket !== 'function') return Promise.resolve('no hook');
    return new Promise((resolve) => getSocket({ ...options }, (err: Error | null, answer?: { connection?: net.Socket }) => {
      answer?.connection?.destroy();
      resolve(err ?? 'admitted');
    }));
  }

  const NO_POLICY_OPTIONS = {
    host: 'smtp.x',
    port: 587,
    secure: false,
    requireTLS: true,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 20_000,
    // Always on, policy or not: the transport reads no file and fetches no URL for a message.
    disableFileAccess: true,
    disableUrlAccess: true,
  };

  it('CONTROL: without a policy, nodemailer receives exactly the options it always did', async () => {
    await new SmtpTransport({ host: 'smtp.x' }).send(MSG);
    expect(nm.createTransport.mock.calls[0][0]).toStrictEqual(NO_POLICY_OPTIONS);
    expect(new SmtpTransport({ host: 'smtp.x' }).describe()).not.toHaveProperty('getSocket');
  });

  it('hands the policy to nodemailer, and it is asked with the configured host and port', async () => {
    const { connect, seen } = policy();
    await new SmtpTransport({ host: 'smtp.x', port: 2525, connect }).send(MSG);
    const options = nm.createTransport.mock.calls[0][0];
    expect(await dial(options)).toBe('admitted');
    expect(seen).toEqual([{ host: 'smtp.x', port: 2525 }]);
  });

  it('a getSocket in transportOptions cannot replace the policy', async () => {
    const { connect, seen } = policy();
    const other = vi.fn((_o: unknown, cb: (e: Error | null) => void) => cb(null));
    await new SmtpTransport({ host: 'smtp.x', connect, transportOptions: { getSocket: other, pool: true } }).send(MSG);
    const options = nm.createTransport.mock.calls[0][0];
    expect(options.pool).toBe(true);
    await dial(options);
    expect(other).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
  });

  it('a refusal is the error the policy wrote', async () => {
    const { connect } = policy(new Error('the host does not allow this destination'));
    await new SmtpTransport({ host: 'smtp.x', connect }).send(MSG);
    const answer = await dial(nm.createTransport.mock.calls[0][0]);
    expect(answer).toBeInstanceOf(Error);
    expect((answer as Error).message).toBe('the host does not allow this destination');
  });

  it.each([
    ['implicit TLS', { port: 465 }],
    ['required STARTTLS', { port: 587 }],
    ['opportunistic STARTTLS', { port: 25, secure: false }],
  ] as const)('keeps the %s settings a transport without a policy has', (_label, shape) => {
    const { connect } = policy();
    const without = new SmtpTransport({ host: 'smtp.x', ...shape }).describe();
    const withPolicy = new SmtpTransport({ host: 'smtp.x', ...shape, connect }).describe();
    expect(withPolicy.secure).toBe(without.secure);
    expect(withPolicy.requireTLS).toBe(without.requireTLS);
    const { getSocket, ...rest } = withPolicy;
    expect(typeof getSocket).toBe('function');
    expect(rest).toStrictEqual(without);
  });

  const REFUSED: Array<[string, unknown]> = [
    ['send', () => {}],
    ['proxy', 'http://proxy.example.test:3128'],
    ['url', 'smtp://smtp.example.test:25'],
    ['sendmail', true],
    ['streamTransport', true],
    ['jsonTransport', true],
    ['SES', { sesClient: {} }],
    ['connection', {}],
    ['socket', {}],
  ];

  it('the refused key list is exactly the one the transport declares', () => {
    expect(REFUSED.map(([key]) => key)).toEqual([...SMTP_CONNECT_POLICY_REFUSED_TRANSPORT_OPTIONS]);
  });

  it.each(REFUSED)('refuses transportOptions.%s at construction while a policy is set', (key, value) => {
    const { connect } = policy();
    expect(() => new SmtpTransport({ host: 'smtp.x', connect, transportOptions: { [key]: value } }))
      .toThrow(`SmtpTransport: transportOptions.${key} cannot be used while a connect policy is set`);
    expect(nm.createTransport).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('passes transportOptions.%s through unchanged without a policy', async (key, value) => {
    await new SmtpTransport({ host: 'smtp.x', transportOptions: { [key]: value } }).send(MSG);
    expect(nm.createTransport.mock.calls[0][0]).toStrictEqual({ ...NO_POLICY_OPTIONS, [key]: value });
  });

  it('refuses an OAuth2 auth in transportOptions while a policy is set, and passes it through without one', async () => {
    const { connect } = policy();
    const auth = { type: 'OAuth2', user: 'u@x', accessUrl: 'https://token.example.test/' };
    expect(() => new SmtpTransport({ host: 'smtp.x', connect, transportOptions: { auth } }))
      .toThrow('SmtpTransport: transportOptions.auth of type OAuth2 cannot be used while a connect policy is set');
    expect(() => new SmtpTransport({ host: 'smtp.x', connect, transportOptions: { auth: { ...auth, type: 'oauth2' } } }))
      .toThrow(/auth of type OAuth2/);
    // A plain login block is not refused.
    expect(() => new SmtpTransport({ host: 'smtp.x', connect, transportOptions: { auth: { user: 'u', pass: 'p' } } }))
      .not.toThrow();

    await new SmtpTransport({ host: 'smtp.x', transportOptions: { auth } }).send(MSG);
    expect(nm.createTransport.mock.calls[0][0]).toStrictEqual({ ...NO_POLICY_OPTIONS, auth });
  });

  it.each([
    ['false', false],
    ['undefined', undefined],
    ['an object without a connection', {}],
  ] as const)('an answer without a socket (%s) fails the connection', async (_label, answer) => {
    const connect: SmtpConnectPolicy = {
      getSocket(_request, callback) { (callback as (e: Error | null, s?: unknown) => void)(null, answer); },
    };
    await new SmtpTransport({ host: 'smtp.x', connect }).send(MSG);
    const result = await dial(nm.createTransport.mock.calls[0][0]);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(SMTP_CONNECT_POLICY_NO_SOCKET);
  });

  it.each([
    ['a socket value', { socket: {} }],
    ['a socket key left undefined', { socket: undefined }],
  ] as const)('refuses transportOptions.tls carrying %s while a policy is set', async (_label, tls) => {
    const { connect } = policy();
    expect(() => new SmtpTransport({ host: 'smtp.x', connect, transportOptions: { tls } }))
      .toThrow('SmtpTransport: transportOptions.tls.socket cannot be used while a connect policy is set');
    // Other TLS settings are not refused, and without a policy tls passes through as before.
    expect(() => new SmtpTransport({ host: 'smtp.x', connect, transportOptions: { tls: { rejectUnauthorized: false } } }))
      .not.toThrow();
    await new SmtpTransport({ host: 'smtp.x', transportOptions: { tls } }).send(MSG);
    expect(nm.createTransport.mock.calls[0][0]).toStrictEqual({ ...NO_POLICY_OPTIONS, tls });
  });

  it('refuses a policy that carries no getSocket function', () => {
    expect(() => new SmtpTransport({ host: 'smtp.x', connect: {} as never }))
      .toThrow('SmtpTransport: the connect policy has no getSocket function');
  });

  it('makeTransport carries the policy to an smtp transport, and omits it when absent', async () => {
    const { connect, seen } = policy();
    const withPolicy = makeTransport({ provider: 'smtp', options: { host: 'smtp.boot.x' }, smtpConnect: connect });
    expect(await dial((withPolicy as SmtpTransport).describe())).toBe('admitted');
    expect(seen).toEqual([{ host: 'smtp.boot.x', port: 587 }]);

    const without = makeTransport({ provider: 'smtp', options: { host: 'smtp.boot.x' } }) as SmtpTransport;
    expect(without.describe()).not.toHaveProperty('getSocket');
  });
});

describe('SmtpTransport — the transport reads no file and fetches no URL on a message\'s behalf', () => {
  const OPEN = { disableFileAccess: false, disableUrlAccess: false };

  it('sets both content-access flags on the transport it builds, after transportOptions', async () => {
    await new SmtpTransport({ host: 'smtp.x', transportOptions: { ...OPEN, pool: true } }).send(MSG);
    expect(nm.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      pool: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    }));
  });

  it('sets both flags on every message it hands to sendMail', async () => {
    const t = new SmtpTransport({ host: 'smtp.x', transportOptions: OPEN });
    await t.send(MSG);
    await t.send({ ...MSG, attachments: [{ filename: 'a.txt', content: 'a' }] });
    expect(nm.sendMail).toHaveBeenCalledTimes(2);
    for (const [mail] of nm.sendMail.mock.calls) {
      expect(mail).toMatchObject({ disableFileAccess: true, disableUrlAccess: true });
    }
  });

  it('describe() shows both flags on, whatever transportOptions says', () => {
    expect(new SmtpTransport({ host: 'smtp.x' }).describe())
      .toMatchObject({ disableFileAccess: true, disableUrlAccess: true });
    expect(new SmtpTransport({ host: 'smtp.x', transportOptions: OPEN }).describe())
      .toMatchObject({ disableFileAccess: true, disableUrlAccess: true });
  });

  it('CONTROL — message fields outside the contract never reach nodemailer', async () => {
    const body = {
      to: 'rcpt@example.test',
      from: 'no-reply@example.test',
      subject: 'S',
      text: 'T',
      raw: 'RAW',
      alternatives: [{ contentType: 'text/x-other', content: 'ALT' }],
      icalEvent: { content: 'ICAL' },
      amp: '<p>AMP</p>',
      watchHtml: '<p>WATCH</p>',
      attachments: [{
        filename: 'a.txt',
        content: 'body',
        path: 'attachment-fixture/never-read.txt',
        href: 'http://127.0.0.1:9/never-fetched',
        raw: 'RAW-PART',
      }],
    };
    await new SmtpTransport({ host: 'smtp.x' }).send(normalizeMessage(body as never));

    const [mail] = nm.sendMail.mock.calls[0];
    expect(Object.keys(mail).sort()).toEqual(
      ['attachments', 'disableFileAccess', 'disableUrlAccess', 'from', 'subject', 'text', 'to'],
    );
    expect(mail.attachments).toEqual([{ filename: 'a.txt', content: 'body' }]);
  });
});
