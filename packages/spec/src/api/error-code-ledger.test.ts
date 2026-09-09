// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { StandardErrorCode } from './errors.zod';
import {
  ERROR_CODE_LEDGER,
  REGISTERED_ERROR_CODES,
  ErrorCode,
  STANDARD_SYNONYM_WAIVERS,
  StandardSynonymWaiverSchema,
  standardSynonymOf,
  standardSynonymViolations,
  type StandardSynonymWaiver,
} from './error-code-ledger.zod';

/**
 * Ledger admission rules (ADR-0112 D3). These are the invariants that make a
 * registered code a catalogued one rather than an invented string — keep them
 * in sync with the registration instructions in `error-code-ledger.ts`.
 */
describe('ERROR_CODE_LEDGER', () => {
  const entries = Object.entries(ERROR_CODE_LEDGER);

  it('every registered code is SCREAMING_SNAKE', () => {
    for (const [pkg, codes] of entries) {
      for (const code of codes) {
        expect(code, `${pkg} → ${code}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it('no package registers the same code twice', () => {
    for (const [pkg, codes] of entries) {
      expect(new Set(codes).size, `duplicate code in ${pkg}`).toBe(codes.length);
    }
  });

  it('no registered code shadows the standard catalog', () => {
    const standard = new Set<string>(StandardErrorCode.options);
    for (const [pkg, codes] of entries) {
      for (const code of codes) {
        expect(standard.has(code), `${pkg} → ${code} is already a StandardErrorCode`).toBe(false);
      }
    }
  });

  it('owner keys are package names', () => {
    for (const [pkg] of entries) {
      expect(pkg).toMatch(/^@objectstack\/[a-z0-9-]+$/);
    }
  });

  it('REGISTERED_ERROR_CODES is the deduped, sorted union', () => {
    const union = [...new Set(entries.flatMap(([, codes]) => [...codes]))].sort();
    expect([...REGISTERED_ERROR_CODES]).toEqual(union);
  });

  it('no registered code is an unwaived semantic synonym of a standard member (#8211)', () => {
    // The ledger header's "use the standard catalog instead of registering a
    // synonym" was prose only, and four synonyms accumulated under it without
    // anyone deciding to allow them. This is its mechanical form (option C,
    // adjudicated 2026-08-12): a synonym registers only with a recorded
    // STANDARD_SYNONYM_WAIVERS entry naming the member it shadows.
    expect(standardSynonymViolations(ERROR_CODE_LEDGER, STANDARD_SYNONYM_WAIVERS)).toEqual([]);
  });
});

describe('standard-synonym detection (#8211)', () => {
  it('flags the grandfathered synonyms, each against the member it shadows', () => {
    expect(standardSynonymOf('CONFLICT')).toBe('RESOURCE_CONFLICT');
    expect(standardSynonymOf('NOT_FOUND')).toBe('RESOURCE_NOT_FOUND');
    expect(standardSynonymOf('FORBIDDEN')).toBe('PERMISSION_DENIED');
    expect(standardSynonymOf('INTERNAL')).toBe('INTERNAL_ERROR');
    // Surfaced by the detector beyond the four #8211 named — same class
    // (401 reason phrase), grandfathered by the same rationale.
    expect(standardSynonymOf('UNAUTHORIZED')).toBe('UNAUTHENTICATED');
  });

  it('does not flag domain-prefixed or catalog-uncovered codes', () => {
    // A domain prefix carries a token no standard member has — exactly the
    // shape the registration instructions endorse.
    expect(standardSynonymOf('FORM_NOT_FOUND')).toBeUndefined();
    expect(standardSynonymOf('ATTACHMENT_DOWNLOAD_DENIED')).toBeUndefined();
    // 413 is deliberately judged against the explicit HttpStatusErrorCodeMap,
    // never the bucket fallback: no standard member covers its condition, so
    // its reason phrase is a legitimate registration, not a synonym.
    expect(standardSynonymOf('PAYLOAD_TOO_LARGE')).toBeUndefined();
    // Near-misses stay admitted: FAILED is not a token of VALIDATION_ERROR.
    expect(standardSynonymOf('VALIDATION_FAILED')).toBeUndefined();
    expect(standardSynonymOf('UNSUPPORTED')).toBeUndefined();
  });

  it('REJECTS a newly-introduced synonym of a standard member — both prongs', () => {
    // The hard constraint this card adopted from review: a detector that only
    // passes on today's tree is the exact failure mode the prose rule already
    // had. Prove the SAME function that gates the real ledger goes red when a
    // new synonym lands, once per detection prong.
    // Prong 1 — reason-phrase alias (429 → RATE_LIMIT_EXCEEDED):
    const withReasonPhrase = {
      ...ERROR_CODE_LEDGER,
      '@objectstack/rest': [...ERROR_CODE_LEDGER['@objectstack/rest'], 'TOO_MANY_REQUESTS'],
    };
    expect(standardSynonymViolations(withReasonPhrase, STANDARD_SYNONYM_WAIVERS)).toEqual([
      { package: '@objectstack/rest', code: 'TOO_MANY_REQUESTS', shadows: 'RATE_LIMIT_EXCEEDED' },
    ]);
    // Prong 2 — token subset (RATE_LIMIT ⊆ RATE_LIMIT_EXCEEDED):
    const withTokenSubset = {
      ...ERROR_CODE_LEDGER,
      '@objectstack/core': [...ERROR_CODE_LEDGER['@objectstack/core'], 'RATE_LIMIT'],
    };
    expect(standardSynonymViolations(withTokenSubset, STANDARD_SYNONYM_WAIVERS)).toEqual([
      { package: '@objectstack/core', code: 'RATE_LIMIT', shadows: 'RATE_LIMIT_EXCEEDED' },
    ]);
  });

  it('a waiver admits exactly the (code, shadows) pair it records', () => {
    const withNew = {
      ...ERROR_CODE_LEDGER,
      '@objectstack/rest': [...ERROR_CODE_LEDGER['@objectstack/rest'], 'TOO_MANY_REQUESTS'],
    };
    const rightWaiver: StandardSynonymWaiver = {
      code: 'TOO_MANY_REQUESTS',
      shadows: 'RATE_LIMIT_EXCEEDED',
      reason: 'test fixture: recorded reason',
    };
    expect(standardSynonymViolations(withNew, [...STANDARD_SYNONYM_WAIVERS, rightWaiver]))
      .toEqual([]);
    // A waiver naming the WRONG member does not admit the code — the recorded
    // reason must be about the member actually shadowed.
    const wrongWaiver: StandardSynonymWaiver = {
      code: 'TOO_MANY_REQUESTS',
      shadows: 'QUOTA_EXCEEDED',
      reason: 'test fixture: wrong member on purpose',
    };
    expect(standardSynonymViolations(withNew, [...STANDARD_SYNONYM_WAIVERS, wrongWaiver]))
      .toHaveLength(1);
  });

  it('every waiver is well-formed, still registered, and names the member the detector derives', () => {
    const seen = new Set<string>();
    for (const waiver of STANDARD_SYNONYM_WAIVERS) {
      const parsed = StandardSynonymWaiverSchema.safeParse(waiver);
      expect(parsed.success, `${waiver.code} waiver parses`).toBe(true);
      expect(seen.has(waiver.code), `duplicate waiver for ${waiver.code}`).toBe(false);
      seen.add(waiver.code);
      // Stale-waiver guard: a waiver for a code no longer registered, or one
      // the detector no longer flags as a synonym of exactly the member it
      // names, is dead weight — it must come out with the condition it waived.
      expect(REGISTERED_ERROR_CODES, `${waiver.code} is still registered`).toContain(waiver.code);
      expect(standardSynonymOf(waiver.code), `${waiver.code} shadows`).toBe(waiver.shadows);
    }
  });

  it('dropping a waiver reddens the gate for every package registering that code', () => {
    // Reverse direction, asserted rather than hand-run: the grandfather
    // entries are load-bearing, not decorative.
    const withoutForbidden = STANDARD_SYNONYM_WAIVERS.filter((w) => w.code !== 'FORBIDDEN');
    const violations = standardSynonymViolations(ERROR_CODE_LEDGER, withoutForbidden);
    expect(violations.map((v) => v.package).sort()).toEqual([
      // cloud-connection joined with #13353's provenance row for the same
      // pre-existing wire value (the marketplace-install plugin-route 403) —
      // the waiver admits the (code, shadows) pair, so a new emitter listing
      // widens this reverse pin, never the waiver table.
      '@objectstack/cloud-connection',
      '@objectstack/plugin-approvals',
      '@objectstack/plugin-sharing',
      '@objectstack/rest',
    ]);
    expect(new Set(violations.map((v) => v.code))).toEqual(new Set(['FORBIDDEN']));
    expect(new Set(violations.map((v) => v.shadows))).toEqual(new Set(['PERMISSION_DENIED']));
  });
});

describe('ErrorCode (standard ∪ registered)', () => {
  it('accepts standard-catalog members', () => {
    expect(ErrorCode.parse('VALIDATION_ERROR')).toBe('VALIDATION_ERROR');
    expect(ErrorCode.parse('PERMISSION_DENIED')).toBe('PERMISSION_DENIED');
    expect(ErrorCode.parse('METHOD_NOT_ALLOWED')).toBe('METHOD_NOT_ALLOWED');
  });

  it('accepts registered extension codes', () => {
    expect(ErrorCode.parse('AUTH_REQUIRED')).toBe('AUTH_REQUIRED');
    expect(ErrorCode.parse('ATTACHMENT_DOWNLOAD_DENIED')).toBe('ATTACHMENT_DOWNLOAD_DENIED');
    expect(ErrorCode.parse('VALIDATION_FAILED')).toBe('VALIDATION_FAILED');
    expect(ErrorCode.parse('ROUTE_NOT_FOUND')).toBe('ROUTE_NOT_FOUND');
  });

  it('accepts the #8087 dispatcher-gate batch, each under its measured owning package (#8846)', () => {
    // The seven codes the dispatcher-vocabulary gate's first derivation
    // reported as "merely unregistered" — live producer, real wire, no ledger
    // row (option B of the 2026-08-12 ruling, delivered as a gate;
    // `scripts/check-dispatcher-error-vocabulary.mjs` re-derives the set on
    // every CI run). Owning packages per #7504 provenance: the package whose
    // source stamps the code.
    const batch: Record<string, keyof typeof ERROR_CODE_LEDGER> = {
      FLOW_FAILED: '@objectstack/runtime',
      QUERY_OBJECT_MISMATCH: '@objectstack/metadata-protocol',
      ERR_AUTONUMBER_COLLISION: '@objectstack/objectql',
      ERR_TRANSACTION_UNSUPPORTED: '@objectstack/objectql',
      ERR_CROSS_DATASOURCE_TRANSACTION_WRITE: '@objectstack/objectql',
      ERR_HOOK_TARGET_REBIND: '@objectstack/objectql',
      FIELD_VISIBILITY_UNRESOLVED: '@objectstack/rest',
    };
    for (const [code, owner] of Object.entries(batch)) {
      expect(ErrorCode.parse(code)).toBe(code);
      expect(ERROR_CODE_LEDGER[owner], `${code} registered under ${owner}`).toContain(code);
      // None re-spells a standard member — registered plainly, no waiver.
      expect(standardSynonymOf(code), `${code} needs no waiver`).toBeUndefined();
    }
    // Deliberately NOT registered, and the absence is load-bearing:
    // STORAGE_FAILURE is producer-less (a row would be unemittable from
    // birth — the retired-code class the ledger header documents), and
    // DUPLICATE is the pinned witness of the sandbox-authored `error.code`
    // limb (#9106) — registering it would delete the only evidence that limb
    // is open.
    expect(() => ErrorCode.parse('STORAGE_FAILURE')).toThrow();
    expect(() => ErrorCode.parse('DUPLICATE')).toThrow();
  });

  it('accepts the #10025 definition-level input-schema refusal code (#11504)', () => {
    // The ruled contract half of #10025's Option B (maintainer, 2026-08-20):
    // the definition-level input-schema refusal is a never-dispatched exit
    // with its own code. Registered AHEAD of its producer, deliberately — the
    // #10413 → #10576 split shape: the services half (`execute()`'s catch
    // short-circuit) is #10025's, blocked on this registration, and asserts
    // this exact string by value — so the value is pinned here by value too.
    expect(ErrorCode.parse('FLOW_INPUT_SCHEMA_INVALID')).toBe('FLOW_INPUT_SCHEMA_INVALID');
    expect(ERROR_CODE_LEDGER['@objectstack/runtime']).toContain('FLOW_INPUT_SCHEMA_INVALID');
    // Not a synonym of any standard member (FLOW is a token no member
    // carries) — registered plainly, no waiver recorded or needed.
    expect(standardSynonymOf('FLOW_INPUT_SCHEMA_INVALID')).toBeUndefined();
  });

  it('accepts the #16449 batch — every code that ships in dist, door or no door (#16404)', () => {
    // The #16404 ruling (director seat, decision batch #62, 2026-09-07, option
    // D): the published face is this ledger, so a code that ships in `dist` is
    // registered whether or not an HTTP door can answer with it. The nine
    // measured unregistered on #16449's tree, each under the package that
    // stamps it: the cross-package ownership refusal, the seven `defineStack`
    // refusals and `PluginSchema`'s `ui` required-key issue code.
    const batch: Record<string, keyof typeof ERROR_CODE_LEDGER> = {
      OBJECT_OWNERSHIP_CONFLICT: '@objectstack/objectql',
      PLUGIN_UI_REQUIRED_KEY_MISSING: '@objectstack/spec',
      STACK_CAPABILITY_UNKNOWN: '@objectstack/spec',
      STACK_CROSS_REFERENCE_INVALID: '@objectstack/spec',
      STACK_HIERARCHY_SCOPE_CAPABILITY_REQUIRED: '@objectstack/spec',
      STACK_NAMESPACE_PREFIX_INVALID: '@objectstack/spec',
      STACK_SCHEMA_INVALID: '@objectstack/spec',
      STACK_SINGLE_APP_VIOLATION: '@objectstack/spec',
      STACK_TRIGGER_CAPABILITY_REQUIRED: '@objectstack/spec',
    };
    for (const [code, owner] of Object.entries(batch)) {
      expect(ErrorCode.parse(code)).toBe(code);
      expect(ERROR_CODE_LEDGER[owner], `${code} registered under ${owner}`).toContain(code);
      // Domain-prefixed, none re-spells a standard member — registered plainly, no waiver.
      expect(standardSynonymOf(code), `${code} needs no waiver`).toBeUndefined();
    }
    // The card's ninth, `NAMESPACE_CONFLICT`, was already a row (#14748) — the
    // one doored code of the batch, whose wire already carries it.
    expect(ERROR_CODE_LEDGER['@objectstack/objectql']).toContain('NAMESPACE_CONFLICT');
  });

  it('rejects unregistered, lowercase, and numeric codes', () => {
    expect(() => ErrorCode.parse('TOTALLY_MADE_UP_CODE')).toThrow();
    expect(() => ErrorCode.parse('validation_error')).toThrow(); // pre-ADR-0112 dialect
    expect(() => ErrorCode.parse(400)).toThrow();                // pre-#3842 dispatcher shape
    expect(() => ErrorCode.parse('')).toThrow();
  });

  it('rejects a retired code with no producer left (the ledger header "Retiring a code" class)', () => {
    // OVERLAY_PERSISTENCE_FAILED (#5264 deleted its only producer, #5783
    // unregistered it): the FIRST ground of the header's "Retiring a code"
    // section — and since #16404 the only ground left, because the second
    // one ("host boot matching is not wire vocabulary", the ground #8035
    // unregistered MONGODB_MULTI_TENANT_UNSUPPORTED on) is superseded by the
    // "door or no door" rule. A code with no producer anywhere in
    // `packages/**` source is a row promising a code no response can carry,
    // and the wire vocabulary must refuse it.
    expect(() => ErrorCode.parse('OVERLAY_PERSISTENCE_FAILED')).toThrow();
    expect(REGISTERED_ERROR_CODES).not.toContain('OVERLAY_PERSISTENCE_FAILED');
  });

  it('accepts the #16649 batch — the fourteen remaining door:none codes, each under its stamping package (#16404)', () => {
    // The rest of the #16404 class after #16449: every `boot-refusal` row
    // `dispatcher-error-vocabulary.ts` still carried, each measured in its
    // package's built `dist/index.js` and absent from the union before this
    // batch. Registration widens the face only — none reaches an HTTP door on
    // this tree, so no wire body changes; the rows ratcheted out with it.
    const batch: Record<string, keyof typeof ERROR_CODE_LEDGER> = {
      INVALID_ARTIFACT_PACKAGES: '@objectstack/core',
      INVALID_ARTIFACT_PACKAGE_ENTRY: '@objectstack/core',
      DUPLICATE_ARTIFACT_PACKAGE: '@objectstack/core',
      NO_SUCH_RUN: '@objectstack/core',
      PLAN_CHANGED: '@objectstack/core',
      PREFLIGHT_FAILED: '@objectstack/core',
      NOT_COMPENSABLE: '@objectstack/core',
      SERVICE_NOT_REGISTERED: '@objectstack/core',
      PLUGIN_CONTRACT_VIOLATION: '@objectstack/core',
      MIXED_ARTIFACT_COLLECTION_SHAPE: '@objectstack/runtime',
      DUPLICATE_ARTIFACT_OBJECT_NAME: '@objectstack/objectql',
      MEMORY_MULTI_TENANT_UNSUPPORTED: '@objectstack/driver-memory',
      MONGODB_MULTI_TENANT_UNSUPPORTED: '@objectstack/driver-mongodb',
      WALLED_MEMBERSHIP_POLICY_UNDECLARED: '@objectstack/organizations',
    };
    expect(Object.keys(batch)).toHaveLength(14);
    for (const [code, owner] of Object.entries(batch)) {
      expect(ErrorCode.parse(code)).toBe(code);
      expect(ERROR_CODE_LEDGER[owner], `${code} registered under ${owner}`).toContain(code);
      // None re-spells a standard member — registered plainly, no waiver.
      expect(standardSynonymOf(code), `${code} needs no waiver`).toBeUndefined();
    }
    // The reversal on the record: MONGODB_MULTI_TENANT_UNSUPPORTED was
    // UNregistered by #8035 and its owner key came out with it (this suite
    // pinned both absences); #16404 supersedes that ground, so the row and
    // the key are back — pinned by presence now. `@objectstack/organizations`
    // is a new owner key, the package's first registration.
    expect(Object.keys(ERROR_CODE_LEDGER)).toContain('@objectstack/driver-mongodb');
    expect(Object.keys(ERROR_CODE_LEDGER)).toContain('@objectstack/organizations');
    // The control that lets this pin fail in the other direction: a code
    // registered by nobody is still refused. `MULTI_TENANT_UNSUPPORTED` is the
    // shared NAME of the two drivers' constants, never a code either stamps.
    expect(() => ErrorCode.parse('MULTI_TENANT_UNSUPPORTED')).toThrow();
    expect(REGISTERED_ERROR_CODES).not.toContain('MULTI_TENANT_UNSUPPORTED');
  });
});
