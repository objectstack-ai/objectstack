// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  API_PRIMITIVES,
  apiExposureDenialReason,
  checkManagedApiMethodAffordances,
  effectiveOperationsArray,
  resolveEffectiveApiMethods,
  type EnableLike,
} from '@objectstack/spec/data';
import { REGISTERED_ERROR_CODES } from '@objectstack/spec/api';
import { SysWebhook } from './sys-webhook.object.js';

/**
 * #9756 — `sys_webhook`'s data-API exposure, and the honest size of it.
 *
 * Three cards (#7799, #7986, #8025 option 2) each observed that this object
 * declared no `enable` block and named narrowing its read surface as the next
 * step; none of them owned the line, so it was never written. #9756's own
 * mandate was to measure the consumers BEFORE narrowing anything, and the
 * measurement is what this file pins — including the part that is easy to lose:
 *
 *   ⛔ the declaration that landed narrows NOTHING.
 *
 * Every primitive is required by a real consumer, so the authored set is all
 * six, whose effective closure is identical to the one the absent block already
 * produced. The value delivered is that the posture is now a decision on the
 * record rather than a default nobody wrote down — not a reduction in what is
 * reachable. The `narrows nothing` block below is the pin that keeps a later
 * reader (or a survey grepping for `enable:`) from concluding otherwise, and it
 * is the assertion the ablation flips.
 */

/** The census (#9756). Each row is a consumer that reaches this object through a GATED surface. */
const CENSUS: ReadonlyArray<{ consumer: string; via: string; operation: string; bulkChild?: string }> = [
  // Setup/Studio console — `nav_webhooks` + the object's four list views.
  { consumer: 'console list views', via: 'REST GET /data/sys_webhook', operation: 'list' },
  { consumer: 'console record detail', via: 'REST GET /data/sys_webhook/:id', operation: 'get' },
  // `userActions: { create, edit, delete }` — this object is an admin authoring surface.
  { consumer: 'console create', via: 'REST POST /data/sys_webhook', operation: 'create' },
  { consumer: 'console edit', via: 'REST PATCH /data/sys_webhook/:id', operation: 'update' },
  { consumer: 'console delete', via: 'REST DELETE /data/sys_webhook/:id', operation: 'delete' },
  // #4639 — a predicate write over sys_webhook ("deactivate every webhook on an
  // object") is a supported operator gesture; `AutoEnqueuer.handleSelfHealEvent`
  // carries a `data.records.*` branch built expressly for it. Both *Many routes
  // gate on the `bulk` primitive AND the batched child verb.
  { consumer: 'operator predicate deactivate (#4639)', via: 'REST updateMany', operation: 'bulk', bulkChild: 'update' },
  { consumer: 'operator predicate delete (#4639)', via: 'REST deleteMany', operation: 'bulk', bulkChild: 'delete' },
  { consumer: 'console bulk create', via: 'REST createMany', operation: 'bulk', bulkChild: 'create' },
  // Derived verbs the console's grid affordances read off the effective set.
  { consumer: 'console export', via: 'REST GET /data/sys_webhook/export', operation: 'export' },
  { consumer: 'console import', via: 'REST POST /data/sys_webhook/import', operation: 'import' },
];

const ENABLE = SysWebhook.enable as EnableLike;

describe('#9756 — sys_webhook declares its data-API exposure explicitly', () => {
  it('declares exactly the six primitives the census derived', () => {
    expect(ENABLE?.apiMethods).toEqual(['get', 'list', 'create', 'update', 'delete', 'bulk']);
    // Authored values are primitives only — legacy verbs are derived, never
    // declared (#3543). The monorepo-wide form of this lives in spec's
    // `api-methods-batch-conformance.test.ts`; asserted here too so the object's
    // own suite fails at the source rather than in another package.
    expect([...(ENABLE?.apiMethods ?? [])].sort()).toEqual([...API_PRIMITIVES].sort());
  });

  it('admits every consumer the census found (anti-vacuity floor included)', () => {
    expect(CENSUS.length).toBeGreaterThanOrEqual(10);
    const refused = CENSUS.filter(
      ({ operation, bulkChild }) => apiExposureDenialReason(ENABLE, operation, { bulkChild }) !== null,
    ).map(({ consumer, via, operation }) => `${consumer} (${via}) — '${operation}' refused`);
    expect(refused).toEqual([]);
  });

  it('keeps every declared write verb through registration — nothing is stripped at boot', () => {
    // `sys_webhook` is `managedBy: 'config'`, so its whitelist is reconciled
    // against its resolved CRUD affordances at registration
    // (`reconcileManagedApiMethods`, objectql `registry.ts`) — a verb the
    // affordances refuse is stripped with only a `console.warn`. The judgement
    // is this predicate (ADR-0092/ADR-0103); the registry is only its reaction,
    // so pinning the predicate pins what boot will do. Closing
    // `userActions.delete`, say, would silently take `delete` away from the API
    // and this is what notices.
    expect(checkManagedApiMethodAffordances(SysWebhook)).toEqual([]);
  });

  it('⛔ narrows NOTHING — the effective surface equals what the absent block produced', () => {
    // THE assertion of this file. `resolveEffectiveApiMethods` seeds its
    // `unrestricted` branch with the same `API_PRIMITIVES` set, so declaring
    // all six reproduces the closure the omission already had. If a later
    // change makes this pair diverge, the object's exposure really did move and
    // the docblock above (and #9756's report) stop describing it.
    const declared = resolveEffectiveApiMethods(ENABLE);
    const absent = resolveEffectiveApiMethods({ ...ENABLE, apiMethods: undefined });

    expect(effectiveOperationsArray(declared)).toEqual(effectiveOperationsArray(absent));
    expect([...declared.primitives].sort()).toEqual([...absent.primitives].sort());
    // The one thing that DID change — and the only thing.
    expect(absent.mode).toBe('unrestricted');
    expect(declared.mode).toBe('restricted');
  });

  it('leaves the reachable-cleartext fields reachable — the card is not closed by this', () => {
    // `url` (#8025, won't-fix on masking) and a legacy row's un-migrated
    // `definition_json.headers` (#7986, still read by `readLegacyHeaders`) are
    // served by `get`/`list`, which the console requires. Stated as an
    // assertion so nobody reads the new `enable` block as having removed them.
    expect(apiExposureDenialReason(ENABLE, 'get')).toBeNull();
    expect(apiExposureDenialReason(ENABLE, 'list')).toBeNull();
    expect(Object.keys(SysWebhook.fields)).toContain('url');
    expect(Object.keys(SysWebhook.fields)).toContain('definition_json');
  });
});

describe('#9756 — the gate this declaration is read by is live (counterfactual)', () => {
  // The shipped block refuses none of the census, so a refusal pin needs a
  // counterfactual subject: a narrowed block proves the mechanism reaching this
  // object's `enable` really does refuse, rather than the suite passing because
  // nothing is ever gated. ADR-0112: assert the discriminant AND the code, not
  // that something merely threw.
  const READ_ONLY: EnableLike = { apiMethods: ['get', 'list'] };

  it('refuses a write with the ADR-0112 method-not-allowed discriminant', () => {
    expect(apiExposureDenialReason(READ_ONLY, 'create')).toBe('method-not-allowed');
    expect(apiExposureDenialReason(READ_ONLY, 'update')).toBe('method-not-allowed');
    expect(apiExposureDenialReason(READ_ONLY, 'delete')).toBe('method-not-allowed');
    expect(apiExposureDenialReason(READ_ONLY, 'bulk', { bulkChild: 'update' })).toBe('method-not-allowed');
    // Reads stay open — the control that makes the three above an oracle rather
    // than "this helper refuses everything".
    expect(apiExposureDenialReason(READ_ONLY, 'get')).toBeNull();
    expect(apiExposureDenialReason(READ_ONLY, 'list')).toBeNull();
  });

  it('names an ADR-0112-registered code for each refusal envelope', () => {
    // The `{ status, code }` envelopes themselves are built by
    // `apiAccessDenialFromEnable` (`@objectstack/rest`) and the MCP bridge, from
    // this same discriminant — 405 `OBJECT_API_METHOD_NOT_ALLOWED` and 404
    // `OBJECT_API_DISABLED`. This package does not depend on `@objectstack/rest`
    // and does not grow a dependency to assert someone else's envelope; what is
    // pinned here is that both codes are registered vocabulary, so a rename
    // cannot pass silently on the spec side.
    expect(REGISTERED_ERROR_CODES).toContain('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(REGISTERED_ERROR_CODES).toContain('OBJECT_API_DISABLED');
    expect(apiExposureDenialReason({ apiEnabled: false }, 'get')).toBe('api-disabled');
  });
});
