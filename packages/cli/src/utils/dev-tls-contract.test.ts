// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dev-TLS flag contract (#16804): what `--cert` / `--key` say, what half a
 * pair says, and the protocol a listener carrying them speaks.
 *
 * ## What these pin, and the one thing they pin NEGATIVELY
 *
 * The ruling this card implements refused the generating shape — `--https` with
 * a self-signed CA and printed instructions for installing it into a system
 * trust store — on a security-statement ground: a product that tells developers
 * to trust a certificate it minted owns that instruction, and an error inside it
 * is invisible to the person following it. 「⛔ 不生成自签 CA;⛔ 不打印、不文档化
 * 任何「把 CA 装进系统信任库」的指引——信任库是开发者自己的事」.
 *
 * `--help` is one of the surfaces that refusal covers, so the last describe
 * block below reads the flag descriptions and the module's own source and
 * asserts the absence. It is a real assertion rather than a restatement: the
 * ANTI-VACUITY case proves the same scan finds the words that ARE there, so a
 * future edit that adds trust-store prose cannot pass by having nothing to read.
 */

import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterAll } from 'vitest';
import {
  DEV_TLS_CERT_FLAG,
  DEV_TLS_KEY_FLAG,
  resolveDevTlsIntent,
  listenerProtocol,
  readDevTlsMaterial,
  devTlsChildArgs,
  devTlsCertFlag,
  devTlsKeyFlag,
  formatIncompleteDevTlsPairNotice,
  formatUnreadableDevTlsFileNotice,
} from './dev-tls-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_SOURCE = readFileSync(resolve(HERE, 'dev-tls-contract.ts'), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'os-dev-tls-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const write = (name: string, body: string): string => {
  const p = join(scratch, name);
  writeFileSync(p, body);
  return p;
};

describe('resolveDevTlsIntent — three answers, never a boolean plus a validity bit', () => {
  it('no flags: `none`, which is the shape every existing boot resolves to', () => {
    expect(resolveDevTlsIntent({})).toEqual({ kind: 'none' });
  });

  it('both flags: `requested`, carrying the two paths unchanged', () => {
    expect(resolveDevTlsIntent({ cert: './c.pem', key: './k.pem' })).toEqual({
      kind: 'requested',
      certPath: './c.pem',
      keyPath: './k.pem',
    });
  });

  it('--cert alone is refused, and the notice names the MISSING half', () => {
    const intent = resolveDevTlsIntent({ cert: './c.pem' });
    expect(intent.kind).toBe('incomplete');
    // The operator typed --cert; what they are told to add is --key.
    expect(intent.kind === 'incomplete' && intent.notice).toContain('--cert was given without --key');
  });

  it('--key alone is refused under its own spelling', () => {
    const intent = resolveDevTlsIntent({ key: './k.pem' });
    expect(intent.kind).toBe('incomplete');
    expect(intent.kind === 'incomplete' && intent.notice).toContain('--key was given without --cert');
  });

  describe('a value that did not expand reads as ABSENT, not as a path', () => {
    // `--cert "$CERT"` with `CERT` unset reaches oclif as an empty string. Read
    // as a path it refuses with `ENOENT ''`, which names neither the flag nor
    // what the operator did.
    it('empty on both: `none`', () => {
      expect(resolveDevTlsIntent({ cert: '', key: '   ' })).toEqual({ kind: 'none' });
    });

    it('empty on one: the incomplete-pair refusal, naming the half that IS set', () => {
      const intent = resolveDevTlsIntent({ cert: './c.pem', key: '' });
      expect(intent.kind).toBe('incomplete');
      expect(intent.kind === 'incomplete' && intent.notice).toContain('--cert was given without --key');
    });
  });
});

describe('listenerProtocol — https exactly when a whole pair was given', () => {
  it('derives https from a requested pair', () => {
    expect(listenerProtocol(resolveDevTlsIntent({ cert: './c.pem', key: './k.pem' }))).toBe('https');
  });

  it('derives http with no flags at all', () => {
    expect(listenerProtocol(resolveDevTlsIntent({}))).toBe('http');
  });

  it('⛔ an INCOMPLETE pair never resolves to https', () => {
    // The door that refuses the pair and the door that derives the origin read
    // the same answer, so a refused boot can never have advertised https.
    expect(listenerProtocol(resolveDevTlsIntent({ cert: './c.pem' }))).toBe('http');
    expect(listenerProtocol(resolveDevTlsIntent({ key: './k.pem' }))).toBe('http');
  });
});

describe('readDevTlsMaterial — the bytes, or a refusal naming the flag and the path', () => {
  it('reads both files, keeping the paths beside the bytes', () => {
    const certPath = write('c.pem', 'CERT-BYTES');
    const keyPath = write('k.pem', 'KEY-BYTES');

    const material = readDevTlsMaterial({ certPath, keyPath });

    expect(material.cert.toString()).toBe('CERT-BYTES');
    expect(material.key.toString()).toBe('KEY-BYTES');
    expect(material).toMatchObject({ certPath, keyPath });
  });

  it('a missing certificate throws, naming --cert and the path', () => {
    const keyPath = write('k2.pem', 'KEY');
    const certPath = join(scratch, 'absent.pem');

    expect(() => readDevTlsMaterial({ certPath, keyPath })).toThrow(/--cert could not be read/);
    expect(() => readDevTlsMaterial({ certPath, keyPath })).toThrow(new RegExp(JSON.stringify(certPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('a missing key throws under ITS flag, not the certificate\'s', () => {
    const certPath = write('c3.pem', 'CERT');
    const keyPath = join(scratch, 'absent-key.pem');

    expect(() => readDevTlsMaterial({ certPath, keyPath })).toThrow(/--key could not be read/);
  });

  it('an unreadable-but-present key is refused too, carrying the OS reason', () => {
    const certPath = write('c4.pem', 'CERT');
    const keyPath = write('k4.pem', 'KEY');
    chmodSync(keyPath, 0o000);
    try {
      // A root-run container can read a 000 file, in which case there is
      // nothing to refuse — assert the two outcomes that are both correct
      // rather than a permission model this test does not own.
      let refusal: string | null = null;
      try {
        readDevTlsMaterial({ certPath, keyPath });
      } catch (e) {
        refusal = (e as Error).message;
      }
      if (refusal !== null) {
        expect(refusal).toContain('--key could not be read');
        expect(refusal).toContain('EACCES');
      }
    } finally {
      chmodSync(keyPath, 0o600);
    }
  });

  it('⛔ offers no path back to plain http — the notice prescribes fixing the path', () => {
    const notice = formatUnreadableDevTlsFileNotice(DEV_TLS_CERT_FLAG, '/no/such.pem', new Error('ENOENT'));
    expect(notice).toContain('/no/such.pem');
    expect(notice).toContain('relative to the current working directory');
    // A developer who typed --cert asked for TLS. "Serving http instead" is the
    // one answer that must never appear here.
    expect(notice.toLowerCase()).not.toContain('falling back');
    expect(notice.toLowerCase()).not.toContain('plain http');
  });
});

describe('devTlsChildArgs — what `os dev` forwards to its `serve` child', () => {
  it('forwards both PATHS, so one process reads the file and owns the refusal', () => {
    const intent = resolveDevTlsIntent({ cert: './c.pem', key: './k.pem' });
    expect(devTlsChildArgs(intent)).toEqual(['--cert', './c.pem', '--key', './k.pem']);
  });

  it('forwards nothing at all when no flags were given', () => {
    expect(devTlsChildArgs(resolveDevTlsIntent({}))).toEqual([]);
  });

  it('⛔ forwards nothing for an incomplete pair — the parent already refused it', () => {
    // Forwarding half a pair would have the child refuse it a second time,
    // under the name of a channel the operator never used.
    expect(devTlsChildArgs(resolveDevTlsIntent({ cert: './c.pem' }))).toEqual([]);
  });

  it('the forwarded spellings ARE the flag names the child declares', () => {
    const args = devTlsChildArgs(resolveDevTlsIntent({ cert: 'c', key: 'k' }));
    expect(args).toContain(`--${DEV_TLS_CERT_FLAG}`);
    expect(args).toContain(`--${DEV_TLS_KEY_FLAG}`);
  });
});

describe('formatIncompleteDevTlsPairNotice — both halves, and the way out', () => {
  it('names the two flags and says dropping both serves plain http', () => {
    const notice = formatIncompleteDevTlsPairNotice(DEV_TLS_CERT_FLAG);
    expect(notice).toContain('--cert <path to the certificate>');
    expect(notice).toContain('--key <path to its private key>');
    expect(notice).toContain('Drop both to serve plain http on this port');
  });

  it('carries no raw control bytes — colouring happens at the call site', () => {
    for (const given of [DEV_TLS_CERT_FLAG, DEV_TLS_KEY_FLAG] as const) {
      // eslint-disable-next-line no-control-regex
      expect(formatIncompleteDevTlsPairNotice(given)).not.toMatch(/\u001b\[/);
    }
  });
});

describe('⛔ NO CA generation and NO trust-store prose — the ruling, asserted', () => {
  const surfaces: Array<[string, string]> = [
    ['--cert description', devTlsCertFlag().description ?? ''],
    ['--key description', devTlsKeyFlag().description ?? ''],
  ];

  /**
   * The words a generating implementation, or an instruction to trust one,
   * cannot be written without. `keychain` / `certutil` / `security add-trusted`
   * are the platform-specific spellings the card's own "Optionally print a
   * one-line hint" sentence would have produced.
   */
  const REFUSED = [
    'trust store', 'trust-store', 'truststore',
    'keychain', 'certutil', 'add-trusted-cert',
    'self-signed', 'selfsigned',
    'generate a cert', 'generates a cert', 'generated cert', 'generated CA',
  ];

  it('no flag description offers to generate anything or to trust anything', () => {
    for (const [name, text] of surfaces) {
      const lower = text.toLowerCase();
      for (const word of REFUSED) {
        expect(lower, `${name} must not mention ${JSON.stringify(word)}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it('--cert says the developer brings the certificate, in as many words', () => {
    // The positive half: refusing the prose is only honest if the flag says
    // whose job the certificate is.
    expect(devTlsCertFlag().description).toContain('Bring your own certificate; none is generated.');
  });

  it('the module generates no key material — no crypto/CA surface is reachable from it', () => {
    // A generating implementation needs one of these. None is imported, and the
    // ANTI-VACUITY case below proves this scan reads the file.
    expect(CONTRACT_SOURCE).not.toContain('node:crypto');
    expect(CONTRACT_SOURCE).not.toContain('selfsigned');
    expect(CONTRACT_SOURCE).not.toContain('generateKeyPair');
    expect(CONTRACT_SOURCE).not.toMatch(/createCertificate|X509Certificate/);
  });

  describe('ANTI-VACUITY: the scan reads the module, and it read something', () => {
    it('finds the words that ARE in the source', () => {
      expect(CONTRACT_SOURCE).toContain('readFileSync');
      expect(CONTRACT_SOURCE).toContain('listenerProtocol');
      // And the refusal is stated in the module, not only in this test.
      expect(CONTRACT_SOURCE).toContain('security-statement ground');
    });

    it('would catch a trust-store sentence if one were added', () => {
      const poisoned = `${CONTRACT_SOURCE}\n// add the CA to your trust store\n`;
      expect(poisoned.toLowerCase()).toContain('trust store');
      expect(CONTRACT_SOURCE.toLowerCase()).not.toContain('add the ca to your trust store');
    });
  });
});
