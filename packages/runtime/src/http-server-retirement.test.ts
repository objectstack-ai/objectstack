// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5122] The `HttpServer` delegating wrapper is RETIRED from `@objectstack/runtime`.
 *
 * ## What was wrong
 *
 * `packages/runtime/src/http-server.ts` declared `class HttpServer implements
 * IHttpServer` and forwarded a constructor-injected server's REQUIRED members
 * (`get`/`post`/`put`/`delete`/`patch`/`use`/`listen`/`close`) — and only
 * those. Every OPTIONAL member of the contract was dropped on the floor:
 *
 *  - `getPort?()` — how a harness addresses a `listen(0)` ephemeral port;
 *  - `getRawApp?()` — the framework-native escape hatch four consumers
 *    feature-detect (cloud-connection ×2, metadata HMR routes, cloud
 *    serverless);
 *  - `setFallbackHandler?()` — since the #5040 E7 publish flip landed (#5111),
 *    the SINGLE seam declarative `apis:` endpoints enter through.
 *
 * `packages/spec/src/contracts/http-server.ts` tells consumers to probe these
 * with `typeof server.X === 'function'`, so wrapping a capable adapter made
 * every probe read **false** and the capability vanish — with the underlying
 * adapter providing it all along. For `setFallbackHandler` that shape is at
 * its worst: a host that wrapped `HonoHttpServer` and registered the wrapper
 * as `http.server` would 404 every endpoint its metadata declared, and the
 * runtime-side warn (#5409, `dispatcher-plugin.fallback-absence-warn.test.ts`)
 * would name the seam's absence without being able to name the wrapper.
 *
 * ## Why retirement rather than conditional forwarding
 *
 * `new HttpServer(` had **zero** occurrences in this repository, examples
 * included; the class was reachable only as a barrel export. Real hosts
 * register an `IHttpServer` adapter INSTANCE as `http.server` and always did.
 * The 2026-08-06 maintainer ruling took the #4939 (`ApiRegistry`) precedent —
 * retiring a part that was never assembled beats repairing it — over growing a
 * forwarding surface nobody composes; ADR-0049's remove side is the process.
 *
 * ## Why these assertions are runtime probes, not type-level ones
 *
 * A removed export cannot be imported by name — that would not compile, so the
 * pin has to interrogate the namespace object instead. And a compile-time pin
 * would be inert here anyway: `packages/runtime/tsconfig.json` excludes
 * `**\/*.test.ts` from `tsc --noEmit`, and vitest never type-checks (#4311),
 * which is the #4642 trap the sibling pin in
 * `packages/spec/src/api/registry-retirement.test.ts` records. Hence runtime
 * probes, each with an anti-vacuity guard so a broken import or a wrong path
 * cannot turn "absent" into a free pass.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

// Statically, not `await import()` inside a case: this barrel pulls the whole
// runtime (sandbox, rest, security, observability) and takes several seconds to
// evaluate cold — long enough to blow vitest's 5s per-test timeout, which is a
// flake, not a finding. A namespace object answers `in` and `Object.keys` just
// as well, and module evaluation happens outside any test's clock.
import * as runtime from './index.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('[#5122] `HttpServer` wrapper retired from @objectstack/runtime', () => {
  it('the barrel exports no `HttpServer`', () => {
    // Anti-vacuity FIRST: the namespace we are about to probe must be real and
    // non-trivial, or the `toBe(false)` below passes for the wrong reason.
    const names = Object.keys(runtime);
    expect(names.length, 'the runtime barrel must export a non-trivial surface').toBeGreaterThan(40);
    expect(names).toContain('Runtime');

    expect('HttpServer' in runtime, '@objectstack/runtime must not export HttpServer').toBe(false);
  });

  it('keeps the HTTP exports that were its neighbours — the deletion took nothing with it', () => {
    for (const kept of ['HttpDispatcher', 'DomainHandlerRegistry', 'MiddlewareManager']) {
      expect(kept in runtime, `${kept} must survive the retirement`).toBe(true);
    }
  });

  it('the module file is gone, so it cannot come back as an unexported private wrapper', () => {
    // Anti-vacuity: a wrong base directory would make every `existsSync` false.
    expect(
      existsSync(path.join(SRC_DIR, 'http-dispatcher.ts')),
      'probe path must point at the runtime source directory',
    ).toBe(true);

    expect(
      existsSync(path.join(SRC_DIR, 'http-server.ts')),
      'packages/runtime/src/http-server.ts is retired (#5122) — a host composes the ' +
        'framework by registering an IHttpServer ADAPTER INSTANCE as `http.server`, ' +
        'not by wrapping one in a same-shaped delegator that drops the optional members',
    ).toBe(false);
  });
});
