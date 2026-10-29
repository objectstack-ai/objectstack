// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin keygen` (ADR-0025 §3.5 M1): the pair it writes is one Ed25519
 * key, the private half owner-only, and the fingerprint it prints is the one
 * `os plugin trust add` stores for the public half. It never overwrites a key
 * file unless `--force` says so.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { createPublicKey } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSignature, signPayload, verifyPayload } from '@objectstack/core';
import { readPublisherPublicKey } from '@objectstack/runtime';
import PluginKeygen from '../src/commands/plugin/keygen.js';

const dirs: string[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function run(argv: string[]): Promise<{ exit: number; printed: string[] }> {
  const printed: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void printed.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void printed.push(a.join(' ')));
  try {
    await PluginKeygen.run(argv);
    return { exit: 0, printed };
  } catch (err) {
    const exit = (err as { oclif?: { exit?: number } }).oclif?.exit;
    if (typeof exit !== 'number') throw err;
    return { exit, printed };
  }
}

async function scratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'osplugin-keygen-'));
  dirs.push(d);
  return d;
}

describe('os plugin keygen', () => {
  it('writes one Ed25519 pair: the private half 0600, and the fingerprint printed is the public half\'s', async () => {
    const prefix = join(await scratch(), 'acme');
    const { exit, printed } = await run(['--out', prefix, '--key-id', 'acme-2026']);
    expect(exit).toBe(0);

    const privateKeyPem = await readFile(`${prefix}.key.pem`, 'utf-8');
    const publicKeyPem = await readFile(`${prefix}.pub.pem`, 'utf-8');
    expect(privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY');
    if (process.platform !== 'win32') expect(statSync(`${prefix}.key.pem`).mode & 0o777).toBe(0o600);

    const bytes = new TextEncoder().encode('artifact');
    const signature = signPayload(bytes, privateKeyPem, 'acme-2026');
    expect(parseSignature(signature)?.keyId).toBe('acme-2026');
    expect(verifyPayload(bytes, signature, publicKeyPem)).toBe(true);

    const read = readPublisherPublicKey(publicKeyPem);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const output = printed.join('\n');
    expect(output).toContain(read.fingerprint);
    expect(output).toContain(`os plugin trust add ${prefix}.pub.pem --key-id acme-2026`);
    // The private key's text never reaches the terminal.
    expect(output).not.toContain(privateKeyPem.split('\n')[1]);
  });

  it('defaults the key id to the first 16 hex digits of the fingerprint', async () => {
    const prefix = join(await scratch(), 'k');
    const { exit, printed } = await run(['--out', prefix]);
    expect(exit).toBe(0);
    const read = readPublisherPublicKey(await readFile(`${prefix}.pub.pem`, 'utf-8'));
    if (!read.ok) throw new Error(read.message);
    const keyId = read.fingerprint.slice('sha256:'.length, 'sha256:'.length + 16);
    expect(printed.join('\n')).toContain(`--key-id ${keyId}`);
    expect(createPublicKey(await readFile(`${prefix}.key.pem`, 'utf-8')).asymmetricKeyType).toBe('ed25519');
  });

  it('refuses to overwrite an existing key file without --force, and replaces it with --force', async () => {
    const prefix = join(await scratch(), 'acme');
    await writeFile(`${prefix}.key.pem`, 'precious', { mode: 0o644 });
    const refused = await run(['--out', prefix]);
    expect(refused.exit).toBe(1);
    expect(refused.printed.join('\n')).toContain('Refusing to overwrite');
    expect(await readFile(`${prefix}.key.pem`, 'utf-8')).toBe('precious');
    expect(existsSync(`${prefix}.pub.pem`)).toBe(false);

    const forced = await run(['--out', prefix, '--force']);
    expect(forced.exit).toBe(0);
    expect(await readFile(`${prefix}.key.pem`, 'utf-8')).toContain('BEGIN PRIVATE KEY');
    if (process.platform !== 'win32') expect(statSync(`${prefix}.key.pem`).mode & 0o777).toBe(0o600);
  });

  it('refuses a key id a signature string could not carry, writing nothing', async () => {
    const prefix = join(await scratch(), 'acme');
    const { exit } = await run(['--out', prefix, '--key-id', 'acme:2026']);
    expect(exit).toBe(1);
    expect(existsSync(`${prefix}.key.pem`)).toBe(false);
  });
});
