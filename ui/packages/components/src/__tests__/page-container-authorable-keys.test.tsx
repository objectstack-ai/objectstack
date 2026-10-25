/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `page:*` container registrations publish the composition slot the
 * contract declares — and stop publishing the one it retired (objectui#4027).
 *
 * `inputs` is not documentation, it is the published AUTHORING surface: the
 * Studio block designer builds its panel from it, `sdui-parser`'s
 * `gen-manifest.ts` serializes it into `sdui.manifest.json` (the save gate and
 * parser whitelist) and into `sdui-intrinsics.d.ts`, and `page.tsx:462` builds
 * the JSX-page prop whitelist from it. Whatever it lists is what an author —
 * an AI author above all — is TOLD is legal.
 *
 * Two drifts, opposite directions, both closed here:
 *
 *   RETIRED KEY STILL OFFERED. `page:card` published `{ name: 'body', type:
 *   'slot' }`. objectstack#5775 (PR objectstack#6281, merged 2026-08-07,
 *   ADR-0087 D2) retired `PageCardProps.body` and declared `children` in its
 *   place — one composition slot, one spelling, the same one `grid`, `flex`,
 *   `page:section` and `page:tabs` items already use. The designer was teaching
 *   a key the contract now rejects by name.
 *
 *   DECLARED SLOT NOT OFFERED AT ALL. `page:section` / `page:footer` /
 *   `page:sidebar` registered with no `inputs` whatsoever, so the designer could
 *   not authorize the child list that is the entire point of those three
 *   components. The same PR gave all three the shared `PageContainerProps`,
 *   whose one key is `children`.
 *
 * WHY THESE ASSERTIONS ARE LITERAL AND NOT DERIVED FROM `@objectstack/spec`.
 * The sibling gate `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`
 * derives its expectations from `ComponentPropsMap` at runtime, which is the
 * right shape for a repo-wide gate — but this repo pins
 * `@objectstack/spec@^17.0.0-rc.5`, and rc.5 PREDATES #6281: its `PageCardProps`
 * still lists `body` and has no `children`, and the three containers are still
 * `EmptyProps`. A spec-derived assertion here would therefore pin the STALE
 * contract and fail the change that follows the merged one. The parity gate
 * absorbs that with stale-pin exemptions that name this issue and delete
 * themselves when the pin moves; this file states the merged contract directly.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window),
// and it makes the registry state this file asserts on explicit rather than
// inherited from a setup file.
import '../index';

const inputsOf = (type: string) => {
  const config = ComponentRegistry.getConfig(type);
  if (!config) throw new Error(`\`${type}\` is not registered`);
  return config.inputs ?? [];
};

const inputNamesOf = (type: string): string[] => inputsOf(type).map((i) => i.name);

const THIN_CONTAINERS = ['page:section', 'page:footer', 'page:sidebar'] as const;

describe('page:card publishes `children`, never the retired `body` (objectui#4027)', () => {
  it('does not offer `body` as an authorable slot', () => {
    // The direction this issue is named for. `body` is retired upstream; a
    // designer offering it produces metadata the spec rejects by name.
    expect(inputNamesOf('page:card')).not.toContain('body');
  });

  it('offers `children` as the card content slot', () => {
    const children = inputsOf('page:card').find((i) => i.name === 'children');
    expect(children, '`page:card` does not declare `children`').toBeTruthy();
    // `slot` rather than `array`: it is a composition target the designer drops
    // blocks into, and `codegen.ts:emitInterface` filters `slot` inputs out of
    // the generated `.d.ts` where `SduiBaseProps.children` already types it.
    expect(children?.type).toBe('slot');
  });

  it('leaves the card\'s other slots and props alone', () => {
    // Scope guard: this change respells ONE slot. `footer` is a genuinely
    // distinct slot and the spec keeps it; `title` / `bordered` are untouched.
    expect(inputNamesOf('page:card')).toEqual(['title', 'bordered', 'children', 'footer']);
  });
});

describe('the thin containers publish the `children` slot they render (objectui#4027)', () => {
  it.each(THIN_CONTAINERS)('%s declares exactly one input: `children`', (type) => {
    expect(inputNamesOf(type)).toEqual(['children']);
    expect(inputsOf(type)[0].type).toBe('slot');
  });

  it.each(THIN_CONTAINERS)('%s is still a layout container', (type) => {
    // Two independent facts, and since objectui#9910 the `children` slot in
    // `inputs` carries BOTH the designer's offer and the containment the tier
    // reads (`sdui-parser`'s `not-a-container` reads only that input). The
    // flag is the other fact — LAYOUT containment (objectui#6804): the
    // react-page JSX scope skips these three and the public layout ledger
    // lists them — and it stays declared because they are layout regions.
    expect(ComponentRegistry.getConfig(type)?.isContainer).toBe(true);
  });

  it('shares one declaration across all three, as the spec shares one `PageContainerProps`', () => {
    // Not a style point: three copied literals are three places for the
    // contract to drift, which is exactly why the spec declares them once.
    const [section, footer, sidebar] = THIN_CONTAINERS.map((t) => inputsOf(t));
    expect(section).toBe(footer);
    expect(section).toBe(sidebar);
  });
});

describe('the renderers keep READING `body` — a back-compat read is not an authorable key', () => {
  // The sequencing guard, and the reason removing the declaration was safe on
  // its own. Documents stored against the old contract still carry `body`, and
  // the ADR-0087 D2 conversion that rewrites `body` → `children` runs upstream
  // at load time. Deleting the READ here — the obvious "finish the job" move —
  // would blank an existing card's content silently, which is the least
  // reportable failure there is. Same shape as the `page-header-subtitle-alias`
  // sequencing pinned in `packages/layout`: narrow the DECLARATION now, delete
  // the READ only when the conversion is live.
  const renderCard = (schema: Record<string, unknown>) => {
    const Component = ComponentRegistry.get('page:card');
    if (!Component) throw new Error('page:card not registered');
    return render(<Component schema={{ type: 'page:card', ...schema }} />);
  };

  it('renders a stored `body` on page:card', () => {
    renderCard({ body: [{ type: 'text', content: 'Stored under the retired key' }] });
    expect(screen.getByText('Stored under the retired key')).toBeTruthy();
  });

  it('renders the canonical `children` on page:card', () => {
    renderCard({ children: [{ type: 'text', content: 'Authored under the canonical key' }] });
    expect(screen.getByText('Authored under the canonical key')).toBeTruthy();
  });

  it.each(THIN_CONTAINERS)('%s renders both spellings', (type) => {
    const Component = ComponentRegistry.get(type);
    if (!Component) throw new Error(`${type} not registered`);
    const { unmount } = render(
      <Component schema={{ type, children: [{ type: 'text', content: `${type} canonical` }] }} />,
    );
    expect(screen.getByText(`${type} canonical`)).toBeTruthy();
    unmount();

    render(<Component schema={{ type, body: [{ type: 'text', content: `${type} legacy` }] }} />);
    expect(screen.getByText(`${type} legacy`)).toBeTruthy();
  });
});
