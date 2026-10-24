/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10485 — an authored `hideEmpty` on a `detail-section` node
 * VALIDATES and REACHES `DetailSection`.
 *
 * ## The gap
 *
 * `DetailSection` reads `section.hideEmpty === true` (the all-empty hide that
 * objectui#8603 restored), but the `detail-section` registration did not
 * declare `hideEmpty` among its `inputs`, and `DetailSectionNode` folds only
 * the declared names into the `section` it hands the component. So an author
 * who wrote `hideEmpty` on the node met both halves of one gap — the same two
 * halves objectui#9529 closed for `icon`:
 *
 *  - the JSX-page compiler's validator (a manifest built from
 *    `getKnownTypes()` plus these `inputs`, the way
 *    `packages/components/src/renderers/layout/page.tsx` builds it) warned
 *    `unknown-prop "hideEmpty"`, steering the author away from a key the
 *    renderer honours; and
 *  - the fold passed `hideEmpty` on as a host prop, which `DetailSection`
 *    ignores, so an all-empty section still drew its heading and skeleton.
 *
 * The triage on the card reuses objectui#9529's ruling (declare a key the
 * renderer already honours) and asks for the node's OMITTED default to be
 * stated. On this node it is one value: nothing on the node's path resolves a
 * default (`record:details` resolves `?? true` on its OWN authored sections,
 * which never pass through this node), and `DetailSection` tests `=== true`,
 * so an omitted key keeps the all-empty section. The declaration states that;
 * it does not change it.
 *
 * ## What each row reads, and why it is a verdict
 *
 * - VALIDATES — the node with an authored `hideEmpty` of either polarity draws
 *   ZERO diagnostics from the live manifest. The declared TYPE is read through
 *   the same judge: a non-boolean `hideEmpty` draws `type-mismatch` naming the
 *   key, which only a declared `boolean` input can produce (an undeclared key
 *   draws `unknown-prop` instead).
 * - THE CONTROL IS LIT — `hideIfEmpty`, a near-miss this block neither
 *   declares nor reads, still draws `unknown-prop` from the same manifest in
 *   the same run. A silenced validator would pass the rows above vacuously; it
 *   cannot pass this one. (It was `name` until objectui#11044 made `name` a
 *   base prop wherever a type does not declare it.)
 * - REACHES `DetailSection` — measured in the DOM through the real
 *   `SchemaRenderer` and the real registry, over a record on which every field
 *   of the section is empty. `true` hides the section: no heading, no
 *   skeleton. A sibling node in the SAME render, identical but for the key,
 *   draws its heading and its placeholder, so the absence is a decision about
 *   `hideEmpty` and not an artefact of the fixture. `false` and an omitted key
 *   both keep the heading and the placeholder — the node's declared default.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';

// Module scope, not a hook (the test-discipline section of AGENTS.md):
// importing the package index executes its registration side-effects, so the
// entry under test is the very one production resolves.
import '../index';

const TAG = 'detail-section';
const TITLE = 'Billing Address';
const CONTROL_TITLE = 'Shipping Address';

/** A minimal authored node: the one required input plus a title to anchor on. */
const authoredNode = (overrides: Record<string, unknown> = {}, title = TITLE) =>
  ({
    type: TAG,
    title,
    fields: [{ name: 'street', label: 'Street' }],
    ...overrides,
  }) as never;

/** A record on which every field of the section above is empty. */
const EMPTY_RECORD = {};

/** Built the way `page.tsx` builds the JSX-page compiler's manifest. */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return {
        type,
        namespace: meta?.namespace,
        isContainer: meta?.isContainer,
        inputs: meta?.inputs,
      };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const diagnose = (overrides: Record<string, unknown>) =>
  validateTree(authoredNode(overrides), liveManifest()).diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
  }));

/** The empty-value placeholder `DetailSection` draws for a field with no value. */
const placeholdersIn = (heading: HTMLElement | null) => {
  const card = heading?.closest('.bg-card') ?? null;
  return card ? card.querySelectorAll('[title="No value"]').length : 0;
};

/**
 * Renders the node under test beside a CONTROL node that is identical except
 * for its title and for carrying no `hideEmpty`, over the same all-empty record.
 */
const renderBesideControl = (overrides: Record<string, unknown>) =>
  render(
    <>
      <SchemaRenderer schema={authoredNode(overrides)} data={EMPTY_RECORD} />
      <SchemaRenderer schema={authoredNode({}, CONTROL_TITLE)} data={EMPTY_RECORD} />
    </>,
  );

afterEach(() => {
  cleanup();
});

describe('objectui#10485 — an authored detail-section hideEmpty validates', () => {
  it('draws no diagnostic for an authored boolean hideEmpty, in either polarity', () => {
    expect(diagnose({ hideEmpty: true })).toEqual([]);
    expect(diagnose({ hideEmpty: false })).toEqual([]);
  });

  it('judges the authored hideEmpty as a declared BOOLEAN input', () => {
    const found = diagnose({ hideEmpty: 'yes' });
    expect(found.map((d) => d.code)).toEqual(['type-mismatch']);
    expect(found[0].message).toContain('"hideEmpty"');
  });

  it('CONTROL: still warns on hideIfEmpty, which the block neither declares nor reads', () => {
    const found = diagnose({ hideIfEmpty: true });
    expect(found.map((d) => d.code)).toEqual(['unknown-prop']);
    expect(found[0].message).toContain('"hideIfEmpty"');
  });
});

describe('objectui#10485 — an authored detail-section hideEmpty reaches DetailSection', () => {
  it('`hideEmpty: true` hides an all-empty section: no heading, no skeleton', () => {
    renderBesideControl({ hideEmpty: true });

    // The lit control: the same all-empty section, without the key, in the
    // same render, draws its heading and its placeholder.
    const control = screen.getByText(CONTROL_TITLE);
    expect(placeholdersIn(control)).toBe(1);

    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getAllByTitle('No value')).toHaveLength(1);
  });

  it('`hideEmpty: false` keeps the heading and the label skeleton of an all-empty section', () => {
    renderBesideControl({ hideEmpty: false });

    expect(placeholdersIn(screen.getByText(TITLE))).toBe(1);
    expect(placeholdersIn(screen.getByText(CONTROL_TITLE))).toBe(1);
  });

  it('an OMITTED hideEmpty keeps the all-empty section too: the node declares no hide by default', () => {
    render(<SchemaRenderer schema={authoredNode()} data={EMPTY_RECORD} />);

    expect(screen.getByText('Street')).toBeTruthy();
    expect(placeholdersIn(screen.getByText(TITLE))).toBe(1);
  });
});
