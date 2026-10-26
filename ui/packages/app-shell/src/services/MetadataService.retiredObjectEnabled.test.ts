/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6238 — `MetadataService`'s delete path no longer PUTs a tombstone.
 *
 * `deleteObject` and `deleteMetadataItem` used to write
 * `{ name, enabled: false, _deleted: true }` through `client.meta.saveItem`,
 * i.e. `PUT /api/v1/meta/:type/:name`. Neither key is a metadata convention,
 * and the two halves of that failed differently — which is why this file
 * carries both a schema oracle and a WIRE oracle.
 *
 * ## What was measured before the fix
 *
 * Against the installed `@objectstack/spec` 17.2.0 (ESM build), using
 * `getMetadataTypeSchema` — the registry the framework's own `saveMetaItem`
 * resolves a PUT's validator from (`resolveOverlaySchema`):
 *
 *   - 25 of the 26 registered overlay schemas refuse `enabled` and/or
 *     `_deleted` BY NAME, `object` among them (`422 INVALID_METADATA`,
 *     `unrecognized_keys ["enabled","_deleted"]`).
 *   - `view` is the exception, and it is the WORSE one: its schema tolerates
 *     unknown keys, and the framework persists the request item verbatim rather
 *     than `parsed.data`, so the tombstone was STORED. So were the four kinds
 *     with no registered schema at all (`analytics_cube`, `connector`,
 *     `sharing_rule`, `webhook`), which fall through unvalidated.
 *   - `_deleted` has no reader anywhere in the platform. So on exactly the
 *     categories that did not 422, the "soft delete" was a silent no-op that
 *     left the item live carrying two junk keys.
 *
 * Nothing strips them, and there is no spec surface for "this item exists but
 * is off" — `ObjectSchema`'s accept set has no such flag, and the near-spelling
 * `enable` is a capabilities MODULE OBJECT, so `enabled: false` -> `enable:
 * false` fails on the value where it passes on the name. There was therefore no
 * spelling to rename to and no convention to converge onto: the delete door
 * `DELETE /meta/:type/:name` is the whole answer, and it is the same request
 * `MetadataClient.reset` already issued for `MetadataObjectsPage`'s object
 * deletes.
 *
 * ## Why a wire oracle as well as the schema one
 *
 * `scripts/check-designer-field-key-parity.mjs` reads DECLARATIONS. It saw the
 * latent `enabled?: boolean` on `ObjectMetadataPayload` and it could not see
 * the tombstone at all — that body is a literal, not a declared shape, which is
 * the gate's own coverage note 1. So restoring only the WRITER, with the
 * declaration still deleted, leaves that gate green. Every case below that
 * asserts on a captured request is covering that half, and is the half that
 * reds if the tombstone comes back.
 *
 * ## Why the assertions are on captured requests rather than spies
 *
 * The claim is about bytes on the wire, and the two disagree in the case that
 * matters: a spy sees an in-memory body, and `JSON.stringify` drops
 * `undefined`. Every wire case here reads the real `RequestInit` the SDK handed
 * `fetch`.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from '@objectstack/spec/kernel';
import { ObjectStackAdapter, MetadataClient } from '@object-ui/data-objectstack';
import { MetadataService } from './MetadataService';

const BASE_URL = 'http://test.local';

/** One request exactly as the SDK issued it. */
interface CapturedRequest {
  method: string;
  url: string;
  body: string | undefined;
}

function makeCapturingAdapter() {
  const requests: CapturedRequest[] = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: BASE_URL,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        method: (init?.method ?? 'GET').toUpperCase(),
        url: String(input),
        body: init?.body == null ? undefined : String(init.body),
      });
      return new Response(JSON.stringify({ type: 'object', name: 'account', deleted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { adapter, requests };
}

const unrecognizedKeys = (result: { success: boolean; error?: unknown }): string[] =>
  result.success
    ? []
    : ((result as { error: { issues: Array<{ code: string; keys?: string[] }> } }).error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => i.keys ?? []));

/** A base document `ObjectSchema` accepts, for probing one key at a time. */
const BASE = { name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } };

/** The body the two delete methods used to PUT. */
const TOMBSTONE = { name: 'account', enabled: false, _deleted: true };

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    // Without this, every "refuses `enabled`" assertion below could be produced
    // by a schema that silently dropped the key instead (objectstack#4001).
    const result = ObjectSchema.safeParse({ ...BASE, zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('accepts the controls — this is a key-by-key result, not a schema refusing everything', () => {
    expect(ObjectSchema.safeParse(BASE).success).toBe(true);
    expect(ObjectSchema.safeParse({ ...BASE, isSystem: true }).success).toBe(true);
  });
});

describe('objectui#6238 · the schema oracle — both tombstone keys are refused BY NAME', () => {
  it('refuses `enabled` and `_deleted` individually, on a document it otherwise accepts', () => {
    expect(unrecognizedKeys(ObjectSchema.safeParse({ ...BASE, enabled: false }))).toEqual(['enabled']);
    expect(unrecognizedKeys(ObjectSchema.safeParse({ ...BASE, _deleted: true }))).toEqual(['_deleted']);
  });

  it('refuses the whole tombstone body, naming both keys at once', () => {
    expect(unrecognizedKeys(ObjectSchema.safeParse(TOMBSTONE)).sort()).toEqual(['_deleted', 'enabled']);
  });

  it('has no on/off flag to rename to — `enable` is a capabilities object, not a boolean', () => {
    // This is the trap the card names, and it is a VALUE-level fact, so the
    // key-name gate could never have stated it. `enable` passes on the name and
    // fails on the value, which is why this is objectui#4687's resolution
    // (delete the declaration) rather than objectui#6041's (rename it).
    // 43, not the 42 this pin carried against 17.2.0: `@objectstack/spec` 17.3.0
    // ADOPTED `editMode` (measured — gained set exactly `['editMode']`, lost set
    // empty). That adoption is unrelated to this file's subject and is pinned in
    // `packages/types/src/__tests__/object-schema-metadata-spec-derivation.test.ts`;
    // the count rides here only as the corpus guard for the membership claims
    // below, so it is re-pointed, not weakened.
    // 44 at `@objectstack/spec` 17.6.0, which adopted `imageField` (measured against
    // a 17.5.0 control: gained set exactly `['imageField']`, lost set empty;
    // objectui#11438). Re-pointed as the 17.3.0 adoption was, not weakened.
    // 45 at `@objectstack/spec` 18.0.0-next.0, which adopted `attachedOnRead`
    // (measured against a 17.7.0 control: gained set exactly `['attachedOnRead']`,
    // lost set empty; objectui#12030). Re-pointed the same way.
    // 46 on the objectstack `main` pin after 18.0.0-next.3, which adopted
    // `defaultRowScope` (objectstack#24398; measured against the next.3 pin: the
    // one top-level key `ObjectSchema` gains between the two commits, none lost;
    // objectui#12971). Re-pointed the same way.
    // 47 at `@objectstack/spec` 18.1.0, which adopted `membershipKeys`
    // (objectstack#25513; measured against the 915e9404 pin: the spec's own
    // `authorable-surface/data.json` gains exactly `data/Object:membershipKeys`
    // between the two commits, none lost; objectui#13440). Re-pointed the same way.
    const accept = new Set(Object.keys(ObjectSchema.shape as Record<string, unknown>));
    expect(accept.size).toBe(47);
    expect(accept.has('enable')).toBe(true);
    expect(accept.has('enabled')).toBe(false);
    expect(accept.has('_deleted')).toBe(false);
    for (const key of ['disabled', 'active', 'isActive', 'deleted', 'isDeleted', 'softDeleted']) {
      expect(accept.has(key), `ObjectSchema unexpectedly accepts \`${key}\``).toBe(false);
    }

    const asBoolean = ObjectSchema.safeParse({ ...BASE, enable: false });
    expect(asBoolean.success).toBe(false);
    // The refusal is NOT a name refusal — that is the whole point.
    expect(unrecognizedKeys(asBoolean)).not.toContain('enable');
  });

  it('is a platform-wide fact, not an `object`-only one — the generic method serves every category', () => {
    // `deleteMetadataItem` is generic over category, so the measurement has to
    // be too. `getMetadataTypeSchema` is the registry the framework's
    // `saveMetaItem` resolves a PUT's validator from, so this is the same
    // oracle the server would have used, type by type.
    const types = listMetadataTypeSchemaTypes();
    expect(types.length).toBeGreaterThan(20);

    const refusedByName: string[] = [];
    const tolerated: string[] = [];
    for (const type of types) {
      const schema = getMetadataTypeSchema(type);
      if (!schema) continue;
      const parsed = schema.safeParse({ name: 'probe_name', enabled: false, _deleted: true });
      const refused = unrecognizedKeys(parsed).filter((k) => k === 'enabled' || k === '_deleted');
      if (refused.length) refusedByName.push(type);
      else tolerated.push(type);
    }

    // The overwhelming majority refuse by name — a hard 422 on the delete.
    expect(refusedByName).toContain('object');
    expect(refusedByName.length).toBeGreaterThanOrEqual(20);
    // And at least one does NOT, which is the case that made this a silent
    // no-op rather than a loud failure. Recorded as a measurement rather than
    // an exact list so a spec release that tightens a schema does not red this.
    expect(refusedByName.length + tolerated.length).toBe(types.length);
  });
});

describe('objectui#6238 · the wire oracle — the delete path issues DELETE, never a tombstone PUT', () => {
  it('deleteObject issues DELETE /api/v1/meta/object/:name and no PUT at all', async () => {
    const { adapter, requests } = makeCapturingAdapter();
    await new MetadataService(adapter).deleteObject('account');

    const writes = requests.filter((r) => r.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('DELETE');
    expect(writes[0].url).toBe(`${BASE_URL}/api/v1/meta/object/account`);
    // A DELETE carries no body, so there is nothing left for a refused key to
    // ride on. Asserted rather than assumed: the defect was a body.
    expect(writes[0].body).toBeUndefined();
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('puts neither `enabled` nor `_deleted` anywhere in any request it makes', async () => {
    // Deliberately a scan of every captured request rather than of one body:
    // the claim is that the two keys left the wire, not that one call stopped
    // sending them.
    const { adapter, requests } = makeCapturingAdapter();
    const service = new MetadataService(adapter);
    await service.deleteObject('account');
    await service.deleteMetadataItem('flow', 'nightly_purge');

    const wire = requests.map((r) => `${r.method} ${r.url} ${r.body ?? ''}`).join('\n');
    expect(wire).not.toContain('enabled');
    expect(wire).not.toContain('_deleted');
    // Falsification: the requests really happened and really named the items.
    expect(wire).toContain('DELETE http://test.local/api/v1/meta/object/account');
    expect(wire).toContain('DELETE http://test.local/api/v1/meta/flow/nightly_purge');
  });

  it('covers the categories the old tombstone did NOT 422 on — where it was a silent no-op', async () => {
    // `view` (tolerant schema) and `webhook` (no registered schema) are the two
    // shapes of "stored verbatim". Those are the categories where the old
    // tombstone persisted junk keys onto a still-live item, so they are the
    // ones worth pinning by name rather than trusting the generic case to cover.
    for (const category of ['view', 'webhook']) {
      const { adapter, requests } = makeCapturingAdapter();
      await new MetadataService(adapter).deleteMetadataItem(category, 'probe_name');

      const writes = requests.filter((r) => r.method !== 'GET');
      expect(writes).toHaveLength(1);
      expect(writes[0].method).toBe('DELETE');
      expect(writes[0].url).toBe(`${BASE_URL}/api/v1/meta/${category}/probe_name`);
      expect(writes[0].body).toBeUndefined();
    }
  });

  it('issues the SAME request `MetadataClient.reset` does — one operation, one mechanism', async () => {
    // The convergence claim, measured rather than asserted in prose. `reset` is
    // the door `MetadataObjectsPage.handleObjectsChange` and
    // `ResourceEditPage` already delete through; `client.meta.deleteItem` is
    // its name on the SDK client `MetadataService` already holds. If they were
    // two different endpoints, converging on one of them would not be
    // convergence — so the endpoints are compared, not the call sites.
    const { adapter, requests: viaService } = makeCapturingAdapter();
    await new MetadataService(adapter).deleteObject('account');

    const viaReset: CapturedRequest[] = [];
    await new MetadataClient({
      baseUrl: BASE_URL,
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        viaReset.push({
          method: (init?.method ?? 'GET').toUpperCase(),
          url: String(input),
          body: init?.body == null ? undefined : String(init.body),
        });
        return new Response(JSON.stringify({ reset: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    }).reset('object', 'account');

    const serviceWrite = viaService.filter((r) => r.method !== 'GET');
    expect(serviceWrite).toHaveLength(1);
    expect(viaReset).toHaveLength(1);
    expect(serviceWrite[0].method).toBe(viaReset[0].method);
    expect(serviceWrite[0].url).toBe(viaReset[0].url);
    // Falsification: neither is a GET that happened to match.
    expect(viaReset[0].method).toBe('DELETE');
  });
});
