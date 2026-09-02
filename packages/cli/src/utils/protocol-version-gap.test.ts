// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { checkProtocolVersionGap } from './protocol-version-gap.js';

/** A minimal manifest the schema accepts, plus whatever the case is about. */
function manifest(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'com.acme.crm',
    namespace: 'acme',
    version: '1.0.0',
    type: 'app',
    name: 'Acme CRM',
    ...extra,
  };
}

describe('checkProtocolVersionGap', () => {
  // ── The reachability this advisory never had ───────────────────────────
  //
  // Before the axis moved, the advisory read `manifest.specVersion` — a key
  // `ManifestSchema` does not declare, on a schema that is not `.strict()`.
  // It was therefore DEAD for stack configs: it could only fire for a manifest
  // carrying a key the schema does not offer. These two cases are the pins for
  // that: the axis it reads now survives the schema parse, and the axis it
  // retired does not. Assert them THROUGH `ManifestSchema.parse` rather than on
  // a hand-built literal — a literal would prove the function works on input
  // the platform never produces, which is exactly the state being repaired.

  it('FIRES for a gap on a manifest the schema actually declares', () => {
    const parsed = ManifestSchema.parse(manifest({ engines: { protocol: '^16' } }));
    expect(parsed.engines?.protocol, 'engines.protocol must survive the parse').toBe('^16');

    const gap = checkProtocolVersionGap(parsed, '17.2.0');
    expect(gap, 'a declared, schema-visible range behind the platform must advise').not.toBeNull();
    expect(gap!.declaredMajor).toBe(16);
    expect(gap!.installedMajor).toBe(17);
    expect(gap!.installedVersion).toBe('17.2.0');
    expect(gap!.url).toBe('https://objectstack.ai/docs/releases/v17');
    expect(gap!.message).toContain("engines.protocol '^16'");
    expect(gap!.hint).toContain('https://objectstack.ai/docs/releases/v17');
  });

  it('is silent for the RETIRED `specVersion` key, which the schema drops', () => {
    // The pin the old suite spent on `checkSpecVersionGap({ specVersion:
    // '^12.0.0' }, '14.7.0')`, re-aimed at the contract that replaced it.
    // `ManifestSchema` is not `.strict()`, so the key is accepted and dropped
    // with nothing said — the silence that made the old advisory unreachable.
    const parsed = ManifestSchema.parse(manifest({ specVersion: '^12.0.0' })) as Record<string, unknown>;
    expect(parsed.specVersion, 'ManifestSchema does not declare specVersion').toBeUndefined();
    expect(checkProtocolVersionGap({ specVersion: '^12.0.0' }, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap(parsed, '17.2.0')).toBeNull();
  });

  it('is silent when the declared range covers the installed platform', () => {
    // The shape every scaffold and example stamps today.
    const parsed = ManifestSchema.parse(manifest({ engines: { protocol: '^17' } }));
    expect(checkProtocolVersionGap(parsed, '17.2.0')).toBeNull();
  });

  // ── Direction, target and guide ────────────────────────────────────────

  it('points at the guide for the INSTALLED major, not the declared one', () => {
    // Two-major jump (15 → 17): the guide must be v17, the version on disk.
    const gap = checkProtocolVersionGap({ engines: { protocol: '^15' } }, '17.0.0');
    expect(gap!.url).toBe('https://objectstack.ai/docs/releases/v17');
    expect(gap!.declaredMajor).toBe(15);
  });

  it('is silent when the app targets a NEWER major (stale install, out of scope)', () => {
    expect(checkProtocolVersionGap({ engines: { protocol: '^18' } }, '17.2.0')).toBeNull();
  });

  it('is silent when no compatibility range is declared', () => {
    expect(checkProtocolVersionGap(manifest({}), '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap({ engines: {} }, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap({}, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap(undefined, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap(null, '17.2.0')).toBeNull();
  });

  it('is silent when the installed version cannot be resolved', () => {
    expect(checkProtocolVersionGap({ engines: { protocol: '^15' } }, null)).toBeNull();
  });

  // ── Range grammar is the handshake's, not a second opinion ─────────────

  it('advises across the range spellings that pin a single older major', () => {
    for (const range of ['^15', '^15.0.0', '~15.3.0', '15.x', '15.0.0']) {
      const gap = checkProtocolVersionGap({ engines: { protocol: range } }, '17.0.0');
      expect(gap, range).not.toBeNull();
      expect(gap!.declaredMajor, range).toBe(15);
    }
  });

  it('stays silent on a multi-major range that ADMITS the installed platform', () => {
    // The case a leading-integer parse of our own would get wrong: `>=15 <18`
    // targets 15 but explicitly covers 17, so there is nothing to advise. The
    // verdict comes from `checkProtocolCompat`, the same reader the boot
    // handshake uses — the advisory cannot disagree with what the loader does.
    expect(checkProtocolVersionGap({ engines: { protocol: '>=15 <18' } }, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap({ engines: { protocol: '15 - 17' } }, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap({ engines: { protocol: '*' } }, '17.2.0')).toBeNull();
  });

  it('advises on a bounded range that EXCLUDES the installed platform', () => {
    const gap = checkProtocolVersionGap({ engines: { protocol: '>=15 <17' } }, '17.2.0');
    expect(gap).not.toBeNull();
    expect(gap!.declaredMajor).toBe(15);
    expect(gap!.installedMajor).toBe(17);
  });

  it('is silent on a range shape the handshake cannot parse', () => {
    // `unparsed-range` is admitted at load with a warning, never refused, so
    // the advisory must not speak where the loader does not.
    expect(checkProtocolVersionGap({ engines: { protocol: 'not-a-range' } }, '17.2.0')).toBeNull();
  });

  // ── Source priority, named honestly ────────────────────────────────────

  it('falls back to engines.platform and names the key it actually read', () => {
    const gap = checkProtocolVersionGap({ engines: { platform: '^15' } }, '17.2.0');
    expect(gap).not.toBeNull();
    expect(gap!.message).toContain("engines.platform '^15'");
    expect(gap!.hint).toContain('bumping engines.platform');
  });

  it('falls back to the legacy engine.objectstack and names it', () => {
    const gap = checkProtocolVersionGap({ engine: { objectstack: '^15.0.0' } }, '17.2.0');
    expect(gap).not.toBeNull();
    expect(gap!.message).toContain("engine.objectstack '^15.0.0'");
  });

  it('prefers engines.protocol over the other two sources', () => {
    const gap = checkProtocolVersionGap(
      { engines: { protocol: '^15', platform: '^9' }, engine: { objectstack: '^3' } },
      '17.2.0',
    );
    expect(gap!.declaredMajor).toBe(15);
    expect(gap!.message).toContain('engines.protocol');
  });

  // ── The advisory must never be what fails a command ────────────────────

  it('tolerates a non-string range without throwing', () => {
    // `doctor` hands over an unvalidated `normalizeStackInput` result, so this
    // reaches the util as raw JSON. `resolveDeclaredRange` calls `.trim()`; an
    // advisory that throws here would turn a print-only check into a command
    // failure.
    expect(() => checkProtocolVersionGap({ engines: { protocol: 17 } }, '17.2.0')).not.toThrow();
    expect(checkProtocolVersionGap({ engines: { protocol: 17 } }, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap({ engines: null }, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap({ engines: 'nope' }, '17.2.0')).toBeNull();
    expect(checkProtocolVersionGap('not an object', '17.2.0')).toBeNull();
  });

  it('raises no advisory when the installed version is unreadable', () => {
    expect(checkProtocolVersionGap({ engines: { protocol: '^15' } }, 'not-a-version')).toBeNull();
  });
});
