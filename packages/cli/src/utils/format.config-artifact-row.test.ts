// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#8978 — the ready banner's `Config:`/`Artifact:` row must name
// what actually booted. `printServerReady` used to print `opts.configFile`
// unconditionally; the row is now printed only when the caller actually has
// something safe to say (see `resolveBannerConfigRow` in serve.ts for the
// decision, and its own pin test for that half). This file pins the OTHER
// half — printServerReady's own rendering — so a future edit to either
// function cannot silently reintroduce the always-print-configFile bug.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printServerReady, type ServerReadyOptions } from './format.js';

// Built from a char code, never a literal escape spelling, so this source
// file never carries a raw ESC control byte (repo control-byte discipline —
// AGENTS.md — a raw ESC embedded via a regex literal has bitten this exact
// file shape before).
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

describe('printServerReady Config:/Artifact: row (#8978)', () => {
  const base: Omit<ServerReadyOptions, 'configFile' | 'artifactSource'> = {
    port: 3000,
    isDev: true,
    pluginCount: 1,
  };

  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lines = [];
    // stderr, not stdout (#7915) — same capture pattern as the #4801 Tenancy
    // row test.
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' ').replace(ANSI_SGR, ''));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  const configLine = () => lines.find((l) => l.includes('Config:'))?.trim();
  const artifactLine = () => lines.find((l) => l.includes('Artifact:'))?.trim();

  it('prints the Config: row on the ordinary config-boot path', () => {
    printServerReady({ ...base, configFile: 'objectstack.config.ts' });
    expect(configLine()).toBe('Config:  objectstack.config.ts');
    expect(artifactLine()).toBeUndefined();
  });

  it('prints an Artifact: row instead of Config: when artifactSource is set (OS_ARTIFACT_URL, #8368)', () => {
    // The #8978 repro, at the rendering layer: even if a caller mistakenly
    // passed both, the resolved artifact must win and the config must never
    // appear — it was not read.
    printServerReady({
      ...base,
      configFile: 'objectstack.config.ts',
      artifactSource: 'http://127.0.0.1:41541/hotcrm-2.2.2.json',
    });
    expect(artifactLine()).toBe('Artifact: http://127.0.0.1:41541/hotcrm-2.2.2.json (OS_ARTIFACT_URL)');
    expect(configLine()).toBeUndefined();
  });

  it('omits BOTH rows when the caller has nothing safe to report (plain artifact-fallback path)', () => {
    // No configFile, no artifactSource — the plain `dist/objectstack.json`
    // fallback and the empty/quick-start boot. Absence beats a fabricated
    // or nonexistent-file claim.
    printServerReady({ ...base });
    expect(configLine()).toBeUndefined();
    expect(artifactLine()).toBeUndefined();
  });
});
