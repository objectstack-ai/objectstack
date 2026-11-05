// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * emailDomain — the address parse, the closed public-mailbox list and the
 * registrable-label rule.
 */

import { describe, it, expect } from 'vitest';
import {
  emailDomain,
  isPublicMailboxDomain,
  registrableLabel,
  PUBLIC_MAILBOX_DOMAINS,
} from '../emailDomain';

describe('emailDomain', () => {
  it.each([
    ['jane@acme.com', 'acme.com'],
    ['  Jane@ACME.COM ', 'acme.com'],
    ['jane@acme.com.', 'acme.com'],
    // The LAST at sign separates the domain.
    ['"a@b"@acme.com', 'acme.com'],
  ])('%s → %s', (email, expected) => {
    expect(emailDomain(email)).toBe(expected);
  });

  it.each([
    ['no e-mail', undefined],
    ['null', null],
    ['an empty e-mail', ''],
    ['no domain', 'jane@'],
    ['no local part', '@acme.com'],
    ['no at sign', 'jane.acme.com'],
    ['a domain that is only a dot', 'jane@.'],
  ])('%s → undefined', (_label, email) => {
    expect(emailDomain(email)).toBeUndefined();
  });
});

describe('isPublicMailboxDomain', () => {
  it.each([...PUBLIC_MAILBOX_DOMAINS])('%s is public', (domain) => {
    expect(isPublicMailboxDomain(domain)).toBe(true);
  });

  it('the closed list carries the common providers by name', () => {
    for (const named of [
      'gmail.com',
      'outlook.com',
      'hotmail.com',
      'yahoo.com',
      'icloud.com',
      'qq.com',
      '163.com',
      '126.com',
      'foxmail.com',
      'proton.me',
    ]) {
      expect(PUBLIC_MAILBOX_DOMAINS.has(named), named).toBe(true);
    }
  });

  it('a subdomain of a listed provider is that provider (vip.qq.com)', () => {
    expect(isPublicMailboxDomain('vip.qq.com')).toBe(true);
  });

  it.each([
    // Merely ENDING in a listed name is not that provider.
    'notgmail.com',
    'acme.com',
    'mail.acme.co.uk',
  ])('%s is not public', (domain) => {
    expect(isPublicMailboxDomain(domain)).toBe(false);
  });
});

describe('registrableLabel', () => {
  it.each([
    ['acme.com', 'acme'],
    ['mail.acme.com', 'acme'],
    ['a.b.acme.com', 'acme'],
    ['acme.io', 'acme'],
    ['acme.co.uk', 'acme'],
    ['acme.com.cn', 'acme'],
    ['acme.com.au', 'acme'],
    ['eu.acme.co.jp', 'acme'],
    ['acme-labs.com', 'acme-labs'],
    // `co` under a three-letter TLD is an ordinary label, not a registry pair.
    ['acme.co.com', 'co'],
    ['localhost', undefined],
  ])('%s → %s', (domain, expected) => {
    expect(registrableLabel(domain)).toBe(expected);
  });
});
