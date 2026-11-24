// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#36840] `IPrintDoorService.handlePrintDoor`: the print door, declared
// transport-neutrally on the contract the `print` service implements, so the
// runtime dispatcher can reach it on a kernel with no `http.server`.
//
// Type-level pins, the shape `attachment-doors-service.test.ts` uses: the
// member is OPTIONAL, at the web-standard `(request: Request) =>
// Promise<Response>` shape, and the barrel exports the same contract. The
// aliases are exported so TS6196 does not flag them as unused;
// `check:test-typecheck` compiles this file.

import { describe, it, expect } from 'vitest';
import type { IPrintDoorService } from './print-door-service';
import type { IPrintDoorService as FromBarrel } from './index';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type HandlePrintDoor = NonNullable<IPrintDoorService['handlePrintDoor']>;

/** Optional: a service may omit it. A required member turns this alias red. */
export type PrintDoorIsOptional = Assert<{} extends Pick<IPrintDoorService, 'handlePrintDoor'> ? true : false>;

/** One web-standard `Request` in: the whole input, with no execution context beside it. */
export type PrintDoorTakesOneRequest = Assert<Eq<Parameters<HandlePrintDoor>, [request: Request]>>;

/** A web-standard `Response` out, asynchronously. */
export type PrintDoorAnswersAResponse = Assert<Eq<ReturnType<HandlePrintDoor>, Promise<Response>>>;

/** The barrel (`@objectstack/spec/contracts`) exports this contract, not a look-alike. */
export type BarrelExportsTheContract = Assert<Eq<FromBarrel, IPrintDoorService>>;

describe('IPrintDoorService.handlePrintDoor: the print door, declared transport-neutrally', () => {
  it('is optional: a service object without it still satisfies IPrintDoorService', () => {
    const service: IPrintDoorService = {};

    expect(service.handlePrintDoor).toBeUndefined();
  });
});
