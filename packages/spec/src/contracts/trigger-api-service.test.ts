// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22772] `ITriggerApiService.handleInboundHook`: the inbound hook
// `POST /api/v1/automation/hooks/:flowName/:hookId`, declared on the
// `trigger-api` slot's contract transport-neutrally (the first segment of
// ruling A on #22757).
//
// The card asks for a type-level pin, and these aliases are it: the contract
// carries the member, OPTIONAL, at the web-standard shape (one `Request` and
// the two matched path parameters in, a `Response` out; no Hono context, no
// raw app, no `http.server` type, no execution context), and the `contracts`
// barrel exports the same contract the next segments import. The address pin
// holds the verifier's boundary in the type: the second argument carries the
// flow name and the hook id and nothing else, so a body, a signature or a
// timestamp handed over beside the request, which would move a read or a
// check out to the caller, turns it red. The value-level pin below is the
// optionality's other half: a service object without the member still
// satisfies `ITriggerApiService`.
//
// The optionality pin is a type alias, not `expectTypeOf`: `toEqualTypeOf`
// cannot tell an optional member from a REQUIRED one typed `T | undefined`,
// while `{} extends Pick<…>` can. The aliases are exported so TS6196 does not
// flag them as unused; `check:test-typecheck` compiles this file.

import { describe, it, expect } from 'vitest';
import type { ITriggerApiService } from './trigger-api-service';
import type { ITriggerApiService as ITriggerApiServiceFromBarrel } from './index';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type HandleInboundHook = NonNullable<ITriggerApiService['handleInboundHook']>;
type HookAddress = Parameters<HandleInboundHook>[1];

/** Optional: a service may omit it. A required member turns this alias red. */
export type InboundHookIsOptional = Assert<{} extends Pick<ITriggerApiService, 'handleInboundHook'> ? true : false>;

/** The forwarded `Request` and the matched path parameters: the whole input, with no execution context beside them. */
export type InboundHookTakesTheRequestAndTheAddress = Assert<
    Eq<Parameters<HandleInboundHook>, [request: Request, hook: { readonly flowName: string; readonly hookId: string }]>
>;

/** The address is the two path parameters and nothing else: no body, no headers, no signature, no timestamp. */
export type HookAddressCarriesOnlyThePathParameters = Assert<Eq<keyof HookAddress, 'flowName' | 'hookId'>>;

/** A web-standard `Response` out, asynchronously: the trigger's own answer. */
export type InboundHookAnswersAResponse = Assert<Eq<ReturnType<HandleInboundHook>, Promise<Response>>>;

/** The barrel (`@objectstack/spec/contracts`) exports this contract, not a look-alike. */
export type BarrelExportsTheContract = Assert<Eq<ITriggerApiServiceFromBarrel, ITriggerApiService>>;

describe('ITriggerApiService.handleInboundHook: the inbound hook, declared transport-neutrally', () => {
    it('is optional: a service object without it still satisfies ITriggerApiService', () => {
        // The population the optionality is for: a trigger-api service with no
        // inbound-hook door, which the caller must answer with a typed refusal
        // rather than call.
        const service: ITriggerApiService = {};

        expect(service.handleInboundHook).toBeUndefined();
    });
});
