/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  classifyImportMappingsFailure,
  classifyViewsFailure,
  type MetadataReadWarningEvent,
} from './index';

/**
 * `listViews(object)` feeds the list-view switcher, and it degrades EVERY
 * failure to an empty list. So three states the user must be able to tell
 * apart —
 *
 *   has saved views  -> a non-empty list
 *   has none         -> `[]`   (the server served zero; a real answer)
 *   could not read   -> `[]`   (the server refused, or broke)
 *
 * — collapse to two on the return value, and the two that collapse are exactly
 * the two that must not be confused. Nothing below asserts on emptiness to
 * establish WHICH happened: an assertion on "is the result empty" passes
 * identically for a refusal and for a served zero, so it can never fail for the
 * condition it is supposed to be about. The discriminator is the
 * `onMetadataReadWarning` channel, read from the ERROR's ADR-0112 `code` and
 * status (objectui#8151, the sibling of objectui#7741 one method over).
 *
 * The empty list itself is UNCHANGED on every arm, including the loud ones, and
 * every assertion below re-checks that it did not move: `listViews` has
 * answered `Promise<any[]>` and never thrown since
 * `@object-ui/data-objectstack@17.1.0`.
 *
 * ## Why `view`'s quiet set is not `mapping`'s
 *
 * The one arm that differs has its own pin (`the divergence`, last describe
 * block): 400 `INVALID_REQUEST` is `mapping`'s supported "this deployment does
 * not carry that kind", and on `view` it cannot mean that — `view` is in the
 * platform's static spelling contract, so `refuseUnknownMetaListType` never
 * writes that refusal for it. Reading it as kind-absence here would put a fresh
 * swallow inside this card's own fix.
 */

const BASE_URL = 'http://list-views-read-warning.local';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** An error body in the WRAPPED family (`{ success:false, error:{code,message} }`). */
function wrappedError(code: string, message: string) {
  return { success: false, error: { code, message } };
}

/**
 * An adapter whose `GET /meta/view` answers with `answer` — a `Response` to
 * serve, or a thrown value for a transport failure — with the read-warning
 * channel already subscribed.
 *
 * Discovery is always served, so `connect()` succeeds and every reading below
 * is about the view read itself rather than about an adapter that never got off
 * the ground. The SDK is NOT stubbed: the real `@objectstack/client` fetch
 * wrapper is what decorates the error with `code` / `httpStatus`, and it is
 * that decoration the classifier reads.
 */
function makeFailingDS(answer: (() => Response) | (() => never)) {
  const warnings: MetadataReadWarningEvent[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/discovery')) {
      return json({ success: true, data: { capabilities: {}, routes: {} } });
    }
    if (url.includes('/api/v1/meta/view')) return answer();
    return json({ success: false, error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
  });
  const ds = new ObjectStackAdapter({ baseUrl: BASE_URL, fetch: fetchImpl, autoReconnect: false });
  const unsubscribe = ds.onMetadataReadWarning((ev) => warnings.push(ev));
  return { ds, warnings, unsubscribe, fetchImpl };
}

describe('listViews — a refused read is not an object without saved views (objectui#8151)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearSharedDiscoveryCache();
    // The breadcrumb is kept on every arm by design; silence it so a suite that
    // exercises a dozen failures does not print a dozen stack traces.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('QUIET — this host mounted no metadata door', () => {
    it('says nothing when the `/meta` route is not mounted at all', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('ROUTE_NOT_FOUND', 'no route for GET /api/v1/meta/view'), 404),
      );

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('says nothing when the route is mounted with nothing behind it', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('NOT_IMPLEMENTED', 'metadata not implemented on this host'), 501),
      );

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('says nothing for a bare, code-less transport 404 (a proxy, a gateway)', async () => {
      // No ObjectStack route wrote this answer — this door's own refusals all
      // ship a `code` — so the status is the best signal available and it means
      // the API is not there.
      const { ds, warnings } = makeFailingDS(() => json({ message: 'Not Found' }, 404));

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toEqual([]);
    });
  });

  describe('LOUD — the server answered and declined this caller', () => {
    it('announces a lapsed session, and STILL answers []', async () => {
      // The card's headline case: a token that lapsed mid-session renders the
      // object's view switcher as though the user's own saved views were gone.
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('UNAUTHENTICATED', 'Authentication required'), 401),
      );

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        operation: 'listViews',
        kind: 'view',
        objectName: 'crm_lead',
        reason: 'refused',
        code: 'UNAUTHENTICATED',
        status: 401,
      });
    });

    it('announces a missing grant', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('PERMISSION_DENIED', 'manage_metadata required'), 403),
      );

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ reason: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    });

    it('announces a code-less refusal on the status alone', async () => {
      const { ds, warnings } = makeFailingDS(() => json({ message: 'Forbidden' }, 403));

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ reason: 'refused', status: 403 });
      expect(warnings[0]?.code).toBeUndefined();
    });
  });

  describe('LOUD — the read could not be completed', () => {
    it('announces a 5xx', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('INTERNAL_ERROR', 'metadata store unavailable'), 500),
      );

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        operation: 'listViews',
        kind: 'view',
        reason: 'unreadable',
        status: 500,
      });
    });

    it('announces a dropped connection, which carries no code and no status', async () => {
      const { ds, warnings } = makeFailingDS(() => {
        throw new TypeError('Failed to fetch');
      });

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ reason: 'unreadable' });
      expect(warnings[0]?.code).toBeUndefined();
      expect(warnings[0]?.status).toBeUndefined();
      expect(warnings[0]?.message).toBe('Failed to fetch');
    });
  });

  describe('the control that cannot be faked — a server that served ZERO views', () => {
    it('is silent, because nothing failed', async () => {
      // Identical RETURN to every loud arm above. If the discrimination were
      // read from the emptiness of the result instead of from `err`, this test
      // and the refusal tests could not both hold.
      const { ds, warnings } = makeFailingDS(() => json({ type: 'view', items: [] }));

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toEqual([]);
    });
  });

  describe('the OTHER door — `?preview=draft` decorates errors differently', () => {
    it('classifies a refused draft read the same way (ADR-0037)', async () => {
      // `listViews({ previewDrafts })` goes through this package's own
      // `MetadataClient`, whose `parseError` sets `status` and NOT `httpStatus`.
      // The classifier's status ladder is what makes the two doors agree; read
      // only `httpStatus` and this falls through to the code-less residual.
      const { ds, warnings, fetchImpl } = makeFailingDS(() =>
        json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401),
      );

      expect(await ds.listViews('crm_lead', { previewDrafts: true })).toEqual([]);
      expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('preview=draft'))).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        operation: 'listViews',
        kind: 'view',
        objectName: 'crm_lead',
        reason: 'refused',
        code: 'UNAUTHENTICATED',
        status: 401,
      });
    });
  });

  describe('the divergence — `view` does not inherit `mapping`’s quiet arm', () => {
    it('announces a coded 400 that the sibling classifier keeps quiet', async () => {
      // 400 `INVALID_REQUEST` is the metadata LIST door's "this deployment
      // carries no such kind" (framework#9488). It is unreachable for `view`:
      // `refuseUnknownMetaListType` returns without writing a refusal for any
      // spelling in the platform's static contract, and `view`/`views` are both
      // in it. So on this face the shape is some OTHER refusal, and swallowing
      // it would be objectui#8151 re-created inside its own fix.
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('INVALID_REQUEST', 'malformed metadata list request'), 400),
      );

      expect(await ds.listViews('crm_lead')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ reason: 'unreadable', code: 'INVALID_REQUEST', status: 400 });
    });

    it('is the ONLY arm on which the two classifiers disagree', async () => {
      // One input, two verdicts — the whole reading this card owed, in one
      // assertion. Everything else agrees, and that agreement is asserted too
      // so a future edit cannot quietly fork a second dialect.
      const unknownKind = { code: 'INVALID_REQUEST', httpStatus: 400 };
      expect(classifyImportMappingsFailure(unknownKind).kind).toBe('not-served');
      expect(classifyViewsFailure(unknownKind).kind).toBe('unreadable');

      for (const shared of [
        { code: 'ROUTE_NOT_FOUND', httpStatus: 404 },
        { code: 'NOT_IMPLEMENTED', httpStatus: 501 },
        { code: 'UNAUTHENTICATED', httpStatus: 401 },
        { code: 'PERMISSION_DENIED', httpStatus: 403 },
        { httpStatus: 404 },
        { httpStatus: 501 },
        { httpStatus: 405 },
        { httpStatus: 500 },
        { status: 401 },
        { statusCode: 403 },
        new Error('boom'),
        undefined,
        null,
      ]) {
        expect(classifyViewsFailure(shared).kind).toBe(classifyImportMappingsFailure(shared).kind);
      }
    });
  });

  describe('the LIT CONTROL — `listImportMappings` is untouched', () => {
    it('still keeps its own kind-absent 400 quiet, and still announces a refusal', async () => {
      // The sibling objectui#7741 already fixed, in the same file, exercised
      // through the same probe. If it moved, this card broke it; if it read
      // nothing at all, the probe is what is broken.
      const mappingDS = (answer: () => Response) => {
        const warnings: MetadataReadWarningEvent[] = [];
        const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith('/api/v1/discovery')) {
            return json({ success: true, data: { capabilities: {}, routes: {} } });
          }
          if (url.includes('/api/v1/meta/mapping')) return answer();
          return json({ success: false, error: { code: 'NOT_FOUND', message: url } }, 404);
        });
        const ds = new ObjectStackAdapter({ baseUrl: BASE_URL, fetch: fetchImpl, autoReconnect: false });
        ds.onMetadataReadWarning((ev) => warnings.push(ev));
        return { ds, warnings };
      };

      const quiet = mappingDS(() =>
        json(wrappedError('INVALID_REQUEST', "'mapping' is not a metadata type."), 400),
      );
      expect(await quiet.ds.listImportMappings('task')).toEqual([]);
      expect(quiet.warnings).toEqual([]);

      clearSharedDiscoveryCache();
      const loud = mappingDS(() =>
        json(wrappedError('UNAUTHENTICATED', 'Authentication required'), 401),
      );
      expect(await loud.ds.listImportMappings('task')).toEqual([]);
      expect(loud.warnings).toHaveLength(1);
      expect(loud.warnings[0]).toMatchObject({
        operation: 'listImportMappings',
        kind: 'mapping',
        reason: 'refused',
      });
    });
  });
});
