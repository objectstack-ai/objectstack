// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16025 — `AuthManager.getBasePath()`: the string an HTTP adapter reads to
// learn where better-auth serves.
//
// ⛔ NOT "the one definition" of that value, which an earlier spelling of this
// header claimed. Two more readers of `this.config.basePath` are live in
// `auth-manager.ts` — `getAuthIssuer()` and `getMcpResourceUrl()`, each with its
// own normaliser — and they are deliberately untouched: they are published OAuth
// identifiers, compared by exact string. The accessor's docblock carries the
// measurement and the reason.
//
// ## Why this member is public, and why a rename is a breaking change
//
// An HTTP adapter that mounts this service has to know where its routes live,
// and no member answered THAT question. (The value was not unreachable —
// `getAuthIssuer()` is public and its URL path is the configured base path — but
// parsing a path back out of an issuer identifier is reading a different
// contract that happens to contain the answer.) So `@objectstack/hono`'s
// `createHonoApp` mounted the auth surface under its OWN `prefix` option, whose
// default (`/api`) does not compose with this one (`/api/v1/auth`). Measured on
// a real boot with the documented embed `createHonoApp({ kernel })`, before the
// fix:
//
//     POST /api/auth/sign-in/email  (valid shape, wrong password)  ->  200 {}
//
// `createHonoApp` now derives the mount from this method, by name, through a
// structural interface (the adapter does not depend on this package). ⇒ A
// rename or removal here silently returns that adapter to the mount above.
//
// ⛔ The behaviour that matters most is NOT assertable from this package: that
// better-auth is really configured with the string this returns. Those two
// sites are one expression — `createAuthInstance` passes `this.getBasePath()`
// and `betterAuthEndpointPath` reads the same call — so THEY cannot disagree by
// construction rather than by happening to agree. (What they disagreed about
// before was a string, not a behaviour: better-auth tolerates a missing leading
// slash, so both spellings routed.) The observable
// proof runs on a real boot in `@objectstack/verify`
// (`auth-base-path-contract.test.ts`), which is the nearest package that can
// hold a live better-auth and this manager at once.

import { describe, it, expect } from 'vitest';
import { AuthManager } from './auth-manager';
import type { AuthManagerOptions } from './auth-manager';

const managerWith = (basePath?: unknown) =>
  new AuthManager({ ...(basePath === undefined ? {} : { basePath }) } as unknown as AuthManagerOptions);

describe('#16025 AuthManager.getBasePath', () => {
  it('is a public member — the surface @objectstack/hono reads by name', () => {
    expect(typeof managerWith().getBasePath).toBe('function');
  });

  it('defaults to the shipped base path when nothing is configured', () => {
    expect(managerWith().getBasePath()).toBe('/api/v1/auth');
  });

  it('answers the CONFIGURED base path, which is the point of asking', () => {
    expect(managerWith('/api/v9/identity').getBasePath()).toBe('/api/v9/identity');
  });

  it('normalises the spellings that used to reach better-auth and the ownership walk differently', () => {
    // Before this method there were two normalising sites and they disagreed as
    // STRINGS: a configured `api/v1/auth` reached better-auth WITHOUT its
    // leading slash while `betterAuthEndpointPath` tested against
    // `/api/v1/auth`. ⛔ They did NOT disagree as behaviour — better-auth and
    // better-call tolerate the missing slash, so on the merge base
    // `handleRequest` answered `200` and `ownsRoute` answered `true` on the same
    // request. What these spellings buy is the trap closed, not a class moved.
    expect(managerWith('api/v1/auth').getBasePath()).toBe('/api/v1/auth');
    expect(managerWith('/api/v1/auth/').getBasePath()).toBe('/api/v1/auth');
    expect(managerWith('/api/v1/auth///').getBasePath()).toBe('/api/v1/auth');
    expect(managerWith('api/v1/auth/').getBasePath()).toBe('/api/v1/auth');
  });

  it('treats an empty configured value as unset, exactly as the pre-#16025 readers did', () => {
    expect(managerWith('').getBasePath()).toBe('/api/v1/auth');
  });

  it('leaves a configured root as the empty base — unchanged behaviour, pinned so it is a decision', () => {
    // `'/'` normalises to `''`, which is what `betterAuthEndpointPath` has
    // always computed for it. The hono adapter rejects that answer as unusable
    // and keeps its previous mount rather than mounting at the app root.
    expect(managerWith('/').getBasePath()).toBe('');
  });
});
