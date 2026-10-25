/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The retired `v3.0.0 Deep Integration` surface stays retired — negative pin
 * (objectui#4241).
 *
 * `index.ts`'s `// v3.0.0 Deep Integration modules` banner introduced five
 * modules; `CloudOperations` (`cloud.ts`) was the first to go, retired by
 * objectui#4152 / PR #4239 for fabricating success against a client namespace
 * that does not exist (see `cloud-surface-retired-4152.pin.test.ts`). The
 * other four — `contracts.ts`, `integration.ts`, `security.ts`, `studio.ts` —
 * were not fabricating anything: `SecurityManager.generateCSPHeader()` really
 * composes a header, `snapToGrid` really snaps, `validatePluginContract`
 * really validates. What they shared with `CloudOperations` was the other
 * limb — published surface of `@object-ui/data-objectstack` with a measured
 * ZERO code consumers outside this package, across `packages/`, `apps/` and
 * `examples/`. Under the startup-focus principle a declared capability with
 * no producer, no consumer and no business pull is retired, not kept on the
 * chance it becomes useful.
 *
 * ## Why a negative pin, and why it reads BOTH surfaces
 *
 * Nothing else can see this regression. The gates in this repo run from a
 * declaration to its usage; a re-added export has a declaration and no usage,
 * which is exactly the shape that has no alarm on it — the same gap
 * objectui#4145's retirement pin, and objectui#4152's after it, were built
 * for.
 *
 * The two halves are not redundant, because a class/function and a type do
 * not fail the same way:
 *
 *   - the **runtime** half enumerates `./index`'s bindings, which catches the
 *     seven value exports (`IntegrationManager`, `SecurityManager`,
 *     `createDefaultCanvasConfig`, `snapToGrid`, `calculateAutoLayout`,
 *     `validatePluginContract`, `generateContractManifest`) but is
 *     structurally blind to the twenty-three `export type` names, since a
 *     type erases at runtime;
 *   - the **source-text** half reads `index.ts` for every one of those names
 *     AND for a re-export of any of the four modules, which is the only
 *     instrument that can see a returning *type*.
 *
 * Drop either one and half the retired surface can come back green.
 *
 * ## Why the source is read through `ts.sys` rather than `node:fs`
 *
 * Inherited from the pin this file sits beside: this package's
 * `tsconfig.json` compiles its whole test tree, and keeping `@types/node` out
 * of a browser-side adapter's type environment is deliberate. TypeScript's
 * own system host is typed by the `typescript` devDependency.
 *
 * ## If a real integration/security/studio/contracts surface lands
 *
 * Then this pin is what you delete, deliberately, in the PR that binds a real
 * producer — with methods that call it and fail loudly when it is absent.
 * Re-adding the names alone, ahead of a producer, is the thing being
 * prevented.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

import * as adapter from './index';

/** The seven runtime (value) bindings the retirement removed. */
const RETIRED_RUNTIME_EXPORTS = [
  'IntegrationManager',
  'SecurityManager',
  'createDefaultCanvasConfig',
  'snapToGrid',
  'calculateAutoLayout',
  'validatePluginContract',
  'generateContractManifest',
] as const;

/**
 * Every name the retirement removed from the package's public surface —
 * runtime bindings above plus the twenty-three `export type`-only names,
 * which `Object.keys` below can never see.
 */
const RETIRED_EXPORTS = [
  ...RETIRED_RUNTIME_EXPORTS,
  'IntegrationConfig',
  'IntegrationTrigger',
  'IntegrationProvider',
  'SlackIntegrationConfig',
  'EmailIntegrationConfig',
  'WebhookIntegrationConfig',
  'SecurityManagerPolicy',
  'CSPConfig',
  'AuditLogConfig',
  'AuditEventType',
  'DataMaskingConfig',
  'DataMaskingRule',
  'AuditLogEntry',
  'StudioCanvasConfig',
  'StudioPropertyEditor',
  'StudioThemeBuilderConfig',
  'StudioColorPalette',
  'StudioTypographyPreset',
  'StudioShadowPreset',
  'PluginContract',
  'PluginExport',
  'PluginAPIContract',
  'ContractValidationResult',
  'ContractValidationError',
] as const;

/** The four module specifiers the retirement deleted. */
const RETIRED_MODULE_SPECIFIERS = ['./integration', './security', './studio', './contracts'] as const;

/** This file, as an absolute path — `index.ts` is its sibling. */
const HERE = new URL(import.meta.url).pathname;
const INDEX_TS = HERE.replace(/[^/]+$/, 'index.ts');
const MODULE_FILES = RETIRED_MODULE_SPECIFIERS.map((spec) =>
  HERE.replace(/[^/]+$/, `${spec.replace('./', '')}.ts`),
);

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

describe('the retired modules are gone from the runtime exports', () => {
  it.each(RETIRED_RUNTIME_EXPORTS)('`%s` is not a runtime binding of the package entry', (name) => {
    expect(
      Object.prototype.hasOwnProperty.call(adapter, name),
      `\`${name}\` is exported from @object-ui/data-objectstack again. It was ` +
        `retired by objectui#4241 because it had zero code consumers outside ` +
        `this package, measured across packages/, apps/ and examples/. If a ` +
        `real consumer has landed, bind it and re-add the export deliberately ` +
        `— do not restore it speculatively.`,
    ).toBe(false);
  });
});

describe('the retired modules are gone from the source, types included', () => {
  it.each(RETIRED_MODULE_SPECIFIERS)("index.ts re-exports nothing from '%s'", (spec) => {
    const escaped = spec.replace(/[.]/g, '\\.');
    const pattern = new RegExp(`from\\s+'${escaped}'`);
    expect(
      pattern.test(INDEX_SOURCE),
      `index.ts re-exports from '${spec}' again (objectui#4241 removed that ` +
        `module). \`export type\` erases at runtime, so the runtime-binding ` +
        `assertions above cannot see a returning type — this one is what ` +
        `catches it.`,
    ).toBe(false);
  });

  it.each(RETIRED_EXPORTS)('index.ts does not name `%s`', (name) => {
    expect(
      INDEX_SOURCE.includes(name),
      `index.ts mentions \`${name}\` again. If this is a comment rather than an ` +
        `export, rewrite the comment — this pin deliberately cannot tell the ` +
        `difference, because a type export is invisible to every other check.`,
    ).toBe(false);
  });

  it.each(MODULE_FILES)('the %s module itself is gone', (file) => {
    expect(
      ts.sys.fileExists(file),
      `${file} is back. It was one of the four \`v3.0.0 Deep Integration\` ` +
        `modules retired by objectui#4241 for having zero code consumers ` +
        `outside this package.`,
    ).toBe(false);
  });
});
