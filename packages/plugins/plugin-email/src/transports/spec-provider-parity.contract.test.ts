// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `EmailProviderSchema` (spec) ↔ `EMAIL_TRANSPORT_PROVIDERS` (this package) — #5104.
//
// The third side of one vocabulary. `mail-manifest-providers.contract.test.ts`
// already holds the settings dropdown equal to the transports; this holds the
// *authoring contract* equal to them too. All three describe "which providers
// exist", and every time two of them were left to drift the result was a
// deployment that accepted a provider it could not deliver through (#5094's
// `sendgrid` / `ses`) or refused one it could (#5087's `smtp`, and the spec
// enum this test was written for: an author annotating `objectstack.config.ts`
// with `EmailServiceConfig` got a type error for `provider: 'smtp'` months
// after the transport shipped).
//
// It is a CROSS-PACKAGE assertion for the reason spelled out in the manifest
// contract test: two mirrored literals can always be "fixed" by editing the
// other literal. `@objectstack/spec` is a real dependency of this package, so
// the comparison costs nothing and no runtime edge is added — this file is
// test-only.
//
// Note the asymmetry with the spec-side companion
// (`packages/spec/src/system/email-config.test.ts`): that package excludes
// `**/*.test.ts` from its `tsconfig.json`, so a type-level witness written
// there is never compiled (#5286) and can only be a runtime check. This
// package's tsconfig includes its tests, so the compile-time half below is
// real — `pnpm --filter @objectstack/plugin-email typecheck` fails on a
// mismatch before any test runs.

import { describe, it, expect } from 'vitest';
import { EmailProviderSchema } from '@objectstack/spec/system';
import type { EmailProvider } from '@objectstack/spec/system';
import {
  makeTransport,
  EMAIL_TRANSPORT_PROVIDERS,
  RETIRED_EMAIL_PROVIDERS,
  type EmailTransportProvider,
} from './index.js';

/**
 * Compile-time halves of the same invariant: each union must be assignable to
 * the other. A member added on one side only collapses its alias to `never`,
 * and `true` stops being assignable — a type error in this package's
 * `typecheck`, not a deferred test failure.
 */
type SpecAssignableToTransport = EmailProvider extends EmailTransportProvider ? true : never;
type TransportAssignableToSpec = EmailTransportProvider extends EmailProvider ? true : never;
const MUTUALLY_ASSIGNABLE: [SpecAssignableToTransport, TransportAssignableToSpec] = [true, true];

/** Minimal credentials that let each provider be built for real. */
const BUILD_ARGS: Record<string, Parameters<typeof makeTransport>[0]> = {
  log: { provider: 'log' },
  resend: { provider: 'resend', apiKey: 're_test_key' },
  postmark: { provider: 'postmark', apiKey: 'pm-test-key' },
  smtp: { provider: 'smtp', options: { host: 'smtp.example.test' } },
};

describe('EmailProviderSchema ↔ EMAIL_TRANSPORT_PROVIDERS', () => {
  it('declares exactly the providers this package can materialise', () => {
    // Set equality, both directions at once:
    //   ⊆ — no spec value without a transport (authors promised a provider
    //       every boot would refuse);
    //   ⊇ — no transport the spec hides (`smtp`, for three releases).
    expect(new Set(EmailProviderSchema.options)).toEqual(new Set(EMAIL_TRANSPORT_PROVIDERS));
  });

  it('agrees at the type level in both directions', () => {
    expect(MUTUALLY_ASSIGNABLE).toEqual([true, true]);
  });

  it('builds a real transport for every provider the spec declares', () => {
    // Set equality alone would be satisfied by two identically-wrong lists.
    // This is the direction that matters to an author: what the contract
    // permits, `makeTransport` delivers.
    for (const provider of EmailProviderSchema.options) {
      const args = BUILD_ARGS[provider];
      expect(args, `no build recipe for spec provider '${provider}'`).toBeDefined();
      expect(() => makeTransport(args), provider).not.toThrow();
    }
  });

  it('never re-admits a retired provider tag', () => {
    // `sendgrid` / `ses` have migration guidance rather than a transport
    // (#5094). Declaring either in the spec would tell authors to write a
    // value every boot path throws on — the same defect as the missing
    // `smtp`, pointed the other way.
    for (const retired of Object.keys(RETIRED_EMAIL_PROVIDERS)) {
      expect(EmailProviderSchema.safeParse(retired).success, retired).toBe(false);
      expect(EMAIL_TRANSPORT_PROVIDERS, retired).not.toContain(retired);
    }
  });
});
