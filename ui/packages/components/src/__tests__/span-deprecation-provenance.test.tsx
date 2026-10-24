/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `span` deprecation notice is scoped BY PROVENANCE (objectui#4917,
 * applying the ruling made for `div` in objectui#4000).
 *
 * A `kind:'html'` page is authored as constrained JSX text that our own
 * parser compiles (never executes) into SDUI nodes, tag name straight through.
 * So an author writing the plain inline tag in that tier gets a node the
 * DEPRECATED renderer serves — and the notice fired at them, recommending
 * `badge` / `text`, neither of which is an html-tier tag. Nothing the author
 * could write made it stop: in that tier the tag IS the tier's own vocabulary,
 * and `basic/html-elements.tsx` deliberately leaves it out of its own TAGS list
 * precisely because this module registers it. A notice nobody can act on is not
 * a deprecation, it is noise, and it also meant the type could never be retired
 * — the engine's own compiler keeps emitting it.
 *
 * Maintainer ruling (2026-08-10, on objectui#4000): split the notice by
 * provenance. Nodes the html tier's parser emitted are exempt; JSON-authored
 * nodes keep being reported, unchanged.
 *
 * NOTE ON ORDER — the warn-once guard from objectui#3965 is a module-level Set
 * that latches for the lifetime of this module instance, so the cases below are
 * ordered deliberately and each depends on the one before:
 *
 *   1. the html-tier case runs FIRST, against a virgin Set. "No notice" here
 *      therefore cannot be explained away by an earlier render having latched
 *      the guard — there was no earlier render.
 *   2. the authored case then observes exactly one notice, which is only
 *      possible if case 1 left the Set virgin. The two cases pin each other:
 *      an exemption that silently marked the guard would show up as a ZERO in
 *      case 2, not as a pass.
 *
 * NOTE ON THE RENDER CONTROL — this deliberately does NOT copy the sibling
 * `div` test's control assertion. That test proves the html page really
 * rendered by reading the box tag's own text back out. When this file was
 * written the inline tag's text never arrived, because the renderer read
 * `schema.body` while the parser emits `children` — filed separately as
 * objectui#5027, since it was a rendering-path defect rather than a
 * notice-scoping one and needed its own ruling on which key is canonical. The
 * control here therefore uses a sibling paragraph's text plus the presence of
 * the inline element itself: together they prove the page compiled AND that the
 * node reached this deprecated renderer, so silence is an exemption rather than
 * a missing node.
 *
 * objectui#5027 has since been fixed (the renderer reads `children`), and both
 * assertions hold unchanged, as predicted here. They are deliberately left as
 * they are: what this file is about is WHO gets told, and the inline tag's own
 * text is now pinned where it belongs, in
 * `__tests__/span-children-rendering.test.tsx`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const DEPRECATION_RE = /The "span" component is deprecated/;

function deprecationCalls(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return spy.mock.calls.filter((args: unknown[]) => DEPRECATION_RE.test(String(args[0])));
}

/** Renders a `kind:'html'` page — source compiled by the parser, then rendered. */
function renderHtmlPage(source: string) {
  return render(<SchemaRenderer schema={{ type: 'home', kind: 'html', name: 'test_page', source } as never} />);
}

describe('span deprecation notice — scoped by provenance (#4917)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // MUST run first: see the ordering note above.
  it('stays silent for nodes the html tier compiled from its own source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = renderHtmlPage(
      '<box className="outer"><span className="inner">hello html tier</span><p>page rendered</p></box>',
    );

    // Control FIRST: silence proves nothing if the page never rendered. A
    // compile error replaces the whole page with an error panel, which would
    // produce zero notices for entirely the wrong reason. See the note above on
    // why the inline tag's own text is not what is read back here.
    expect(container.textContent).not.toContain('failed to compile');
    expect(container.textContent).toContain('page rendered');
    // …and the inline node really did reach THIS renderer: the element exists,
    // carrying the class the html source authored.
    expect(container.querySelector('span.inner')).toBeTruthy();

    expect(deprecationCalls(warn)).toHaveLength(0);
  });

  it('still reports a JSON-authored node, exactly once, and says which surface it means', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = render(
      <SchemaRenderer
        schema={{
          type: 'span',
          className: 'authored',
          // Canonical child key (objectui#5027) — this used to spell `body`.
          // The inner node has to really render for the assertions below to
          // mean anything: it is the second `span` whose absence would let the
          // "exactly once" count pass without the guard doing any work.
          children: [{ type: 'span', className: 'authored-inner' }],
        } as never}
      />,
    );

    // Same control on this side: the nodes have to have actually rendered.
    expect(container.querySelector('.authored')).toBeTruthy();
    expect(container.querySelector('.authored-inner')).toBeTruthy();

    const calls = deprecationCalls(warn);
    expect(calls).toHaveLength(1);
    const notice = String(calls[0][0]);
    // The migration guidance is untouched — this issue narrows WHO is told, it
    // does not water down WHAT they are told.
    expect(notice).toContain('use "badge" component');
    expect(notice).toContain('use "text" component with appropriate className');
    // …and the notice now names the surface it applies to. A notice that says
    // the type is deprecated FULL STOP is false the moment another tier keeps
    // it as permanent vocabulary; whoever reads the console has to be able to
    // tell which of their pages it is about.
    expect(notice).toMatch(/JSON-authored/);
    expect(notice).toMatch(/html/);
  });

  it('does not re-report an authored node on a later render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<SchemaRenderer schema={{ type: 'span', className: 'later' } as never} />);

    expect(deprecationCalls(warn)).toHaveLength(0);
  });

  it('keeps provenance off the DOM and out of the serialized node', () => {
    // The marker rides on the node object, so it must not reach the element or
    // survive serialization. A string-keyed marker would have been spread onto
    // the host element as an unknown attribute, and would have been copied into
    // any persisted form of the tree — where an authored page could replay it
    // and silence the notice for itself.
    const { container } = renderHtmlPage('<span className="probe">x</span>');
    const el = container.querySelector('span.probe') as HTMLElement | null;
    expect(el).toBeTruthy();
    const attrs = Array.from(el!.attributes).map((a) => a.name);
    expect(attrs.filter((n) => n.includes('provenance') || n.includes('tier'))).toHaveLength(0);
  });

  /**
   * objectui#6674 — the same scope, DECLARED. objectui#4917 brought this
   * renderer level with `div` because the two then carried the same ruling.
   * They no longer do: objectui#10757 declared `div` deprecated on both
   * surfaces (its sibling case in `div-deprecation-provenance.test.tsx` pins
   * that), while `span` keeps objectui#4000's json-only scope, which this case
   * pins.
   *
   * The runtime exemption above and the declaration below are the same fact.
   * Moving either alone turns this red.
   */
  it('DECLARES the scope those cases demonstrate — deprecated on json, not on html', () => {
    expect(ComponentRegistry.deprecationFor('span', 'json')).toEqual({
      surfaces: ['json'],
      replacement:
        'use "badge" for labels, or "text" with a className for inline emphasis',
    });

    expect(ComponentRegistry.deprecationFor('span', 'html')).toBeUndefined();
    expect(ComponentRegistry.deprecationFor('ui:span', 'json')).toBeDefined();
  });
});
