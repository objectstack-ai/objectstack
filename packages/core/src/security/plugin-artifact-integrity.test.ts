// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  verifyIntegrity,
  formatIntegrityViolation,
  type IntegrityFile,
} from './plugin-artifact-integrity.js';

function sri(data: Uint8Array, alg = 'sha256'): string {
  return `${alg}-${createHash(alg).update(data).digest('base64')}`;
}

const codeBytes = new Uint8Array(Buffer.from('export const x = 1;\n'));
const assetBytes = new Uint8Array(Buffer.from('body { color: red }\n'));

function files(): IntegrityFile[] {
  return [
    { path: 'dist/index.mjs', data: codeBytes },
    { path: 'assets/app.css', data: assetBytes },
  ];
}

describe('verifyIntegrity', () => {
  it('passes when every declared digest matches and every file is declared', () => {
    const res = verifyIntegrity(files(), {
      'dist/index.mjs': sri(codeBytes),
      'assets/app.css': sri(assetBytes),
    });
    expect(res).toEqual({ ok: true, skipped: false, checked: 2, violations: [] });
  });

  it('refuses on a single-file digest mismatch, naming declared and actual', () => {
    const declared = sri(new Uint8Array(Buffer.from('tampered')));
    const res = verifyIntegrity(files(), {
      'dist/index.mjs': declared,
      'assets/app.css': sri(assetBytes),
    });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.checked).toBe(2);
    expect(res.violations).toEqual([
      { kind: 'digest_mismatch', path: 'dist/index.mjs', declared, actual: sri(codeBytes) },
    ]);
  });

  it('refuses when a declared entry has no corresponding file', () => {
    const res = verifyIntegrity([files()[0]], {
      'dist/index.mjs': sri(codeBytes),
      'assets/app.css': sri(assetBytes),
    });
    expect(res.ok).toBe(false);
    expect(res.violations).toEqual([
      { kind: 'missing_file', path: 'assets/app.css', declared: sri(assetBytes) },
    ]);
  });

  it('refuses on a file the integrity map does not declare (stale-map drift)', () => {
    const res = verifyIntegrity(files(), { 'dist/index.mjs': sri(codeBytes) });
    expect(res.ok).toBe(false);
    expect(res.violations).toEqual([{ kind: 'extra_file', path: 'assets/app.css' }]);
  });

  it('absent map is a permissive pass (the manifest field is optional): ok + skipped, nothing checked', () => {
    for (const absent of [undefined, null] as const) {
      const res = verifyIntegrity(files(), absent);
      expect(res).toEqual({ ok: true, skipped: true, checked: 0, violations: [] });
    }
  });

  it('exempt paths are outside the map coverage in both directions', () => {
    const manifestFile: IntegrityFile = {
      path: 'objectstack.plugin.json',
      data: new Uint8Array(Buffer.from('{}')),
    };
    const res = verifyIntegrity([...files(), manifestFile], {
      'dist/index.mjs': sri(codeBytes),
      'assets/app.css': sri(assetBytes),
      // A (mis)declared exempt entry is skipped rather than compared.
      'objectstack.plugin.json': 'sha256-not-checked',
    }, { exempt: ['objectstack.plugin.json'] });
    expect(res).toEqual({ ok: true, skipped: false, checked: 2, violations: [] });
  });

  it('verifies sha384/sha512 SRI digests by their own algorithm', () => {
    const res = verifyIntegrity(files(), {
      'dist/index.mjs': sri(codeBytes, 'sha512'),
      'assets/app.css': sri(assetBytes, 'sha384'),
    });
    expect(res.ok).toBe(true);
    expect(res.checked).toBe(2);
  });

  it('an unrecognized digest shape is a mismatch (compared as sha256), never a silent pass', () => {
    const res = verifyIntegrity([files()[0]], { 'dist/index.mjs': 'md5-abc' });
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toMatchObject({
      kind: 'digest_mismatch',
      path: 'dist/index.mjs',
      declared: 'md5-abc',
      actual: sri(codeBytes),
    });
  });

  it('reports every violation, deterministically ordered (map order, then sorted extras)', () => {
    const res = verifyIntegrity(
      [files()[1], { path: 'dist/extra.mjs', data: codeBytes }],
      {
        'dist/index.mjs': sri(codeBytes),
        'assets/app.css': sri(codeBytes), // wrong bytes declared
      },
    );
    expect(res.ok).toBe(false);
    expect(res.violations.map((v) => `${v.kind}:${v.path}`)).toEqual([
      'missing_file:dist/index.mjs',
      'digest_mismatch:assets/app.css',
      'extra_file:dist/extra.mjs',
    ]);
  });
});

describe('formatIntegrityViolation', () => {
  it('renders one actionable line per kind', () => {
    expect(
      formatIntegrityViolation({ kind: 'digest_mismatch', path: 'a', declared: 'sha256-x', actual: 'sha256-y' }),
    ).toContain('digest mismatch');
    expect(formatIntegrityViolation({ kind: 'missing_file', path: 'a', declared: 'sha256-x' })).toContain(
      'absent from the artifact',
    );
    expect(formatIntegrityViolation({ kind: 'extra_file', path: 'a' })).toContain('not in the integrity map');
  });
});
