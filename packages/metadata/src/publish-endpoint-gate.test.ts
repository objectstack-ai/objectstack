// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5189 (#5040 E7b) — `publishPackage` runs the endpoint publish gates.
 *
 * E7 (#5111) hung the five per-endpoint gates on `ObjectStackDefinitionSchema`,
 * covering every path that parses a STACK. This file pins the path that never
 * does: an `api` item minted item-by-item (`metadata.register()`, a Studio
 * write) and promoted by `publishPackage`, which before #5189 reached `state:
 * 'active'` without any gate seeing it. The one that mattered is ADR-0121 D6 —
 * `authRequired: false` with no armed `rateLimit` — because it is the only gate
 * with NO runtime counterpart: the executor honours anonymous access faithfully
 * and an unarmed budget meters nothing, so the bypass minted an anonymous,
 * zero-quota execution entry point.
 *
 * The load-time half of the backstop lives in `endpoint-matcher.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager.js';
import { MemoryLoader } from './loaders/memory-loader.js';

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const PKG = 'com.acme.endpoints';
const NS = 'acme';

/**
 * The AUTHORED endpoint document — exactly `ApiEndpointSchema` vocabulary,
 * nothing else. Passes every gate under `namespace: 'acme'`.
 *
 * [#5309] Split out of `apiItem` so the publish-envelope case below can put a
 * real authored body under `metadata`. It used to nest `apiItem()` there, which
 * put `packageId` / `state` INSIDE the body as well as on the envelope — an
 * accident of fixture reuse that only the schema's unknown-key stripping made
 * invisible.
 */
function endpointBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'list_things',
    path: `/api/v1/apps/${NS}/things`,
    method: 'GET',
    type: 'object_operation',
    target: 'acme_thing',
    objectParams: { object: 'acme_thing', operation: 'find' },
    ...over,
  };
}

/**
 * A STORED `api` item in the flat shape: the authored body plus the metadata
 * layer's bookkeeping at one level, which is what `MetadataManager.register`
 * holds and what `publishPackage` filters by.
 */
function apiItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...endpointBody(),
    packageId: PKG,
    state: 'draft',
    ...over,
  };
}

describe('#5189 — publishPackage gates `api` items', () => {
  let manager: MetadataManager;

  beforeEach(() => {
    manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
  });

  // ── The security case: ADR-0121 D6 ─────────────────────────────────────
  describe('ADR-0121 D6 — anonymous requires an ARMED budget', () => {
    it('REJECTS an `authRequired: false` endpoint with no rateLimit, naming the endpoint and the key', async () => {
      await manager.register('api', 'open_things', apiItem({ name: 'open_things', authRequired: false }));

      const result = await manager.publishPackage(PKG, { namespace: NS });

      expect(result.success).toBe(false);
      expect(result.itemsPublished).toBe(0);
      const errors = result.validationErrors ?? [];
      expect(errors.length).toBeGreaterThan(0);
      const d6 = errors.find(e => e.message.includes('authRequired: false'));
      expect(d6).toBeDefined();
      // names the endpoint …
      expect(d6!.name).toBe('open_things');
      expect(d6!.type).toBe('api');
      expect(d6!.message).toContain('open_things');
      // … and the key to fix, with the armed spelling.
      expect(d6!.message).toContain('rateLimit');
      expect(d6!.message).toContain('enabled: true');
    });

    it('REJECTS a rateLimit that is present but NOT armed (`enabled` defaults to false)', async () => {
      await manager.register(
        'api',
        'open_things',
        apiItem({
          name: 'open_things',
          authRequired: false,
          rateLimit: { windowMs: 60000, maxRequests: 100 },
        }),
      );

      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes('meters nothing'))).toBe(true);
    });

    it('PUBLISHES an anonymous endpoint that carries an armed budget', async () => {
      await manager.register(
        'api',
        'open_things',
        apiItem({
          name: 'open_things',
          authRequired: false,
          rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 },
        }),
      );

      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(true);
      expect(result.itemsPublished).toBe(1);
      const stored = (await manager.get('api', 'open_things')) as Record<string, unknown>;
      expect(stored.state).toBe('active');
    });

    it('is NOT opt-outable with `validate: false` — a gate is not a lint', async () => {
      await manager.register('api', 'open_things', apiItem({ name: 'open_things', authRequired: false }));

      const result = await manager.publishPackage(PKG, { namespace: NS, validate: false });
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes('authRequired: false'))).toBe(true);
    });
  });

  // ── The rest of the gates come along, because it is ONE function ────────
  describe('the other gates ride the same call', () => {
    it('rejects an unsupported target type (`proxy`)', async () => {
      await manager.register('api', 'proxied', apiItem({ name: 'proxied', type: 'proxy', target: 'https://x.test' }));
      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes("type: 'proxy'"))).toBe(true);
    });

    it('rejects a path outside the stack carve-out (ADR-0121 D1)', async () => {
      await manager.register('api', 'list_things', apiItem({ path: '/api/v1/things' }));
      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes('carve-out'))).toBe(true);
    });

    it('rejects two items claiming the same METHOD + normalized path', async () => {
      await manager.register('api', 'a_things', apiItem({ name: 'a_things' }));
      await manager.register('api', 'b_things', apiItem({ name: 'b_things', path: `/api/v1/apps/${NS}/things/` }));

      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes('already claimed by endpoint'))).toBe(true);
    });

    it('reports EVERY bad endpoint, not just the first', async () => {
      await manager.register('api', 'bad_one', apiItem({ name: 'bad_one', type: 'proxy', target: 'https://x.test' }));
      await manager.register('api', 'bad_two', apiItem({ name: 'bad_two', path: '/api/v1/elsewhere', method: 'POST' }));

      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      const named = (result.validationErrors ?? []).map(e => e.name);
      expect(named).toContain('bad_one');
      expect(named).toContain('bad_two');
    });
  });

  // ── Identity: this path cannot prove a namespace on its own ─────────────
  describe('namespace identity (ADR-0121 D2 / #5040 Q1 = A)', () => {
    it('refuses to publish `api` items when no namespace was supplied, and says why HERE', async () => {
      await manager.register('api', 'list_things', apiItem());

      const result = await manager.publishPackage(PKG);

      expect(result.success).toBe(false);
      const precondition = result.validationErrors!.find(e => e.message.includes('manifest.namespace'));
      expect(precondition).toBeDefined();
      // Reported ONCE, against the type rather than any one endpoint …
      expect(precondition!.name).toBe('');
      expect(precondition!.type).toBe('api');
      // … and carries this call's own remedy, not only the stack-file one.
      expect(precondition!.message).toContain('publishPackage(id, { namespace })');
    });

    it('does NOT infer the namespace from the item being judged — the key cannot even be authored (#5384)', async () => {
      // The item declares a `namespace` field and a matching path; believing it
      // would make the carve-out gate vacuous.
      //
      // ⚠️ [#5384] The MECHANISM that guarantees this changed, and the change is
      // a strengthening — so the assertion moved with it rather than being
      // deleted. Before: `ApiEndpointSchema` was an open `z.object`, the key
      // parsed through and was silently stripped, and the gate went on reading
      // the manifest — so the proof was "the gate ignores it". Now the schema is
      // `strictObject` and `namespace` is refused BY NAME before the gate runs:
      // the gate cannot infer a namespace from the item because the item can no
      // longer express one. `namespace` was deliberately NOT peeled as a stored
      // envelope key in #5309 — it is authored here, and peeling it would hide
      // exactly the typo class #5384 exists to catch.
      //
      // Which refusal SPEAKS is therefore what changed; that publish refuses is
      // unchanged, and both halves are asserted.
      await manager.register('api', 'list_things', apiItem({ namespace: NS }));

      const result = await manager.publishPackage(PKG);
      expect(result.success).toBe(false);

      // The named verdict entry — `publishPackage` speaks in `validationErrors[]`,
      // not in an ADR-0112 envelope, so the entry is what carries the refusal.
      const refusal = result.validationErrors!.find(e => e.message.includes('ApiEndpointSchema'));
      expect(
        refusal,
        'the closed shape must refuse the authored `namespace` key by name',
      ).toBeDefined();
      expect(refusal!.name).toBe('list_things');
      expect(refusal!.type).toBe('api');
      // The offending key is echoed back …
      expect(refusal!.message).toContain('namespace');
      // … with the ADR-0121 D2 wrong-layer prescription, not a bare "unrecognized".
      expect(refusal!.message).toContain('manifest.namespace');
    });

    it('the carve-out gate is not vacuous: a clean item with no namespace supplied still hits the precondition', async () => {
      // CONTROL for the case above. Without it, that test would keep passing if
      // the shape started refusing EVERY item for some unrelated reason — the
      // failure mode this file's own §1 warns about. Same call, same absent
      // namespace, but a body the schema accepts: the refusal that speaks must
      // be the manifest precondition, and it must NOT be a schema error.
      await manager.register('api', 'list_things', apiItem());

      const result = await manager.publishPackage(PKG);
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes('manifest.namespace'))).toBe(true);
      expect(
        result.validationErrors!.some(e => e.message.includes('ApiEndpointSchema')),
        'a clean endpoint body must not produce a schema error',
      ).toBe(false);
    });
  });

  // ── Precondition + blast radius ────────────────────────────────────────
  describe('shape and scope', () => {
    it('rejects an `api` item that does not satisfy ApiEndpointSchema', async () => {
      await manager.register('api', 'broken', { name: 'broken', path: '/api/v1/apps/acme/x', packageId: PKG });

      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes('ApiEndpointSchema'))).toBe(true);
    });

    it('reads a publish ENVELOPE\'s `metadata` — the same document publish snapshots', async () => {
      await manager.register('api', 'open_things', {
        name: 'open_things',
        packageId: PKG,
        state: 'draft',
        // [#5309] The body under `metadata` is the AUTHORED document; the
        // bookkeeping belongs on the envelope around it, and only there.
        metadata: endpointBody({ name: 'open_things', authRequired: false }),
      });

      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      expect(result.validationErrors!.some(e => e.message.includes('authRequired: false'))).toBe(true);
    });

    it('leaves a package with no `api` items completely untouched', async () => {
      await manager.register('object', 'acme_thing', {
        name: 'acme_thing', label: 'Thing', packageId: PKG, state: 'draft',
        metadata: { fields: ['name'] },
      });
      await manager.register('view', 'thing_list', {
        name: 'thing_list', label: 'Things', packageId: PKG, state: 'draft',
        metadata: { columns: ['name'] },
      });

      // No namespace supplied, and none needed: the gate pass returns early.
      const result = await manager.publishPackage(PKG);
      expect(result.success).toBe(true);
      expect(result.itemsPublished).toBe(2);
    });

    // ── [#5309] The stored ENVELOPE / authored BODY split ────────────────
    //
    // `apiItem()` above is already a stored row: it carries `packageId` and
    // `state`, which are storage identity and not endpoint vocabulary. Every
    // case in this file therefore depends on those keys not being judged as
    // vocabulary — silently, via the schema's unknown-key STRIPPING, until the
    // split made it explicit. These two pin it directly, so the dependency is
    // stated rather than assumed.
    it('#5309 — gates the BODY: a fully-published row yields the D6 verdict, not a schema error', async () => {
      await manager.register('api', 'open_things', apiItem({
        name: 'open_things',
        authRequired: false,
        // Everything `publishPackage` stamps onto a row it has published once.
        version: 2,
        publishedAt: '2026-08-08T00:00:00.000Z',
        publishedBy: 'usr_admin',
        publishedDefinition: { name: 'open_things' },
        package: PKG,
        state: 'active',
      }));

      const result = await manager.publishPackage(PKG, { namespace: NS });

      expect(result.success).toBe(false);
      const messages = (result.validationErrors ?? []).map(e => e.message);
      // The verdict the gate exists to give …
      expect(messages.some(m => m.includes('authRequired: false'))).toBe(true);
      // … and NOT the "cannot be gated" precondition failure, which is what a
      // schema that judged the bookkeeping would produce instead.
      expect(messages.some(m => m.includes('does not satisfy ApiEndpointSchema'))).toBe(false);
    });

    it('#5309 — a published row still indexes: publish and the matcher read the same body', async () => {
      // End to end through both doors of the split. `publishPackage` re-registers
      // the row with `state`/`version`/`published*` stamped on; the load-time
      // backstop must still find the declaration underneath.
      await manager.register('api', 'list_things', apiItem());

      const published = await manager.publishPackage(PKG, { namespace: NS });
      expect(published.success).toBe(true);

      const stored = (await manager.get('api', 'list_things')) as Record<string, unknown>;
      expect(stored.state).toBe('active');
      expect(stored.version).toBe(1);

      const match = await manager.matchEndpoint({ method: 'GET', path: `/api/v1/apps/${NS}/things` });
      expect(match?.endpoint.name).toBe('list_things');
      expect(match?.endpoint.authRequired).toBe(true);
      // The served declaration carries no storage bookkeeping.
      const body = match!.endpoint as unknown as Record<string, unknown>;
      expect(body).not.toHaveProperty('packageId');
      expect(body).not.toHaveProperty('state');
      expect(body).not.toHaveProperty('publishedDefinition');
    });

    it('fails the WHOLE publish, leaving the good items unpublished (publish is atomic)', async () => {
      await manager.register('api', 'good_things', apiItem({ name: 'good_things' }));
      await manager.register('api', 'open_things', apiItem({
        name: 'open_things',
        path: `/api/v1/apps/${NS}/open`,
        authRequired: false,
      }));

      const result = await manager.publishPackage(PKG, { namespace: NS });
      expect(result.success).toBe(false);
      const good = (await manager.get('api', 'good_things')) as Record<string, unknown>;
      expect(good.state).toBe('draft');
      expect(good.publishedDefinition).toBeUndefined();
    });
  });
});
