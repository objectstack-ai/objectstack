// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  RestApiEndpointSchema,
  RestApiRouteRegistrationSchema,
  getDefaultRouteRegistrations,
  type RestApiEndpoint,
} from './plugin-rest-api.zod';
import {
  MIGRATIONS_BY_MAJOR,
  RETIRED_DEFS_BY_MAJOR,
  RETIRED_KEYS_BY_MAJOR,
} from '../migrations/registry';
import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#13823] `RestApiEndpoint.handlerStatus` and the Route Coverage Report
//     are RETIRED ───────────────────────────────────────────────────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-09-01 (director decision
// batch #27, verbatim 「同意」: remove; enforce excluded). The key
// (`implemented` / `stub` / `planned`) was documented to make a `stub`
// handler "return 501 Not Implemented", and NOTHING read it: every
// `DispatcherErrorCode.enum.NOT_IMPLEMENTED` site is the declarative-endpoint
// executor refusing a target or mapping it cannot serve, none consulting the
// key. So `handlerStatus: 'stub'` got an ordinarily served route, and the
// `RouteCoverageReportSchema` that would have carried the status outward had
// zero constructors in objectstack, objectui (pinned sha) or cloud.
//
// Three bookkeeping shapes, pinned below:
//
//   1. `handlerStatus:` — `retiredKey()` tombstone on the non-strict
//      `RestApiEndpointSchema` (a bare deletion would be a SILENT STRIP,
//      #3733 / ADR-0104); `api/RestApiEndpoint:handlerStatus` in
//      `RETIRED_KEYS_BY_MAJOR[18]`.
//   2. `RouteCoverageEntrySchema` / `RouteCoverageReportSchema` + their two
//      types — whole-def removal (route 3: nobody ever parsed or constructed
//      one); `api/RouteCoverageEntry` + `api/RouteCoverageReport` in
//      `RETIRED_DEFS_BY_MAJOR[18]`.
//   3. `HandlerStatusSchema` / `HandlerStatus` — orphan value enum once both
//      carriers are gone (#3950); `api/HandlerStatus` in
//      `RETIRED_DEFS_BY_MAJOR[18]`.
//
// No D2 conversion, deliberately: nothing in the tree parses
// `RestApiEndpointSchema` outside its own unit tests — a REST API plugin route
// registration is not a stack collection member and never a `sys_metadata`
// row — so the conversion chain has no seam that would ever see one (the
// `kernel/Manifest:loading` precedent). The D3 semantic entry
// `rest-api-endpoint-handler-status-retired` carries the prescription.
//
// On the assertion set (the #8586 / #11846 precedent): a schema refusal
// raises a `ZodError` whose issues carry `code` and `path` but no ADR-0112
// `status` — that envelope belongs to the API error surface. So these pins
// assert the strongest set this surface really has: refusal, the issue
// `code`, the `path` naming WHICH site refused, and the prescription text
// (#5240: where the wording is the contract, pin the wording).

/** A well-formed endpoint — every required key, none of the retired one. */
const WELL_FORMED = {
  method: 'POST',
  path: '/api/v1/cases/:id/close',
  handler: 'closeCase',
  category: 'data',
} as const;

const PRESCRIPTION = /`RestApiEndpoint\.handlerStatus`.*was removed.*17/s;

describe('[#13823] RestApiEndpoint.handlerStatus retirement', () => {
  // All three former values, INCLUDING the documented default: the old
  // docblock's `@default 'implemented'` was prose only — the key never carried
  // a Zod `.default()`, so no built artifact materialised it and there is no
  // residue window to tolerate (#12840 does not apply). Each is refused alike.
  it.each(['implemented', 'stub', 'planned'] as const)(
    "REJECTS handlerStatus: '%s' at path `handlerStatus`, carrying the prescription",
    (value) => {
      const result = RestApiEndpointSchema.safeParse({ ...WELL_FORMED, handlerStatus: value });
      expect(result.success).toBe(false);
      if (result.success) return; // narrowing; the assertion above already failed

      const issue = result.error.issues.find((i) => i.path[0] === 'handlerStatus');
      expect(issue, 'the refusal must name `handlerStatus`').toBeDefined();
      // The machine-readable half of the envelope this surface actually has:
      // a `retiredKey()` tombstone raises `invalid_type` from its `z.never()`.
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual(['handlerStatus']);
      // The prescription IS the migration doc for whoever hits it — contract,
      // not commentary: it names the key, says it was removed, explains why
      // it was inert, and tells the author what to do.
      expect(issue!.message).toMatch(PRESCRIPTION);
      expect(issue!.message).toMatch(/nothing ever read it/s);
      expect(issue!.message).toMatch(/Delete the key/s);
      // The live mechanism must be named: the 501 comes from the executor.
      expect(issue!.message).toMatch(/501 NOT_IMPLEMENTED.*declarative-endpoint executor/s);
      // And the ruled-out alternative, so nobody re-declares it as a repair.
      expect(issue!.message).toMatch(/not a platform capability/s);
    },
  );

  it('REJECTS it through the route-registration embed too, at the nested path', () => {
    const result = RestApiRouteRegistrationSchema.safeParse({
      prefix: '/api/v1/cases',
      service: 'cases',
      category: 'data',
      endpoints: [{ ...WELL_FORMED, handlerStatus: 'stub' }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path.join('.') === 'endpoints.0.handlerStatus');
    expect(issue, 'the refusal must surface through `endpoints[]`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['endpoints', 0, 'handlerStatus']);
    expect(issue!.message).toMatch(PRESCRIPTION);
  });

  it('parses a well-formed endpoint without the key and grows no `handlerStatus` property', () => {
    const parsed = RestApiEndpointSchema.parse({ ...WELL_FORMED });
    expect(parsed.handler).toBe('closeCase');
    expect(parsed.public).toBe(false); // control: the live defaults still apply
    expect(parsed.cacheable).toBe(false);
    // The non-strict strip path: absence must stay absence. If the tombstone
    // were ever replaced by a plain deletion, an authored `handlerStatus`
    // would be stripped here in silence — this pin plus the rejections above
    // are what make that regression loud.
    expect(parsed).not.toHaveProperty('handlerStatus');
  });

  it('the shipped default route registrations never carried the key and still parse', () => {
    const groups = getDefaultRouteRegistrations();
    expect(groups.length).toBe(8); // anti-vacuity: the real shipped set
    for (const group of groups) {
      const result = RestApiRouteRegistrationSchema.safeParse(group);
      expect(result.success, `${group.prefix} must still parse`).toBe(true);
    }
  });

  it('fails tsc at the authoring site: the input type of the key is `never`', () => {
    const endpoint: RestApiEndpoint = {
      ...WELL_FORMED,
      // @ts-expect-error — `handlerStatus` is a retiredKey() tombstone: its
      // input type is `never`, so a typed literal cannot carry it (#13823).
      handlerStatus: 'implemented',
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(RestApiEndpointSchema.safeParse(endpoint).success).toBe(false);
  });
});

describe('[#13823] api/HandlerStatus + api/RouteCoverage{Entry,Report} def retirement', () => {
  /** The 6 names the three retired defs exported (3 schema consts + 3 types). */
  const RETIRED_NAMES = [
    'HandlerStatusSchema',
    'HandlerStatus',
    'RouteCoverageEntrySchema',
    'RouteCoverageEntry',
    'RouteCoverageReportSchema',
    'RouteCoverageReport',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the carriers survive', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./api').length, './api must export a non-trivial surface').toBeGreaterThan(50);

    // ── ABSENCE (every entry, not just ./api) ─────────────────────────────
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #13823`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    // The plugin module itself stays: the carrier def and its neighbours are
    // untouched — this retirement is a narrowing, not a module sweep.
    const apiNames = exportNamesOf('./api');
    for (const name of [
      'RestApiEndpointSchema',
      'RestApiRouteRegistrationSchema',
      'RestApiPluginConfigSchema',
      'RestApiRouteCategory',
      'getDefaultRouteRegistrations',
    ]) {
      expect(apiNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the api barrel resolves without the retired schemas and keeps the survivors', async () => {
    const api = await import('./index');
    expect(api).not.toHaveProperty('HandlerStatusSchema');
    expect(api).not.toHaveProperty('RouteCoverageEntrySchema');
    expect(api).not.toHaveProperty('RouteCoverageReportSchema');
    // Anti-vacuity: the barrel really resolved and still exports the carrier.
    expect(api).toHaveProperty('RestApiEndpointSchema');
    expect(api).toHaveProperty('RestApiRouteRegistrationSchema');
  });
});

describe('[#13823] ADR-0087 registration', () => {
  it('declares the tombstoned key and the three removed defs under major 18, with the D3 entry', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('api/RestApiEndpoint:handlerStatus');
    for (const def of ['api/HandlerStatus', 'api/RouteCoverageEntry', 'api/RouteCoverageReport']) {
      expect(RETIRED_DEFS_BY_MAJOR[18], `${def} must be declared`).toContain(def);
    }
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step.semantic.map((m) => m.id)).toContain('rest-api-endpoint-handler-status-retired');
    // No D2 conversion by design (no seam ever parses the schema) — a
    // conversion id appearing here would mean someone wired a transform that
    // never runs; see the entry file for the reasoning.
    expect(step.conversionIds).not.toContain('rest-api-endpoint-handler-status-removed');
  });
});
