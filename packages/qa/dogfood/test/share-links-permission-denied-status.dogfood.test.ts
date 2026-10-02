// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21405 — one permission refusal answers the same status through both
 * share-link doors.
 *
 * ## The two doors
 *
 * `/share-links` has two implementations. `plugin-sharing`'s
 * `registerShareLinkRoutes` serves `/api/v1/share-links` in this composition
 * (the standalone server mounts no dispatcher route for the path). The runtime
 * dispatcher's `/share-links` domain is the designed primary surface for
 * cloud's per-environment kernels. Here it is driven in-process, the way
 * `@objectstack/verify`'s own handle drives it: an `HttpDispatcher` over the
 * SAME booted kernel, with the same bearer token. Both doors hand the caller's
 * envelope to the same `ShareLinkService`, so one caller and one request reach
 * one refusal, and only the door differs.
 *
 * ## The defect
 *
 * The refusal is the security middleware's object-CRUD gate, which throws
 * `PermissionDeniedError` when a plain member reads an object their permission
 * sets grant nothing on. That class declared `statusCode = 403` and no
 * `status`. The plugin door's catch reads `err?.status ?? 500` and the
 * dispatcher's `errorFromThrown` reads `status` then `statusCode`. Measured on
 * this boot as a plain member, before the fix (`main` at 6d67ad5ec):
 *
 *   | request                 | plugin door              | dispatcher door          |
 *   |-------------------------|--------------------------|--------------------------|
 *   | POST /share-links       | 500 `PERMISSION_DENIED`  | 403 `PERMISSION_DENIED`  |
 *   | GET  /share-links       | 500 `PERMISSION_DENIED`  | 403 `PERMISSION_DENIED`  |
 *
 * The ruled fix is in the class, not the door: `PermissionDeniedError` carries
 * both spellings, as every sibling in `plugin-security/src/errors.ts` does.
 * That also fixes every other door that reads `status` alone.
 *
 * ## Why only create is pinned
 *
 * The create refusal is the visibility read in `createLink`: the member asks
 * to share a record of `showcase_client_brief` (which opts into
 * `publicSharing`, so the request reaches that read) and holds no read grant on
 * it. The list refusal in the table above was the read of `sys_share_link`
 * under the member's context. #21328 made a member's own list a self-scoped
 * read, and both doors force the creator filter to the caller, so no list
 * request reaches that refusal any more. Measured on this boot after #21328:
 * `GET /share-links` answers 200 through both doors, with no filter, with the
 * Share dialog's object and record filter, and with `includeRevoked`. A list
 * case here would pin a refusal no request can produce.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
// The dispatcher class the boot mounts, read from source the way this suite's
// other runtime readers are (`route-ledger-live-mount-parity`): it is not part
// of this package's dependencies, and its source is a declared input of this
// suite's turbo task.
import { HttpDispatcher } from '../../../runtime/src/http-dispatcher.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const OBJECT = 'showcase_client_brief';
/** A seeded brief that passes the object's `eligibility` predicate. */
const PUBLISHED_BRIEF = 'Northwind — Website Relaunch brief';
const MEMBER_EMAIL = 'share-links.denied.21405@verify.test';

interface DoorAnswer {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

describe('#21405: a share-link permission refusal answers one status through both doors', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let dispatcher: HttpDispatcher;
  let memberTok = '';
  let memberId = '';
  let briefId = '';

  /** `POST /share-links` through the plugin door: an HTTP request into the booted Hono app. */
  const mintViaPluginDoor = async (body: unknown): Promise<DoorAnswer> => {
    const res = await stack.apiAs(memberTok, 'POST', '/share-links', body);
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* the status still reports */ }
    return { status: res.status, body: parsed };
  };

  /** `POST /share-links` through the dispatcher door: same kernel, same token. */
  const mintViaDispatcherDoor = async (body: unknown): Promise<DoorAnswer> => {
    const res = await dispatcher.dispatch('POST', '/share-links', body, {}, {
      request: {
        method: 'POST',
        url: 'http://localhost/api/v1/share-links',
        headers: {
          authorization: `Bearer ${memberTok}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
      },
    });
    if (!res.handled || !res.response) throw new Error('the dispatcher did not handle POST /share-links');
    return { status: res.response.status, body: res.response.body };
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    await stack.signIn(); // the seeded admin first, so the sign-up below is a plain member
    memberTok = await stack.signUp(MEMBER_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');
    memberId = String((await ql.findOne('sys_user', { where: { email: MEMBER_EMAIL }, context: SYS }))?.id ?? '');
    briefId = String((await ql.findOne(OBJECT, { where: { title: PUBLISHED_BRIEF }, context: SYS }))?.id ?? '');
    expect(memberId, 'the member exists').toBeTruthy();
    expect(briefId, 'the seeded published brief').toBeTruthy();
    dispatcher = new HttpDispatcher(stack.kernel);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('[persona] the member is plain and holds no read grant on the object', async () => {
    const res = await stack.apiAs(memberTok, 'GET', `/security/explain?object=${OBJECT}&operation=read`);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = JSON.parse(text)?.layers ?? [];
    const setNames = layers.flatMap((l) => l.contributors ?? []).map((c: { name?: unknown }) => String(c?.name));
    expect(setNames, 'the persona must not be an admin').not.toContain('admin_full_access');
    expect(layers.find((l) => l.layer === 'object_crud')?.verdict, 'the refusal is the object-CRUD gate').toBe('denies');
  });

  it('[create] both doors answer 403 PERMISSION_DENIED, and mint nothing', async () => {
    const request = { object: OBJECT, recordId: briefId };
    const plugin = await mintViaPluginDoor(request);
    const dispatched = await mintViaDispatcherDoor(request);

    expect(plugin.status, `plugin door: ${JSON.stringify(plugin.body)}`).toBe(403);
    expect(plugin.body).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
    expect(dispatched.status, `dispatcher door: ${JSON.stringify(dispatched.body)}`).toBe(403);
    expect(dispatched.body).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });

    const minted = await ql.find('sys_share_link', { where: { created_by: memberId }, context: SYS });
    expect(minted, 'a refused mint writes no link').toEqual([]);
  });
});
