/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `ui` layout primitives DECLARE the containment they render (objectui#6740).
 *
 * `flex` renders `schema.children` and always has, but its registration omitted
 * `isContainer` while `grid`, `card`, `container` and `stack` — same directory,
 * same namespace — all declared it. The render path never reads the flag, so
 * nothing was broken at runtime; the consumers are elsewhere, and the gap made
 * them contradict the renderer.
 *
 * MEASURED on b76ca6764, through the mechanism rather than the property: the
 * manifest built the way the app builds it, with a `flex` node carrying children
 * put through `validateTree`, returned `["not-a-container"]`, while `grid` /
 * `card` / `container` under the identical probe returned `[]`. Downstream,
 * objectstack's three shipped `examples/app-showcase` html pages drew 232
 * diagnostics of which 32 were warnings — every one of them `not-a-container` on
 * `flex`, and `flex` the only source of them.
 *
 * WHY THIS FILE PINS FOUR COMPONENTS AND NOT ONE. The defect's shape is "three
 * declare it and one does not". A pin covering only `flex` would let the next
 * registration rot exactly the same way and stay green while it did, so the
 * assertion is over the family. `stack` rides along for the same reason.
 *
 * WHY THROUGH `validateTree` AND NOT `getConfig(t).isContainer`. The property is
 * only interesting because a mechanism reads it; asserting the literal would
 * stay green if the containment check were removed, mis-keyed, or fed a manifest
 * the tag is missing from — the three ways this fact dies without anyone
 * noticing. The reachability controls below exist for the same reason.
 *
 * RE-POINTED BY objectui#9910 (2026-09-24). What `validateTree` reads is no
 * longer the flag but the declared `children` slot input (`acceptsChildren`);
 * the four declare both. The flag keeps its OTHER consumer — the react-page
 * JSX scope skips containers — which is what the second describe still pins,
 * and the childless control moved from `badge` (which now declares the slot it
 * renders as a label fallback) to `tabs` (renders `items[].content`, never
 * `schema.children`).
 */

import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx } from '@object-ui/react';
import { CHILD_LIST_KEY, manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window).
import '../renderers';

const CONTAINMENT = 'not-a-container';

/** The four `ui` layout registrations whose whole job is to hold children. */
const LAYOUT_CONTAINERS = ['flex', 'grid', 'card', 'container'] as const;

/**
 * The manifest the running app validates against, built the way the app builds
 * it — keyed by every KNOWN registry tag rather than by `getAllConfigs()`, whose
 * `.type` is always the namespaced form. Mirrors `getJsxManifest()` in
 * `renderers/layout/page.tsx:462` (module-private, hence the four lines here).
 * Key it off `getAllConfigs()` instead and the bare `flex` tag authors write is
 * absent from the manifest, so every assertion below would pass on
 * `unknown-component` without ever reaching the containment check.
 */
const diagnose = (schema: unknown): Diagnostic[] => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  const manifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
  return validateTree(schema as SchemaElement, manifest).diagnostics;
};

const withChildren = (type: string) => ({
  type,
  children: [{ type: 'text', content: 'child' }],
});

describe('the ui layout primitives accept children without warning (objectui#6740)', () => {
  it.each(LAYOUT_CONTAINERS)('`%s` with children draws no `not-a-container`', (type) => {
    const diagnostics = diagnose(withChildren(type));

    // Reachability BEFORE absence — an empty result proves nothing if the
    // containment branch never ran. Two ways it silently would not: an
    // unresolved tag reports `unknown-component` and never reaches the check,
    // and the branch is guarded by `node.children?.length`.
    expect(diagnostics.filter((d) => d.code === 'unknown-component')).toEqual([]);
    expect(withChildren(type).children.length).toBeGreaterThan(0);

    // Filtered by code, not against an empty list: this file owns the
    // CONTAINMENT fact only, so a future diagnostic on some other key belongs
    // to that key's pin rather than here.
    expect(diagnostics.filter((d) => d.code === CONTAINMENT)).toEqual([]);
  });

  it.each(LAYOUT_CONTAINERS)('`%s` declares the `children` slot the tier reads (objectui#9910)', (type) => {
    // The declaration behind the silence above, asserted by name so the
    // absence of a diagnostic cannot pass on a fallback: `validateTree` reads
    // this input and nothing else.
    const inputs = ComponentRegistry.getMeta(type)?.inputs ?? [];
    expect(inputs.find((i) => i.name === CHILD_LIST_KEY)?.type).toBe('slot');
  });

  it('still reports `not-a-container` for a component that genuinely takes none', () => {
    // The control that keeps every assertion above meaningful. Without it the
    // suite would stay green if the containment check were deleted outright, or
    // if every registration declared the slot — either of which turns this file
    // into a measurement of nothing. `tabs` renders `items[].content` and never
    // reads `schema.children`, so children under it ARE an authoring mistake the
    // author must still hear about. (`badge` held this role until objectui#9910,
    // when it declared the slot it renders as its label fallback.)
    //
    // If `tabs` ever legitimately reads `children`, this goes red — move the
    // control to another childless registration rather than deleting it.
    const codes = diagnose(withChildren('tabs')).map((d) => d.code);
    expect(codes).toContain(CONTAINMENT);
    expect((ComponentRegistry.getMeta('tabs')?.inputs ?? []).some((i) => i.name === CHILD_LIST_KEY)).toBe(false);
  });
});

describe('the declaration reaches the consumers that read it (objectui#6740)', () => {
  it.each(LAYOUT_CONTAINERS)('`%s` reports as a container on the public tier', (type) => {
    // The flag's consumer, and the reason it is pinned rather than left
    // implicit: `renderers/layout/react-page.tsx` builds the JSX scope of
    // every `kind:'react'` page with `if (!tag || cfg.isContainer || cfg.tier === 'html') continue;`,
    // reading THIS predicate off `getPublicConfigs()` — not off `getMeta()`.
    // Since objectui#9910 this is the flag's ONE meaning — layout containment —
    // so this block is about the react-page scope, not about `validateTree`.
    // While `flex` omitted the flag it was the one layout primitive of the five
    // still injected there, contradicting
    // `content/docs/guide/react-pages.md` ("Layout containers are deliberately
    // not injected … `<flex>`, `<grid>`, `<card>` and friends have no injected
    // wrapper"). Declaring it lines `flex` up with its four siblings.
    const cfg = ComponentRegistry.getPublicConfigs().find((c: { type: string }) => c.type === type);
    expect(cfg, `\`${type}\` is not in the public tier`).toBeTruthy();
    expect((cfg as { isContainer?: boolean }).isContainer).toBe(true);
  });

  it('leaf blocks stay injectable into a react page — containers are the only ones dropped', () => {
    // The direction control for the assertion above. If this were empty or all
    // falsy, "containers are excluded" would be indistinguishable from
    // "everything is excluded", and the pin would be measuring the wrong fact.
    for (const leaf of ['badge', 'button', 'image', 'icon']) {
      const cfg = ComponentRegistry.getPublicConfigs().find((c: { type: string }) => c.type === leaf);
      expect(cfg, `\`${leaf}\` is not in the public tier`).toBeTruthy();
      expect((cfg as { isContainer?: boolean }).isContainer).toBeFalsy();
    }
  });
});

describe('flex still renders its children (objectui#6740)', () => {
  it('renders children through the real SchemaRenderer, as it always did', async () => {
    // The scope guard for acceptance "nothing else about flex changes". The
    // render path does not consult `isContainer` — `SchemaRenderer` passes the
    // whole node as `schema` and `flex` re-reads `schema.children` itself —
    // so declaring the flag must leave this untouched.
    const { container } = render(
      <AdapterCtx.Provider value={null as never}>
        <SchemaRenderer
          schema={{
            type: 'flex',
            direction: 'col',
            children: [{ type: 'badge', label: 'kept' }],
          } as never}
        />
      </AdapterCtx.Provider>,
    );

    await waitFor(() => expect(container.querySelector('[data-obj-type="flex"]')).toBeTruthy());
    const root = container.querySelector('[data-obj-type="flex"]');
    expect(root?.className).toContain('flex-col');
    expect(container.textContent).toContain('kept');
  });
});
