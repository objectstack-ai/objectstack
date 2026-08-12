// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    // #7991: this package is the repo's backward-compatibility gate for
    // `@objectstack/spec` — its README's contract is "a change that turns this
    // red is breaking for a published-spec third party". It shipped no vitest
    // config, so every `@objectstack/spec` import resolved through `exports` to
    // `packages/spec/dist` — A BUILD ARTIFACT. The verdict of the one suite
    // built to answer "is this spec change breaking?" was therefore a function
    // of build state rather than of the spec source in the checkout.
    //
    // Measured on this package, direction predicted before running: with a
    // required field injected into `ConnectorSchema` in SOURCE only and no
    // rebuild — a break the frozen `DcConnector` fixture cannot parse — the
    // suite reported **14/14 pass**. Aliased to source, the identical tree
    // reported **1 failed / 13 passed**, naming the injected field. A green
    // here was being consumed as evidence of backward compatibility while it
    // was reporting on the last `pnpm build` instead.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never
    // the failing path. What breaks is every path turbo does not mediate:
    // `pnpm test` inside the package, `vitest run <file>`, an editor runner, or
    // an agent in a tree built at an older commit — i.e. exactly the paths this
    // gate is re-run on WHILE someone is changing the spec, when it most needs
    // to be telling the truth.
    //
    // Array form with ANCHORED patterns, deliberately — the same correction
    // `service-knowledge` and `plugin-audit` record. The object form matches by
    // PREFIX, so a bare `@objectstack/spec` entry also swallows
    // `@objectstack/spec/ui` and resolves it to `spec/src/index.ts/ui`
    // (`ENOTDIR`). One rule for all namespaces cannot go stale as imports are
    // added; `pnpm check:test-source-alias` enforces both halves.
    //
    // The subpath rule covers the namespaces the fixtures reach today
    // (`automation` / `data` / `identity` / `integration` / `security` /
    // `system` / `ui`) and every other one they might reach tomorrow. One rule
    // for all namespaces cannot go stale the way a hand-maintained list does.
    //
    // ⚠️ The replacement is spelled `path.join(<packages>, 'spec/src/$1/…')`
    // and NOT as the template literal `${path.resolve(…, '../../spec/src')}/$1/
    // index.ts` that `service-knowledge` and `plugin-audit` use, because
    // `check:test-source-alias` reads an alias replacement by taking the LAST
    // string literal in the expression: from the template form that is the
    // whole template body, which contains no `/src/` segment, so a config that
    // aliases every namespace correctly still reads to the gate as aliasing
    // nothing. Filed as #8020 — it is why both of those packages still
    // carry a `['@objectstack/objectql', '@objectstack/spec']` registry entry
    // they have in fact already half-fixed. In this spelling the gate's
    // simulated resolution lands on `spec/src/<ns>/index.ts`, which is what
    // Vite really produces — the gate's verdict here is true, not lucky.
    alias: [
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: path.join(path.resolve(__dirname, '..', '..'), 'spec/src/$1/index.ts'),
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
    ],
  },
});
