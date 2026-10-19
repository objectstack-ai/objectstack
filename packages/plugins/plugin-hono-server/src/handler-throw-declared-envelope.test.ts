// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16545] A throw that ESCAPES a `RouteHandler` carrying a declared ADR-0112
 * `status` + a registered `code` is answered as THAT envelope; a throw that
 * carries no such envelope still answers `500` with no cause in the body.
 *
 * The `domain:cli` half of the #15999 ruling, verbatim:
 *
 * > **Shared half** (`domain:cli`, hono adapter / registrar wrapper): an
 * > escaped throw carrying a declared ADR-0112 `status` + registered `code` is
 * > rendered by them, not as a bare `500 INTERNAL_ERROR "No response from
 * > handler"`. This changes what an escaped throw means for every direct-mount
 * > route; the PR pins that an escaped **non**-envelope throw still answers 500
 * > with no cause in the body.
 *
 * ## Why the pin is HERE and not on the raw Hono mount
 *
 * The `domain:cli` seat's scope ruling on the card (comment `5570159125`,
 * restated in `5575064522`) is binding, and its first reason is a measurement
 * about where a pin can mean anything:
 *
 * > ⭐ **本卡自带的那条 pin 在那扇门上是空的** —— 普查实测,raw mount 上「带信封的
 * > 抛出」与「不带信封的抛出」今天答的是**逐字节相同**的 `text/plain` 500,所以
 * > 「非信封抛出仍答 500 且 body 里没有 cause」这条 pin **在任何修复存在之前就已经
 * > 绿了**。⛔ 一条对着未修复的树就绿的 pin,正是本车道拒绝出货的东西。
 *
 * `HonoHttpServer.wrap()` is the seam every direct-mount route passes —
 * `get`/`post`/`put`/`delete`/`patch` each register `this.wrap(handler)`, and
 * `IHttpServer` is how `service-datasource`, `packages/rest` and the dispatcher
 * bridge all mount. A route mounted through `getRawApp()` funnels through
 * NEITHER `wrap()` nor any registrar wrapper and is out of this card's scope by
 * that ruling; it is named in the PR body as a known-unreached door and filed
 * separately, ⛔ not folded in here.
 *
 * ## Both directions, and the ablation that makes them evidence
 *
 * Every assertion below was measured RED against the unfixed tree before the
 * fix existed (the PR body carries the run). The render arm fails as `500 /
 * INTERNAL_ERROR / "No response from handler"`; the fallback arms pass on the
 * unfixed tree by construction — they are the REGRESSION half, and they are the
 * half that goes red if the gate is ever widened.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';

import { HonoHttpServer, declaredEnvelopeForThrow } from './adapter';

/**
 * The exact bytes `wrap()` answers for a throw carrying no declared envelope,
 * and for a handler that simply wrote nothing. Byte-identical to the constant
 * `handler-throw-logging.test.ts` pins — deliberately duplicated rather than
 * imported, so that suite and this one cannot drift into agreeing about a
 * literal that moved.
 */
const FALLBACK_BODY =
  '{"success":false,"error":{"code":"INTERNAL_ERROR","message":"No response from handler"}}';

/** A silent logger — this file is about the WIRE, not the diagnosis. */
function quietLogger(): Logger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as unknown as Logger;
}

function server(): HonoHttpServer {
  const s = new HonoHttpServer(0);
  s.setLogger(quietLogger());
  return s;
}

const call = (s: HonoHttpServer, path: string, init?: RequestInit) =>
  s.getRawApp().fetch(new Request(`http://localhost${path}`, init));

/** A throw shaped exactly like the platform's declared refusals. */
function declared(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

describe('an escaped throw carrying a declared ADR-0112 envelope is rendered as that envelope', () => {
  /**
   * The motivating path, in the shape `service-datasource` really produces it:
   * `AuthzStoreUnavailableError` declares `status: 503` / `code:
   * SERVICE_UNAVAILABLE` and `requireDatasourceAdmin` re-raises it (commit 6a180e42d), so
   * before this card the operator's outage reached the caller as a generic
   * fault naming the wrong component.
   */
  it('answers the declared status and the declared code, not 500 INTERNAL_ERROR', async () => {
    const s = server();
    s.get('/api/v1/datasources', async () => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'The authorization store could not be read.');
    });

    const res = await call(s, '/api/v1/datasources');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The authorization store could not be read.',
      },
    });
  });

  it('reads `statusCode` as well as `status` — both spellings are produced in this repo', async () => {
    const s = server();
    // `plugin-approvals`' lifecycle hooks and `metadata-protocol` throw
    // `statusCode`; reading one spelling is how `/api/v1/data` answered 500 for
    // a deliberate `409 RECORD_LOCKED` until #7525.
    s.get('/api/v1/conflict', async () => {
      throw Object.assign(new Error('locked by another process'), {
        statusCode: 409,
        code: 'LOCK_CONFLICT',
      });
    });

    const res = await call(s, '/api/v1/conflict');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: 'LOCK_CONFLICT',
      message: 'locked by another process',
    });
  });

  it('renders a code registered in the LEDGER, not only a StandardErrorCode', async () => {
    const s = server();
    // `ErrorCode` is `StandardErrorCode` ∪ `ERROR_CODE_LEDGER`; a ledger member
    // is registered exactly as much as a standard one, and a gate that admitted
    // only the standard half would silently demote every service's own code.
    s.get('/api/v1/import', async () => {
      throw declared(400, 'EXTERNAL_IMPORT_ERROR', 'remote table has no primary key');
    });

    const res = await call(s, '/api/v1/import');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('EXTERNAL_IMPORT_ERROR');
  });

  it('forwards the producer’s `details` and `userMessage` channels', async () => {
    const s = server();
    s.get('/api/v1/conflicted', async () => {
      throw declared(409, 'RESOURCE_CONFLICT', 'diagnostic prose', {
        issues: [{ path: 'name' }],
        userMessage: 'Pick a different name.',
      });
    });

    const res = await call(s, '/api/v1/conflicted');
    const body = await res.json();
    expect(res.status).toBe(409);
    // `userMessage` is the producer's END-USER-addressed text (commit 79c46da90) and
    // `details` its structured context — the same two channels the REST twin
    // forwards. A door that dropped them would answer a narrower envelope than
    // the producer declared.
    expect(body.error.userMessage).toBe('Pick a different name.');
    expect(body.error.details).toEqual({ issues: [{ path: 'name' }] });
  });

  /**
   * ⚠️ The BLAST RADIUS this card accepts, pinned so it is a decision rather
   * than a surprise. `resolveThrownHttpError` — the ONE rule both HTTP doors
   * already call — treats the validation SHAPE as a declaration (`err.name ===
   * 'ValidationError'` ⇒ `400` / `VALIDATION_FAILED`, and `fields[]` alongside).
   * So a bare `ValidationError` escaping a direct-mount handler now answers 400
   * where it used to answer a bare 500.
   *
   * Carving that limb out HERE would mean this seam disagreeing with the very
   * function it delegates to, which is the two-door divergence #8016 removed.
   * It is accepted and recorded instead.
   */
  it('renders the validation SHAPE as the 400 the one rule says it declares', async () => {
    const s = server();
    s.get('/api/v1/shaped', async () => {
      throw Object.assign(new Error('name is required'), {
        name: 'ValidationError',
        fields: [{ field: 'name', code: 'required' }],
      });
    });

    const res = await call(s, '/api/v1/shaped');
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ fields: [{ field: 'name', code: 'required' }] });
  });

  it('withholds a LEAKY 5xx message while keeping the declared status and code', async () => {
    const s = server();
    // This seam becomes a door that emits a thrown message with this card, so
    // it owes the disclosure filter its twins already run (#3867 / #8086) from
    // its first day — otherwise a driver dump on a declared 5xx would newly
    // reach the client, where the old bare 500 disclosed nothing.
    s.get('/api/v1/leaky', async () => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'SQLITE_ERROR: no such table: sys_metadata');
    });

    const res = await call(s, '/api/v1/leaky');
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.message).not.toContain('sys_metadata');
  });

  it('leaves a 4xx message alone — a caller-facing refusal is not a disclosure', async () => {
    const s = server();
    s.get('/api/v1/refused', async () => {
      throw declared(409, 'RESOURCE_CONFLICT', 'no such table: pass `?version=` to disambiguate');
    });

    const body = await (await call(s, '/api/v1/refused')).json();
    expect(body.error.message).toBe('no such table: pass `?version=` to disambiguate');
  });
});

/**
 * [#23531] A stale `If-Match` on a direct-mount route: the `409
 * CONCURRENT_UPDATE` carries the server's `currentVersion` and `currentRecord`,
 * which `RestServer`'s `409` carries and objectui's conflict bar reads.
 *
 * `currentRecord` is forwarded as the producer threw it, field for field: the
 * row below stands for the caller's own read, which is what `metadata-protocol`
 * puts there since #23586 (PR #23628). `error.details` is asserted EXACTLY, so
 * a field the door drops or invents turns the row red.
 *
 * The producer below is shaped exactly like `metadata-protocol`'s
 * `ConcurrentUpdateError` (`name`, `code`, `status`, and the two own
 * properties), because this package does not depend on that one. The routes
 * judge the `If-Match` header against a stored version, as `updateData` /
 * `deleteData` do. The composed-host twin, over the REAL protocol, is
 * `hono-declared-envelope.conformance.test.ts` in `packages/qa/http-conformance`;
 * it also shows a field the caller's read masks staying off `currentRecord`.
 *
 * On the wrapped envelope the fields ride `error.details`: that is the
 * envelope's declared context slot (`ApiErrorSchema.details`), and it is where
 * `@objectstack/client` reads a wrapped body's context from
 * (`errorBody.error.details`).
 */
describe('[#23531] a stale If-Match on a direct-mount route: the 409 carries currentVersion and currentRecord', () => {
  class ConcurrentUpdateError extends Error {
    readonly code = 'CONCURRENT_UPDATE';
    readonly status = 409;
    readonly currentVersion: string | null;
    readonly currentRecord: unknown;
    constructor(opts: { currentVersion: string | null; currentRecord: unknown; message: string }) {
      super(opts.message);
      this.name = 'ConcurrentUpdateError';
      this.currentVersion = opts.currentVersion;
      this.currentRecord = opts.currentRecord;
    }
  }

  const STORED_VERSION = '2026-10-15T00:00:00.000Z';
  const STALE_VERSION = '2001-01-01T00:00:00.000Z';
  const STORED = { id: 'task_1', name: 'original', updated_at: STORED_VERSION };

  /** A server whose PATCH and DELETE refuse a stale version, as the protocol does. */
  function occServer(conflict: { currentVersion: string | null; currentRecord: unknown } = {
    currentVersion: STORED_VERSION,
    currentRecord: STORED,
  }): HonoHttpServer {
    const s = server();
    const guard = (req: { params: Record<string, string>; headers: Record<string, unknown> }) => {
      const sent = String(req.headers['if-match'] ?? '').replace(/^"|"$/g, '');
      if (sent !== STORED_VERSION) {
        throw new ConcurrentUpdateError({
          ...conflict,
          message: `Record task/${req.params.id} was modified by another user (current version ${STORED_VERSION}, expected ${sent})`,
        });
      }
    };
    s.patch('/api/v1/data/task/:id', async (req, res) => { guard(req as any); res.json({ updated: true }); });
    s.delete('/api/v1/data/task/:id', async (req, res) => { guard(req as any); res.json({ deleted: true }); });
    return s;
  }

  it.each(['PATCH', 'DELETE'])('%s: 409 CONCURRENT_UPDATE with currentVersion and currentRecord in `error.details`, as the producer stated them', async (method) => {
    const res = await call(occServer(), '/api/v1/data/task/task_1', {
      method,
      headers: { 'If-Match': `"${STALE_VERSION}"`, ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'PATCH' ? { body: JSON.stringify({ name: 'lost update' }) } : {}),
    });
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONCURRENT_UPDATE');
    // Exactly the two fields the producer stated: nothing dropped, nothing added.
    expect(body.error.details).toEqual({ currentVersion: STORED_VERSION, currentRecord: STORED });
  });

  it('control: the version the route stores is accepted, so the 409 rows are the guard and not the rig', async () => {
    const res = await call(occServer(), '/api/v1/data/task/task_1', {
      method: 'PATCH',
      headers: { 'If-Match': `"${STORED_VERSION}"`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'kept' }),
    });
    expect(res.status).toBe(200);
  });

  it('a conflict that names no current state keeps the two-key envelope, as the REST door keeps its body', async () => {
    // `RestServer`'s arm forwards each field only when the producer stated it,
    // so a conflict carrying neither adds nothing to either door's answer.
    const res = await call(occServer({ currentVersion: null, currentRecord: null }), '/api/v1/data/task/task_1', {
      method: 'DELETE',
      headers: { 'If-Match': `"${STALE_VERSION}"` },
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  });
});

/**
 * [#23587] The rest of `RestServer`'s structured arms, on a direct-mount route.
 * A refusal that classification answers with structured fields carries them
 * in `error.details`, as the `409 CONCURRENT_UPDATE` above carries
 * `currentVersion`. The measured case is `409 DELETE_RESTRICTED`, which reached
 * a caller of these doors with `code` and `message` only.
 *
 * Each producer below is shaped exactly like the real one (its `code`,
 * `status` and own properties, as the real throw carries them on a composed
 * host), because this package depends on none of them. Each row asserts the
 * status, the code and `error.details` EXACTLY, so a field the door invents or
 * drops turns it red. The composed-host twin, over the REAL engine and
 * protocol, is `hono-declared-envelope.conformance.test.ts` in
 * `packages/qa/http-conformance`.
 *
 * `object` is absent from the `DELETE_RESTRICTED` and `METADATA_CONFLICT`
 * answers: those arms add the object the ROUTE named, and the recogniser has
 * no route. The error's own `object` is not substituted for it (a cascade's
 * restrict names the child it was deleting, not the route's object).
 */
describe('[#23587] a structured refusal on a direct-mount route carries RestServer’s fields in `error.details`', () => {
  function throwingServer(method: 'get' | 'delete', path: string, thrown: () => unknown): HonoHttpServer {
    const s = server();
    s[method](path, async () => { throw thrown(); });
    return s;
  }

  /** The engine's referential restrict, as `ObjectQL.delete` throws it. */
  function deleteRestricted(dependentCount?: number) {
    const counted = dependentCount !== undefined;
    return Object.assign(
      new Error(counted
        ? 'This Account is still referenced by 2 Contact record(s) through “Account”. Delete or reassign them first.'
        : 'This Account is still referenced by Contact records through “Account”. Delete or reassign them first.'),
      {
        developerMessage: counted
          ? "Cannot delete account (acc_1): 2 dependent contact record(s) reference it via account. Delete or reassign them first, or set deleteBehavior:'cascade' on contact.account."
          : "Cannot delete account (acc_1): dependent contact record(s) reference it via account. Delete or reassign them first, or set deleteBehavior:'cascade' on contact.account.",
        code: 'DELETE_RESTRICTED',
        status: 409,
        httpStatus: 409,
        object: 'account',
        dependentObject: 'contact',
        ...(counted ? { dependentCount } : {}),
      },
    );
  }

  it('409 DELETE_RESTRICTED: developerMessage, dependentObject and dependentCount, as the producer stated them', async () => {
    const thrown = deleteRestricted(2);
    const res = await call(throwingServer('delete', '/api/v1/data/account/:id', () => thrown), '/api/v1/data/account/acc_1', { method: 'DELETE' });
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DELETE_RESTRICTED');
    // The end user's sentence stays the envelope's `message`, unchanged.
    expect(body.error.message).toBe(thrown.message);
    expect(body.error.details).toEqual({
      developerMessage: thrown.developerMessage,
      dependentObject: 'contact',
      dependentCount: 2,
    });
  });

  it('409 DELETE_RESTRICTED with the count withheld by the producer: no count, and none invented', async () => {
    // The engine withholds the count when the caller's own identity would not
    // see the same rows (`dependentCountIsDisclosable`). The door relays that
    // narrowing as it stands: each field only when the producer stated it.
    const thrown = deleteRestricted();
    const res = await call(throwingServer('delete', '/api/v1/data/account/:id', () => thrown), '/api/v1/data/account/acc_1', { method: 'DELETE' });
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('DELETE_RESTRICTED');
    expect(body.error.details).toEqual({ developerMessage: thrown.developerMessage, dependentObject: 'contact' });
  });

  it('409 DELETE_RESTRICTED stating none of the fields (the subflow guard’s shape) keeps the two-key envelope', async () => {
    // `service-automation`'s packaged-subflow guard throws this code with
    // `subflowCallers` only, which the arm does not carry; the REST door's body
    // adds nothing for it either.
    const res = await call(throwingServer('delete', '/api/v1/flows/:name', () => Object.assign(
      new Error("Flow 'sub' cannot be removed while 1 packaged flow still calls it as a subflow."),
      { code: 'DELETE_RESTRICTED', status: 409, subflowCallers: ['caller'] },
    )), '/api/v1/flows/sub', { method: 'DELETE' });
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('DELETE_RESTRICTED');
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  });

  it.each([
    ['a version token', 'hmac-sha256:842021a1'],
    ['null, the answer "no row"', null],
  ])('409 METADATA_CONFLICT: currentVersion as %s', async (_label, currentVersion) => {
    const res = await call(throwingServer('get', '/api/v1/meta/view/:name', () => Object.assign(
      new Error('view/case_grid has been modified since you loaded it.'),
      { code: 'METADATA_CONFLICT', status: 409, actualHead: currentVersion, currentVersion },
    )), '/api/v1/meta/view/case_grid');
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('METADATA_CONFLICT');
    expect(body.error.details).toEqual({ currentVersion });
  });

  it('400 INVALID_FIELD: the field and the object it names', async () => {
    const res = await call(throwingServer('get', '/api/v1/data/task', () => Object.assign(
      new Error("Unknown field 'nosuchfield' on object 'task'."),
      { code: 'INVALID_FIELD', status: 400, field: 'nosuchfield', fields: ['nosuchfield'], object: 'task' },
    )), '/api/v1/data/task?nosuchfield=1');
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error.code).toBe('INVALID_FIELD');
    expect(body.error.details).toEqual({ field: 'nosuchfield', object: 'task' });
  });

  it('404 OBJECT_NOT_FOUND: the object it names, and the producer’s own sentence', async () => {
    const res = await call(throwingServer('get', '/api/v1/data/ghost', () => Object.assign(
      new Error("Object 'ghost' not found"),
      { code: 'OBJECT_NOT_FOUND', status: 404, object: 'ghost' },
    )), '/api/v1/data/ghost');
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(404);
    expect(body.error.code).toBe('OBJECT_NOT_FOUND');
    expect(body.error.message).toBe("Object 'ghost' not found");
    expect(body.error.details).toEqual({ object: 'ghost' });
  });

  it.each([
    'FEEDS_DISABLED',
    'FILES_DISABLED',
    'ATTACHMENT_PARENT_ACCESS',
    'ATTACHMENT_DELETE_DENIED',
    'RECORD_NOT_ACCESSIBLE',
  ])('403 %s: the object the refusal names', async (code) => {
    const res = await call(throwingServer('get', '/api/v1/data/sys_comment', () => Object.assign(
      new Error('access refused'),
      { code, status: 403, object: 'account' },
    )), '/api/v1/data/sys_comment');
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body.error.code).toBe(code);
    expect(body.error.details).toEqual({ object: 'account' });
  });

  it('an arm whose status differs from the declared one is not consulted', async () => {
    const res = await call(throwingServer('delete', '/api/v1/data/account/:id', () => Object.assign(
      new Error('refused'),
      { code: 'DELETE_RESTRICTED', status: 400, developerMessage: 'dev text', dependentObject: 'contact', dependentCount: 1 },
    )), '/api/v1/data/account/acc_1', { method: 'DELETE' });
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error.code).toBe('DELETE_RESTRICTED');
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  });

  it('an arm whose code differs from the declared one is not consulted', async () => {
    // The arm keys this class by its NAME and answers `CONCURRENT_UPDATE`; the
    // throw declares a different registered code, which stays the answer.
    const res = await call(throwingServer('get', '/api/v1/data/task', () => Object.assign(
      new Error('conflict'),
      { name: 'ConcurrentUpdateError', code: 'RESOURCE_CONFLICT', status: 409, currentVersion: 'v2' },
    )), '/api/v1/data/task');
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('RESOURCE_CONFLICT');
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  });
});

/**
 * [#23587] The engine's `DuplicateRecordError` crosses a Hono door as `409
 * UNIQUE_VIOLATION`, the one wire spelling the maintainer ruled for every route
 * (recorded in commit 65846bc46), with `RestServer`'s arm fields in
 * `error.details`. Before this, both doors answered the engine's in-process
 * spelling, `DUPLICATE_RECORD`, with `code` and `message` only.
 *
 * Measured on a real `createHonoApp` over the real engine (SQLite WASM), a
 * repeated unique value: `409 {"success":false,"error":{"code":
 * "DUPLICATE_RECORD","message":"Duplicate record refused on 'udoc': …"}}`, the
 * same on a `HonoHttpServer` route and on its raw mount.
 *
 * The producer below is shaped exactly like `@objectstack/objectql`'s class
 * (`name`, `code`, `status`, `httpStatus`, `object`, `field`, the in-process
 * `developerMessage` and the driver's error on `cause`), because this package
 * does not depend on that one. Three doors render it: a route (`wrap()`), the
 * raw mount (the transport `onError` seam), and `declaredEnvelopeForThrow`
 * itself, which is what `createHonoApp`'s catch arms call.
 *
 * The controls are the discrimination the ruling keeps: the mapping keys on the
 * registered code AND the class, as `RestServer`'s arm does, so a producer
 * that merely SPEAKS `DUPLICATE_RECORD` keeps its own code, and the class name
 * without that code changes nothing either.
 */
describe('[#23587] a repeated unique value answers 409 UNIQUE_VIOLATION on a Hono door, with the arm’s fields', () => {
  /** The driver's own text, so a row can assert it never reaches the wire. */
  const DRIVER_TEXT = "UNIQUE constraint failed: index 'uniq_udoc_email'";

  /** The engine's envelope, as `engine.insert` throws it. */
  function engineDuplicate(field?: string) {
    return Object.assign(
      new Error(field
        ? `Duplicate record refused on 'udoc': a unique constraint on '${field}' already holds this value. No record was written.`
        : "Duplicate record refused on 'udoc': a unique constraint already holds these values. No record was written."),
      {
        name: 'DuplicateRecordError',
        code: 'DUPLICATE_RECORD',
        status: 409,
        httpStatus: 409,
        object: 'udoc',
        ...(field ? { field } : {}),
        // The in-process remedy text: it names the engine's spelling, and the
        // arm deliberately does not relay it.
        developerMessage: "Branch on the platform code: over the HTTP API this refusal is reported as code === 'UNIQUE_VIOLATION'; inside the engine the thrown class carries code === 'DUPLICATE_RECORD'.",
        cause: new Error(DRIVER_TEXT),
      },
    );
  }

  /** A hook that SPEAKS the registered code without being the engine's class. */
  function hookDuplicate() {
    return Object.assign(new Error('A hook refused this row as a duplicate of its own bookkeeping.'), {
      code: 'DUPLICATE_RECORD',
      status: 409,
    });
  }

  type Door = (thrown: () => unknown) => Promise<{ status: number; body: any }>;
  const doors: Array<[string, Door]> = [
    ['a HonoHttpServer route', async (thrown) => {
      const s = server();
      s.post('/api/v1/direct/udoc', async () => { throw thrown(); });
      const res = await call(s, '/api/v1/direct/udoc', { method: 'POST' });
      return { status: res.status, body: await res.json() };
    }],
    ['the HonoHttpServer raw mount', async (thrown) => {
      const s = server();
      s.getRawApp().post('/raw/udoc', async () => { throw thrown(); });
      const res = await call(s, '/raw/udoc', { method: 'POST' });
      return { status: res.status, body: await res.json() };
    }],
    ['declaredEnvelopeForThrow (createHonoApp’s renderer)', async (thrown) => {
      const envelope = declaredEnvelopeForThrow(thrown());
      return envelope ? { status: envelope.status, body: envelope.body } : { status: 0, body: undefined };
    }],
  ];

  it.each(doors)('%s: the engine’s class answers 409 UNIQUE_VIOLATION with developerMessage, field and object', async (_door, door) => {
    const thrown = engineDuplicate('email');
    const { status, body } = await door(() => thrown);

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNIQUE_VIOLATION');
    expect(Object.keys(body.error.details ?? {}).sort()).toEqual(['developerMessage', 'field', 'object']);
    expect(body.error.details.field).toBe('email');
    expect(body.error.details.object).toBe('udoc');
    // One spelling of the code: no demoted `declaredCode`, and the in-process
    // spelling appears nowhere on the wire, nor does the driver's text.
    expect(body.error).not.toHaveProperty('declaredCode');
    expect(JSON.stringify(body)).not.toContain('DUPLICATE_RECORD');
    expect(JSON.stringify(body)).not.toContain(DRIVER_TEXT);
  });

  it.each(doors)('%s: no field when the driver named none, and none invented', async (_door, door) => {
    const { status, body } = await door(() => engineDuplicate());

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('UNIQUE_VIOLATION');
    expect(Object.keys(body.error.details ?? {}).sort()).toEqual(['developerMessage', 'object']);
  });

  it.each(doors)('%s: CONTROL — a hook that speaks DUPLICATE_RECORD keeps its own code and its two keys', async (_door, door) => {
    const { status, body } = await door(hookDuplicate);

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('DUPLICATE_RECORD');
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  });

  it.each(doors)('%s: CONTROL — the class name with another registered code keeps that code', async (_door, door) => {
    const { status, body } = await door(() => Object.assign(new Error('conflict'), {
      name: 'DuplicateRecordError',
      code: 'RESOURCE_CONFLICT',
      status: 409,
      object: 'udoc',
      field: 'email',
    }));

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error.code).toBe('RESOURCE_CONFLICT');
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
  });
});

describe('an escaped throw that is NOT such an envelope keeps today’s behaviour exactly', () => {
  it('a plain Error answers the byte-identical 500 with no cause in the body', async () => {
    const s = server();
    s.get('/api/v1/boom', async () => { throw new Error('datasource exploded'); });

    const res = await call(s, '/api/v1/boom');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a declared status with NO code takes the fallback arm', async () => {
    const s = server();
    s.get('/api/v1/half', async () => {
      throw Object.assign(new Error('half declared'), { status: 503 });
    });

    const res = await call(s, '/api/v1/half');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a registered code with NO status takes the fallback arm', async () => {
    const s = server();
    s.get('/api/v1/codeonly', async () => {
      throw Object.assign(new Error('code only'), { code: 'SERVICE_UNAVAILABLE' });
    });

    const res = await call(s, '/api/v1/codeonly');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('an UNREGISTERED code takes the fallback arm — ⛔ nothing is registered in passing', async () => {
    const s = server();
    // A code on this path that is not registered is a LEDGER GAP under the
    // #16404 ruling — reported, never minted here. The card states this as a
    // prohibition, so it is pinned as one.
    s.get('/api/v1/unregistered', async () => {
      throw declared(503, 'TENANCY_SERVICE_EXPLODED', 'not in the ledger');
    });

    const res = await call(s, '/api/v1/unregistered');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a status ADR-0112 does not declare takes the fallback arm', async () => {
    const s = server();
    // 418 is not a key of `HttpStatusErrorCodeMap`, so it is not "a declared
    // ADR-0112 status" however registered the code beside it is.
    s.get('/api/v1/teapot', async () => {
      throw declared(418, 'INTERNAL_ERROR', 'kaboom');
    });

    const res = await call(s, '/api/v1/teapot');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a NON-string `code` is context, never a declaration', async () => {
    const s = server();
    // A driver errno. Promoting it would put a number in the field callers
    // branch on — the drift #3842 removed.
    s.get('/api/v1/errno', async () => {
      throw Object.assign(new Error('driver said no'), { status: 503, code: 1 });
    });

    const res = await call(s, '/api/v1/errno');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });

  it('a handler that simply writes nothing is unaffected', async () => {
    const s = server();
    // Not a throw — the OTHER way to reach the same body. It never had a
    // declaration to read, and this card does not give it one.
    s.get('/api/v1/silent', async () => { /* resolves without responding */ });

    const res = await call(s, '/api/v1/silent');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(FALLBACK_BODY);
  });
});

describe('the seams this card deliberately does not move', () => {
  it('a handler that WROTE and then threw keeps what it wrote', async () => {
    const s = server();
    s.get('/api/v1/wrote-then-threw', async (_req, res) => {
      res.status(202);
      res.json({ accepted: true });
      throw declared(503, 'SERVICE_UNAVAILABLE', 'too late');
    });

    const res = await call(s, '/api/v1/wrote-then-threw');
    // The declared envelope must not overwrite a response the handler already
    // produced — the render decision is taken where `capturedResponse` is
    // visible precisely so this stays true.
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
  });

  it('a THROWING FALLBACK handler still answers `Fallback handler failed`', async () => {
    const s = server();
    // The `notFound` seam's consumer is a fallback, and a fallback that threw
    // is a broken consumer — not a refusal it declared. The ruling names
    // direct-mount ROUTES, so this arm is opted OUT of the render.
    s.setFallbackHandler(() => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'fallback exploded');
    });

    const res = await call(s, '/api/v1/nothing-mounted');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Fallback handler failed' },
    });
  });
});

describe('the diagnosis names the answer that was really sent', () => {
  function recording() {
    const errors: Array<{ message: string; meta?: Record<string, any> }> = [];
    const noop = () => {};
    const logger = {
      debug: noop, info: noop, warn: noop, fatal: noop,
      error: (message: string, _err?: unknown, meta?: Record<string, any>) => {
        errors.push({ message, meta });
      },
    } as unknown as Logger;
    return { logger, errors };
  }

  it('reports the rendered envelope instead of claiming an opaque 500', async () => {
    const s = new HonoHttpServer(0);
    const rec = recording();
    s.setLogger(rec.logger);
    s.get('/api/v1/outage', async () => {
      throw declared(503, 'SERVICE_UNAVAILABLE', 'store unreadable');
    });

    await call(s, '/api/v1/outage');

    // Still reported, still exactly once, still at `error`: a refusal thrown
    // past its own `catch` is a server-side defect whatever the wire says.
    expect(rec.errors).toHaveLength(1);
    expect(rec.errors[0]!.message).toContain('declared ADR-0112 envelope');
    expect(rec.errors[0]!.meta).toMatchObject({
      method: 'GET',
      path: '/api/v1/outage',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('keeps the old sentence for a throw that took the fallback arm', async () => {
    const s = new HonoHttpServer(0);
    const rec = recording();
    s.setLogger(rec.logger);
    s.get('/api/v1/plain', async () => { throw new Error('plain'); });

    await call(s, '/api/v1/plain');

    expect(rec.errors).toHaveLength(1);
    expect(rec.errors[0]!.message).toBe(
      '[hono] route handler threw — request answered 500 with no cause in the body',
    );
    expect(rec.errors[0]!.meta).toEqual({ method: 'GET', path: '/api/v1/plain' });
  });
});

/**
 * A guard on the reading above: `vi` is imported by every sibling suite in this
 * package and an unused import is a lint failure, so it is used here for the
 * one thing this file genuinely needs a spy for — proving the recording logger
 * is the object the adapter really wrote through.
 */
describe('the logger under test is the one the adapter uses', () => {
  it('routes through `setLogger`, not the package default', async () => {
    const s = new HonoHttpServer(0);
    const error = vi.fn();
    s.setLogger({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), fatal: vi.fn(), error } as unknown as Logger);
    s.get('/api/v1/probe', async () => { throw new Error('probe'); });

    await call(s, '/api/v1/probe');
    expect(error).toHaveBeenCalledTimes(1);
  });
});
