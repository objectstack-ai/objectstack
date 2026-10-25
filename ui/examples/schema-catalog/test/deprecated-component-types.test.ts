/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3965 — the catalog-scoped gate on DEPRECATED component types,
 * CLOSED at zero.
 *
 * Every catalog entry is an exemplar: the corpus is what a human copies from,
 * and what few-shot retrieval over these examples hands a generating model. A
 * fixture authoring a type the engine itself deprecates therefore teaches the
 * deprecated spelling, and does so at corpus scale. This file makes that
 * measurable, because nothing else in the repo does.
 *
 * ## Nothing stopped the 49th before this file
 *
 * Both gates that touch component types ask only whether the type RESOLVES,
 * never whether it is deprecated:
 *
 *   - `catalog-gallery-render.test.tsx` (objectui#4616) asserts
 *     `ComponentRegistry.get(type)` is truthy and that no OBJUI-001 panel
 *     paints. `div` is registered and renders, so the suite was green with all
 *     85 deprecated nodes present — measured, not assumed.
 *   - `scripts/check-doc-component-types.mjs` asks the same existence question
 *     and walks `content/docs` and nothing else (`DOCS_ROOT = 'content/docs'`),
 *     so `examples/**` is outside its scan surface entirely.
 *
 * The deprecation itself is declared machine-readably since objectui#6674
 * (`deprecated: { surfaces: ['json'], replacement: … }` on the registration,
 * read back through `ComponentRegistry.deprecationFor(type, surface)`), which
 * is what the premise arm and the omission arm below consult.
 *
 * ⚠️ `DEPRECATED_TYPES` stays HAND-KEPT on purpose, and deriving it wholesale
 * from the registry would be a regression rather than the obvious next step.
 * This file loads `@object-ui/components` and nothing else; a type declared
 * deprecated by a plugin package it does not import would silently drop out of
 * a derived list, and the census would shrink to green. The list is the
 * gate's authority precisely because it is complete by construction. What
 * the declaration buys is that the list can now be CHECKED — in both directions
 * — against something a machine can read.
 *
 * ## From ratchet to closed gate (the objectui#3965 arc)
 *
 * When this file landed (PR #6732) it FROZE a stock of 25 files / 80 authored
 * `div` nodes, because the conversion was not mechanical: `div` is
 * class-transparent while every replacement the deprecation notice names
 * injects layout, and `div` reads `children || body` while `container` /
 * `flex` / `stack` / `grid` read `children` only — four sidebar fixtures
 * authored `body`, and a blind swap would have dropped their content silently
 * AT AN UNCHANGED ELEMENT COUNT (measured on the real `basic-sidebar.json`:
 * 21 elements before and after, "Main content area" gone). That measurement
 * is why two sweep rulings were superseded.
 *
 * The 2026-08-29 ruling (方案 A) minted what the vocabulary was missing — the
 * neutral, class-transparent `box` (renders `children`, authored `className`
 * verbatim, zero injected classes; contract pinned in
 * `packages/components/src/renderers/__tests__/box-neutral-container.test.tsx`)
 * — and the stock then drained in one mechanical pass: 25 files / 80 nodes
 * retyped `div`→`box`, the four `body`-authoring nodes moving their content
 * into `children`, each fixture verified through the real `SchemaRenderer`
 * with the ruled dual assertion (element count + text content). So the
 * BASELINE table this file used to carry is gone: the catalog now tolerates
 * ZERO JSON-authored `div` outside the documentation exemption, exactly like
 * `span` all along.
 *
 * ## Why `components-basic-div/` is exempt rather than refused
 *
 * That category DOCUMENTS the deprecated type: it ships `use-card-instead`,
 * `flex-layout` and `grid-layout` beside `nested-divs` and `custom-card`. A
 * category documenting the deprecated type must author the deprecated type —
 * sweeping it would delete the before-and-after that teaches the migration.
 * Same class as the two deliberate legacy examples in `div.mdx`, exempted on
 * 2026-08-09 in any option. The exemption is a DIRECTORY, and it is checked
 * for non-vacuity below so it cannot quietly become a hole nothing uses.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Registers `div` / `span` (and the rest of the basic set) at module scope, so
// the two arms below can ASK the registry what is deprecated instead of reading
// a renderer's source. Module scope, not a hook — objectui#3010/#3021.
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';

/** Resolved off this module, so the gate does not depend on the process cwd. */
const SCHEMAS_ROOT = fileURLToPath(new URL('../src/schemas', import.meta.url));

/**
 * The surface this corpus is authored on. Every fixture under `SCHEMAS_ROOT` is
 * JSON metadata, so the question this gate asks the registry is scoped to
 * it: `span` is ALSO vocabulary of the `kind:'html'` tier (objectui#4000),
 * where the parser compiles the plain tag straight through and no other
 * spelling exists to migrate to. A gate that dropped the scope would be
 * refusing a spelling that is correct on the other surface. (`div` no longer
 * differs by surface: objectui#10757 declared it deprecated on both.)
 */
const CORPUS_SURFACE = 'json' as const;

/**
 * The deprecated JSON-authored component types this gate refuses. Hand-kept
 * — see the header for why deriving it from the registry would shrink the
 * census silently — and checked in BOTH directions against the
 * machine-readable declaration the registrations carry (objectui#6674).
 */
const DEPRECATED_TYPES = ['div', 'span'] as const;

/**
 * The category that DOCUMENTS the deprecated type, and may therefore author it.
 * A directory prefix, relative to `SCHEMAS_ROOT`.
 */
const DOC_EXEMPT_DIRS = ['components-basic-div/'] as const;

/** Every `*.json` fixture, path relative to `SCHEMAS_ROOT`, sorted. */
function fixtureFiles(): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs).sort()) {
      const childAbs = `${abs}/${name}`;
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else if (name.endsWith('.json')) out.push(childRel);
    }
  };
  walk(SCHEMAS_ROOT, '');
  return out;
}

/**
 * Count deprecated nodes STRUCTURALLY — every object with a `type` of a
 * deprecated name, at any depth, under any key. A text scan for `"type": "div"`
 * would be at the mercy of JSON formatting and would also match the string
 * inside an unrelated value.
 */
function countDeprecated(node: unknown, into: Map<string, number>): void {
  if (Array.isArray(node)) {
    for (const child of node) countDeprecated(child, into);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj.type;
  if (typeof type === 'string' && (DEPRECATED_TYPES as readonly string[]).includes(type)) {
    into.set(type, (into.get(type) ?? 0) + 1);
  }
  for (const value of Object.values(obj)) countDeprecated(value, into);
}

/** `{ file -> { type -> count } }` over the whole catalog, deprecated types only. */
function census(): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const rel of fixtureFiles()) {
    const counts = new Map<string, number>();
    countDeprecated(JSON.parse(readFileSync(`${SCHEMAS_ROOT}/${rel}`, 'utf8')), counts);
    if (counts.size > 0) out.set(rel, counts);
  }
  return out;
}

const isDocExempt = (rel: string) => DOC_EXEMPT_DIRS.some((dir) => rel.startsWith(dir));
const total = (counts: Map<string, number>) =>
  [...counts.values()].reduce((a, b) => a + b, 0);

describe('deprecated component types are refused across the catalog (#3965, closed)', () => {
  const measured = census();

  it('no fixture outside the documentation exemption authors a deprecated component type', () => {
    const offenders = [...measured]
      .filter(([rel]) => !isDocExempt(rel))
      .map(([rel, counts]) => `${rel} — ${[...counts].map(([t, n]) => `${n}x "${t}"`).join(', ')}`);

    expect(
      offenders,
      'A catalog fixture authors a deprecated component type. Every catalog ' +
        'entry is an exemplar — this is the corpus a human copies from and that ' +
        'few-shot retrieval hands a generating model — so a deprecated spelling ' +
        'here teaches itself forward. The stock drained to ZERO when the ' +
        'neutral `box` container landed (objectui#3965): author `box` for a ' +
        'bare styled wrapper, or `card` / `flex` / `container` / `stack` / ' +
        '`grid` when their layout semantics are wanted. If the entry exists ' +
        'specifically to DOCUMENT the deprecated type, it belongs in a ' +
        'DOC_EXEMPT_DIRS category, not outside it.',
    ).toEqual([]);
  });

  it('the deprecation this gate mirrors is still declared', () => {
    // The mirror's premise. If a type is UN-deprecated, this file must die
    // loudly rather than keep refusing a spelling that became legal again.
    const undeclared = DEPRECATED_TYPES.filter(
      (type) => ComponentRegistry.deprecationFor(type, CORPUS_SURFACE) === undefined,
    );

    expect(
      undeclared,
      'A type this gate refuses no longer DECLARES a deprecation for the ' +
        'json authoring surface. Either it was un-deprecated — in which case ' +
        'drop it from DEPRECATED_TYPES — or the declaration moved and this ' +
        'mirror needs re-pointing. (A type whose `surfaces` no longer lists ' +
        '`json` reads as un-deprecated HERE and is still deprecated elsewhere; ' +
        'that is the objectui#4000 scope working, not a bug in this arm.)',
    ).toEqual([]);
  });

  it('no LOADED registration declares a deprecation this list omits', () => {
    // The direction the hand-kept mirror could never check before objectui#6674:
    // a third deprecated type added to `@object-ui/components` must join
    // DEPRECATED_TYPES or this arm goes red.
    //
    // Scoped honestly to what this file LOADS — `@object-ui/components`. A
    // plugin package's declaration is out of range here, which is the reason
    // DEPRECATED_TYPES stays the authority rather than being derived.
    //
    // Non-vacuity is the arm ABOVE: an empty result here would also be produced
    // by a registry that answered `undefined` for everything, and that state
    // turns the premise arm red first. The two hold each other up.
    const listed = new Set<string>(DEPRECATED_TYPES);
    // A namespaced registration answers under BOTH spellings (`ui:div` and
    // `div`); the corpus authors the bare one. Either spelling being listed
    // counts, and the raw key is what gets reported so the message names
    // something that exists in the registry.
    const bare = (key: string) => (key.includes(':') ? key.slice(key.indexOf(':') + 1) : key);
    const missing = ComponentRegistry.getKnownTypes()
      .filter((type) => ComponentRegistry.deprecationFor(type, CORPUS_SURFACE))
      .filter((type) => !listed.has(type) && !listed.has(bare(type)))
      .sort();

    expect(
      missing,
      'A loaded registration declares a json-surface deprecation that this ' +
        'gate does not refuse. Add it to DEPRECATED_TYPES so the corpus ' +
        'cannot start teaching it.',
    ).toEqual([]);
  });

  it('the exemption is not a hole, and not a leak', () => {
    const exempt = [...measured].filter(([rel]) => isDocExempt(rel));

    // Non-vacuity: an exemption covering no real fixture would be dead licence
    // sitting open for a future author to walk through. The documentation
    // category must really author the type it documents — 2 files / 5 `div`
    // nodes, as measured at every ref of the objectui#3965 arc.
    expect(
      exempt.reduce((n, [, c]) => n + total(c), 0),
      'the documentation category must really author the type it documents',
    ).toBe(5);
    expect(exempt.length, 'files inside the documentation exemption').toBe(2);
  });

  it('the detector actually detects — counter-probe', () => {
    // Fails on a walker that returns [] for everything, which is the failure
    // mode every arm above would read as green.
    const found = new Map<string, number>();
    countDeprecated(
      { type: 'stack', children: [{ type: 'div', children: [{ type: 'span' }] }, { type: 'card' }] },
      found,
    );
    expect(found.get('div')).toBe(1);
    expect(found.get('span')).toBe(1);

    const clean = new Map<string, number>();
    countDeprecated({ type: 'stack', children: [{ type: 'card' }] }, clean);
    expect(clean.size, 'and does not claim a type that is not deprecated').toBe(0);
  });
});
