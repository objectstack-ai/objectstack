// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  RuntimeMode,
  KernelContextSchema,
  TenantRuntimeContextSchema,
} from './context.zod';
import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#11846] Preview mode is RETIRED: the `'preview'` RuntimeMode value and
//     the whole `previewMode` / `PreviewModeConfig` block ────────────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-08-27 (Option A: remove).
// The declaration promised an auth bypass — "skips authentication screens",
// "simulates an admin identity", with a docstring naming a production guard
// "the runtime must enforce" — and NOTHING implemented any of it. Measured
// three-repo zero consumers (objectstack in-card + re-verified at dispatch;
// objectui in-card; cloud#1651 with positive controls on 2026-08-26): no
// runtime branches on the mode, nothing reads any of the six config keys, and
// `OS_PREVIEW_MODE` is deployment ROUTING, unrelated to identity — it stays.
//
// Two rejection sites, three bookkeeping shapes:
//
//   1. `mode: 'preview'` — enum-VALUE narrowing. Invisible to the four
//      surface ratchets (no def changed), so the prescription hangs on the
//      enum's own error map (the `HookBodyCapability` / `crypto.hash`
//      precedent), dispatched by `issue.input`.
//   2. `previewMode:` — `retiredKey()` tombstone on the non-strict
//      `KernelContextSchema` (a bare deletion would be a SILENT STRIP,
//      #3733 / ADR-0104). `TenantRuntimeContextSchema` extends the shape, so
//      the tombstone lands in that walked shape too; both keys are registered
//      in `RETIRED_KEYS_BY_MAJOR[18]`.
//   3. `PreviewModeConfigSchema` + its 2 types — orphan value schema, def
//      removed whole (`kernel/PreviewModeConfig` in `RETIRED_DEFS_BY_MAJOR[18]`;
//      an exported value schema with no consumer reads as a capability, #3950).
//
// No D2 conversion, deliberately: a kernel context is constructed by HOST CODE
// at boot — it is not a stack collection member and nothing stores one as a
// `sys_metadata` row, so the conversion chain has no seam that would ever see
// it (the `kernel/Manifest:loading` precedent). The D3 semantic entry
// `kernel-context-preview-mode-retired` carries the prescription outward.
//
// On the assertion set (the #8586 precedent, same reasoning): a schema refusal
// raises a `ZodError` whose issues carry `code` and `path` but no ADR-0112
// `status` — that envelope belongs to the API error surface. So these pins
// assert the strongest set this surface really has: refusal, the issue `code`,
// the `path` naming WHICH site refused, and the prescription text (#5240:
// where the wording is the contract, pin the wording).
describe("[#11846] RuntimeMode 'preview' retirement", () => {
  it("no longer offers 'preview' as a mode", () => {
    expect(RuntimeMode.options).toEqual([
      'development',
      'production',
      'test',
      'provisioning',
    ]);
    expect(RuntimeMode.options).not.toContain('preview');
  });

  it("REJECTS mode: 'preview', carrying the retirement prescription", () => {
    const result = RuntimeMode.safeParse('preview');
    expect(result.success).toBe(false);
    if (result.success) return; // narrowing; the assertion above already failed

    const message = JSON.stringify(result.error.issues);
    // The prescription itself, not a bare "invalid enum value": it must name
    // the value, say it was removed, and tell the author what to do instead.
    expect(message).toMatch(/`context\.mode: 'preview'`.*was removed.*17/s);
    expect(message).toMatch(/no layer of the platform ever branched on it/s);
    expect(message).toMatch(/Delete the value/s);
    // The live mechanism must be named: preview DEPLOYMENTS are the
    // deployment layer's job, and the env var that stays is routing-only.
    expect(message).toMatch(/OS_PREVIEW_MODE.*routing-only/s);
    // The recorded fallback: re-declaring is fresh, production refusal first.
    expect(message).toMatch(/production-posture hard-refusal.*first-landed half/s);
  });

  it('REJECTS it through the context embed too, at path `mode`', () => {
    const result = KernelContextSchema.safeParse({
      instanceId: '550e8400-e29b-41d4-a716-446655440000',
      mode: 'preview',
      version: '1.0.0',
      cwd: '/app',
      startTime: Date.now(),
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'mode');
    expect(issue, 'the refusal must land at `mode`').toBeDefined();
    expect(issue!.message).toMatch(/`context\.mode: 'preview'`.*was removed/s);
  });

  it("gives an UNKNOWN mode zod's own message, not the retirement one", () => {
    // Only the value that used to be legal gets "was removed" — telling the
    // author of a typo that their mode was retired would misinform.
    const result = RuntimeMode.safeParse('previeww');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).not.toMatch(/was removed/);
  });
});

describe('[#11846] KernelContext.previewMode retirement', () => {
  const baseContext = {
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    mode: 'production',
    version: '1.0.0',
    cwd: '/app',
    startTime: Date.now(),
  } as const;

  /** The block exactly as the retired docs taught authors to write it. */
  const authoredBlock = { autoLogin: true, simulatedRole: 'admin' } as const;

  it('REJECTS an authored `previewMode` block, naming the key and carrying the fix', () => {
    const result = KernelContextSchema.safeParse({
      ...baseContext,
      previewMode: authoredBlock,
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'previewMode');
    expect(issue, 'the refusal must name `previewMode`').toBeDefined();
    // The machine-readable half of the envelope this surface actually has:
    // a `retiredKey()` tombstone raises `invalid_type` from its `z.never()`.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['previewMode']);
    // The prescription IS the migration doc for whoever hits it — contract,
    // not commentary.
    expect(issue!.message).toMatch(/`context\.previewMode`.*was removed.*17/s);
    expect(issue!.message).toMatch(/nothing ever read the block/s);
    expect(issue!.message).toMatch(/Delete the key/s);
    // The live mechanism: the deployment layer owns preview deployments.
    expect(issue!.message).toMatch(/deployment layer/s);
    expect(issue!.message).toMatch(/OS_PREVIEW_MODE.*routing-only/s);
  });

  it('REJECTS it through TenantRuntimeContextSchema too (the `.extend()` copy)', () => {
    const result = TenantRuntimeContextSchema.safeParse({
      ...baseContext,
      tenantId: 'tenant_abc',
      tenantPlan: 'pro',
      tenantDbUrl: 'libsql://tenant-abc-myorg.turso.io',
      previewMode: authoredBlock,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'previewMode');
    expect(issue, 'the refusal must surface on the tenant context too').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(/`context\.previewMode`.*was removed/s);
  });

  it('parses cleanly once the key is deleted, and grows no `previewMode` property', () => {
    const parsed = KernelContextSchema.parse({ ...baseContext });
    expect(parsed.mode).toBe('production'); // control: the live keys still work
    // The non-strict strip path: absence must stay absence. If the tombstone
    // were ever replaced by a plain deletion, an authored `previewMode` would
    // be stripped here in silence — this pin plus the rejections above are
    // what make that regression loud.
    expect(parsed).not.toHaveProperty('previewMode');
  });
});

describe('[#11846] kernel/PreviewModeConfig def retirement', () => {
  /** The 3 names the retired def exported (1 schema const + 2 types). */
  const RETIRED_NAMES = [
    'PreviewModeConfigSchema',
    'PreviewModeConfig',
    'PreviewModeConfigParsed',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the carrier survives', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './kernel']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(
      exportNamesOf('./kernel').length,
      './kernel must export a non-trivial surface',
    ).toBeGreaterThan(50);

    // ── ABSENCE (every entry, not just ./kernel) ──────────────────────────
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #11846`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    // The context module itself stays: the carrier def and its neighbours are
    // untouched — this retirement is a narrowing, not a module sweep.
    const kernelNames = exportNamesOf('./kernel');
    for (const name of [
      'RuntimeMode',
      'KernelContextSchema',
      'TenantRuntimeContextSchema',
    ]) {
      expect(kernelNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the kernel barrel resolves without the retired schema and keeps the survivors', async () => {
    const kernel = await import('./index');
    expect(kernel).not.toHaveProperty('PreviewModeConfigSchema');
    // Anti-vacuity: the barrel really resolved and still exports the carrier.
    expect(kernel).toHaveProperty('KernelContextSchema');
    expect(kernel).toHaveProperty('RuntimeMode');
  });
});
