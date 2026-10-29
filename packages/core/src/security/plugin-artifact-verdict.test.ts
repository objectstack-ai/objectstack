// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27123 slice 2] The kernel loader's signature check reads a host verdict
 * (ADR-0025 §3.5 M1), and the artifact reader's inflate is bounded.
 *
 * Pinned: a plugin carrying a signature no host verified is refused, a plugin
 * whose recorded verdict is for that exact signature loads, a verdict for
 * another signature does not stand in for it, and a malformed signature is
 * refused by name first; a plugin with no signature is unaffected. The reader
 * round-trips an archive, and an artifact that inflates past the bound throws
 * naming it instead of growing.
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { PluginLoader } from '../plugin-loader';
import { ObjectKernel } from '../kernel';
import { createLogger } from '../logger';
import type { Plugin, PluginContext } from '../types';
import { recordPluginArtifactVerdict, pluginArtifactVerdict } from './plugin-artifact-verdict';
import { MAX_UNPACKED_ARTIFACT_BYTES, readTar, readTarGz, sha256Hex } from './plugin-artifact-archive';

const SIG = 'ed25519:acme-2026:' + Buffer.alloc(64, 1).toString('base64url');

function loader(): PluginLoader {
  const logger = createLogger({ level: 'silent' });
  const l = new PluginLoader(logger);
  l.setContext({
    registerService: () => {},
    getService: () => { throw new Error('none'); },
    hook: () => {},
    trigger: async () => {},
    getServices: () => new Map(),
    logger,
    getKernel: () => ({}) as never,
  } as unknown as PluginContext);
  return l;
}

function plugin(extra: Record<string, unknown> = {}): Plugin {
  return { name: 'com.acme.signed', version: '1.0.0', init: async () => {}, ...extra } as Plugin;
}

describe('PluginLoader reads the host verdict for a signed plugin', () => {
  it('refuses a signature no host verified', async () => {
    const result = await loader().loadPlugin(plugin({ signature: SIG }));
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/carries a signature \(keyId=acme-2026\) that no host verified/);
  });

  it('loads a plugin whose host recorded a verdict for that exact signature', async () => {
    const p = plugin({ signature: SIG });
    recordPluginArtifactVerdict(p, { signature: SIG, keyId: 'acme-2026', fingerprint: 'sha256:00', artifactSha256: 'ab' });
    const result = await loader().loadPlugin(p);
    expect(result.success).toBe(true);
  });

  it('does not let a verdict for another signature stand in', async () => {
    const p = plugin({ signature: SIG });
    recordPluginArtifactVerdict(p, { signature: null, keyId: null, fingerprint: null, artifactSha256: 'ab' });
    expect((await loader().loadPlugin(p)).success).toBe(false);
  });

  it('refuses a malformed signature by name, verdict or not', async () => {
    const p = plugin({ signature: 'nope' });
    recordPluginArtifactVerdict(p, { signature: 'nope', keyId: null, fingerprint: null, artifactSha256: 'ab' });
    const result = await loader().loadPlugin(p);
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/malformed signature/);
  });

  it('leaves a plugin without a signature as it was', async () => {
    expect((await loader().loadPlugin(plugin())).success).toBe(true);
  });

  it('is what kernel.use answers: the unverified signed plugin is not registered', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    await expect(kernel.use(plugin({ signature: SIG }))).rejects.toThrow(/no host verified/);
    expect(kernel.hasPlugin('com.acme.signed')).toBe(false);
  });

  it('keeps the verdict frozen, off the object, and per object', () => {
    const a = plugin();
    const b = plugin();
    recordPluginArtifactVerdict(a, { signature: SIG, keyId: 'k', fingerprint: 'f', artifactSha256: 's' });
    expect(Object.isFrozen(pluginArtifactVerdict(a))).toBe(true);
    expect(Object.keys(a)).not.toContain('verdict');
    expect(pluginArtifactVerdict(b)).toBeUndefined();
  });
});

/** One ustar entry plus the end-of-archive blocks. */
function tarOf(path: string, data: Uint8Array): Uint8Array {
  const h = Buffer.alloc(512, 0);
  h.write(path, 0, 100, 'utf8');
  h.write(data.byteLength.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  const pad = (512 - (data.byteLength % 512)) % 512;
  return new Uint8Array(Buffer.concat([h, Buffer.from(data), Buffer.alloc(pad), Buffer.alloc(1024)]));
}

describe('readTarGz bounds the inflate', () => {
  it('round-trips an archive, and sha256Hex is the plain hex digest', () => {
    const tar = tarOf('dist/index.mjs', new Uint8Array(Buffer.from('export {};\n')));
    expect(readTar(tar)).toEqual([{ path: 'dist/index.mjs', data: new Uint8Array(Buffer.from('export {};\n')) }]);
    expect(readTarGz(gzipSync(tar))).toEqual(readTar(tar));
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('throws naming the bound when an artifact inflates past it', () => {
    // 4 MiB of zeros compresses to a few KiB: a small bomb.
    const bomb = gzipSync(tarOf('zeros.bin', new Uint8Array(4 * 1024 * 1024)));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    expect(() => readTarGz(bomb, { maxUnpackedBytes: 1024 * 1024 })).toThrow(
      /inflates past 1048576 bytes, the most an \.osplugin may unpack to/,
    );
    // Control: the same artifact under the default bound reads.
    expect(readTarGz(bomb)[0].data.byteLength).toBe(4 * 1024 * 1024);
    expect(MAX_UNPACKED_ARTIFACT_BYTES).toBe(256 * 1024 * 1024);
  });

  it('still throws the inflate\'s own error for bytes that are not gzip', () => {
    expect(() => readTarGz(new Uint8Array(Buffer.from('not gzip')))).toThrow(/incorrect header check|Z_DATA_ERROR/);
  });
});

/** One ustar header plus its padded data, with the fields a test varies. */
function entryOf(
  name: string,
  data: Uint8Array,
  options: { typeflag?: string; prefix?: string; magic?: string; size?: number } = {},
): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'utf8');
  h.write((options.size ?? data.byteLength).toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  if (options.typeflag !== undefined) h.write(options.typeflag, 156, 1, 'ascii');
  h.write(options.magic ?? 'ustar\0', 257, 6, 'ascii');
  if (options.prefix !== undefined) h.write(options.prefix, 345, 155, 'utf8');
  const pad = (512 - (data.byteLength % 512)) % 512;
  return Buffer.concat([h, Buffer.from(data), Buffer.alloc(pad)]);
}

describe('readTar reads regular files only', () => {
  const end = Buffer.alloc(1024);
  const body = new Uint8Array(Buffer.from('export {};\n'));

  it('joins a POSIX prefix onto the name, skips a directory entry, and answers views', () => {
    const tar = new Uint8Array(Buffer.concat([
      entryOf('dist', new Uint8Array(0), { typeflag: '5' }),
      entryOf('index.mjs', body, { typeflag: '0', prefix: 'dist' }),
      end,
    ]));
    const files = readTar(tar);
    expect(files.map((f) => f.path)).toEqual(['dist/index.mjs']);
    expect(Buffer.from(files[0].data).toString('utf8')).toBe('export {};\n');
    // A view into the buffer read, not a copy of it.
    expect(files[0].data.buffer).toBe(tar.buffer);
  });

  it('ignores the prefix bytes of a GNU-format header', () => {
    const tar = new Uint8Array(Buffer.concat([entryOf('a.txt', body, { typeflag: '0', magic: 'ustar ', prefix: 'junk' }), end]));
    expect(readTar(tar).map((f) => f.path)).toEqual(['a.txt']);
  });

  it.each([
    ['a symbolic link', '2'],
    ['a hard link', '1'],
    ['a pax extended header', 'x'],
    ['a GNU long-name header', 'L'],
  ])('throws, naming the entry, on %s', (_kind, typeflag) => {
    const tar = new Uint8Array(Buffer.concat([entryOf('dist/index.mjs', body, { typeflag }), end]));
    expect(() => readTar(tar)).toThrow(`the archive entry "dist/index.mjs" is not a regular file or directory (typeflag "${typeflag}")`);
  });

  it('throws on an entry the buffer cuts short, and on a size it cannot read', () => {
    const short = new Uint8Array(entryOf('big.bin', body, { typeflag: '0', size: 4096 }));
    expect(() => readTar(short)).toThrow('the archive entry "big.bin" is cut short: it declares 4096 bytes, and 512 follow');
    const bad = Buffer.concat([entryOf('a.txt', body, { typeflag: '0' }), end]);
    bad.write('zz\0', 124, 3, 'ascii');
    expect(() => readTar(new Uint8Array(bad))).toThrow('the archive entry "a.txt" has no readable size');
  });
});
