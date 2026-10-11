// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stack definition's door for the mail and SMS configuration the boot
 * reads: `appName`, `email` and `sms`.
 *
 * ## The accept-set delta this file measures
 *
 * Before this change all three keys were REFUSED at the top level (the door is
 * strict), while `resolveEmailCapabilityArg` / `resolveSmsCapabilityArg` read
 * `config.email`, `config.sms` and `config.appName` — so the configuration arm
 * of both readers was reachable only from a config `defineStack` did not build.
 * The delta is: the three keys are writable, carrying the NON-SECRET members the
 * readers read, and the credentials are refused BY NAME with the environment
 * variable that carries them. A stack definition is compiled into the
 * published artifact, which is why the credentials stop here. `sms` carries
 * `retries` alone: `sms.provider` is refused by name too, because a stack
 * cannot select the delivering SMS transport — the `sms` settings namespace
 * builds it from its own provider setting (`OS_SMS_PROVIDER`).
 *
 * ## Why the refusals assert the envelope and the issue, never `toThrow()`
 *
 * A bare throw assertion passes on any failure. Each refusal names the error
 * `code` + `status` (ADR-0112), the Zod issue's path and key, and the env var
 * the prescription carries — the env var is the contract here (it is what the
 * author must do instead), so it is asserted beside the code, not instead of it.
 */

import { describe, it, expect } from 'vitest';

import {
  ObjectStackDefinitionSchema,
  defineStack,
  composeStacks,
  COMPOSE_KEY_DISPOSITIONS,
  STACK_DEFINITION_KEYS,
} from './stack.zod';
import { EmailServiceConfigSchema, StackEmailConfigSchema } from './system/email-config.zod';
import { StackSmsConfigSchema } from './system/sms-config.zod';

const manifest = {
  id: 'com.example.mailer',
  name: 'mailer',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'mailer',
};

const parse = (raw: Record<string, unknown>) => ObjectStackDefinitionSchema.safeParse(raw);

/** The `unrecognized_keys` issue of a failed parse, with its path, keys and message — or undefined. */
const unrecognized = (verdict: ReturnType<typeof parse>) => {
  if (verdict.success) return undefined;
  const issue = verdict.error.issues.find((i) => i.code === 'unrecognized_keys');
  return issue
    ? { path: issue.path.map(String), keys: (issue as unknown as { keys: string[] }).keys, message: issue.message }
    : undefined;
};

/** What `defineStack` threw, or a sentinel when it did not throw. */
const refusalOf = (raw: Record<string, unknown>) => {
  try {
    defineStack(raw as Parameters<typeof defineStack>[0]);
  } catch (e) {
    return e as { code?: string; status?: number; message: string; issues?: readonly { code: string; path: PropertyKey[]; keys?: string[] }[] };
  }
  return { code: 'DID_NOT_THROW', status: 0, message: '', issues: [] };
};

// ─── GREEN — the non-secret members are writable and survive the parse ───

describe('accept — appName, email and sms carry the non-secret configuration', () => {
  it('a defineStack with email { provider, defaultFrom } builds and carries the block through', () => {
    const stack = defineStack({
      manifest,
      email: { provider: 'smtp', defaultFrom: { name: 'Acme', address: 'no-reply@acme.example' }, options: { host: 'smtp.acme.example' } },
    });
    expect(stack.email).toEqual({
      provider: 'smtp',
      defaultFrom: { name: 'Acme', address: 'no-reply@acme.example' },
      options: { host: 'smtp.acme.example' },
    });
  });

  it('carries every non-secret member the mail reader reads, and the top-level appName', () => {
    const email = {
      provider: 'postmark' as const,
      defaultFrom: { address: 'ops@acme.example' },
      retries: 2,
      persist: false,
      queueDelivery: true,
      appName: 'Acme CRM',
      defaultTemplateContext: { supportEmail: 'help@acme.example' },
      options: { messageStream: 'broadcast', host: 'smtp.acme.example', port: 2525, secure: false, user: 'mailer' },
    };
    const stack = defineStack({ manifest, appName: 'Acme', email });
    expect(stack.appName).toBe('Acme');
    expect(stack.email).toEqual(email);
  });

  it('carries the SMS retries — the one SMS member a stack can deliver', () => {
    const stack = defineStack({ manifest, sms: { retries: 1 } });
    expect(stack.sms).toEqual({ retries: 1 });
  });

  it('the email block is DERIVED from EmailServiceConfigSchema: every member except the credential apiKey', () => {
    // A key added to the operator contract has to arrive on the stack, and a
    // secret one has to be left out on purpose — this is that statement.
    const operator = Object.keys(EmailServiceConfigSchema.shape).sort();
    const stack = Object.keys(StackEmailConfigSchema.shape).sort();
    expect(operator.filter((k) => !stack.includes(k))).toEqual(['apiKey']);
    expect(stack.filter((k) => !operator.includes(k))).toEqual([]);
  });

  it('the three keys are declared top-level keys composed as single values', () => {
    for (const key of ['appName', 'email', 'sms'] as const) {
      expect(STACK_DEFINITION_KEYS).toContain(key);
      expect(COMPOSE_KEY_DISPOSITIONS[key]).toBe('single');
    }
  });
});

// ─── RED — the credentials are refused BY NAME, with their env variable ───

describe('refuse — a credential on the stack names itself and its environment variable', () => {
  it('email.apiKey is refused by name, prescribing OS_EMAIL_API_KEY', () => {
    const raw = { manifest, email: { provider: 'resend', apiKey: 're_live_secret' } };
    const issue = unrecognized(parse(raw));
    expect(issue?.path).toEqual(['email']);
    expect(issue?.keys).toEqual(['apiKey']);
    expect(issue?.message).toContain('OS_EMAIL_API_KEY');

    const err = refusalOf(raw);
    expect(err.code).toBe('STACK_SCHEMA_INVALID');
    expect(err.status).toBe(422);
    expect(err.message).toContain('`apiKey`');
    expect(err.message).toContain('OS_EMAIL_API_KEY');
  });

  it('email.options.password is refused by name, prescribing OS_EMAIL_SMTP_PASSWORD', () => {
    const raw = { manifest, email: { provider: 'smtp', options: { host: 'smtp.acme.example', user: 'u', password: 'p' } } };
    const issue = unrecognized(parse(raw));
    expect(issue?.path).toEqual(['email', 'options']);
    expect(issue?.keys).toEqual(['password']);
    expect(issue?.message).toContain('OS_EMAIL_SMTP_PASSWORD');

    const err = refusalOf(raw);
    expect(err.code).toBe('STACK_SCHEMA_INVALID');
    expect(err.status).toBe(422);
  });

  it('email.options.apiKey is refused too — makeTransport would spread it over the real key', () => {
    const issue = unrecognized(parse({ manifest, email: { provider: 'postmark', options: { apiKey: 'pm' } } }));
    expect(issue?.path).toEqual(['email', 'options']);
    expect(issue?.keys).toEqual(['apiKey']);
    expect(issue?.message).toContain('OS_EMAIL_API_KEY');
  });

  it('sms.provider is refused by name, prescribing OS_SMS_PROVIDER and Settings — a stack cannot select the delivering transport', () => {
    const raw = { manifest, sms: { provider: 'twilio', retries: 1 } };
    const issue = unrecognized(parse(raw));
    expect(issue?.path).toEqual(['sms']);
    expect(issue?.keys).toEqual(['provider']);
    expect(issue?.message).toContain('OS_SMS_PROVIDER');
    expect(issue?.message).toContain('Settings → SMS Delivery');

    const err = refusalOf(raw);
    expect(err.code).toBe('STACK_SCHEMA_INVALID');
    expect(err.status).toBe(422);
    expect(err.message).toContain('`provider`');
    expect(err.message).toContain('OS_SMS_PROVIDER');
  });

  it('sms.providerOptions is refused by name, prescribing the sms settings namespace and its OS_SMS_* overrides', () => {
    const raw = { manifest, sms: { providerOptions: { accountSid: 'AC1', authToken: 'secret', from: '+15005550006' } } };
    const issue = unrecognized(parse(raw));
    expect(issue?.path).toEqual(['sms']);
    expect(issue?.keys).toEqual(['providerOptions']);
    expect(issue?.message).toContain('OS_SMS_TWILIO_AUTH_TOKEN');
    expect(issue?.message).toContain('Settings');

    const err = refusalOf(raw);
    expect(err.code).toBe('STACK_SCHEMA_INVALID');
    expect(err.status).toBe(422);
  });

  it('an SMS credential written flat on the block gets the same prescription', () => {
    const issue = unrecognized(parse({ manifest, sms: { authToken: 'secret' } }));
    expect(issue?.keys).toEqual(['authToken']);
    expect(issue?.message).toContain('OS_SMS_TWILIO_AUTH_TOKEN');
  });

  it('`from` is pointed at `defaultFrom`', () => {
    const issue = unrecognized(parse({ manifest, email: { from: { address: 'a@b.example' } } }));
    expect(issue?.keys).toEqual(['from']);
    expect(issue?.message).toContain('`defaultFrom`');
  });
});

// ─── CONTROL — nothing else moved ───

describe('control — the door opened for exactly these keys', () => {
  it('a stack with no mail or SMS configuration is unchanged by the parse', () => {
    const verdict = parse({ manifest });
    expect(verdict.success).toBe(true);
    if (!verdict.success) return;
    expect('email' in verdict.data).toBe(false);
    expect('sms' in verdict.data).toBe(false);
    expect('appName' in verdict.data).toBe(false);
  });

  it('a neighbouring undeclared top-level key still refuses', () => {
    for (const key of ['mail', 'smtp', 'emailConfig']) {
      const issue = unrecognized(parse({ manifest, [key]: {} }));
      expect(issue?.path, `'${key}' must still refuse at the top level`).toEqual([]);
      expect(issue?.keys).toEqual([key]);
    }
  });

  it('the narrowed blocks are closed: an undocumented key is refused, not shipped into the artifact', () => {
    expect(unrecognized(parse({ manifest, email: { options: { transportOptions: { auth: { pass: 'x' } } } } }))?.keys)
      .toEqual(['transportOptions']);
    expect(StackSmsConfigSchema.safeParse({ retries: 1, bogus: 1 }).success).toBe(false);
  });
});

// ─── COMPOSE — one configuration per boot ───

describe('compose — an identical configuration passes, a different one is named', () => {
  const stackWith = (id: string, email: Record<string, unknown>) => defineStack({
    manifest: { ...manifest, id: `com.example.${id}`, name: id, namespace: id },
    appName: 'Acme',
    email,
  });

  it('passes an identical email block through and refuses two different ones by key', () => {
    const a = stackWith('one', { provider: 'log', persist: false });
    const b = stackWith('two', { provider: 'log', persist: false });
    expect(composeStacks([a, b]).email).toEqual({ provider: 'log', persist: false });
    expect(composeStacks([a, b]).appName).toBe('Acme');

    const c = stackWith('three', { provider: 'log', persist: true });
    expect(() => composeStacks([a, c])).toThrow("top-level key 'email'");
  });
});
