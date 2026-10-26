/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * BUILT-ARTIFACT PIN — the first resident of the `dist` vitest project
 * (objectui#7183, PM ruling 2026-09-02, option 1).
 *
 * ## What this file is, and why it is not a `*.test.tsx`
 *
 * Every other test in this repository reads its package's `src`: the root
 * `vitest.config.mts` aliases `@object-ui/components` to
 * `packages/components/src`, which is correct for the ~2000 tests that want
 * fast source feedback and structurally unable to answer "does the SHIPPED
 * BUNDLE still do X". This file answers exactly that class of question, and it
 * is the only kind of file that belongs in the `dist` project.
 *
 * The `.dist.spec.tsx` suffix is load-bearing three times over, and each one is
 * a hazard rather than a style choice:
 *
 *   1. `unit` collects `packages/**` + `*.test.ts` and `dom` collects
 *      `packages/**` + `*.test.tsx`. A `*.test.tsx` here would be collected by
 *      the light `dom` project, where `packages/components/dist` does not
 *      exist — the NOT MEASURED failure this card was filed about.
 *   2. `packages/components/tsconfig.test.json` compiles this package's tests —
 *      its include names `*.test.ts` and `*.test.tsx` under `src`. (Spelled
 *      without the glob that pairs a star with a slash: inside a block comment
 *      that pair ENDS the comment, and the file then fails to parse. This file
 *      hit exactly that, and `tsconfig.scripts.json`'s header records the same
 *      trap.)
 *      This file must stay OUT of that program: turbo's `type-check` task is
 *      `dependsOn: ["^build"]` — the DEPENDENCIES' builds, never this package's
 *      own — so a type program that reads `../../dist/index.d.ts` would demand
 *      an artifact `type-check` is not allowed to wait for. objectui#4801
 *      removed a self-referencing `paths` entry for precisely that reason; this
 *      file must not reintroduce the coupling by the back door.
 *   3. `tsconfig.json` (the package build) already excludes `src/__tests__`, so
 *      nothing here reaches `dist`.
 *
 * ## The measurement (objectui#6252 acceptance criterion 3)
 *
 * Re-derived from PR objectui#7180, which ran it by hand and could not commit
 * it: "the id path carries no `body.source` into the built artifact". An
 * id-authored `page:header` resolves an action whose definition carries a
 * script body; the built renderer must resolve the id, must not leak the body
 * into the DOM, and must not write the resolved definition back onto the
 * authored node (that node is what a page build serializes).
 *
 * ## The live control — read this before trusting a green
 *
 * `registers page:header from the BUILT bundle` is the control, and it is the
 * reason a green here means anything. Delete the `await import(...)` line below
 * and that case fails with `expected undefined to be truthy`: `page:header` is
 * registered by NOTHING else in this project, because the `dist` project runs
 * the LIGHT dom setup, which deliberately imports none of the
 * `@object-ui/components` graph. So a passing run has measured the built
 * bundle and nothing else — there is no source path that could have satisfied
 * it.
 *
 * That is also why this project must never adopt `vitest.setup.dom.tsx`: that
 * setup registers `page:header` from SOURCE, which would keep every assertion
 * below green with the built bundle removed entirely.
 */

import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, MetadataCtx, RecordContextProvider } from '@object-ui/react';
import type { MetadataContextValue } from '@object-ui/react';

/**
 * The built entry, read from THIS package's `package.json` rather than
 * hardcoded, so the precondition names the file the package actually publishes.
 * `exports['.'].import` is the ESM entry every consumer resolves.
 */
const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'),
) as { exports: Record<string, { import: string }> };
const BUILT_ENTRY = path.resolve(PACKAGE_DIR, PACKAGE_JSON.exports['.'].import);
const BUILT_ENTRY_PRESENT = fs.existsSync(BUILT_ENTRY);

/**
 * ⚠️ THE ONE LINE THAT MAKES THIS A BUILT-ARTIFACT MEASUREMENT.
 *
 * Relative on purpose: the specifier `@object-ui/components` would be
 * redirected to `src` by the root alias map, which is the whole thing this file
 * exists to bypass. Held in a variable so Vite cannot resolve it at transform
 * time — with a literal specifier, a missing `dist` fails the file's TRANSFORM
 * and the precondition below never gets to run, which is the opaque
 * MODULE_NOT_FOUND this card names. The bundle's own externals
 * (`@object-ui/core`, `@object-ui/react`, `react`) still resolve through the
 * Vite pipeline, so the registry it writes to is the same singleton this file
 * reads.
 *
 * Guarded by the precondition so "not built" fails as a NAMED assertion below
 * rather than as a module-resolution error.
 */
const BUILT_ENTRY_SPECIFIER = '../../dist/index.js';
if (BUILT_ENTRY_PRESENT) {
  await import(BUILT_ENTRY_SPECIFIER);
}

/** A script body on the resolved action. Must reach neither the DOM nor the node. */
const BODY_MARKER = 'OS6252_DIST_BODY_MARKER';

const ACTIONS: Record<string, Record<string, unknown>> = {
  convert: { name: 'convert', label: 'Convert Lead', type: 'flow', locations: ['record_header'], order: 2 },
  scripted: {
    name: 'scripted',
    label: 'Run Script',
    type: 'script',
    locations: ['record_header'],
    order: 3,
    body: { language: 'js', source: `return { marker: '${BODY_MARKER}' };` },
  },
};

const OBJECT_META = { name: 'lead', label: 'Lead', actions: [ACTIONS.convert, ACTIONS.scripted] };
const RECORD = { id: 'rec-1', name: 'Ada', status: 'open' };
const USER = { id: 'u1', systemPermissions: ['setup.access'] };

/**
 * Held at MODULE level on purpose: `getItem` is an effect dependency of
 * `useMetadataItem`, so a value rebuilt per render spins that hook forever.
 */
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_META],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: (async (type: string, name: string) =>
    type === 'object' && name === 'lead' ? OBJECT_META : null) as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
} as unknown as MetadataContextValue;

function mount(schema: Record<string, unknown>) {
  const Component = ComponentRegistry.get('page:header') as React.ComponentType<{
    schema: Record<string, unknown>;
  }>;
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <ActionProvider context={{ user: USER } as never}>
        <RecordContextProvider
          objectName="lead"
          recordId={RECORD.id}
          data={RECORD}
          objectSchema={{ name: 'lead', label: 'Lead' }}
        >
          <Component schema={schema} />
        </RecordContextProvider>
      </ActionProvider>
    </MetadataCtx.Provider>,
  );
}

describe('page:header — BUILT artifact (objectui#7183, re-derived from PR objectui#7180)', () => {
  /**
   * The precondition. It FAILS — it does not skip — because a pin that skips
   * itself when its subject is missing is the "green suite that measures
   * nothing" this card was filed to prevent.
   */
  it('precondition: the package under test has been built', () => {
    expect(
      BUILT_ENTRY_PRESENT,
      `The built entry ${BUILT_ENTRY} does not exist, so this built-artifact pin has ` +
        'NOTHING to measure. It must fail rather than skip. The `dist` vitest project is ' +
        'meant to be reached through `pnpm test:dist`, whose turbo task carries ' +
        '`dependsOn: ["build"]` for the package under test and therefore builds it first. ' +
        'Running the project directly builds nothing — build it yourself with ' +
        '`turbo run build --filter=@object-ui/components`, which orders the packages ' +
        'this one is built from.',
    ).toBe(true);
  });

  /**
   * THE LIVE CONTROL. Bare `toBeTruthy()` on purpose: with the `await import`
   * above removed this reports exactly `expected undefined to be truthy`, the
   * verdict PR objectui#7180 recorded. A custom message here would change that
   * string and cost the control its recorded form.
   */
  it('registers page:header from the BUILT bundle', () => {
    expect(ComponentRegistry.get('page:header')).toBeTruthy();
  });

  it('resolves an action id and carries no body.source into the DOM or the authored node', async () => {
    const authored = { type: 'page:header', title: 'Lead', actions: ['convert', 'scripted'] };
    const before = JSON.stringify(authored);
    expect(before).not.toContain(BODY_MARKER);

    const { container } = mount(authored);

    // The id resolved THROUGH THE BUILT RENDERER — the action is named by id
    // only, so a button carrying its label can only come from a resolution.
    expect(await screen.findByRole('button', { name: /Run Script/i })).toBeTruthy();

    // The handler body reaches neither the rendered DOM ...
    expect(container.innerHTML).not.toContain(BODY_MARKER);
    // ... nor the authored node, which is what a page build serializes.
    expect(JSON.stringify(authored)).toBe(before);
  });
});
