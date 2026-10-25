/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8316 — the ratchet that replaced a source-text pin, and its fence.
 *
 * ## What this file is for
 *
 * The objectui#6950 ruling made removing the `as ComponentMeta` cast from
 * `withElementDataSourceInput` a deliverable. Nothing the compiler runs can
 * hold that removal — an assertion is invisible to `tsc` by construction, and
 * it was measured on `4dc80d0fc`: with `as ComponentMeta` re-added to the
 * return, `packages/core`'s `tsc --noEmit` exits 0 (control taken in the same
 * run: `const injected: InjectedComponentInput = 42` on the line above does
 * fail it, TS2322 at `Registry.ts`). So the removal was pinned by reading the
 * file's source text, in
 * `packages/types/src/__tests__/injected-component-input-6950.test.ts`.
 *
 * That pin was LIVE — re-adding `as ComponentMeta` did turn it red — and blind
 * anyway: `<ComponentMeta>{…}`, the same assertion in the other spelling, left
 * it green at 9 passed. `eslint.config.js` now scopes
 * `@typescript-eslint/consistent-type-assertions` with `assertionStyle:
 * 'never'` to `Registry.ts` instead, and that pin is retired.
 *
 * ## Why the ratchet needs a test of its own
 *
 * A rule scoped by a path glob has the same failure mode the pin had: if the
 * glob stops selecting the file, ESLint reports nothing and every downstream
 * reading — the package's `lint` script, `lint.yml`'s exit code — is green.
 * A silent scope is a silent guard. So the assertions below are BEHAVIOURAL,
 * driven through ESLint's own API against the real config, and every zero has
 * a non-zero control in the same class taken in the same run.
 *
 * ## And the fence, which is half of it
 *
 * A repo-wide `assertionStyle: 'never'` ban is a much larger decision with its
 * own decision box and is NOT what objectui#8316 proposed. The scope is one
 * file. `neighbouring core files are untouched by the rule` is what holds that,
 * and it is the reason a scope widened by accident fails here rather than
 * arriving as a thousand-error lint run someone silences.
 */

import { ESLint } from 'eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULE = '@typescript-eslint/consistent-type-assertions';

const GUARDED = path.join(REPO_ROOT, 'packages/core/src/registry/Registry.ts');
/** Same package, same extension, one directory over — differs only in path. */
const NEIGHBOUR = path.join(REPO_ROOT, 'packages/core/src/data-scope/element-data-source.ts');

const eslint = new ESLint({ cwd: REPO_ROOT });

/** Rule ids reported for `code` when ESLint is told it lives at `filePath`. */
async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? '<fatal>');
}

const countRule = (ids: string[]): number => ids.filter((id) => id === RULE).length;

/**
 * The two spellings of one assertion. `<T>expr` is legal in a `.ts` file (it is
 * only ambiguous with JSX, and `Registry.ts` is not `.tsx`), which is exactly
 * why a regex written against `as T` could not see it.
 */
const AS_CAST = 'export const meta = { inputs: [] } as ComponentMeta;\n';
const ANGLE_CAST = 'export const meta = <ComponentMeta>{ inputs: [] };\n';
const NO_CAST = 'export const meta: ComponentMeta = { inputs: [] };\n';

describe('the registry meta seam refuses type assertions (objectui#8316)', () => {
  it('reports `as ComponentMeta` in `Registry.ts`', async () => {
    expect(countRule(await ruleIdsFor(AS_CAST, GUARDED))).toBe(1);
  });

  it('reports the `<ComponentMeta>{…}` spelling too — the half the source-text pin was blind to', async () => {
    expect(countRule(await ruleIdsFor(ANGLE_CAST, GUARDED))).toBe(1);
  });

  it('permits an annotation, which is the shape the ruling asked for', async () => {
    expect(countRule(await ruleIdsFor(NO_CAST, GUARDED))).toBe(0);
  });

  it('`Registry.ts` as it stands on disk carries no assertion — the ratchet lints clean today', async () => {
    const [result] = await eslint.lintFiles([GUARDED]);
    const reported = (result?.messages ?? []).filter((m) => m.ruleId === RULE);
    expect(reported).toEqual([]);
    // The zero above is a reading and not a broken invocation: the same file,
    // in the same run, resolves rules and reports under them.
    expect(result?.messages.length ?? 0).toBeGreaterThan(0);
  });
});

describe('the scope is one file, not the repo (objectui#8316 fence)', () => {
  it('leaves a neighbouring `packages/core` file alone', async () => {
    // Controlled by the identical text scoring 1 at `Registry.ts` above; the
    // two readings differ in the file path and in nothing else.
    expect(countRule(await ruleIdsFor(AS_CAST, GUARDED))).toBe(1);
    expect(countRule(await ruleIdsFor(AS_CAST, NEIGHBOUR))).toBe(0);
  });

  it('does not reach the `gen-manifest.ts` sibling the card recorded and did not file', async () => {
    const sibling = path.join(REPO_ROOT, 'packages/sdui-parser/scripts/gen-manifest.ts');
    const code = 'export const configs = [] as unknown as RegistryConfigLike[];\n';
    // Two reports at the guarded path, because `as unknown as T` is two
    // assertions — which is the control that makes the sibling's zero a
    // reading rather than a pattern that failed to match.
    expect(countRule(await ruleIdsFor(code, GUARDED))).toBe(2);
    expect(countRule(await ruleIdsFor(code, sibling))).toBe(0);
  });
});
