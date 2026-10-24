/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The retired cloud surface stays retired — negative pin (objectui#4152).
 *
 * `packages/data-objectstack/src/cloud.ts` exported a `CloudOperations` class
 * and three `Cloud*` types, all re-exported from this package's `index.ts`, so
 * they were published surface of `@object-ui/data-objectstack`. Every one of
 * the class's four methods optional-chained into `client.cloud?.…` — a
 * namespace no released `@objectstack/client` has ever exported (measured again
 * at `17.0.0-rc.6` while removing it: the module exports exactly
 * `ObjectStackClient`, `ScopedProjectClient`, `RealtimeAPI`, `QueryBuilder`,
 * `FilterBuilder`, `createQuery`, `createFilter`, and a constructed instance's
 * `.cloud` is `undefined`) — and then returned a fallback literal:
 *
 * | method | what it returned, always |
 * |:--|:--|
 * | `deploy` | `{ deploymentId: 'deploy-' + Date.now(), status: 'pending' }` |
 * | `getDeploymentStatus` | `{ status: 'unknown' }` |
 * | `searchMarketplace` | `[]` |
 * | `installPlugin` | `{ success: false }` |
 *
 * The maintainer ruling of 2026-08-11 removed it. The reason worth keeping in
 * front of whoever reads this file: `deploy()` did not degrade to an error, it
 * **manufactured a plausible success**. A caller — especially an AI one, which
 * will not get suspicious — received a well-formed `deploymentId` for an
 * operation that never left the process, then polled it forever against
 * `{ status: 'unknown' }`. Fabricated success is banned by that ruling; a stub
 * that must exist for compile compatibility throws instead.
 *
 * ## Why a negative pin, and why it reads BOTH surfaces
 *
 * Nothing else can see this regression. The gates in this repo run from a
 * declaration to its usage; a re-added export has a declaration and no usage,
 * which is exactly the shape that has no alarm on it — the same gap
 * objectui#4145's retirement pin was built for.
 *
 * The two halves are not redundant, because a class and a type do not fail the
 * same way:
 *
 *   - the **runtime** half enumerates `./index`'s bindings, which catches
 *     `CloudOperations` (a class survives to runtime) but is structurally blind
 *     to `CloudDeploymentConfig` and friends, since `export type` erases;
 *   - the **source-text** half reads `index.ts` for the names and for a
 *     re-export of `./cloud`, which is the only instrument that can see a
 *     returning *type*.
 *
 * Drop either one and half the retired surface can come back green.
 *
 * ## Why the source is read through `ts.sys` rather than `node:fs`
 *
 * Inherited from the pin this file replaces: this package's `tsconfig.json`
 * compiles its whole test tree, and keeping `@types/node` out of a browser-side
 * adapter's type environment is deliberate. TypeScript's own system host is
 * typed by the `typescript` devDependency.
 *
 * ## What happened to objectui#3720's pin
 *
 * `cloud-environment-vocabulary.pin.test.ts` pinned the doc comment on
 * `CloudDeploymentConfig.environment` — the deploy-target vocabulary and the
 * `staging` trap. Its subject was deleted here, so it retired with it rather
 * than being re-pointed: every fact it held was a claim ABOUT that comment, and
 * its spec-side assertions (`DiscoveryEnvironmentSchema` / `EnvironmentTypeSchema`
 * member lists) existed only to keep those claims honest — with the comment
 * gone they would pin an upstream library's enums on behalf of no local reader,
 * which is the same phantom shape objectui#4152 is closing. #3720's own
 * conclusion is unaffected and now moot: it found no producer-side deploy-target
 * type to converge onto, because the producer did not exist. This file records
 * the same measurement one step further along.
 *
 * ## If a real cloud API lands
 *
 * Then this pin is what you delete, deliberately, in the PR that binds the new
 * `@objectstack/client` surface — with methods that call it and fail loudly when
 * it is absent. Re-adding the names alone, ahead of a producer, is the thing
 * being prevented.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import * as adapter from './index';

/** Every name the retirement removed from the package's public surface. */
const RETIRED_EXPORTS = [
  'CloudOperations',
  'CloudDeploymentConfig',
  'CloudHostingConfig',
  'CloudMarketplaceEntry',
] as const;

/** This file, as an absolute path — `index.ts` is its sibling. */
const HERE = new URL(import.meta.url).pathname;
const INDEX_TS = HERE.replace(/[^/]+$/, 'index.ts');
const CLOUD_TS = HERE.replace(/[^/]+$/, 'cloud.ts');

function readIndexSource(): string {
  const raw = ts.sys.readFile(INDEX_TS);
  if (!raw) throw new Error(`cannot read ${INDEX_TS}`);
  return raw;
}

const INDEX_SOURCE = readIndexSource();

describe('the probe itself works', () => {
  it('read a plausible index.ts', () => {
    expect(INDEX_SOURCE.length).toBeGreaterThan(1000);
    expect(INDEX_SOURCE).toContain('export class ObjectStackAdapter');
  });
});

describe('the cloud surface is gone from the runtime exports', () => {
  it.each(RETIRED_EXPORTS)('`%s` is not a runtime binding of the package entry', (name) => {
    expect(
      Object.prototype.hasOwnProperty.call(adapter, name),
      `\`${name}\` is exported from @object-ui/data-objectstack again. It was ` +
        `retired by objectui#4152 because it optional-chained into a ` +
        `\`client.cloud\` namespace @objectstack/client does not have, and ` +
        `returned a fabricated success instead of failing. If a real cloud API ` +
        `has landed, bind it and delete this pin deliberately — do not restore ` +
        `the old fallbacks.`,
    ).toBe(false);
  });

  it('exports no other `Cloud`-prefixed binding either', () => {
    const strays = Object.keys(adapter).filter((name) => name.startsWith('Cloud'));
    expect(
      strays,
      `unexpected \`Cloud*\` export(s) on the package entry. objectui#4152 ` +
        `removed this prefix wholesale; a new one needs a producer behind it.`,
    ).toEqual([]);
  });
});

describe('the cloud surface is gone from the source, types included', () => {
  it('index.ts re-exports nothing from `./cloud`', () => {
    expect(
      /from\s+'\.\/cloud'/.test(INDEX_SOURCE),
      `index.ts re-exports from './cloud' again (objectui#4152 removed that ` +
        `module). \`export type\` erases at runtime, so the assertions above ` +
        `cannot see a returning type — this one is what catches it.`,
    ).toBe(false);
  });

  it.each(RETIRED_EXPORTS)('index.ts does not name `%s`', (name) => {
    // The retirement note left behind in index.ts mentions the family in prose
    // (`Cloud*Config`), never a retired identifier, so a hit here is a real
    // re-export rather than the comment.
    expect(
      INDEX_SOURCE.includes(name),
      `index.ts mentions \`${name}\` again. If this is a comment rather than an ` +
        `export, rewrite the comment — this pin deliberately cannot tell the ` +
        `difference, because a type export is invisible to every other check.`,
    ).toBe(false);
  });

  it('the cloud.ts module itself is gone', () => {
    expect(
      ts.sys.fileExists(CLOUD_TS),
      `${CLOUD_TS} is back. The module header claimed to integrate ` +
        `"@objectstack/spec v3.0.0" cloud schemas the package never consumed; ` +
        `objectui#4152 deleted both the claim and the surface.`,
    ).toBe(false);
  });
});
