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
  type MetadataReadWarningEvent,
} from './index';

/**
 * `listImportMappings(objectName)` feeds the import wizard's "saved mapping"
 * selector (framework #2611). The selector is FEATURE-DETECTED: an empty list
 * hides it, and the adapter deliberately degrades every failure to an empty
 * list — so a filter reading the wrong depth of the served item would not
 * fail anywhere; it would just make the selector never appear, on every
 * deployment, silently (objectui#14026).
 *
 * This pin therefore does not stub the SDK. The `fetch` stub answers the
 * discovery probe and `GET /api/v1/meta/mapping` with the body the framework's
 * REST list door was MEASURED to emit — `RestServer`'s `GET /meta/:type`
 * driven by a real `ObjectStackProtocolImplementation` over a registered
 * `mapping` artifact (objectstack `packages/rest`, probe run 2026-09-05):
 * raw spec documents decorated with `_packageId` / `_provenance` /
 * `_diagnostics`, carrying `targetObject` at the TOP LEVEL, inside the spec's
 * `{ type, items }` envelope with no `{ success, data }` wrapper. The real
 * `@objectstack/client` `meta.getItems` then unwraps it, and the adapter's
 * own filter runs on what the SDK hands back.
 */

/** Verbatim `GET /api/v1/meta/mapping` body from the framework probe. */
const WIRE_BODY = {
  type: 'mapping',
  items: [
    {
      name: 'task_feed_import',
      label: 'Task feed import (manifest path)',
      sourceFormat: 'csv',
      targetObject: 'task',
      fieldMapping: [
        { source: 'ID', target: 'id', transform: 'none' },
        { source: 'Task Title', target: 'title', transform: 'none' },
      ],
      mode: 'upsert',
      upsertKey: ['id'],
      _packageId: 'probe_pkg',
      _provenance: 'package',
      _diagnostics: { valid: true },
    },
    {
      name: 'user_only_mapping',
      label: 'User feed import',
      sourceFormat: 'json',
      targetObject: 'user',
      fieldMapping: [{ source: 'id', target: 'id', transform: 'none' }],
      mode: 'insert',
      _diagnostics: { valid: true },
    },
  ],
};

const BASE_URL = 'http://list-import-mappings-pin.local';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeDS() {
  const requested: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('/api/v1/discovery')) {
      return json({ success: true, data: { capabilities: {}, routes: {} } });
    }
    if (url.endsWith('/api/v1/meta/mapping')) {
      return json(WIRE_BODY);
    }
    return json({ success: false, error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
  });
  const ds = new ObjectStackAdapter({ baseUrl: BASE_URL, fetch: fetchImpl, autoReconnect: false });
  return { ds, requested };
}

describe('ObjectStackDataSource.listImportMappings (objectui#14026)', () => {
  beforeEach(() => {
    clearSharedDiscoveryCache();
  });

  it('returns a registered mapping artifact targeting the object, read through the real SDK', async () => {
    const { ds, requested } = makeDS();

    const mappings = await ds.listImportMappings('task');

    // The SDK route the adapter reads — not a stubbed client method.
    expect(requested).toContain(`${BASE_URL}/api/v1/meta/mapping`);
    // The artifact targeting `task` is served; the one targeting `user` is not.
    expect(mappings.map((m: any) => m.name)).toEqual(['task_feed_import']);
    // …and it is the served document itself, decorations included, so the
    // wizard's `asSavedMapping` predicate (`name` string, `targetObject`
    // string, `fieldMapping` array) accepts it as-is.
    const [m] = mappings;
    expect(typeof m.name).toBe('string');
    expect(m.targetObject).toBe('task');
    expect(Array.isArray(m.fieldMapping)).toBe(true);
    expect(m.mode).toBe('upsert');
    expect(m.upsertKey).toEqual(['id']);
  });

  it('answers an empty list, not a match, for an object no artifact targets', async () => {
    const { ds } = makeDS();
    expect(await ds.listImportMappings('project')).toEqual([]);
  });
});

/**
 * ## The three states, and why the RESULT can only ever show two (objectui#7741)
 *
 * `listImportMappings` degrades every failure to `[]`, and the wizard hides its
 * saved-mapping selector on an empty list. So the three states a caller has to
 * tell apart —
 *
 *   has mappings    -> a non-empty list
 *   no mappings     -> `[]`   (the server served zero; supported, quiet)
 *   could not read  -> `[]`   (the server refused or broke)
 *
 * — collapse to two on the return value, and the two that collapse are exactly
 * the two that must not be confused. That is why nothing below asserts on
 * emptiness to establish which happened: an assertion on "is the result empty"
 * passes identically for a refusal and for a served zero, so it can never fail
 * for the condition it is supposed to be about. The discriminator is the
 * `onMetadataReadWarning` channel, read from the ERROR's ADR-0112 `code` and
 * status.
 *
 * This is framework #13906 decision 1 option A — *a thing that could not be
 * READ is not a thing that is ABSENT* — applied at this seam. The empty list
 * itself is UNCHANGED on every arm, including the loud ones: the published
 * `Promise<any[]>` contract (shipped since `@object-ui/data-objectstack@17.1.0`)
 * does not move, and every assertion below re-checks that it did not.
 */

/** An error body in the WRAPPED family (`{ success:false, error:{code,message} }`). */
function wrappedError(code: string, message: string) {
  return { success: false, error: { code, message } };
}

/** An error body in the FLAT family (`{ code, message }`). */
function flatError(code: string, message: string) {
  return { code, message };
}

/**
 * A data source whose `GET /meta/mapping` answers with `answer` — a `Response`
 * to serve, or a thrown value for a transport failure — with the read-warning
 * channel already subscribed.
 *
 * Discovery is always served, so `connect()` succeeds and every reading below
 * is about the mapping read itself and not about an adapter that never got off
 * the ground.
 */
function makeFailingDS(answer: (() => Response) | (() => never)) {
  const warnings: MetadataReadWarningEvent[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/discovery')) {
      return json({ success: true, data: { capabilities: {}, routes: {} } });
    }
    if (url.endsWith('/api/v1/meta/mapping')) return answer();
    return json({ success: false, error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
  });
  const ds = new ObjectStackAdapter({ baseUrl: BASE_URL, fetch: fetchImpl, autoReconnect: false });
  const unsubscribe = ds.onMetadataReadWarning((ev) => warnings.push(ev));
  return { ds, warnings, unsubscribe, fetchImpl };
}

describe('listImportMappings — a refused door is not an empty list (objectui#7741)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearSharedDiscoveryCache();
    // The breadcrumb is kept on every arm by design; silence it so a suite that
    // exercises nine failures does not print nine stack traces.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('QUIET — a deployment that does not serve the `mapping` kind', () => {
    it('says nothing when the metadata LIST door refuses the kind (framework#9488)', async () => {
      // The modern spelling of "an older server without the `mapping` kind":
      // `mapping` entered the platform's declared set only when the ADR-0088
      // admission test accepted it, so a server older than that promotion has
      // it in neither the static contract nor its live type set.
      const { ds, warnings } = makeFailingDS(() =>
        json(
          wrappedError(
            'INVALID_REQUEST',
            "'mapping' is not a metadata type. The platform declares no such type and this deployment has registered no items under it.",
          ),
          400,
        ),
      );

      expect(await ds.listImportMappings('task')).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('says nothing when the `/meta` route is not mounted at all', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('ROUTE_NOT_FOUND', 'no route for GET /api/v1/meta/mapping'), 404),
      );

      expect(await ds.listImportMappings('task')).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('says nothing for a bare, code-less transport 404 (a proxy, a gateway)', async () => {
      // No ObjectStack route wrote this answer — this door's own 404s all ship
      // a `code` — so the status is the best signal available and it means the
      // API is not there.
      const { ds, warnings } = makeFailingDS(() => json({ message: 'Not Found' }, 404));

      expect(await ds.listImportMappings('task')).toEqual([]);
      expect(warnings).toEqual([]);
    });
  });

  describe('LOUD — the server refused this caller', () => {
    it('announces an anonymous or lapsed session, and STILL answers []', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(flatError('UNAUTHENTICATED', 'authentication required'), 401),
      );

      // The return is unchanged — this is a channel ALONGSIDE it, not a
      // replacement for it. A consumer that subscribes to nothing sees exactly
      // what it saw before this card.
      expect(await ds.listImportMappings('task')).toEqual([]);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        operation: 'listImportMappings',
        kind: 'mapping',
        objectName: 'task',
        reason: 'refused',
        code: 'UNAUTHENTICATED',
        status: 401,
      });
      // The server's own words travel, so the user has something to paste into
      // a report and the message does not have to be guessed at.
      expect(warnings[0].message).toBe('authentication required');
    });

    it('announces a permission denial', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('PERMISSION_DENIED', 'manage_metadata required'), 403),
      );

      expect(await ds.listImportMappings('task')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].reason).toBe('refused');
      expect(warnings[0].status).toBe(403);
    });
  });

  describe('LOUD — the read could not be completed', () => {
    it('announces a server error', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(wrappedError('INTERNAL_ERROR', 'metadata store unavailable'), 500),
      );

      expect(await ds.listImportMappings('task')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].reason).toBe('unreadable');
      expect(warnings[0].status).toBe(500);
    });

    it('announces a transport failure that carries no status at all', async () => {
      const { ds, warnings } = makeFailingDS(() => {
        throw new TypeError('Failed to fetch');
      });

      expect(await ds.listImportMappings('task')).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ reason: 'unreadable', objectName: 'task' });
      // Nothing is invented for a failure that declared nothing.
      expect(warnings[0].status).toBeUndefined();
      expect(warnings[0].code).toBeUndefined();
    });
  });

  describe('the discrimination itself', () => {
    it('⭐ served-zero and refused return the SAME value and differ only on the channel', async () => {
      // Served zero: the door answered, with an empty collection.
      const served = makeFailingDS(() => json({ type: 'mapping', items: [] }));
      const servedResult = await served.ds.listImportMappings('task');

      clearSharedDiscoveryCache();

      // Refused: the door never answered at all.
      const refused = makeFailingDS(() =>
        json(flatError('UNAUTHENTICATED', 'authentication required'), 401),
      );
      const refusedResult = await refused.ds.listImportMappings('task');

      // This is the whole defect in one line: the two conditions are byte-equal
      // on the return, so no consumer reading only the return can ever separate
      // them — and the wizard reads only the return.
      expect(refusedResult).toEqual(servedResult);
      expect(refusedResult).toEqual([]);

      // And this is the fix: they are NOT equal on the channel.
      expect(served.warnings).toEqual([]);
      expect(refused.warnings).toHaveLength(1);
      expect(refused.warnings[0].reason).toBe('refused');
    });

    it('a served, matching mapping is still served — the loud arm did not cost the happy path', async () => {
      const { ds, warnings } = makeFailingDS(() => json(WIRE_BODY));

      const mappings = await ds.listImportMappings('task');

      expect(mappings.map((m: any) => m.name)).toEqual(['task_feed_import']);
      expect(warnings).toEqual([]);
    });
  });

  describe('the channel itself', () => {
    it('unsubscribes', async () => {
      const { ds, warnings, unsubscribe } = makeFailingDS(() =>
        json(flatError('UNAUTHENTICATED', 'authentication required'), 401),
      );

      // Control: the channel is live first, so the silence below is about the
      // unsubscribe and not about a chain that never ran.
      await ds.listImportMappings('task');
      expect(warnings).toHaveLength(1);

      unsubscribe();
      await ds.listImportMappings('task');
      expect(warnings).toHaveLength(1);
    });

    it('a throwing listener neither breaks the caller nor starves the others', async () => {
      const { ds, warnings } = makeFailingDS(() =>
        json(flatError('UNAUTHENTICATED', 'authentication required'), 401),
      );
      ds.onMetadataReadWarning(() => {
        throw new Error('listener exploded');
      });
      const later: MetadataReadWarningEvent[] = [];
      ds.onMetadataReadWarning((ev) => later.push(ev));

      await expect(ds.listImportMappings('task')).resolves.toEqual([]);

      expect(warnings).toHaveLength(1);
      expect(later).toHaveLength(1);
    });
  });
});

describe('classifyImportMappingsFailure (objectui#7741)', () => {
  it('reads the ADR-0112 code, not the status, when the two disagree', () => {
    // A 404 that carries the route-absent code is the door being missing; a 404
    // that carries a refusal code is not. Branching on the status alone cannot
    // express that difference, which is the objectui#5663 failure this ladder
    // is built to avoid.
    expect(classifyImportMappingsFailure({ code: 'ROUTE_NOT_FOUND', httpStatus: 404 }).kind)
      .toBe('not-served');
    expect(classifyImportMappingsFailure({ code: 'PERMISSION_DENIED', httpStatus: 404 }).kind)
      .toBe('refused');
  });

  it('matches the pre-ADR-0112 lowercase spelling too', () => {
    // The console is versioned separately from the server, so at any moment it
    // may be pointed at a build from either side of the vocabulary rename.
    expect(classifyImportMappingsFailure({ code: 'route_not_found', httpStatus: 404 }).kind)
      .toBe('not-served');
    expect(classifyImportMappingsFailure({ code: 'unauthenticated', httpStatus: 401 }).kind)
      .toBe('refused');
  });

  it('requires the 400 as well as the code before reading INVALID_REQUEST as kind-absent', () => {
    expect(
      classifyImportMappingsFailure({ code: 'INVALID_REQUEST', httpStatus: 400 }).kind,
    ).toBe('not-served');
    // Same code, a status this door does not write it on: not the framework#9488
    // refusal, so not a licence to stay quiet.
    expect(
      classifyImportMappingsFailure({ code: 'INVALID_REQUEST', httpStatus: 500 }).kind,
    ).toBe('unreadable');
  });

  it('reads the status only when NO code was declared', () => {
    expect(classifyImportMappingsFailure({ httpStatus: 501 }).kind).toBe('not-served');
    expect(classifyImportMappingsFailure({ httpStatus: 404 }).kind).toBe('not-served');
    // An empty-string code is "the producer declared nothing", not a code — it
    // must not block the residual it fails to match.
    expect(classifyImportMappingsFailure({ code: '', httpStatus: 404 }).kind).toBe('not-served');
    // A coded 5xx has no absence claim to make.
    expect(classifyImportMappingsFailure({ httpStatus: 503 }).kind).toBe('unreadable');
  });

  it('accepts every spelling of the status the transports use', () => {
    expect(classifyImportMappingsFailure({ status: 401 }).kind).toBe('refused');
    expect(classifyImportMappingsFailure({ statusCode: 403 }).kind).toBe('refused');
    expect(classifyImportMappingsFailure({ httpStatus: 405 }).kind).toBe('refused');
  });

  it('an error carrying nothing at all is unreadable, never absent', () => {
    // The direction matters: inventing "this deployment has no mapping kind"
    // from an answer that declared nothing is the exact over-claim this card
    // exists to delete.
    expect(classifyImportMappingsFailure(new Error('boom')).kind).toBe('unreadable');
    expect(classifyImportMappingsFailure(undefined).kind).toBe('unreadable');
    expect(classifyImportMappingsFailure(null).kind).toBe('unreadable');
  });
});
