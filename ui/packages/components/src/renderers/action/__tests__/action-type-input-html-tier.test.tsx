/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7415 — the acceptance reading for renaming `action:button` /
 * `action:icon`'s declared `type` input to `actionType` (objectstack#14490,
 * maintainer 2026-09-02, ruling A).
 *
 * ## Why this row exists on the html tier specifically
 *
 * The old input name was unauthorable HERE and only here it is provable in one
 * hop. `parse.ts` used to compose a node as `{ type: tag, ...props }` — props
 * spread LAST — so an authored `type="api"` did not set an input, it REPLACED
 * the component discriminator and the node stopped resolving to a component at
 * all. `validate.ts` could not report that either: `type` is in `BASE_PROPS`,
 * so it is skipped before the declared-input check ever runs. Two mechanisms,
 * one outcome, no diagnostic — which is the whole reason the collision was
 * removed at the source instead of being special-cased per tier.
 *
 * ⚠️ UPDATED by objectui#7235: the parser now REFUSES a `type` attribute on
 * this tier outright (`forbidden-attr`, one diagnostic naming both the tag and
 * the attribute) and composes `{ ...props, type: tag }`. Row 3 below still
 * fails to compile and still renders no button, but for the ruled reason
 * instead of the accidental one, and it now asserts WHICH diagnostic — without
 * that it would go on passing while measuring nothing.
 *
 * The renamed input has no such problem: `actionType` is an ordinary declared
 * prop, so it survives the spread, validates against the manifest built from
 * the registry `inputs`, and reaches the renderer on the node.
 *
 * ## The rows, and what makes each a reading
 *
 * 1. AUTHORED — a page that sets `actionType="api"` compiles (no error panel),
 *    renders a real button, and on click hands `ActionRunner` `type: 'api'`.
 * 2. NEGATIVE CONTROL — the same page with the prop REMOVED still compiles and
 *    still renders, and the `api` handler is NOT reached. Without this row, row
 *    1's `'api'` could equally have come from a default, from the tag, or from
 *    the handler being the only one registered; with it, the value is pinned to
 *    the authored prop.
 * 3. NO ALIAS — the pre-rename spelling `type="api"` does not resurrect the old
 *    behaviour. Since objectui#7235 the attribute is REFUSED at parse, so the
 *    page reports `forbidden-attr` naming the attribute and no button is
 *    rendered. (Before that port it was the discriminator, and the page
 *    reported `unknown-component` naming the VALUE.) Either way it states the
 *    cost the ruling accepted by name: no alias, no transition window.
 * 4. THE DECLARATION — rows 1-3 are about the RENDERER, and every one of them
 *    was green before this change too: the renderer already read `actionType`
 *    first (`action:bar`'s member spread has always used it), and an undeclared
 *    prop is only a `unknown-prop` WARNING, which does not stop a page
 *    compiling. So they cannot, on their own, measure the rename. The last row
 *    can: it puts the two spellings through the manifest built from the live
 *    registry `inputs` — the same call `getJsxManifest()` makes — and asserts
 *    `actionType` is DECLARED (no diagnostic) while `type` and a bogus prop are
 *    not. That is the assertion that is red on `origin/main` and green here,
 *    and it is what the objectstack `sdui.manifest.json` pin will follow.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { SchemaRenderer } from '@object-ui/react';
import { compile, manifestFromConfigs } from '@object-ui/sdui-parser';
// Module-scope side-effect import so `page` (the kind:'html' host) and the two
// action renderers are registered before the first render — the light `dom`
// project does not load the `@object-ui/components` barrel for us, and
// `getJsxManifest()` reads the live registry. Module scope, not a `beforeAll`,
// per AGENTS.md 测试纪律.
import '../../../renderers';

let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
});

/** Render `source` as a real `kind:'html'` page, exactly as PageRenderer does. */
function renderHtmlPage(source: string) {
  return render(
    <ActionProvider handlers={{ api }} onToast={vi.fn()}>
      <SchemaRenderer schema={{ type: 'home', kind: 'html', name: 'acceptance_page', source } as never} />
    </ActionProvider>,
  );
}

const TARGET = '/api/v1/tasks/mark_done';

describe('objectui#7415 — action:button authors its execution type on the html tier', () => {
  it('an html-tier page setting the renamed input parses, renders and dispatches it', async () => {
    renderHtmlPage(
      `<action:button label="Mark done" actionType="api" target="${TARGET}" />`,
    );

    // Parsed: a compile error renders the panel instead of the tree.
    expect(screen.queryByText(/failed to compile/i)).not.toBeInTheDocument();
    // Rendered: a real button, not a fallback or an empty node.
    const button = await screen.findByRole('button', { name: 'Mark done' });

    fireEvent.click(button);

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[0][0].type).toBe('api');
    expect(api.mock.calls[0][0].target).toBe(TARGET);
  });

  it('negative control — the same page without the prop renders but dispatches no api action', async () => {
    renderHtmlPage(`<action:button label="Mark done" target="${TARGET}" />`);

    expect(screen.queryByText(/failed to compile/i)).not.toBeInTheDocument();
    const button = await screen.findByRole('button', { name: 'Mark done' });

    fireEvent.click(button);

    // Settle the click before reading the zero, so this is about WHICH type
    // resolved and never about async timing.
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(api).not.toHaveBeenCalled();
  });

  it('the renamed input is DECLARED — the manifest accepts `actionType` and nothing else', () => {
    // The manifest `getJsxManifest()` builds, built the same way from the same
    // live registry, so this reads the shipped declaration rather than a copy of
    // it. `unknown-prop` is the diagnostic `validate.ts` raises for a prop no
    // `inputs` entry claims.
    const manifest = manifestFromConfigs(
      ComponentRegistry.getKnownTypes().map((t) => {
        const meta = ComponentRegistry.getMeta(t);
        return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      }) as unknown as Parameters<typeof manifestFromConfigs>[0],
    );
    const unknownProps = (source: string) =>
      compile(source, manifest)
        .diagnostics.filter((d) => d.code === 'unknown-prop')
        .map((d) => d.message);

    // DECLARED: the renamed input passes the manifest clean…
    expect(unknownProps(`<action:button label="Mark done" actionType="api" />`)).toEqual([]);
    expect(unknownProps(`<action:icon label="Mark done" actionType="api" />`)).toEqual([]);
    // …and the CONTROL that keeps that zero from being vacuous: a prop the
    // component genuinely does not declare is reported, on the same call.
    expect(unknownProps(`<action:button label="Mark done" bogusProp="api" />`)).toEqual([
      '<action:button> has no prop "bogusProp"',
    ]);

    // And the declaration itself, read straight off the registry: one spelling,
    // not two. A re-added `type` input would fail HERE even if every renderer
    // row above stayed green.
    for (const type of ['action:button', 'action:icon']) {
      const names = (ComponentRegistry.getMeta(type)?.inputs ?? []).map((i) => i.name);
      expect(names, `${type} inputs`).toContain('actionType');
      expect(names, `${type} still declares the colliding spelling`).not.toContain('type');
    }
  });

  it('no alias — the pre-rename `type` spelling is still the discriminator, not an input', async () => {
    renderHtmlPage(`<action:button label="Mark done" type="api" target="${TARGET}" />`);

    // objectui#7235: the attribute is refused at parse, so the panel names the
    // ATTRIBUTE rather than the value. Asserting the panel alone would keep
    // passing on the old `unknown-component` reading too, which is exactly the
    // misdirection that port removed — so the message is read, not just the
    // fact that compilation failed.
    expect(await screen.findByText(/failed to compile/i)).toBeInTheDocument();
    expect(screen.getByText(/Attribute "type" is not allowed on <action:button>/)).toBeInTheDocument();
    expect(screen.queryByText(/unknown component/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });
});
