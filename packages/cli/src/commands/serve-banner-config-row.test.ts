// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#8978 — the ready banner's `Config:`/`Artifact:` row.
//
// `relativeConfig` is derived from `args.config` at the top of `run()`,
// before the artifact-fallback branch is decided, and used to be handed to
// `printServerReady` unconditionally. On an `OS_ARTIFACT_URL` boot the
// `objectstack.config.ts` in cwd is deliberately never executed — the boot
// diagnostics say so plainly a few lines above the banner — yet the banner
// still named it. The plain artifact-fallback path (no config authored,
// booting from `OS_ARTIFACT_PATH` or the `<cwd>/dist/objectstack.json`
// convention) named a config file that does not exist on disk at all.
//
// This pins `resolveBannerConfigRow`, the pure decision serve.ts's banner
// call site now delegates to, against every boot shape it must distinguish.

import { describe, it, expect } from 'vitest';
import { resolveBannerConfigRow } from './serve.js';

describe('resolveBannerConfigRow (#8978)', () => {
  it('reports the authored config on the ordinary config-boot path', () => {
    expect(resolveBannerConfigRow({
      relativeConfig: 'objectstack.config.ts',
      useArtifactFallback: false,
    })).toEqual({ configFile: 'objectstack.config.ts' });
  });

  it('reports the resolved artifact — never the config — on an OS_ARTIFACT_URL boot', () => {
    // The #8978 repro: `OS_ARTIFACT_URL` set, config never read, but the old
    // code still named `objectstack.config.ts` in the banner.
    expect(resolveBannerConfigRow({
      relativeConfig: 'objectstack.config.ts',
      useArtifactFallback: true,
      pinnedArtifact: { display: 'http://127.0.0.1:41541/hotcrm-2.2.2.json' },
    })).toEqual({ artifactSource: 'http://127.0.0.1:41541/hotcrm-2.2.2.json' });
  });

  it('never emits BOTH a configFile and an artifactSource for the same boot', () => {
    const row = resolveBannerConfigRow({
      relativeConfig: 'objectstack.config.ts',
      useArtifactFallback: true,
      pinnedArtifact: { display: 'https://cdn.example.com/app.json' },
    });
    expect(row.configFile).toBeUndefined();
    expect(row.artifactSource).toBe('https://cdn.example.com/app.json');
  });

  it('omits the row on the plain artifact-fallback path (no config authored, dist/objectstack.json)', () => {
    // The card's second half: no OS_ARTIFACT_URL, no config on disk, booted
    // from the default-host convention. There is no safely-redacted display
    // in hand here (OS_ARTIFACT_PATH may itself be a credentialed URL), so
    // the row is omitted rather than naming a nonexistent config file.
    expect(resolveBannerConfigRow({
      relativeConfig: 'objectstack.config.ts',
      useArtifactFallback: true,
      pinnedArtifact: undefined,
    })).toEqual({});
  });

  it('omits the row on an empty/quick-start boot (no config, no artifact)', () => {
    // `useArtifactFallback` is also set on the `OS_BOOT_EMPTY=1` quick-start
    // path — same defect, same fix: nothing was read, so nothing is named.
    expect(resolveBannerConfigRow({
      relativeConfig: 'objectstack.config.ts',
      useArtifactFallback: true,
    })).toEqual({});
  });
});
