// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#36506] `IAttachmentDoorsService.handleAttachmentDoor`: the attachment's
// removal and rename doors, declared transport-neutrally on the contract the
// `file-attachments` service implements beside `IFileAttachmentService`, so the
// runtime dispatcher can reach them on a kernel with no `http.server`.
//
// Type-level pins, the shape `comment-doors-service.test.ts` uses: the member is
// OPTIONAL, at the web-standard `(request: Request) => Promise<Response>`
// shape, and the barrel exports the same contract. The aliases are exported so
// TS6196 does not flag them as unused; `check:test-typecheck` compiles this
// file.

import { describe, it, expect } from 'vitest';
import type { IAttachmentDoorsService } from './attachment-doors-service';
import type { IAttachmentDoorsService as FromBarrel, IFileAttachmentService } from './index';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type HandleAttachmentDoor = NonNullable<IAttachmentDoorsService['handleAttachmentDoor']>;

/** Optional: a service may omit it. A required member turns this alias red. */
export type AttachmentDoorIsOptional = Assert<
  {} extends Pick<IAttachmentDoorsService, 'handleAttachmentDoor'> ? true : false
>;

/** One web-standard `Request` in: the whole input, with no execution context beside it. */
export type AttachmentDoorTakesOneRequest = Assert<Eq<Parameters<HandleAttachmentDoor>, [request: Request]>>;

/** A web-standard `Response` out, asynchronously. */
export type AttachmentDoorAnswersAResponse = Assert<Eq<ReturnType<HandleAttachmentDoor>, Promise<Response>>>;

/** The barrel (`@objectstack/spec/contracts`) exports this contract, not a look-alike. */
export type BarrelExportsTheContract = Assert<Eq<FromBarrel, IAttachmentDoorsService>>;

/** It composes with the attach verb's contract on one service, member names apart. */
export type ComposesWithTheAttachVerb = Assert<
  Eq<keyof (IFileAttachmentService & IAttachmentDoorsService), 'attachFile' | 'handleAttachmentDoor'>
>;

describe('IAttachmentDoorsService.handleAttachmentDoor: the attachment doors, declared transport-neutrally', () => {
  it('is optional: a service object without it still satisfies IAttachmentDoorsService', () => {
    const service: IAttachmentDoorsService = {};

    expect(service.handleAttachmentDoor).toBeUndefined();
  });
});
