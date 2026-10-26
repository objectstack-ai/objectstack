/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/runner` ↔ `@objectstack/spec` symbol-collision guard
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 * `App` → `RunnerApp`. `@objectstack/spec/ui` owns `App` twice: the authored
 * application METADATA type and the `App.create()` builder that produces one.
 * The runner's root React component renders such a document — it even loads it
 * into a variable named `appConfig` — so the name belonged to the metadata.
 *
 * The component itself is not imported here: `App.tsx` pulls in the plugin
 * packages for their registration side effects and reads `window` on render, so
 * importing it would turn a name pin into a DOM-environment test. The rename is
 * enforced by `scripts/check-spec-symbol-derivation.mjs` (a re-declared `App`
 * fails it by name and by file); what this file adds is the half the guard
 * cannot see — that the spec still owns the name, in BOTH of its meanings, so
 * the rename does not outlive its reason.
 */

import { describe, it, expect } from 'vitest';
import { App as SpecAppBuilder } from '@objectstack/spec/ui';
import type { App as SpecApp } from '@objectstack/spec/ui';

describe('the spec still owns `App`', () => {
  it('as a runtime builder namespace', () => {
    expect(typeof SpecAppBuilder.create).toBe('function');
  });

  it('and the builder still produces an application document', () => {
    const app = SpecAppBuilder.create({ name: 'demo_app', label: 'Demo' });
    expect(app.name).toBe('demo_app');
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('and as the authored application metadata type', () => {
  it('is pinned at compile time', () => {
    type _SpecIsReal = Assert<Equal<IsAny<SpecApp>, false>>;
    type _ItIsADocument = Assert<HasKey<SpecApp, 'name'>>;
    type _WithALabel = Assert<HasKey<SpecApp, 'label'>>;
    expect(true).toBe(true);
  });
});
