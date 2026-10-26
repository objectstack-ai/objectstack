/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Local stand-ins for `vitest` / `@testing-library/react`, so the fixtures next
 * to this file are self-contained TypeScript.
 *
 * They are NOT executed. `tsconfig.scripts.json` compiles every `.ts` under
 * `scripts/`, so the fixtures have to type-check; importing the real `vitest`
 * and `@testing-library/react` would drag DOM lib types into a project whose
 * `lib` is `ES2022` + `types: ["node"]`. Declaring the three names locally
 * keeps the fixtures compiling while leaving their SOURCE SHAPE — which is the
 * only thing the census reads — identical to a real test file.
 */

export declare function describe(name: string, fn: () => void): void;
export declare function it(name: string, fn: () => Promise<void> | void): void;
export declare function waitFor(fn: () => void): Promise<void>;

export interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchObject(expected: object): void;
}
export declare function expect(actual: unknown): Matchers;
