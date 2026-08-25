// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { SendEmailInput, SendTemplateInput } from './email-service';

/**
 * #11741 (Decision 2 of #11303) — `SendEmailInput` is widened with an
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
describe('Email Service Contract — organization widening (#11741)', () => {
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
describe('Email Service Contract — SendTemplateInput.org retired (#11832)', () => {
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
