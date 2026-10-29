// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IEmailService, SendEmailInput, SendTemplateInput } from './email-service';

/**
 * Commit b706af987 (Decision 2 of #11303) — `SendEmailInput` is widened with an
 * OPTIONAL `organizationId` so producers that already hold an organization
 * can thread it to `plugin-email`'s writer, which stamps
 * `sys_email.organization_id` verbatim.
 *
 * Two contract facts pinned here:
 *  - the pre-widening shape stays legal byte-identically — a caller that has
 *    no organization (auth verification / password-reset mail) passes the
 *    same object it always passed and is not refused;
 *  - the widened shape carries `organizationId` as a plain optional string on
 *    BOTH `SendEmailInput` and `SendTemplateInput` (the template entry point
 *    forwards it into the send it performs).
 */
describe('Email Service Contract — organization widening', () => {
  it('accepts the pre-widening SendEmailInput shape unchanged (organizationId optional, absent legal)', () => {
    const legacy: SendEmailInput = { to: 'a@b.com', subject: 'Hi', text: 'x' };
    expect(legacy).not.toHaveProperty('organizationId');
    expect(legacy.organizationId).toBeUndefined();
  });

  it('accepts a SendEmailInput carrying organizationId (the sys_email.organization_id pass-through stamp)', () => {
    const widened: SendEmailInput = {
      to: 'a@b.com',
      subject: 'Hi',
      text: 'x',
      organizationId: 'org_apex',
    };
    expect(widened.organizationId).toBe('org_apex');
  });

  it('accepts a SendTemplateInput carrying organizationId (forwarded to the underlying send)', () => {
    const legacy: SendTemplateInput = { template: 'auth.password_reset', to: 'a@b.com' };
    expect(legacy.organizationId).toBeUndefined();

    const widened: SendTemplateInput = {
      template: 'auth.password_reset',
      to: 'a@b.com',
      organizationId: 'org_apex',
    };
    expect(widened.organizationId).toBe('org_apex');
  });
});

/**
 * #11832 (ADR-0049 enforce-or-remove) — `SendTemplateInput.org` is RETIRED.
 *
 * The member declared "Tenant id for org-overlay resolution (when supported)"
 * and no implementation ever read it: template resolution keys on
 * `(name, locale)` only, so a caller passing `org` got no overlay resolution
 * and no error. This is a programmatic contracts interface (nothing parses it
 * at runtime), so the enforcement channel is the COMPILER: the pin below is a
 * compile-time assertion that authoring `org` is an excess-property error.
 * Re-adding the member makes the `@ts-expect-error` directive unused, which is
 * itself a compile error (TS2578) under `check:test-typecheck` — the pin fails
 * loudly in both directions.
 */
describe('Email Service Contract — SendTemplateInput.org retired', () => {
  it('refuses `org` at compile time (excess property; organizationId is NOT an overlay opt-in)', () => {
    const input: SendTemplateInput = {
      template: 'auth.password_reset',
      to: 'a@b.com',
      // `org` was removed from SendTemplateInput (#11832); it never resolved
      // any org overlay. There is no replacement key: `organizationId` is the
      // delivery row's tenant stamp, not overlay resolution.
      // @ts-expect-error #11832 — authoring `org` is an excess-property error
      org: 'org_apex',
    };
    // Runtime footnote only — the contract is type-level; the object literal
    // above still carries the key at runtime, which is exactly the inertness
    // the removal documents (nothing reads it).
    expect(input.template).toBe('auth.password_reset');
  });
});

/**
 * `IEmailService.isConfigured` — the OPTIONAL deliverability member, shaped
 * like `ISmsService.isConfigured()`. Two contract facts pinned here:
 *  - an implementation without the member stays assignable (the widening is
 *    additive; absent reads as "unknown", never as delivering);
 *  - when present it is a zero-argument function returning `boolean`.
 */
describe('Email Service Contract — isConfigured (optional deliverability member)', () => {
  const base = {
    send: async () => ({ id: 'e1', status: 'sent' as const }),
    sendTemplate: async () => ({ id: 'e1', status: 'sent' as const }),
    renderTemplate: async () => ({ subject: 's', html: 'h', text: 't' }),
  };

  it('keeps an implementation without isConfigured assignable (absent = unknown)', () => {
    const legacy: IEmailService = { ...base };
    expect(legacy.isConfigured).toBeUndefined();
  });

  it('accepts isConfigured(): boolean and refuses a non-boolean answer at compile time', () => {
    const svc: IEmailService = { ...base, isConfigured: () => false };
    expect(svc.isConfigured?.()).toBe(false);

    type Member = NonNullable<IEmailService['isConfigured']>;
    const ok: Member = () => true;
    // @ts-expect-error isConfigured answers a boolean, not a string
    const bad: Member = () => 'yes';
    expect(ok()).toBe(true);
    expect(typeof bad).toBe('function');
  });
});

/**
 * `IEmailService.getDefaultFrom` — the OPTIONAL configured-sender member the
 * REST send door bounds a caller's `from` to, pinned the way `isConfigured`
 * is above:
 *  - an implementation without the member stays assignable (the widening is
 *    additive; absent reads as "unknown", and the door refuses a caller
 *    `from` on unknown);
 *  - when present it is a zero-argument function answering an
 *    `EmailAddress` (either form) or `undefined` when no sender is configured.
 */
describe('Email Service Contract — getDefaultFrom (optional configured-sender member)', () => {
  const base = {
    send: async () => ({ id: 'e1', status: 'sent' as const }),
    sendTemplate: async () => ({ id: 'e1', status: 'sent' as const }),
    renderTemplate: async () => ({ subject: 's', html: 'h', text: 't' }),
  };

  it('keeps an implementation without getDefaultFrom assignable (absent = unknown)', () => {
    const legacy: IEmailService = { ...base };
    expect(legacy.getDefaultFrom).toBeUndefined();
  });

  it('accepts either address form or undefined, and refuses a non-address answer at compile time', () => {
    const bare: IEmailService = { ...base, getDefaultFrom: () => 'no-reply@acme.example' };
    const named: IEmailService = { ...base, getDefaultFrom: () => ({ name: 'Acme', address: 'no-reply@acme.example' }) };
    const none: IEmailService = { ...base, getDefaultFrom: () => undefined };
    expect(bare.getDefaultFrom?.()).toBe('no-reply@acme.example');
    expect(named.getDefaultFrom?.()).toEqual({ name: 'Acme', address: 'no-reply@acme.example' });
    expect(none.getDefaultFrom?.()).toBeUndefined();

    type Member = NonNullable<IEmailService['getDefaultFrom']>;
    // @ts-expect-error getDefaultFrom answers an EmailAddress, not a number
    const wrongType: Member = () => 42;
    // @ts-expect-error the object form names its `address`
    const noAddress: Member = () => ({ name: 'Acme' });
    expect(typeof wrongType).toBe('function');
    expect(typeof noAddress).toBe('function');
  });
});
