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
import { PushServiceConfigSchema } from './system/push-config.zod';

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

// ─── PUSH — the `push` key carries the push service configuration ───
//
// The top-level `push` key is `PushServiceConfigSchema` itself, read by
// `resolvePushCapabilityArg` (`@objectstack/service-push`) when the stack
// declares `requires: ['push']`. Authoring accepts both transports and the
// absence: refusing the not-yet-served relay is the boot's job, which names the
// missing sender (pinned in the CLI and in `@objectstack/verify`). What
// authoring refuses is an inline secret, by key name or inside a
// `credentialRef`, because the stack is compiled into the published artifact.

const apns = { teamId: 'ABCDE12345', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'production' as const };

describe('push — the stack key carries the push service configuration', () => {
  it('a direct block with credentialRef builds and carries through, transport filled in', () => {
    const stack = defineStack({
      manifest,
      requires: ['push'],
      push: {
        transport: 'direct',
        apns: { ...apns, credentialRef: 'APNS_SIGNING_KEY' },
        fcm: { projectId: 'example-app', credentialRef: 'FCM_SERVICE_ACCOUNT' },
      },
    });
    expect(stack.push).toEqual({
      transport: 'direct',
      apns: { ...apns, credentialRef: 'APNS_SIGNING_KEY' },
      fcm: { projectId: 'example-app', credentialRef: 'FCM_SERVICE_ACCOUNT' },
    });
  });

  it('a vendor block with no transport reads as direct', () => {
    const stack = defineStack({ manifest, push: { fcm: { projectId: 'example-app', credentialRef: 'FCM_SERVICE_ACCOUNT' } } });
    expect(stack.push).toEqual({ transport: 'direct', fcm: { projectId: 'example-app', credentialRef: 'FCM_SERVICE_ACCOUNT' } });
  });

  it('a relay block and an empty block are accepted at authoring and read as the relay', () => {
    expect(defineStack({ manifest, push: { transport: 'relay' } }).push).toEqual({ transport: 'relay' });
    expect(defineStack({ manifest, push: {} }).push).toEqual({ transport: 'relay' });
  });

  it('absence is accepted and left absent — no push key is invented', () => {
    const verdict = parse({ manifest });
    expect(verdict.success).toBe(true);
    if (!verdict.success) return;
    expect('push' in verdict.data).toBe(false);
  });

  it('the key reads as PushServiceConfigSchema, a declared top-level key composed as a single value', () => {
    // Same verdict as the operator contract, on each transport and on a refusal.
    for (const push of [{}, { transport: 'relay' }, { apns: { ...apns, credentialRef: 'APNS_SIGNING_KEY' } }, { transport: 'direct' }]) {
      const viaStack = parse({ manifest, push });
      const direct = PushServiceConfigSchema.safeParse(push);
      expect(viaStack.success, JSON.stringify(push)).toBe(direct.success);
      if (viaStack.success && direct.success) expect(viaStack.data.push).toEqual(direct.data);
    }
    expect(STACK_DEFINITION_KEYS).toContain('push');
    expect(COMPOSE_KEY_DISPOSITIONS.push).toBe('single');
  });

  it('an inline APNs key is refused by name at authoring, prescribing credentialRef', () => {
    const raw = { manifest, push: { transport: 'direct', apns: { ...apns, credentialRef: 'APNS_SIGNING_KEY', key: 'PRIVATE KEY BODY' } } };
    const issue = unrecognized(parse(raw));
    expect(issue?.path).toEqual(['push', 'apns']);
    expect(issue?.keys).toEqual(['key']);
    expect(issue?.message).toContain('`credentialRef`');

    const err = refusalOf(raw);
    expect(err.code).toBe('STACK_SCHEMA_INVALID');
    expect(err.status).toBe(422);
    expect(err.message).toContain('`key`');
    // The refusal names the key, never the value it carried.
    expect(err.message).not.toContain('PRIVATE KEY BODY');
  });

  it('a secret pasted into credentialRef is refused at its path', () => {
    const raw = {
      manifest,
      push: { transport: 'direct', fcm: { projectId: 'example-app', credentialRef: '{"type": "service_account"}' } },
    };
    const verdict = parse(raw);
    expect(verdict.success).toBe(false);
    if (verdict.success) return;
    const issue = verdict.error.issues.find((i) => i.path.join('.') === 'push.fcm.credentialRef');
    expect(issue?.message).toContain('never contains it');

    const err = refusalOf(raw);
    expect(err.code).toBe('STACK_SCHEMA_INVALID');
    expect(err.status).toBe(422);
  });

  it('two stacks declaring different push blocks are named on compose', () => {
    const stackWith = (id: string, projectId: string) => defineStack({
      manifest: { ...manifest, id: `com.example.${id}`, name: id, namespace: id },
      push: { fcm: { projectId, credentialRef: 'FCM_SERVICE_ACCOUNT' } },
    });
    expect(composeStacks([stackWith('one', 'a'), stackWith('two', 'a')]).push)
      .toEqual({ transport: 'direct', fcm: { projectId: 'a', credentialRef: 'FCM_SERVICE_ACCOUNT' } });
    expect(() => composeStacks([stackWith('one', 'a'), stackWith('three', 'b')])).toThrow("top-level key 'push'");
  });
});
