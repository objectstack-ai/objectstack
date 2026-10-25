/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';

import { ZOD_WRAPPER_KEYS } from '../zod-wrapper-keys';
import rawJson from '../zod-wrapper-keys.json';
import * as surface from '../index';

/**
 * objectui#6923 — the TypeScript half of the two-language list.
 *
 * The `.mjs` half, and the counter-example that makes the whole thing worth
 * having, live in `scripts/__tests__/zod-wrapper-keys.shared.test.ts`: this file
 * cannot import a CI gate without dragging `typescript` and the repo root into a
 * package's own suite. That file also owns the ON-DISK byte comparison, because
 * this package's `tsc` program has no `@types/node` and so no `node:fs` — which
 * is why the equality below is against the imported JSON rather than the file.
 *
 * What is pinned here is the surface: the re-export chain does not TRANSFORM the
 * list on its way to a TypeScript consumer, and consumers reach it through the
 * package index rather than a deep path.
 */

describe('ZOD_WRAPPER_KEYS', () => {
  it('re-exports the JSON data file unchanged — one source, not a copy that agrees', () => {
    // Not `toBe`: the assertion is about VALUE, so that a later decision to
    // freeze or copy the array in `zod-wrapper-keys.ts` does not read as drift.
    // What must never change is the content or the order.
    expect([...ZOD_WRAPPER_KEYS]).toEqual(rawJson);
  });

  it('is non-empty — the one property an "both sides agree" test cannot see', () => {
    // An empty list satisfies every equality assertion in this file. It is also
    // the measured failure mode (PR #6047: three of four parity gates stayed
    // GREEN on an empty vocabulary). The load-bearing half of this pin is in
    // `scripts/__tests__/zod-wrapper-keys.shared.test.ts`, which drives one
    // fixture per key through both gates; this is the cheap floor under it.
    expect(ZOD_WRAPPER_KEYS.length).toBeGreaterThan(0);
    expect(ZOD_WRAPPER_KEYS.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
  });

  it('is on the package surface, so consumers import the package and not a deep path', () => {
    // objectui#4325: a deep subpath into another package resolved only through
    // this repo's vitest alias, was TS2882 for `tsc`, and was ruled out rather
    // than minted as permanent API. The `.json` subpath added for objectui#6923
    // is the deliberate, narrow exception — it exists because bare `node` has no
    // other way in — and it does not license a second one for TypeScript.
    expect(surface.ZOD_WRAPPER_KEYS).toBe(ZOD_WRAPPER_KEYS);
  });
});
