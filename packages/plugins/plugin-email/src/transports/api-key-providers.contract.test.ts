// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `API_KEY_EMAIL_PROVIDERS` ↔ what `makeTransport` actually refuses (#5132).
//
// The constant exists so the sites that must reject an incomplete mail
// configuration — `makeTransport` here, `resolveEmailCapabilityArg` in
// `@objectstack/cli` — read one vocabulary instead of each restating
// `provider !== 'log' && provider !== 'smtp'`. A constant that says something
// the `switch` does not do would be worse than no constant at all: the CLI
// would refuse a boot this package would have served, or (the #5132 defect)
// wave through one it cannot deliver.
//
// One direction is already a compile error — the `resend`/`postmark` arms pass
// their tag to `requireApiKey(provider: ApiKeyEmailProvider, …)`, so removing a
// tag from the constant breaks the build. This pins the other direction: every
// provider the constant claims needs a key is one `makeTransport` genuinely
// will not build without one, and every provider it does not claim builds fine
// with no key at all.

import { describe, it, expect } from 'vitest';
import {
  makeTransport,
  EMAIL_TRANSPORT_PROVIDERS,
  API_KEY_EMAIL_PROVIDERS,
  emailProviderRequiresApiKey,
} from './index.js';

/** Everything a provider needs EXCEPT an API key. */
const WITHOUT_KEY: Record<string, Parameters<typeof makeTransport>[0]> = {
  log: { provider: 'log' },
  resend: { provider: 'resend' },
  postmark: { provider: 'postmark' },
  smtp: { provider: 'smtp', options: { host: 'smtp.example.test' } },
};

describe('API_KEY_EMAIL_PROVIDERS ↔ makeTransport', () => {
  it('is a subset of the providers this package can materialise', () => {
    for (const provider of API_KEY_EMAIL_PROVIDERS) {
      expect(EMAIL_TRANSPORT_PROVIDERS).toContain(provider);
    }
  });

  it.each([...EMAIL_TRANSPORT_PROVIDERS])(
    'agrees with what makeTransport does for provider=%s without a key',
    (provider) => {
      const args = WITHOUT_KEY[provider];
      expect(args, `no key-less recipe for provider '${provider}'`).toBeDefined();
      const build = () => makeTransport(args);

      if (emailProviderRequiresApiKey(provider)) {
        // Claimed to need a key ⇒ must actually refuse, and say which key.
        expect(build).toThrow(/requires apiKey/);
        expect(build).toThrow(/OS_EMAIL_API_KEY/);
      } else {
        // Not claimed ⇒ must build with no key at all, or the CLI would be
        // demanding a credential this package never reads.
        expect(build).not.toThrow();
      }
    },
  );

  it('narrows only the SaaS-API tags', () => {
    expect(emailProviderRequiresApiKey('resend')).toBe(true);
    expect(emailProviderRequiresApiKey('postmark')).toBe(true);
    expect(emailProviderRequiresApiKey('smtp')).toBe(false);
    expect(emailProviderRequiresApiKey('log')).toBe(false);
    // Not a provider at all — the caller's next stop is `unsupportedProviderFix`.
    expect(emailProviderRequiresApiKey('sendgrid')).toBe(false);
    expect(emailProviderRequiresApiKey(undefined)).toBe(false);
  });
});
