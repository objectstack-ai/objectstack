// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// SmtpTransport — option mapping, lazy loading and loud failure (#5087).
// nodemailer is mocked here so the assertions are about what WE hand it; the
// real library (and the real wire bytes) are exercised in smtp.wire.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmtpTransport, smtpOptionsFromMailSettings } from './smtp.js';
import { formatInvalidSmtpPortNotice } from './smtp-port-contract.js';
import { makeTransport } from './index.js';

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
    expect(d).toMatchObject({ host: 'smtp.x', port: 587, auth: { user: 'u@x' } });
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
      headers: { 'X-Trace': '42' },
      attachments: [{ filename: 'a.txt', content: 'body', contentType: 'text/plain', cid: 'cid1' }],
    });
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

  // #13190 — `absent` vs `present but unreadable`, which this function used to
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
  });
});
