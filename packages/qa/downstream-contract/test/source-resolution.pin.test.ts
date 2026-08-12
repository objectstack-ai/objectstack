// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { defineConnector as fromPackageRoot } from '@objectstack/spec';
import { defineConnector as fromNamespace } from '@objectstack/spec/integration';

// NOT frozen fixture material (see README) — these two cases assert something
// about the HARNESS, not about the consumer contract: that `contract.test.ts`
// renders a verdict about `packages/spec/src`, the spec in this checkout, and
// not about `packages/spec/dist`, a build artifact.
//
// #7991 is why. This package shipped no vitest config, so every
// `@objectstack/spec` import resolved through `exports` to `dist/`. Measured,
// direction predicted before running: with a required field injected into
// `ConnectorSchema` in SOURCE only and no rebuild — a break the frozen
// `DcConnector` fixture cannot parse — the suite still reported **14/14 pass**;
// aliased to source, the identical tree reported **1 failed / 13 passed**,
// naming the injected field. The gate whose entire job is to notice breaking
// spec changes did not notice one, while its green was being consumed as
// evidence of backward compatibility.
//
// `pnpm check:test-source-alias` asserts the same invariant STATICALLY, by
// simulating Vite's resolution over `vitest.config.ts`. These cases assert it
// DYNAMICALLY, on the resolution the suite next to them actually performs. The
// gap between "the config looks right" and "the import landed on source" is the
// entire subject of this card, so it is worth pinning on both sides.
describe('the contract suite reads spec SOURCE, not spec dist (#7991)', () => {
  it('resolves a namespace that the published `exports` map does not publish', async () => {
    // `packages/spec/src/conversions/` exists in the source tree and is
    // deliberately absent from spec's `exports` map, so this specifier can
    // resolve ONLY through the source alias — through `exports` (i.e. dist) it
    // is `ERR_PACKAGE_PATH_NOT_EXPORTED`. That asymmetry is what makes this a
    // real discriminator rather than a check that passes either way.
    //
    // The specifier is held in a const on purpose: spelled as a literal it
    // would fail `tsc`, which resolves it through the same exports map that
    // does not publish it. `import()` of a non-literal is `any` to tsc and
    // still resolves through Vite's alias at run time.
    const sourceOnlySubpath = '@objectstack/spec/conversions';
    const conversions = (await import(sourceOnlySubpath)) as { CONVERSION_NOTICE_CODE?: unknown };

    expect(conversions.CONVERSION_NOTICE_CODE).toBeTypeOf('string');
  });

  it('serves the package root and the namespaces from ONE source tree', async () => {
    // The case above pins the SUBPATH rule. This one carries it to the bare
    // entry: `defineConnector` is exported by both `@objectstack/spec` and
    // `@objectstack/spec/integration`, so if one of the two aliases were
    // missing or stopped matching, the two specifiers would land on different
    // trees (src and dist) and these would be different function objects.
    //
    // It is also the standing guard on the hazard #7991 flagged in advance:
    // aliasing a dep to source can surface a DUAL INSTANCE that the `dist`
    // boundary was hiding — two copies of the spec loaded at once, which makes
    // every identity comparison downstream (schema instances, registry
    // lookups) quietly wrong. One tree or red.
    expect(fromPackageRoot).toBe(fromNamespace);
  });
});
