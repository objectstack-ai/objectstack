/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `div` is deprecated on BOTH authoring surfaces, and the html tier REFUSES it
 * (objectui#10757).
 *
 * ## What this file used to pin, and why it no longer holds
 *
 * objectui#4000 (maintainer ruling, 2026-08-10) scoped the `div` deprecation by
 * PROVENANCE: nodes the `kind:'html'` parser emitted were exempt from the
 * notice, because the tag was treated as that tier's own vocabulary. This file
 * pinned the exemption, and objectui#6674 pinned the declaration to it
 * (`surfaces: ['json']`, `deprecationFor('div', 'html')` answering nothing).
 *
 * The maintainer's later ruling A on objectstack#20112 supersedes that for
 * `div`: the published manifest declares the html tier's intrinsic set, `div`
 * stays deprecated there, and `box` replaces it. The published gate therefore
 * refused a `<div>` page that the console compiled and rendered, so one page got
 * two answers. The ruling's point 3 also rules out the dev-only warning as the
 * vehicle: the renderer's retirement is a refusal.
 *
 * ## What it pins now, as one join
 *
 *   - the DECLARATION names both surfaces, and `deprecationFor('div', 'html')`
 *     answers it with the replacement naming `box`;
 *   - the html tier's COMPILE refuses the tag (both spellings), and the refusal
 *     names `box`: an error on the page, not a console notice;
 *   - the RENDERER no longer exempts a node carrying html-tier provenance.
 *
 * Moving any one of the three alone turns a case below red.
 *
 * ⛔ `span` keeps objectui#4000's provenance scope: the ruling names only `div`.
 * Its own pin (`span-deprecation-provenance.test.tsx`) is unchanged, and the
 * span case here is a CONTROL that the refusal did not sweep it in.
 *
 * NOTE ON ORDER — the warn-once guard from objectui#3965 is a module-level Set
 * that latches for the lifetime of this module instance, so only ONE `div`
 * notice can be observed per file, and the cases are ordered for it:
 *
 *   1. the refusal runs FIRST. A refused page renders no `div` node, so it
 *      cannot latch the guard, and "no notice" there is a fact about the
 *      refusal rather than about an earlier render.
 *   2. the provenance case then observes exactly one notice, which is only
 *      possible if nothing before it latched the Set.
 *
 * A JSON-authored node's notice is observed on a virgin Set by
 * `div-guidance-names-box.test.tsx` and `deprecation-guidance-agreement.test.tsx`
 * (each expects exactly one), so this file does not spend its one observation on
 * it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { compile, isHtmlTierNode, manifestFromConfigs } from '@object-ui/sdui-parser';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const DEPRECATION_RE = /The "div" component is deprecated/;

const DIV_REPLACEMENT =
  'author "box" for a plain wrapper — the one drop-in swap; reach for "card", "flex", "container", "stack" or "grid" only when you want their layout, and move `body` content into `children` first';

function deprecationCalls(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return spy.mock.calls.filter((args: unknown[]) => DEPRECATION_RE.test(String(args[0])));
}

/** Renders a `kind:'html'` page — source compiled by the console, then rendered. */
function renderHtmlPage(source: string) {
  return render(<SchemaRenderer schema={{ type: 'home', kind: 'html', name: 'test_page', source } as never} />);
}

/** The compile-error panel's entries, one string per reported error. */
function compileErrors(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '');
}

describe('div — deprecated on json AND html; the html tier refuses it (#10757)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // MUST run first: see the ordering note above.
  it('refuses `<div>` on a kind:\'html\' page with a compile error that names "box"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = renderHtmlPage(
      '<div className="outer"><div className="inner">hello html tier</div></div>',
    );

    // The page is refused, not rendered: the error panel is there and the
    // authored content is not.
    expect(container.textContent).toContain('HTML page failed to compile');
    expect(container.textContent).not.toContain('hello html tier');
    expect(container.querySelector('.outer')).toBeNull();

    // Every error is about the refused tag: nothing else about the page broke.
    // An unknown tag draws two diagnostics (the parser's `forbidden-tag` and
    // the validator's `unknown-component`), exactly as the published gate
    // reports it. The refusal names the declared replacement once per `<div>`
    // the source authored, so the author learns what to write instead.
    const errors = compileErrors(container);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((e) => !e.includes('<div>'))).toEqual([]);
    expect(errors.filter((e) => e.includes('"box"'))).toHaveLength(2);

    // It is a refusal on the page, not a dev-only console notice.
    expect(deprecationCalls(warn)).toHaveLength(0);
  });

  it('refuses the namespaced spelling `<ui:div>` the same way', () => {
    const { container } = renderHtmlPage('<ui:div className="outer">x</ui:div>');

    expect(container.textContent).toContain('HTML page failed to compile');
    const errors = compileErrors(container);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((e) => !e.includes('<ui:div>'))).toEqual([]);
    expect(errors.filter((e) => e.includes('"box"'))).toHaveLength(1);
  });

  it('compiles and renders the same page authored with `<box>` (control)', () => {
    // Control for the refusal above: the same shape with the replacement the
    // refusal names compiles and renders, so the red above is about `div`, not
    // about the page.
    const { container } = renderHtmlPage(
      '<box className="outer"><box className="inner">hello html tier</box></box>',
    );

    expect(container.textContent).not.toContain('failed to compile');
    expect(container.textContent).toContain('hello html tier');
    expect(container.querySelector('.outer')).toBeTruthy();
    expect(container.querySelector('.inner')).toBeTruthy();
  });

  it('leaves `span` alone: still not deprecated on html, still compiles there (control)', () => {
    expect(ComponentRegistry.deprecationFor('span', 'html')).toBeUndefined();

    const { container } = renderHtmlPage(
      '<box className="outer"><span className="inline">still vocabulary</span></box>',
    );
    expect(container.textContent).not.toContain('failed to compile');
    expect(container.querySelector('span.inline')).toBeTruthy();
  });

  it('reports a node carrying html-tier provenance: the renderer exemption is retired', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A host that compiles against its OWN whitelist can still admit `div`, and
    // the parser stamps what it emits. Produce such a node the real way,
    // through the parser, with a manifest built from the registry's own `div`
    // declarations.
    const hostManifest = manifestFromConfigs(
      ['div', 'ui:div'].map((type) => {
        const meta = ComponentRegistry.getMeta(type);
        return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      }) as never,
    );
    const compiled = compile('<div className="probe">x</div>', hostManifest);
    // Controls: the node really compiled, and really carries html provenance.
    // Without them, a notice here could come from a JSON-shaped node.
    expect(compiled.ok).toBe(true);
    expect(isHtmlTierNode(compiled.tree)).toBe(true);

    const { container } = render(<SchemaRenderer schema={compiled.tree as never} />);
    const el = container.querySelector('.probe') as HTMLElement | null;
    expect(el).toBeTruthy();

    // objectui#4000's exemption would have kept this at zero.
    const calls = deprecationCalls(warn);
    expect(calls).toHaveLength(1);
    const notice = String(calls[0][0]);
    // The guidance owned by objectui#6877, unchanged by this card.
    expect(notice).toContain('the drop-in swap is "box"');
    expect(notice).toContain('"card", "flex", "container", "stack", or "grid"');
    // The scope sentence names both surfaces, and the retired claim is gone.
    expect(notice).toMatch(/JSON-authored/);
    expect(notice).toMatch(/kind:'html'/);
    expect(notice).not.toContain('compiled straight through');

    // Provenance still stays off the DOM: the marker rides on the node object,
    // and a string-keyed marker would have been spread onto the host element.
    const attrs = Array.from(el!.attributes).map((a) => a.name);
    expect(attrs.filter((n) => n.includes('provenance') || n.includes('tier'))).toHaveLength(0);
  });

  it('does not re-report on a later render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<SchemaRenderer schema={{ type: 'div', className: 'later' } as never} />);

    expect(deprecationCalls(warn)).toHaveLength(0);
  });

  it('DECLARES the answer — deprecated on json and on html, with the replacement naming "box"', () => {
    const declared = { surfaces: ['json', 'html'], replacement: DIV_REPLACEMENT };

    // The html surface now answers, which is what the compile's whitelist reads.
    expect(ComponentRegistry.deprecationFor('div', 'html')).toEqual(declared);
    expect(ComponentRegistry.deprecationFor('div', 'json')).toEqual(declared);
    expect(DIV_REPLACEMENT).toContain('"box"');

    // The bare and namespaced spellings answer alike, because a page authors
    // whichever it likes and the whitelist must not have to know which.
    expect(ComponentRegistry.deprecationFor('ui:div', 'html')).toEqual(declared);
  });
});
