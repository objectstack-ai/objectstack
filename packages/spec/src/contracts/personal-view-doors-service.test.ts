// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#36506] `IPersonalViewDoorsService.handlePersonalViewDoor`: the personal-view
// delete door, declared on the `personal-views` slot's contract
// transport-neutrally, so the runtime dispatcher can reach it on a kernel with
// no `http.server`.
//
// Type-level pins, the shape `comment-doors-service.test.ts` uses: the member is
// OPTIONAL, at the web-standard `(request: Request) => Promise<Response>`
// shape, the barrel exports the same contract, and the `personal-views` slot is
// typed by it. The aliases are exported so TS6196 does not flag them as unused;
// `check:test-typecheck` compiles this file.

import { describe, it, expect } from 'vitest';
import type { IPersonalViewDoorsService } from './personal-view-doors-service';
import type { IPersonalViewDoorsService as FromBarrel, ServiceSlotContract } from './index';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type HandlePersonalViewDoor = NonNullable<IPersonalViewDoorsService['handlePersonalViewDoor']>;

/** Optional: a service may omit it. A required member turns this alias red. */
export type PersonalViewDoorIsOptional = Assert<
  {} extends Pick<IPersonalViewDoorsService, 'handlePersonalViewDoor'> ? true : false
>;

/** One web-standard `Request` in: the whole input, with no execution context beside it. */
export type PersonalViewDoorTakesOneRequest = Assert<Eq<Parameters<HandlePersonalViewDoor>, [request: Request]>>;

/** A web-standard `Response` out, asynchronously. */
export type PersonalViewDoorAnswersAResponse = Assert<Eq<ReturnType<HandlePersonalViewDoor>, Promise<Response>>>;

/** The barrel (`@objectstack/spec/contracts`) exports this contract, not a look-alike. */
export type BarrelExportsTheContract = Assert<Eq<FromBarrel, IPersonalViewDoorsService>>;

/** The `personal-views` slot is typed by this contract, so the dispatcher's probe is typed. */
export type PersonalViewsSlotIsTheContract = Assert<Eq<ServiceSlotContract<'personal-views'>, IPersonalViewDoorsService>>;

describe('IPersonalViewDoorsService.handlePersonalViewDoor: the personal-view door, declared transport-neutrally', () => {
  it('is optional: a service object without it still satisfies IPersonalViewDoorsService', () => {
    const service: IPersonalViewDoorsService = {};

    expect(service.handlePersonalViewDoor).toBeUndefined();
  });
});
