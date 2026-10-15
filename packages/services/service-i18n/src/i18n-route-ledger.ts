// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * i18n route ledger — the `/api/v1/i18n/*` wire table and the audited SDK
 * disposition of each route (#3636, tranche 3 of the #3563 audit).
 *
 * ⚠️ NOT A LIST OF ROUTES THIS PACKAGE MOUNTS — it mounts none (#23347).
 * `I18nServicePlugin` used to register these three paths a second time, at
 * `kernel:ready`, beside the dispatcher bridge's own registrations. Measured on
 * `objectstack serve` over `examples/app-showcase`, the dispatcher answered
 * every request on all three, so the plugin's copy was retired (see the class
 * docblock in `i18n-service-plugin.ts`). The ONE owner is the dispatcher bridge,
 * and its ledger (`packages/runtime/src/route-ledger.ts`, the three `/i18n`
 * rows) carries the same routes as dispatcher-relative patterns.
 *
 * WHY THIS FILE STILL EXISTS. Its rows are read as relative SOURCE by guards
 * outside this package — `packages/client`'s URL-conformance, response-schema
 * and service-ledger-coverage tests, and the dogfood live-mount parity gate —
 * and those readers are outside the change that retired the mount. Folding them
 * onto the dispatcher ledger and deleting this file is the named follow-up of
 * #23347; until then a row here is wire data, never evidence of a mount.
 * `i18n-route-ledger.conformance.test.ts` holds the hygiene of the rows;
 * `i18n-service-plugin.test.ts` pins that the plugin mounts nothing.
 *
 * HISTORY THE ROWS CARRY. The audit caught `i18n.getTranslations` and
 * `i18n.getFieldLabels` shipping the `?locale=` query dialect while every
 * serving surface and the `plugin-rest-api.zod.ts` contract mount only the path
 * form. Both were 404s on the wire, fixed in #3636 by moving the client to the
 * path dialect, the same resolution #3611 gave `meta.getView`.
 *
 * This module is package-internal (not exported from the index): it is the
 * guards' data, not public API. It must stay import-free — the client-side
 * guards import it as a relative SOURCE file.
 */

/** Disposition of a single i18n route. Same vocabulary as the REST ledger. */
export type I18nRouteDisposition =
  /** Expressed by the SDK — `client` names the method (dotted path). */
  | 'sdk'
  /** Should be in the SDK and is not — an open, acknowledged gap. */
  | 'gap'
  /** Deliberately not SDK surface. */
  | 'server-only'
  /** Public, unauthenticated browser-facing route. */
  | 'public'
  /** Server and client disagree on the shape — needs reconciliation. */
  | 'mismatch';

export interface I18nRouteLedgerEntry {
  /** `VERB /api/v1/i18n/...` — full wire path at the default base. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: I18nRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /**
   * Name of the `@objectstack/spec/api` export declaring this route's response
   * PAYLOAD — the `data` of the shared `{ success, data }` envelope where the
   * route emits one, the whole body where it does not. The envelope itself is
   * not this field's business; `pnpm check:route-envelope` guards it
   * structurally, and a single field cannot describe both halves honestly.
   *
   * ABSENT MEANS "UNDECLARED", and that is the state of most of the mounted
   * surface: at the #3877 audit, 0 of 237 ledgered routes carried a schema
   * reference. #3877 ruled that authoring the ~190 missing ones is NOT
   * scheduled — a response schema is a product decision about what an endpoint
   * promises, and mass-producing them is precisely how declarations nobody
   * validated come to exist (the four defects #3676/#3833/#3847/#3870 fixed).
   * So this field is filled incrementally, as a family lands conformance
   * coverage or a route is touched for other reasons; a blank one changes no
   * behaviour and is not a defect.
   *
   * ⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE. The field exists to
   * make "what does this route declare" queryable so #3877's Stage D ratchet
   * can demand coverage for it; a name written ahead of the test it points at
   * would BE the "declared but unverified" surface the programme exists to
   * remove. `packages/client/src/route-ledger-response-schema.test.ts` resolves
   * every name written here against the live `@objectstack/spec/api` exports,
   * so a typo or a retired schema fails loudly rather than rotting.
   *
   * A NAME rather than a live schema object, deliberately: this module stays
   * import-free — the client-side guards compile it as a relative SOURCE file,
   * and `zod` is not a dependency of every package that owns a ledger. The
   * resolution belongs in the guard that can import the spec, not in the data.
   */
  responseSchema?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const I18N_ROUTE_LEDGER: readonly I18nRouteLedgerEntry[] = [
  { route: 'GET /api/v1/i18n/locales', family: 'i18n', disposition: 'sdk', client: 'i18n.getLocales' },
  { route: 'GET /api/v1/i18n/translations/:locale', family: 'i18n', disposition: 'sdk', client: 'i18n.getTranslations',
    note: 'was a wire-level 404 — the client sent /translations?locale=xx, a shape no server mounts (the dispatcher domain body accepts it, but nothing routes a bare /translations to that body). The client now sends the path form the spec declares.' },
  { route: 'GET /api/v1/i18n/labels/:object/:locale', family: 'i18n', disposition: 'sdk', client: 'i18n.getFieldLabels',
    note: 'ditto — the client sent /labels/:object?locale=xx against a two-path-param mount; it now sends both the object and the locale in the path.' },
];
