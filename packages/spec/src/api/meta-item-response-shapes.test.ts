// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two response shapes `GET /api/v1/meta/:type/:name…` serves, each declared
 * by its own schema (sweep #6487).
 *
 * Both members here are DECLARATION changes with zero runtime effect, so the
 * assertions have to bear the load themselves: it is not enough that the new
 * keys exist in the file, they must be reachable at the type level (the thing a
 * consumer was previously forced to `cast` for) and the real wire bodies must
 * parse against them.
 *
 * - **#5950** — the uncached branch of `GET /meta/:type/:name` has always sent
 *   the ADR-0010 protection envelope (`lock` and nine siblings) on top of
 *   `{ type, name, item }`, and `GetMetaItemResponseSchema` declared only the
 *   three. `lock` is the READ half of the ADR-0008 optimistic-concurrency chain
 *   whose write half `SaveMetaItemResponseSchema` already declares (#5745).
 * - **#5882** — `?layers=true` answered a completely different projection that
 *   the route never declared. It now has its own path and its own schema.
 */

import { describe, it, expect } from 'vitest';
import {
  FlowRegistrationSchema,
  GetMetaItemResponseSchema,
  GetMetaItemsResponseSchema,
  GetMetaItemLayeredResponseSchema,
  MetadataConflictErrorSchema,
} from './protocol.zod';
import type {
  FlowRegistration,
  GetMetaItemResponse,
  GetMetaItemsResponse,
  GetMetaItemLayeredResponse,
  ListDraftsResponse,
  MetadataConflictError,
} from './protocol.zod';
import type { MetadataLock } from '../kernel/metadata-protection.zod';

/** Type-level identity / assignability helpers. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Assert< T extends true > = T;

/**
 * The compile-time half of both members, at module scope and EXPORTED.
 *
 * These have to live here rather than inside an `it()` body for two reasons
 * that both bite: an unread alias in a function body is TS6196 under
 * `noUnusedLocals`, and — the one that matters — a pin no program compiles is a
 * phantom check that stays green after someone deletes the thing it guards.
 * `packages/spec` compiles its tests via `tsconfig.test.json`, so these are
 * real: reverting either member turns them red at `pnpm typecheck`.
 */

/**
 * #5950 — `lock` is reachable AND typed as the ADR-0010 union. This is the
 * #5545 complaint stated as a compile-time fact: an SDK caller holding a
 * `GetMetaItemResponse` can branch on the lock's VALUES without a cast, which
 * is what "the read side has a contract" has to mean.
 */
export type LockIsTheAdr0010Union = Assert< Eq< GetMetaItemResponse['lock'], MetadataLock | undefined > >;

/**
 * #5882 — the two responses are genuinely different resources: neither schema
 * is a widening of the other, which is the fact that justifies a second path
 * instead of one stretched declaration.
 */
export type LayeredCarriesNoItem = Assert< Eq< 'item' extends keyof GetMetaItemLayeredResponse ? true : false, false > >;
export type PlainCarriesNoLayers = Assert< Eq< 'effective' extends keyof GetMetaItemResponse ? true : false, false > >;

/**
 * #22114 — the read half of the token chain is reachable and typed: a string
 * to echo as `If-Match`, `null` for "no stored row here", absent where the
 * branch publishes none. And the conflict's current version is data a client
 * reads without a cast.
 */
export type ReadVersionIsTokenNullOrAbsent = Assert< Eq< GetMetaItemResponse['version'], string | null | undefined > >;
export type ConflictCurrentVersionIsTokenOrNull = Assert< Eq< MetadataConflictError['currentVersion'], string | null > >;

/** The document under `item` — irrelevant to these shapes, so kept trivial. */
const CUSTOMER = { name: 'customer', label: 'Customer' };

describe('GetMetaItemResponseSchema — the ADR-0010 protection envelope is declared', () => {
  /**
   * The uncached branch's real body: `metadata-protocol`'s `getMetaItem`
   * return, spread onto the wire verbatim by `translateMetaEnvelope`.
   * All ten protection keys, including the six conditional ones.
   */
  const UNCACHED_BODY = {
    type: 'object',
    name: 'customer',
    item: CUSTOMER,
    lock: 'no-overlay',
    lockReason: 'Shipped by the setup package',
    lockSource: 'package',
    lockDocsUrl: 'https://docs.example.test/locks',
    provenance: 'package',
    packageId: 'com.objectstack.setup',
    packageVersion: '1.2.3',
    editable: false,
    deletable: true,
    resettable: true,
  };

  it('parses the uncached body WITHOUT stripping the protection envelope', () => {
    const parsed = GetMetaItemResponseSchema.parse(UNCACHED_BODY);
    // The substance: every carrier survives the parse. Before this change
    // `.parse()` silently dropped all ten — the same way the write side
    // dropped `version` before #5745.
    expect(parsed.lock).toBe('no-overlay');
    expect(parsed.lockReason).toBe('Shipped by the setup package');
    expect(parsed.lockSource).toBe('package');
    expect(parsed.lockDocsUrl).toBe('https://docs.example.test/locks');
    expect(parsed.provenance).toBe('package');
    expect(parsed.packageId).toBe('com.objectstack.setup');
    expect(parsed.packageVersion).toBe('1.2.3');
    expect(parsed.editable).toBe(false);
    expect(parsed.deletable).toBe(true);
    expect(parsed.resettable).toBe(true);
  });

  it('still parses the CACHED body, where every protection key is absent', () => {
    // The default deployment (`enableCache: true`) rebuilds the envelope as
    // exactly these three keys and resolves no lock. Declaring the envelope
    // REQUIRED would have made the default path fail its own contract.
    const parsed = GetMetaItemResponseSchema.parse({ type: 'object', name: 'customer', item: CUSTOMER });
    expect(parsed.type).toBe('object');
    expect(parsed.item).toEqual(CUSTOMER);
    expect(parsed.lock).toBeUndefined();
    expect(parsed.editable).toBeUndefined();
  });

  it('rejects a lock value outside the ADR-0010 vocabulary', () => {
    // The declaration is not merely wider — it is the lock vocabulary. A value
    // the resolver could never produce must not validate.
    expect(() =>
      GetMetaItemResponseSchema.parse({ ...UNCACHED_BODY, lock: 'read-only' }),
    ).toThrow();
    expect(() =>
      GetMetaItemResponseSchema.parse({ ...UNCACHED_BODY, lockSource: 'overlay' }),
    ).toThrow();
  });

  it('types `lock` as the ADR-0010 union — not `unknown`, so no cast is needed', () => {
    // Compile-time half: `LockIsTheAdr0010Union` at module scope. Runtime half:
    // a response literal that declares `lock` and narrows on it, with no cast.
    const response: GetMetaItemResponse = { type: 'object', name: 'customer', item: CUSTOMER, lock: 'full' };
    // Reading it needs no cast; narrowing works.
    const readOnly = response.lock === 'full' || response.lock === 'no-overlay';
    expect(readOnly).toBe(true);
  });
});

describe('GetMetaItemLayeredResponseSchema — the three-layer projection', () => {
  /** What `getMetaItemLayered` returns, and `GET /meta/:type/:name/layers` serves. */
  const LAYERED_BODY = {
    type: 'object',
    name: 'customer',
    code: { name: 'customer', label: 'Customer' },
    overlay: { label: 'Client' },
    overlayScope: 'env',
    effective: { name: 'customer', label: 'Client' },
    _diagnostics: { valid: true },
    lock: 'none',
    editable: true,
    deletable: true,
    resettable: false,
  };

  it('parses the layered body with all three layers intact', () => {
    const parsed = GetMetaItemLayeredResponseSchema.parse(LAYERED_BODY);
    // The whole point of the projection: the layers stay SEPARATE. Collapsing
    // them into one `item` is what the ordinary read does, and doing it here
    // would delete the diagnostic.
    expect(parsed.code).toEqual({ name: 'customer', label: 'Customer' });
    expect(parsed.overlay).toEqual({ label: 'Client' });
    expect(parsed.effective).toEqual({ name: 'customer', label: 'Client' });
    expect(parsed.overlayScope).toBe('env');
    expect(parsed._diagnostics).toEqual({ valid: true });
  });

  it('accepts an uncustomized item — null overlay, null scope', () => {
    const parsed = GetMetaItemLayeredResponseSchema.parse({
      ...LAYERED_BODY,
      overlay: null,
      overlayScope: null,
    });
    expect(parsed.overlay).toBeNull();
    expect(parsed.overlayScope).toBeNull();
  });

  it('accepts an absent `_diagnostics` — types with no registered Zod schema', () => {
    const { _diagnostics: _omitted, ...withoutDiagnostics } = LAYERED_BODY;
    const parsed = GetMetaItemLayeredResponseSchema.parse(withoutDiagnostics);
    expect(parsed._diagnostics).toBeUndefined();
  });

  it('REQUIRES the four resolved verdicts — this path always sets them', () => {
    // Unlike the ordinary read there is one producer path here (the layered
    // view skips the cache), so these are guaranteed and declared required.
    // A body missing them is not a layered response.
    for (const key of ['lock', 'editable', 'deletable', 'resettable'] as const) {
      const { [key]: _dropped, ...missing } = LAYERED_BODY;
      expect(() => GetMetaItemLayeredResponseSchema.parse(missing)).toThrow();
    }
  });

  it('[ADR-0131 D6] rejects an overlayScope other than `env` — `org` included: no read serves an organization\'s row', () => {
    for (const overlayScope of ['package', 'org']) {
      expect(() => GetMetaItemLayeredResponseSchema.parse({ ...LAYERED_BODY, overlayScope })).toThrow();
    }
  });

  it('is a DIFFERENT shape from the ordinary read — which is why it got its own path', () => {
    // The layered body carries no `item`, and the ordinary envelope carries no
    // layers. One route answering both is what #5882 was filed about; the
    // assertion states that the two really are distinct resources rather than
    // one schema that could have absorbed the other.
    // Compile-time half: `LayeredCarriesNoItem` / `PlainCarriesNoLayers` at
    // module scope.
    const layered = GetMetaItemLayeredResponseSchema.parse(LAYERED_BODY);
    expect(layered).not.toHaveProperty('item');

    // And the ordinary schema cannot stand in for it at all: the layered body
    // has no `item`, which `GetMetaItemResponseSchema` requires, so it does not
    // merely lose the layers on the way through — it fails outright. That is
    // the sharpest available statement that these are two resources and not one
    // schema stretched over both.
    const throughPlain = GetMetaItemResponseSchema.safeParse(LAYERED_BODY);
    expect(throughPlain.success).toBe(false);
    expect(throughPlain.error?.issues.map((i) => i.path.join('.'))).toContain('item');
  });
});

describe('the read serves the version token; the conflict carries the current one as data', () => {
  const TOKEN = 'hmac-sha256:' + 'a'.repeat(64);

  it('GetMetaItemResponseSchema keeps `version` through a parse — a token, `null`, or absent', () => {
    expect(GetMetaItemResponseSchema.parse({ type: 'view', name: 'grid', item: {}, version: TOKEN }).version).toBe(TOKEN);
    expect(GetMetaItemResponseSchema.parse({ type: 'view', name: 'grid', item: {}, version: null }).version).toBeNull();
    // The cached branch and a `?preview=draft` read publish none: absent is legal and stays absent.
    const cached = GetMetaItemResponseSchema.parse({ type: 'view', name: 'grid', item: {} });
    expect('version' in cached).toBe(false);
  });

  it('rejects a `version` that is not a token', () => {
    expect(() => GetMetaItemResponseSchema.parse({ type: 'view', name: 'grid', item: {}, version: 3 })).toThrow();
  });

  it('MetadataConflictErrorSchema parses the door\'s 409 body with `currentVersion` intact — a token or `null`', () => {
    const body = {
      error: `view/grid has been modified since you loaded it. The version token sent is not the current version (current is ${TOKEN}).`,
      code: 'METADATA_CONFLICT',
      currentVersion: TOKEN,
    };
    expect(MetadataConflictErrorSchema.parse(body).currentVersion).toBe(TOKEN);
    expect(MetadataConflictErrorSchema.parse({ ...body, currentVersion: null }).currentVersion).toBeNull();
  });

  it('REQUIRES `currentVersion` and the one code — absence is not "no row"', () => {
    const body = { error: 'view/grid has been modified since you loaded it.', code: 'METADATA_CONFLICT' };
    expect(MetadataConflictErrorSchema.safeParse(body).success).toBe(false);
    expect(MetadataConflictErrorSchema.safeParse({ ...body, currentVersion: null, code: 'CONCURRENT_UPDATE' }).success).toBe(false);
  });
});

/**
 * #23316 — the automation engine's verdict on a stored flow is reachable and
 * typed on both reads, as a closed set: what an SDK caller branches on without
 * a cast, and the `refused` reason a reader renders.
 */
export type RegistrationIsTheVerdictOrAbsent = Assert< Eq< GetMetaItemResponse['registration'], FlowRegistration | undefined > >;
export type ListRegistrationsAreKeyedVerdicts = Assert< Eq< GetMetaItemsResponse['registrations'], Record<string, FlowRegistration> | undefined > >;

describe('the engine\'s verdict on a stored flow: `registration` beside the item, `registrations` beside the list', () => {
  const FLOW = { name: 'nightly_sync', status: 'active' };
  const REFUSED = { state: 'refused', reason: { message: "Flow 'nightly_sync' rejected: 1 undeclared config key(s)." } };

  it('keeps each verdict through a parse — the `refused` reason with or without the engine\'s code', () => {
    for (const registration of [
      { state: 'registered' },
      { state: 'unregistered' },
      REFUSED,
      { state: 'refused', reason: { code: 'VALIDATION_ERROR', message: 'invalid flow' } },
    ]) {
      expect(GetMetaItemResponseSchema.parse({ type: 'flow', name: 'nightly_sync', item: FLOW, registration }).registration)
        .toEqual(registration);
    }
    // Absent stays absent: no engine judged it, which is never `registered`.
    expect('registration' in GetMetaItemResponseSchema.parse({ type: 'flow', name: 'nightly_sync', item: FLOW })).toBe(false);
  });

  it('is a closed set: no fourth state, and `refused` REQUIRES the reason', () => {
    expect(FlowRegistrationSchema.safeParse({ state: 'running' }).success).toBe(false);
    expect(FlowRegistrationSchema.safeParse({ state: 'refused' }).success).toBe(false);
    expect(FlowRegistrationSchema.safeParse({ state: 'refused', reason: { code: 'X' } }).success).toBe(false);
  });

  it('the list keeps `registrations` keyed by name through a parse', () => {
    const parsed = GetMetaItemsResponseSchema.parse({
      type: 'flow',
      items: [FLOW],
      registrations: { nightly_sync: REFUSED },
    });
    expect(parsed.registrations).toEqual({ nightly_sync: REFUSED });
    expect('registrations' in GetMetaItemsResponseSchema.parse({ type: 'flow', items: [FLOW] })).toBe(false);
  });
});

/**
 * #24298 — a pending draft's per-key provenance, `draftChanges`, beside the
 * item on the draft read: a closed `by` vocabulary, a path that is an ARRAY of
 * keys, and absence kept distinct from "nothing changed". Typed at the level
 * an SDK caller branches on, and deliberately not on the `_drafts` row.
 */
type DraftChange = NonNullable<GetMetaItemResponse['draftChanges']>[number];
export type DraftChangeByIsTheClosedSurfaceSet = Assert< Eq< DraftChange['by'], 'copilot' | 'mcp' | 'studio' | 'api' > >;
// #27176 — the OAuth client an `mcp` write was made by: an id, an optional name, and absent otherwise.
export type DraftChangeClientIsOptional = Assert< Eq< DraftChange['client'], { id: string; name?: string | undefined } | undefined > >;
export type DraftChangePathIsAnArrayOfKeys = Assert< Eq< DraftChange['path'], string[] > >;
export type DraftChangeActorIsIdOrNull = Assert< Eq< DraftChange['actor'], string | null > >;
export type DraftChangesMayBeAbsent = Assert< Eq< undefined extends GetMetaItemResponse['draftChanges'] ? true : false, true > >;
export type DraftsRowCarriesNoDraftChanges = Assert< Eq< 'draftChanges' extends keyof ListDraftsResponse['drafts'][number] ? true : false, false > >;

describe('`draftChanges` — which surface last changed each key of a pending draft, beside the item', () => {
  const VIEW = { name: 'loan_board', label: 'Loans', columns: ['title', 'due_on'] };
  const AT = '2026-10-18T11:02:38.000Z';
  const ENTRIES = [
    { path: [], by: 'copilot', actor: 'usr_1', at: AT },
    { path: ['columns'], by: 'studio', actor: 'usr_1', at: AT },
    { path: ['fields', 'account.name', 'readable'], by: 'api', actor: null, at: AT },
    { path: ['label'], by: 'mcp', actor: 'usr_1', at: AT, client: { id: 'cli_1', name: 'Claude' } },
    { path: ['description'], by: 'mcp', actor: 'usr_1', at: AT },
  ];
  const DRAFT_READ = { type: 'view', name: 'loan_board', item: VIEW, version: 'v1', draftChanges: ENTRIES };

  it('keeps every entry through a parse — each surface, a root path, a dotted KEY and a null actor', () => {
    expect(GetMetaItemResponseSchema.parse(DRAFT_READ).draftChanges).toEqual(ENTRIES);
  });

  it('an older response without the key still parses, and the key stays ABSENT — never defaulted to []', () => {
    const parsed = GetMetaItemResponseSchema.parse({ type: 'view', name: 'loan_board', item: VIEW, version: 'v1' });
    expect('draftChanges' in parsed).toBe(false);
  });

  /** The issue a refused body raises, located — never a bare "it failed". */
  const issueOf = (draftChanges: unknown) => {
    const verdict = GetMetaItemResponseSchema.safeParse({ ...DRAFT_READ, draftChanges });
    expect(verdict.success).toBe(false);
    return verdict.success ? undefined : verdict.error.issues[0];
  };

  it('refuses a surface outside the closed set, at the entry\'s `by`', () => {
    for (const by of ['ai', 'user', 'MCP', 'Copilot']) {
      expect(issueOf([{ ...ENTRIES[0], by }])).toMatchObject({ code: 'invalid_value', path: ['draftChanges', 0, 'by'] });
    }
  });

  it('#27176 — refuses a client with no id, an empty id or an empty name, at the entry\'s `client`', () => {
    for (const client of [{}, { id: '' }, { id: 'cli_1', name: '' }, 'cli_1']) {
      expect(issueOf([{ ...ENTRIES[3], client }])?.path?.slice(0, 3)).toEqual(['draftChanges', 0, 'client']);
    }
  });

  it('refuses a dotted-string path and an empty key segment — a path is an array of stored keys', () => {
    expect(issueOf([{ ...ENTRIES[1], path: 'fields.renewal_count' }]))
      .toMatchObject({ code: 'invalid_type', path: ['draftChanges', 0, 'path'] });
    expect(issueOf([{ ...ENTRIES[1], path: ['fields', ''] }]))
      .toMatchObject({ code: 'too_small', path: ['draftChanges', 0, 'path', 1] });
  });

  it('refuses an entry without its write\'s time, or with one that is not an ISO-8601 instant', () => {
    const withoutAt: Record<string, unknown> = { ...ENTRIES[0] };
    delete withoutAt.at;
    expect(issueOf([withoutAt])).toMatchObject({ code: 'invalid_type', path: ['draftChanges', 0, 'at'] });
    expect(issueOf([{ ...ENTRIES[0], at: 'two minutes ago' }]))
      .toMatchObject({ code: 'invalid_format', path: ['draftChanges', 0, 'at'] });
  });
});
