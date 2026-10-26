/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Convergence pin — `ComponentMeta` has ONE declaration (objectui#5893), and
 * the second published name for it is deprecated.
 *
 * ## What was wrong
 *
 * `index.ts` published `ComponentMeta` twice, from two different declarations:
 * `base.ts` (eleven keys) and `plugin-scope.ts` (nine — the same nine, minus
 * `tags` and `description`). They were structural COPIES, not an alias pair.
 * The runtime validator `ComponentMetaSchema` (`zod/base.zod.ts`) declares all
 * eleven, so two of the three authorities agreed and the plugin-facing one did
 * not: a plugin author typing against it could not write two keys the main
 * surface and the validator both advertise.
 *
 * That is objectui#4580's ruling coming true rather than being cited — *"a
 * structural copy would reproduce the defect the moment either side moved"* —
 * and objectui#5671 had already executed the identical convergence for the
 * sibling type `ComponentInput` in the same file.
 *
 * ## Why this pins the DIVERGENCE and not the resulting shape
 *
 * The obvious test — assert both spellings carry the same member set — is
 * NOT sufficient, and the file below demonstrates why rather than asserting
 * it. TypeScript is structurally typed: a local `interface ComponentMeta`
 * re-declaring the same eleven keys is mutually assignable with the imported
 * one, so every type-level check passes on it. A member-identical structural
 * copy is EXACTLY the state objectui#4580 predicted would drift, and exactly
 * the state this card is the proof of — the copy here started member-identical
 * and acquired its two-key delta later.
 *
 * So the load-bearing assertion is an IDENTITY pin: `plugin-scope.ts` must
 * RE-EXPORT the declaration and must not declare a `ComponentMeta` of its own.
 * The member-set checks are kept alongside it, labelled, as the control that
 * shows the identity pin catches something they cannot.
 *
 * ## Why the identity half reads SOURCE TEXT
 *
 * Two reasons, the first structural and the second practical.
 *
 * There is no type-level operator that distinguishes "the same declaration"
 * from "an identical declaration" — structural identity is the whole point of
 * TypeScript's type system, and `keyof`-based comparisons erase the difference
 * by construction. The distinction survives only in the source and in the
 * emitted `.d.ts` (a re-export line versus an `interface` body).
 *
 * And the emitted `.d.ts` is not available here: this repo's per-PR `test` job
 * runs `pnpm test` with no build of the package under test ahead of it (turbo's
 * `test` task `dependsOn: ["^build"]` — the DEPENDENCY closure, never the
 * package's own build). A test requiring a fresh `dist/` would be vacuously
 * absent-or-red on a cold cache, not a signal. Same constraint
 * `plugin-component-input-deprecation.test.ts` and
 * `package-exports-manifest.test.ts` record, same resolution.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ComponentMetaSchema } from '../zod/base.zod.js';
import type { ComponentMeta } from '../base.js';
import type { ComponentMeta as PluginScopeComponentMeta } from '../plugin-scope.js';
import type { ComponentMeta as IndexComponentMeta, PluginComponentMeta } from '../index.js';

const PLUGIN_SCOPE_SRC = readFileSync(
  fileURLToPath(new URL('../plugin-scope.ts', import.meta.url)),
  'utf8',
);

const INDEX_SRC = readFileSync(
  fileURLToPath(new URL('../index.ts', import.meta.url)),
  'utf8',
);

/** The re-export line that makes `plugin-scope.ts` share `base.ts`' declaration. */
const RE_EXPORT = "export type { ComponentMeta } from './base.js';";

/**
 * Any LOCAL declaration of the name, exported or not. The re-export form
 * (`export type { ComponentMeta } from …`) cannot match: the brace after
 * `type` is not the identifier.
 */
const LOCAL_DECLARATION = /^\s*(?:export\s+)?(?:interface|type|class)\s+ComponentMeta\b/m;

describe('ComponentMeta — the identity pin (the assertion a structural copy fails)', () => {
  it('plugin-scope.ts re-exports the declaration from base.ts', () => {
    expect(PLUGIN_SCOPE_SRC).toContain(RE_EXPORT);
  });

  it('plugin-scope.ts declares no ComponentMeta of its own', () => {
    // THIS is the pin. It goes red on a local re-declaration even when that
    // re-declaration is member-identical — which is the case every type-level
    // assertion below stays green on, and the case objectui#4580 ruled about.
    expect(PLUGIN_SCOPE_SRC).not.toMatch(LOCAL_DECLARATION);
  });

  it('base.ts is the declaration site, so the pin is not vacuous', () => {
    // Control for the regex itself: the same pattern MUST match where the one
    // declaration actually lives. A pattern that matched nothing anywhere
    // would pass the assertion above on any tree, including a re-diverged one.
    const BASE_SRC = readFileSync(
      fileURLToPath(new URL('../base.ts', import.meta.url)),
      'utf8',
    );
    expect(BASE_SRC).toMatch(LOCAL_DECLARATION);
  });
});

describe('ComponentMeta — the member-set control (green on a structural copy, kept to show the contrast)', () => {
  it('is mutually assignable across both spellings', () => {
    // Type-level, and really compiled: `packages/types/tsconfig.test.json` is
    // chained from this package's `type-check` script (#3009). It is ALSO
    // exactly what a member-identical local copy would satisfy — recorded here
    // as the control, not as the guarantee.
    const bothWays: [
      PluginScopeComponentMeta extends ComponentMeta ? true : false,
      ComponentMeta extends PluginScopeComponentMeta ? true : false,
    ] = [true, true];

    expect(bothWays).toEqual([true, true]);
  });

  it('reaches the published entry point under both names', () => {
    const published: [
      PluginComponentMeta extends IndexComponentMeta ? true : false,
      IndexComponentMeta extends PluginComponentMeta ? true : false,
    ] = [true, true];

    expect(published).toEqual([true, true]);
  });
});

describe('ComponentMeta — the two keys the convergence delivers', () => {
  it('lets a plugin registration write `tags` and `description`', () => {
    // The counter-probe the convergence has to survive: a consumer legitimately
    // using the converged type must still type-check. "The duplicate is gone"
    // is otherwise satisfiable by breaking the type for everyone.
    //
    // Before objectui#5893 the two annotated keys were a plain TS error on this
    // spelling and legal on `base.ts`' — the divergence, at a call site.
    const registration: PluginScopeComponentMeta = {
      label: 'Kanban Board',
      icon: 'layout-board',
      category: 'data',
      inputs: [{ name: 'columns', type: 'array' }],
      isContainer: false,
      resizable: true,
      tags: ['board', 'kanban'],
      description: 'Drag-and-drop board view over a grouped dataset.',
    };

    expect(registration.tags).toEqual(['board', 'kanban']);
    expect(registration.description).toBe(
      'Drag-and-drop board view over a grouped dataset.',
    );
  });

  it('agrees with the runtime validator, which already carried both keys', () => {
    // The zod mirror is the third authority and it never diverged: it declared
    // `tags` and `description` throughout. The convergence brings the plugin
    // face up to it rather than moving it.
    //
    // Note what this does NOT assert: `ComponentMetaSchema` is a plain
    // `z.object` with no `.strict()`, so it STRIPS unknown keys rather than
    // rejecting them (measured on zod 4.4.3 by
    // `default-children-retired-contract-twins.test.ts`). The convergence buys
    // ACCEPTANCE of two keys on the plugin-facing type; it buys no rejection of
    // anything, here or anywhere else.
    const parsed = ComponentMetaSchema.safeParse({
      label: 'Kanban Board',
      tags: ['board', 'kanban'],
      description: 'Drag-and-drop board view over a grouped dataset.',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveProperty('tags', ['board', 'kanban']);
    expect(parsed.data).toHaveProperty(
      'description',
      'Drag-and-drop board view over a grouped dataset.',
    );
  });
});

/**
 * The JSDoc block immediately preceding an export specifier, or `null` when the
 * specifier is not preceded by one. Anchored to the specifier rather than
 * searching the file for `@deprecated`: this package has many unrelated
 * deprecations and a file-wide search would go green on any of them.
 *
 * Same helper, same reasoning, as `plugin-component-input-deprecation.test.ts`.
 */
function docBlockBefore(specifier: string): string | null {
  const at = INDEX_SRC.indexOf(specifier);
  if (at === -1) return null;
  const before = INDEX_SRC.slice(0, at);
  const close = before.lastIndexOf('*/');
  // Only whitespace may sit between the block and the specifier, otherwise the
  // block belongs to some earlier specifier and says nothing about this one.
  if (close === -1 || before.slice(close + 2).trim() !== '') return null;
  const open = before.lastIndexOf('/**', close);
  if (open === -1) return null;
  return before.slice(open, close + 2);
}

/** The published alias specifier, exactly as `index.ts` spells it. */
const ALIAS = 'ComponentMeta as PluginComponentMeta,';

describe('PluginComponentMeta — stage 1: deprecated, at its final meaning', () => {
  it('is still published (deprecating is not deleting)', () => {
    // In-repo the name has zero importers; what cannot be measured from inside
    // this repository is an importer on npm, and the window is the answer to
    // that unmeasurable half. Stage 2 removes it.
    expect(INDEX_SRC).toContain(ALIAS);
  });

  it('carries a JSDoc block attached to the alias specifier itself', () => {
    expect(docBlockBefore(ALIAS)).not.toBeNull();
  });

  it('tags that block `@deprecated`', () => {
    expect(docBlockBefore(ALIAS)).toContain('@deprecated');
  });

  it('names the replacement, so the warning is actionable', () => {
    expect(docBlockBefore(ALIAS)).toMatch(/`ComponentMeta`/);
  });

  it('does not deprecate its neighbours in the same export block', () => {
    // Control: the tag must attach to ONE specifier. A block comment widened
    // to cover the whole `export type { … }` group would make every
    // plugin-scope name read as deprecated.
    expect(docBlockBefore('AppMetadataPlugin,')).toBeNull();
    expect(docBlockBefore('PluginEventHandler,')).toBeNull();
  });

  it('is deprecated only AFTER the convergence — the ordering is the point', () => {
    // Sequencing pin. Deprecating the alias while it still named a separate
    // nine-key declaration would have warned consumers about a name that was
    // about to change meaning. The tag is only honest because the re-export
    // above it is in place, so the two facts are asserted together.
    expect(PLUGIN_SCOPE_SRC).toContain(RE_EXPORT);
    expect(docBlockBefore(ALIAS)).toContain('@deprecated');
  });
});
