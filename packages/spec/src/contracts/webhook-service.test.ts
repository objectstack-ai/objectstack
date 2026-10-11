// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22754] `IWebhookService.handleRedeliver`: the webhook redeliver door,
// declared on the `webhooks` slot's contract transport-neutrally (the first
// segment of the #22564 bridge for `POST /api/v1/webhooks/redeliver`).
//
// The card asks for a type-level pin, and these aliases are it: the contract
// carries the member, OPTIONAL, at the web-standard
// `(request: Request) => Promise<Response>` shape (no Hono context, no raw app,
// no `http.server` type, no execution context beside the request), and the
// `contracts` barrel exports the same contract the next segments import. The
// value-level pin below is the optionality's other half: a service object
// without the member still satisfies `IWebhookService`.
//
// The optionality pin is a type alias, not `expectTypeOf`: `toEqualTypeOf`
// cannot tell an optional member from a REQUIRED one typed `T | undefined`,
// while `{} extends Pick<…>` can. The aliases are exported so TS6196 does not
// flag them as unused; `check:test-typecheck` compiles this file.

import { describe, it, expect } from 'vitest';
import type { IWebhookService } from './webhook-service';
import type { IWebhookService as IWebhookServiceFromBarrel } from './index';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type HandleRedeliver = NonNullable<IWebhookService['handleRedeliver']>;

/** Optional: a service may omit it. A required member turns this alias red. */
export type RedeliverIsOptional = Assert<{} extends Pick<IWebhookService, 'handleRedeliver'> ? true : false>;

/** One web-standard `Request` in: the whole input, with no execution context beside it. */
export type RedeliverTakesOneRequest = Assert<Eq<Parameters<HandleRedeliver>, [request: Request]>>;

/** A web-standard `Response` out, asynchronously. */
export type RedeliverAnswersAResponse = Assert<Eq<ReturnType<HandleRedeliver>, Promise<Response>>>;

/** The barrel (`@objectstack/spec/contracts`) exports this contract, not a look-alike. */
export type BarrelExportsTheContract = Assert<Eq<IWebhookServiceFromBarrel, IWebhookService>>;

describe('IWebhookService.handleRedeliver: the webhook redeliver door, declared transport-neutrally', () => {
    it('is optional: a service object without it still satisfies IWebhookService', () => {
        // The population the optionality is for: a webhook service with no
        // redeliver door, which the caller must answer with a typed refusal
        // rather than call.
        const service: IWebhookService = {};

        expect(service.handleRedeliver).toBeUndefined();
    });
});
