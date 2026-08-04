// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5262 — `os verify` decides whether to run its multi-tenant proofs from the
// AUTHORITATIVE tenancy posture, never the demoted `OS_MULTI_ORG_ENABLED`.
//
// ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
// `OS_MULTI_ORG_ENABLED` to a back-compat INPUT of `resolveTenancyPosture()`.
// The command kept calling `resolveMultiOrgEnabled()`, so on a deployment
// configured the documented way (posture knob only, which is exactly what v17's
// own docs tell an operator to set) `os verify` booted a SINGLE-ORG stack and
// silently skipped every multi-tenant proof — then exited 0.
//
// This is the worst site in the #5262 sweep for the defect to have landed. The
// other five produce wrong behaviour that some later signal can still catch;
// this one produces a GREEN VERIFICATION RUN over an unverified property, and a
// verifier that under-verifies reports success it never established. Same
// defect shape as cloud#1020 and #5233.
//
// ── Evidence boundary (stated plainly) ──────────────────────────────────────
// This pins `resolveVerifyMultiTenant`, the exported decision, not an
// end-to-end `os verify` invocation. That is this package's established shape
// for command-level decisions — `describeRegisteredDriver` in `serve.ts` is
// tested exactly this way — because the alternative boots two full kernels per
// scenario. The command body is a single call to this function, so the wiring
// it does not cover is one line. Nothing about the RESOLVER is stubbed: the
// real env vars are set and the real `resolveTenancyPosture()` folds them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveVerifyMultiTenant } from './verify.js';

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_LEGACY = process.env.OS_MULTI_ORG_ENABLED;

const under = (
  env: { posture?: string; legacy?: string },
  flags: { 'multi-tenant'?: boolean } = {},
) => {
  if (env.posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = env.posture;
  if (env.legacy === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = env.legacy;
  return resolveVerifyMultiTenant(flags);
};

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_MULTI_ORG_ENABLED;
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_LEGACY === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
  else process.env.OS_MULTI_ORG_ENABLED = OLD_LEGACY;
});

describe('#5262 — os verify keys its multi-tenant suite off OS_TENANCY_POSTURE', () => {
  it('posture-only deployment (OS_TENANCY_POSTURE=isolated, legacy boolean UNSET) verifies multi-tenant', () => {
    // THE regression. Before the fix this run silently proved nothing about
    // tenant isolation and still exited 0.
    expect(under({ posture: 'isolated' })).toBe(true);
  });

  it('`group` is a walled posture too — not just `isolated`', () => {
    // `group` has no legacy-boolean spelling at all, so under the bug NO
    // configuration could get `os verify` to exercise a group deployment.
    expect(under({ posture: 'group' })).toBe(true);
  });

  it('legacy-boolean-only deployment keeps working — back-compat via the posture resolver', () => {
    expect(under({ legacy: 'true' })).toBe(true);
  });

  it('single-org deployments still run the single-org suite', () => {
    // Intent unchanged — only the knob is corrected.
    expect(under({ posture: 'single' })).toBe(false);
    expect(under({ legacy: 'false' })).toBe(false);
    expect(under({})).toBe(false);
  });

  it('an explicit legacy `false` does not veto the authoritative posture', () => {
    expect(under({ posture: 'isolated', legacy: 'false' })).toBe(true);
  });

  it('--multi-tenant still forces the suite on regardless of environment', () => {
    // The flag is an explicit operator request and stays independent of the
    // env: `os verify --multi-tenant` on an unconfigured box is how a developer
    // proves the multi-org path locally.
    expect(under({}, { 'multi-tenant': true })).toBe(true);
    expect(under({ posture: 'single' }, { 'multi-tenant': true })).toBe(true);
    expect(under({ legacy: 'false' }, { 'multi-tenant': true })).toBe(true);
  });

  it('an absent flag object behaves like an unset flag', () => {
    expect(under({ posture: 'single' }, {})).toBe(false);
    expect(under({ posture: 'isolated' }, {})).toBe(true);
  });
});
