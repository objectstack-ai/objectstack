// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import * as coreBarrel from '../index.js';
import * as securityBarrel from './index.js';

// ─── [#14919] `PluginSecurityScanner` is RETIRED ────────────────────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-09-05 (director summon
// #14, decision batch #42). The class, its two companion types (`ScanTarget`,
// `SecurityIssue`), its `packages/core/examples/phase2-integration.ts`
// demonstration and the `PHASE2_IMPLEMENTATION.md` section that advertised it
// are all gone. There is NO replacement export, and repair — writing a real
// vulnerability scanner — was refused by name: it is a feature with a design
// surface, not a repair.
//
// WHAT IT ACTUALLY DID, which is why removal beat repair. `scan()` composed
// five private scanners and scored the result. Four of them — `scanCode`,
// `scanMalware`, `scanLicenses`, `scanConfiguration` — allocated an empty
// issue array, logged, and returned it, with no code between; they could not
// report a finding for any input. The fifth, `scanDependencies`, ran a real
// loop, but only ever matched against `vulnerabilityDb`, an in-memory Map
// whose sole writer was the public `addVulnerability` — which had zero callers
// in this repo, in objectui at the pinned sha, and in the example itself.
// `updateVulnerabilityDatabase()` logged twice and fetched nothing. So the
// database was empty on every code path that has ever executed, no issue was
// ever produced, the score stayed 100, and `status` was `'passed'` for every
// plugin the scanner was ever handed — a malicious one included. That is the
// Prime Directive #10 shape exactly: a security capability advertised on the
// public barrel and delivered by nothing.
//
// ⛔ WHY THIS IS AN EXPORT-LIST ASSERTION AND NOT A GREP. The ruling asks for
// the symbol's absence from a published SURFACE, and a grep cannot answer
// that: the name legitimately survives in this file, in the tombstone comment
// on `./index.ts`, and in the retired section of `PHASE2_IMPLEMENTATION.md` —
// a grep pin would go red on the tombstones that exist to explain the
// retirement, and would stay green if someone re-exported the class under a
// different local name. Reading the barrels' own export lists asks the
// question a consumer's `import` asks.
//
// ⚠️ ON THE SECOND SURFACE. The ruling names `@objectstack/core/security`.
// Measured at head: `packages/core/package.json` declares exactly two
// `exports` entries, `.` and `./logger` — there is no `./security` subpath,
// so that specifier resolves for no consumer of the published package and
// never has (`PHASE2_IMPLEMENTATION.md` sections 4 and 5 still teach it; filed
// separately, since the two repairs differ in whether they widen the published
// contract). This pin therefore reads the in-repo module that a `./security`
// subpath would name — `src/security/index.ts` — which is the surface that
// would carry the symbol outward the moment anyone declares the subpath.
// Pinning it here means the retirement survives that declaration.

const RETIRED = 'PluginSecurityScanner';

describe('[#14919] PluginSecurityScanner retirement', () => {
  it(`is absent from @objectstack/core's export list`, () => {
    expect(Object.keys(coreBarrel)).not.toContain(RETIRED);
  });

  it(`is absent from the security barrel's export list (@objectstack/core/security)`, () => {
    expect(Object.keys(securityBarrel)).not.toContain(RETIRED);
  });

  // The assertions above are only worth anything if these export lists are
  // real — a barrel that failed to load, or a namespace object read the wrong
  // way, would answer "absent" for every name ever asked about and pass
  // forever. Two survivors from the SAME retired file's neighbourhood prove
  // the lists are populated and that this is the surface the class stood on:
  // `PluginSandboxRuntime` is the export block immediately above the retired
  // one in `./index.ts`, and it reaches the root barrel by the same
  // `export * from './security/index.js'` line the scanner used.
  it('reads populated export lists (control)', () => {
    expect(Object.keys(securityBarrel)).toContain('PluginSandboxRuntime');
    expect(Object.keys(coreBarrel)).toContain('PluginSandboxRuntime');
  });
});
