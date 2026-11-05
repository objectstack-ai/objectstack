// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * defaultOrganizationName — the domain rule and the closed public-mailbox list
 * behind the first-organization prefill (maintainer ruling
 * objectstack-ai/cloud#3559 A).
 */

import { describe, it, expect } from 'vitest';
import {
  defaultOrganizationName,
  registrableLabel,
  PUBLIC_MAILBOX_DOMAINS,
} from '../defaultOrganizationName';

describe('defaultOrganizationName', () => {
  describe('a work domain names the company from its registrable label, capitalised', () => {
    it.each([
      ['jane@acme.com', 'Acme'],
      ['Jane@ACME.COM', 'Acme'],
      ['jane@mail.acme.com', 'Acme'],
      ['jane@acme.io', 'Acme'],
      ['jane@acme.co.uk', 'Acme'],
      ['jane@acme.com.cn', 'Acme'],
      ['jane@eu.acme.co.jp', 'Acme'],
      ['jane@acme-labs.com', 'Acme-labs'],
      // An unknown domain is a work domain: the user sees the guess before clicking.
      ['jane@unheard-of-mail.example', 'Unheard-of-mail'],
    ])('%s → %s', (email, expected) => {
      expect(defaultOrganizationName({ email, name: 'Jane Doe' })).toEqual({ kind: 'company', name: expected });
    });
  });

  describe('a public mailbox domain takes the personal form', () => {
    it.each([...PUBLIC_MAILBOX_DOMAINS])('%s', (domain) => {
      expect(defaultOrganizationName({ email: `zhang.san@${domain}`, name: 'Zhang San' })).toEqual({
        kind: 'personal',
        person: 'Zhang San',
      });
    });

    it('the closed list carries every domain the ruling names', () => {
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
      expect(defaultOrganizationName({ email: 'a@vip.qq.com', name: '张三' })).toEqual({ kind: 'personal', person: '张三' });
    });

    it('a domain that merely ENDS in a listed name is not that provider (notgmail.com)', () => {
      expect(defaultOrganizationName({ email: 'a@notgmail.com', name: 'A' })).toEqual({ kind: 'company', name: 'Notgmail' });
    });

    it.each([
      ['no name', undefined],
      ['an empty name', '   '],
      ['the address itself as the name', 'zhang.san@gmail.com'],
    ])('a user with %s falls back to the e-mail local part', (_label, name) => {
      expect(defaultOrganizationName({ email: 'zhang.san@gmail.com', name })).toEqual({
        kind: 'personal',
        person: 'zhang.san',
      });
    });

    it('a punycode work label would read as gibberish, so it takes the personal form', () => {
      expect(defaultOrganizationName({ email: 'li@xn--fiqs8s.com', name: 'Li Si' })).toEqual({
        kind: 'personal',
        person: 'Li Si',
      });
    });
  });

  it.each([
    ['no e-mail', undefined],
    ['an empty e-mail', ''],
    ['no domain', 'jane@'],
    ['no local part', '@acme.com'],
    ['no at sign', 'jane.acme.com'],
  ])('%s → null (nothing to derive from)', (_label, email) => {
    expect(defaultOrganizationName({ email, name: 'Jane' })).toBeNull();
  });
});

describe('registrableLabel', () => {
  it.each([
    ['acme.com', 'acme'],
    ['a.b.acme.com', 'acme'],
    ['acme.co.uk', 'acme'],
    ['acme.com.au', 'acme'],
    // `co` under a three-letter TLD is an ordinary label, not a registry pair.
    ['acme.co.com', 'co'],
    ['localhost', undefined],
  ])('%s → %s', (domain, expected) => {
    expect(registrableLabel(domain)).toBe(expected);
  });
});
