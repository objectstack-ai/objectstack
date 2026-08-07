// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

/**
 * Two entries, deliberately (#6040).
 *
 * `src/index.ts` is the full plugin: `export *` over ~20 modules, several of
 * which take a **value** import on the better-auth family
 * (`objectql-adapter.ts` → `better-auth/adapters`, `backfill-account-issuer.ts`
 * → `@better-auth/core/db`). Loading the root therefore eagerly evaluates
 * `better-auth` + `@better-auth/{core,oauth-provider,scim,sso}` + `jose` +
 * `@noble/hashes` + `@objectstack/rest` + `@objectstack/platform-objects`.
 *
 * `src/rate-limit-storage.ts` is the ~90-line fixed-window counter
 * (`incrementFixedWindow` / `createLazyCounterStore` / `InProcessCounterStore`,
 * ADR-0069 D2). It is the repo's ONE fixed-window counter and #4790 asks later
 * arrivals to reuse it rather than write a third copy — which they did, from
 * outside auth: `@objectstack/runtime` (`security/inbound-rate-limit.ts`,
 * `endpoint-policy.ts`, `dispatcher-plugin.ts`) and `@objectstack/service-sms`
 * (`sms-plugin.ts`, `sms-daily-quota.ts`). With only a `"."` export those
 * consumers had to reach the counter through the root and took the whole
 * better-auth family with it. The `./rate-limit-storage` subpath is the entry
 * they import instead.
 *
 * `splitting: false` is what makes the isolation real rather than nominal: each
 * entry is emitted as a self-contained bundle, so nothing the root pulls in can
 * reach the counter entry through a shared chunk.
 * `rate-limit-storage-isolation.test.ts` pins the source-level half of the same
 * invariant.
 *
 * (Identical shape to `packages/types/tsup.config.ts` and
 * `packages/core/tsup.config.ts`, which ship `./node` and `./logger` this way.
 * The only reason this file exists at all — rather than the shared
 * `../../../tsup.config.ts` — is the second entry.)
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/rate-limit-storage.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
});
