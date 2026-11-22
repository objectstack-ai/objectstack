// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#36469] `ICommentDoorsService.handleCommentDoor`: the three comment doors,
// declared on the `comments` slot's contract transport-neutrally, so the
// runtime dispatcher can reach them on a kernel with no `http.server`.
//
// Type-level pins, the shape `webhook-service.test.ts` uses: the member is
// OPTIONAL, at the web-standard `(request: Request) => Promise<Response>`
// shape, the barrel exports the same contract, and the `comments` slot is
// typed by it. The aliases are exported so TS6196 does not flag them as
// unused; `check:test-typecheck` compiles this file.

import { describe, it, expect } from 'vitest';
import type { ICommentDoorsService } from './comment-doors-service';
import type { ICommentDoorsService as ICommentDoorsServiceFromBarrel, ServiceSlotContract } from './index';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type HandleCommentDoor = NonNullable<ICommentDoorsService['handleCommentDoor']>;

/** Optional: a service may omit it. A required member turns this alias red. */
export type CommentDoorIsOptional = Assert<{} extends Pick<ICommentDoorsService, 'handleCommentDoor'> ? true : false>;

/** One web-standard `Request` in: the whole input, with no execution context beside it. */
export type CommentDoorTakesOneRequest = Assert<Eq<Parameters<HandleCommentDoor>, [request: Request]>>;

/** A web-standard `Response` out, asynchronously. */
export type CommentDoorAnswersAResponse = Assert<Eq<ReturnType<HandleCommentDoor>, Promise<Response>>>;

/** The barrel (`@objectstack/spec/contracts`) exports this contract, not a look-alike. */
export type BarrelExportsTheContract = Assert<Eq<ICommentDoorsServiceFromBarrel, ICommentDoorsService>>;

/** The `comments` slot is typed by this contract, so the dispatcher's probe is typed. */
export type CommentsSlotIsTheContract = Assert<Eq<ServiceSlotContract<'comments'>, ICommentDoorsService>>;

describe('ICommentDoorsService.handleCommentDoor: the comment doors, declared transport-neutrally', () => {
  it('is optional: a service object without it still satisfies ICommentDoorsService', () => {
    const service: ICommentDoorsService = {};

    expect(service.handleCommentDoor).toBeUndefined();
  });
});
