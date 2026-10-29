// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/email/send` — the send door's three bounds (`email-routes.ts`
 * header, "Who may send, and as whom"): the capability, the `sentBy`
 * attribution, and the configured sender.
 *
 * Driven through the real `HonoHttpServer` transport the CLI mounts, so every
 * status, envelope and parsed body below is the wire's, not a mock's. The
 * identity is stubbed at `resolveExecCtx` (the one resolution the door reads),
 * and the mail service is a contract-typed double that records what reached
 * `send` — so each refusal case also proves the service was NEVER called, and
 * each admission case proves what it was called WITH.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import type { EmailAddress, IEmailService, SendEmailInput } from '@objectstack/spec/contracts';
import { RestServer } from './rest-server';
import { EMAIL_SEND_CAPABILITY } from './email-routes';

const CONFIGURED: EmailAddress = { name: 'Acme Mail', address: 'no-reply@acme.example' };
const ADMIN = { userId: 'usr_admin', systemPermissions: ['setup.access', EMAIL_SEND_CAPABILITY] };
const MEMBER = { userId: 'usr_member', systemPermissions: ['setup.access'] };
const MESSAGE = { to: 'someone@example.org', subject: 'Hello', text: 'body' };

interface Boot {
  /** `undefined` ⇒ the deployment wires no email provider at all. */
  service?: Partial<IEmailService> | null;
  ctx: Record<string, unknown> | undefined;
}

function emailDouble(defaultFrom: EmailAddress | undefined = CONFIGURED, withAccessor = true) {
  const send = vi.fn(async (_input: SendEmailInput) => ({ id: 'eml_1', status: 'sent' as const, messageId: 'm1' }));
  const service: Partial<IEmailService> = {
    send,
    ...(withAccessor ? { getDefaultFrom: () => defaultFrom } : {}),
  };
  return { service, send };
}

function boot({ service, ctx }: Boot) {
  const server = new HonoHttpServer(0);
  const provider = vi.fn(async () => service ?? undefined);
  const rest = new RestServer(
    server as any,
    {} as any,
    { api: { requireAuth: false } } as any,
    undefined, // kernelManager
    undefined, // envRegistry
    undefined, // defaultEnvironmentIdProvider
    undefined, // authServiceProvider
    undefined, // objectQLProvider
    service === undefined ? undefined : provider, // emailServiceProvider
  );
  (rest as any).resolveExecCtx = async () => ctx;
  rest.registerRoutes();
  server.installNotFoundSeam();
  const post = async (body: unknown) => {
    const res: Response = await server.getRawApp().fetch(new Request('http://local/api/v1/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: (await res.json()) as any };
  };
  return { post, provider };
}

describe('POST /api/v1/email/send — the capability', () => {
  it('a caller holding the capability sends: 200, and the service receives the message stamped with the caller', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post(MESSAGE);

    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'sent', id: 'eml_1' });
    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0][0];
    expect(input).toMatchObject(MESSAGE);
    expect(input.sentBy).toBe(ADMIN.userId);
    // No caller `from` ⇒ none forwarded: the service applies its own sender.
    expect('from' in input).toBe(false);
  });

  it('an authenticated caller without the capability is refused 403 PERMISSION_DENIED, and nothing is sent', async () => {
    const { service, send } = emailDouble();
    const { post, provider } = boot({ service, ctx: MEMBER });
    const out = await post(MESSAGE);

    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('PERMISSION_DENIED');
    expect(out.body.error.message).toContain(EMAIL_SEND_CAPABILITY);
    expect(send).not.toHaveBeenCalled();
    // Refused before the provider lookup: the answer reveals nothing about the wiring.
    expect(provider).not.toHaveBeenCalled();
  });

  it('a context with no capability set at all is refused the same way', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: { userId: 'usr_bare' } });
    const out = await post(MESSAGE);

    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('PERMISSION_DENIED');
    expect(send).not.toHaveBeenCalled();
  });

  it('the capability is judged before the provider: no provider wired ⇒ 403 for the unentitled, 501 for the entitled', async () => {
    const member = boot({ service: null, ctx: MEMBER });
    const refused = await member.post(MESSAGE);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('PERMISSION_DENIED');

    const admin = boot({ service: null, ctx: ADMIN });
    const unwired = await admin.post(MESSAGE);
    expect(unwired.status).toBe(501);
    expect(unwired.body.code).toBe('NOT_IMPLEMENTED');
  });

  it('anonymous is still refused 401 at the auth floor, ahead of the capability', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: undefined });
    const out = await post(MESSAGE);

    expect(out.status).toBe(401);
    expect(out.body.error.code).toBe('UNAUTHENTICATED');
    expect(send).not.toHaveBeenCalled();
  });

  it('a non-object body from an entitled caller is still 400 INVALID_REQUEST', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post('not an object');

    expect(out.status).toBe(400);
    expect(out.body.code).toBe('INVALID_REQUEST');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/email/send — `sentBy` is the authenticated caller', () => {
  it('a body naming another user as `sentBy` is refused 403, and nothing is sent', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post({ ...MESSAGE, sentBy: 'usr_someone_else' });

    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('PERMISSION_DENIED');
    expect(out.body.error.message).toContain('sentBy');
    expect(send).not.toHaveBeenCalled();
  });

  it('a body naming the caller itself as `sentBy` is admitted, stamped with the caller', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post({ ...MESSAGE, sentBy: ADMIN.userId });

    expect(out.status).toBe(200);
    expect(send.mock.calls[0][0].sentBy).toBe(ADMIN.userId);
  });
});

describe('POST /api/v1/email/send — the sender is the configured sender', () => {
  it('a `from` naming another address is refused 403, and nothing is sent', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post({ ...MESSAGE, from: 'someone-else@other.example' });

    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('PERMISSION_DENIED');
    expect(out.body.error.message).toContain('from');
    expect(send).not.toHaveBeenCalled();
  });

  it('a `from` restating the configured address is admitted, and the CONFIGURED value is what is forwarded', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    // Different case, a caller-chosen display name: the address matches, the
    // caller's text does not travel.
    const out = await post({ ...MESSAGE, from: 'Someone Else <No-Reply@Acme.Example>' });

    expect(out.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].from).toEqual(CONFIGURED);
  });

  it('the object form is judged by its address the same way', async () => {
    const admitted = emailDouble();
    const ok = await boot({ service: admitted.service, ctx: ADMIN })
      .post({ ...MESSAGE, from: { name: 'x', address: 'no-reply@acme.example' } });
    expect(ok.status).toBe(200);
    expect(admitted.send.mock.calls[0][0].from).toEqual(CONFIGURED);

    const refused = emailDouble();
    const no = await boot({ service: refused.service, ctx: ADMIN })
      .post({ ...MESSAGE, from: { name: 'Acme Mail', address: 'other@acme.example' } });
    expect(no.status).toBe(403);
    expect(refused.send).not.toHaveBeenCalled();
  });

  it('with no configured sender, a caller `from` is refused — unknown is not permission', async () => {
    const { service, send } = emailDouble(undefined);
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post({ ...MESSAGE, from: 'no-reply@acme.example' });

    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('PERMISSION_DENIED');
    expect(send).not.toHaveBeenCalled();
  });

  it('a service that cannot report its sender refuses a caller `from` — and still sends without one', async () => {
    const blind = emailDouble(CONFIGURED, false);
    const refused = await boot({ service: blind.service, ctx: ADMIN })
      .post({ ...MESSAGE, from: 'no-reply@acme.example' });
    expect(refused.status).toBe(403);
    expect(blind.send).not.toHaveBeenCalled();

    const admitted = await boot({ service: blind.service, ctx: ADMIN }).post(MESSAGE);
    expect(admitted.status).toBe(200);
    expect(blind.send).toHaveBeenCalledTimes(1);
  });

  it.each(['From', 'sender', 'Return-Path'])('a custom `%s` header is refused 403, and nothing is sent', async (name) => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post({ ...MESSAGE, headers: { [name]: 'someone-else@other.example' } });

    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('PERMISSION_DENIED');
    expect(send).not.toHaveBeenCalled();
  });

  it('other custom headers pass through untouched', async () => {
    const { service, send } = emailDouble();
    const { post } = boot({ service, ctx: ADMIN });
    const out = await post({ ...MESSAGE, headers: { 'X-Campaign': 'q4' } });

    expect(out.status).toBe(200);
    expect(send.mock.calls[0][0].headers).toEqual({ 'X-Campaign': 'q4' });
  });
});
