// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16025 — `AuthManager.getBasePath()`, the one definition of "where does
// better-auth serve".
//
// ## Why this member is public, and why a rename is a breaking change
//
// An HTTP adapter that mounts this service has to know where its routes live.
// Until this accessor existed it could not ask — `config` is private and
// nothing exposed the value — so `@objectstack/hono`'s `createHonoApp` mounted
// the auth surface under its OWN `prefix` option, whose default (`/api`) does
// not compose with this one (`/api/v1/auth`). Measured on a real boot with the
// documented embed `createHonoApp({ kernel })`, before the fix:
//
//     POST /api/auth/sign-in/email  (valid shape, wrong password)  ->  200 {}
//
// `createHonoApp` now derives the mount from this method, by name, through a
// structural interface (the adapter does not depend on this package). ⇒ A
// rename or removal here silently returns that adapter to the mount above.
//
// ⛔ The behaviour that matters most is NOT assertable from this package: that
// better-auth is really configured with the string this returns. It is one
// expression — `createAuthInstance` passes `this.getBasePath()` and
// `betterAuthEndpointPath` reads the same call — so the two cannot disagree by
// construction rather than by two sites happening to agree. The observable
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
    // Before this method there were two normalising sites and they disagreed:
    // a configured `api/v1/auth` reached better-auth WITHOUT its leading slash
    // while `betterAuthEndpointPath` tested against `/api/v1/auth`.
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
