// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `responseSchema` resolution guard (#5791, first step of #3877).
 *
 * WHAT THE FIELD IS. Every route ledger's entry type now carries an optional
 * `responseSchema` — the NAME of the `@objectstack/spec/api` export declaring
 * that route's response payload. #3877 measured the hole it opens onto: of 237
 * ledgered routes, 215 are `sdk` surface and **zero** carried any schema
 * reference, so for ~90% of the mounted surface the problem was never
 * "emitted ≠ declared" but that nothing was declared to check against.
 *
 * WHAT THIS FILE GUARDS, AND WHY IT IS THE ONE THING THE FIELD NEEDED FIRST.
 * A name is data, and data lies. `responseSchema: 'GetDiscoverResponseSchema'`
 * — one letter short — is accepted by `string`, reads correct in review, and
 * silently describes nothing; a name pointing at a schema that later retires
 * rots the same way with no edit at all. That is the "declared but nobody
 * verifies" surface #3877 exists to remove, so the field could not land without
 * the resolver that refuses it. Each name is looked up in the LIVE
 * `@objectstack/spec/api` export namespace and required to be a real zod
 * schema, exercised rather than duck-typed.
 *
 * WHY HERE, of all packages. The five ledgers are five independent declarations
 * in five packages; `@objectstack/spec` cannot import them (wrong direction),
 * and a copy of this resolver in each package would be five copies of one rule
 * — the shape `scripts/check-route-envelope.mjs` records as the signal to lift
 * something into one place. This package already unions all five as relative
 * SOURCE files for the capstone URL guard (`client-url-conformance.test.ts`),
 * and it already depends on `@objectstack/spec`, so it is the single scope
 * where every ledger and the spec are both in hand. Nothing about the client is
 * under test here; it is the meeting point, not the subject.
 *
 * WHAT THIS FILE DOES NOT GUARD. That a filled row HAS conformance coverage is
 * #3877's Stage D ratchet and is explicitly "only meaningful after A/B" — it
 * cannot be mechanised while ~190 routes declare nothing. Today the rule is
 * carried by the field's JSDoc plus a per-row pin next to the coverage itself
 * (`discovery-schema-conformance.test.ts` in `packages/runtime` and
 * `packages/rest`, which assert that the ledger names the schema those suites
 * actually parse with). A name that resolves is not yet a name that is checked.
 */

import { describe, it, expect } from 'vitest';
import * as specApi from '@objectstack/spec/api';
import { ROUTE_LEDGER } from '../../runtime/src/route-ledger';
import { REST_ROUTE_LEDGER } from '../../rest/src/rest-route-ledger';
import { STORAGE_ROUTE_LEDGER } from '../../services/service-storage/src/storage-route-ledger';
import { I18N_ROUTE_LEDGER } from '../../services/service-i18n/src/i18n-route-ledger';
import { AUTH_ROUTE_LEDGER } from '../../plugins/plugin-auth/src/auth-route-ledger';

/** The five independent ledgers, labelled so a failure names the file to open. */
const LEDGERS: ReadonlyArray<{
  readonly label: string;
  readonly rows: ReadonlyArray<{ route: string; responseSchema?: string }>;
}> = [
  { label: 'packages/runtime/src/route-ledger.ts', rows: ROUTE_LEDGER },
  { label: 'packages/rest/src/rest-route-ledger.ts', rows: REST_ROUTE_LEDGER },
  { label: 'packages/plugins/plugin-auth/src/auth-route-ledger.ts', rows: AUTH_ROUTE_LEDGER },
  { label: 'packages/services/service-i18n/src/i18n-route-ledger.ts', rows: I18N_ROUTE_LEDGER },
  { label: 'packages/services/service-storage/src/storage-route-ledger.ts', rows: STORAGE_ROUTE_LEDGER },
];

/** Every row across the five ledgers that declares a response schema. */
function declaredRows(): Array<{ ledger: string; route: string; responseSchema: string }> {
  return LEDGERS.flatMap(({ label, rows }) =>
    rows
      .filter((r): r is typeof r & { responseSchema: string } => r.responseSchema !== undefined)
      .map((r) => ({ ledger: label, route: r.route, responseSchema: r.responseSchema })),
  );
}

const exportsOfSpecApi = specApi as unknown as Record<string, unknown>;

/**
 * The resolver under test, extracted so the negative control below can drive
 * the SAME function a real row goes through. A guard whose failure path is
 * never executed is a guard nobody has seen fail.
 *
 * Note it EXERCISES the schema rather than duck-typing it: `@objectstack/spec`
 * wraps its schemas in `lazySchema()` proxies (`packages/spec/src/shared/
 * lazy-schema.ts`), so property presence is answered by a Proxy trap and
 * `typeof x.safeParse === 'function'` alone would be satisfied by a proxy over
 * anything. Calling it forces the factory and proves a parser came back.
 */
function resolutionFailure(name: string): string | undefined {
  if (name.trim() === '') return 'is empty';
  if (!Object.prototype.hasOwnProperty.call(exportsOfSpecApi, name)) {
    return 'is not an export of `@objectstack/spec/api`';
  }
  const candidate = exportsOfSpecApi[name] as { safeParse?: (v: unknown) => unknown };
  if (typeof candidate?.safeParse !== 'function') return 'is exported but is not a zod schema';
  const verdict = candidate.safeParse(undefined) as { success?: boolean } | undefined;
  if (typeof verdict?.success !== 'boolean') return 'has a `safeParse` that returns no zod verdict';
  return undefined;
}

describe('[#5791] every ledgered `responseSchema` names a real spec schema', () => {
  it('resolves each declared name against the live `@objectstack/spec/api` exports', () => {
    const broken = declaredRows()
      .map(({ ledger, route, responseSchema }) => {
        const why = resolutionFailure(responseSchema);
        return why ? `${ledger} — \`${route}\`: responseSchema '${responseSchema}' ${why}` : undefined;
      })
      .filter((m): m is string => m !== undefined);

    expect(
      broken,
      'Ledger rows whose `responseSchema` does not resolve to a zod schema exported from '
        + '`@objectstack/spec/api`. Fix the name, or drop the field — an unresolvable '
        + 'declaration is worse than none (#3877).',
    ).toEqual([]);
  });

  it('anti-vacuity: the sweep really has rows to resolve', () => {
    // Without this, deleting every `responseSchema` in the repo would leave the
    // assertion above green over an empty list — a sweep rotting to zero while
    // reporting success is the failure mode `client-url-conformance.test.ts`
    // calls out in its own anti-rot section, and this file is no less exposed.
    const rows = declaredRows();
    expect(
      rows.length,
      'No ledger row declares a `responseSchema`, so the resolver above proved nothing. '
        + 'The #5791 landing filled two discovery rows; if they were removed, remove this '
        + 'guard with them rather than leaving it green over nothing.',
    ).toBeGreaterThanOrEqual(2);
  });

  it('the resolver rejects what it is meant to reject', () => {
    // The failure path, driven. Each case is a way a hand-written name goes
    // wrong in review, and none of them is caught by `string`.
    expect(resolutionFailure('GetDiscoverResponseSchema')).toBe(
      'is not an export of `@objectstack/spec/api`',
    ); // one letter short of a real export
    expect(resolutionFailure('')).toBe('is empty');
    expect(resolutionFailure('WELL_KNOWN_CAPABILITY_KEYS')).toBe(
      'is exported but is not a zod schema',
    ); // a real export of the right module, wrong kind of thing
    // …and the positive control, so the rejections above are not a resolver
    // that rejects everything.
    expect(resolutionFailure('DiscoverySchema')).toBeUndefined();
  });

  it('the two #5791 landing rows are the discovery pair, in two different ledgers', () => {
    // The point of the landing evidence was that ONE field shape serves five
    // independently-declared entry types; two rows in one ledger would not have
    // shown that. Pinned so a later edit cannot quietly collapse it.
    const byLedger = new Map<string, string[]>();
    for (const { ledger, route } of declaredRows()) {
      byLedger.set(ledger, [...(byLedger.get(ledger) ?? []), route]);
    }

    // `?? []` rather than a bare `get`: an absent key makes `toContain` report
    // "the given combination of arguments (undefined and string) is invalid"
    // instead of naming the row that went missing — measured while reverse-
    // verifying this file, and a guard whose failure text is a chai complaint
    // about its own arguments has told the next reader nothing.
    expect(
      byLedger.get('packages/runtime/src/route-ledger.ts') ?? [],
      'the dispatcher discovery row must keep declaring its response schema (#5791)',
    ).toContain('GET /discovery');
    expect(
      byLedger.get('packages/rest/src/rest-route-ledger.ts') ?? [],
      'the REST discovery row must keep declaring its response schema (#5791)',
    ).toContain('GET /api/v1/discovery');
  });
});
