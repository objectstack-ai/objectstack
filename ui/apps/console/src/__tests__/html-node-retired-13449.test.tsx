/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13449 — the raw-HTML `html` node type is retired, and neither
 * authoring surface can put unsanitised markup into the page any more.
 *
 * ## The defect
 *
 * `@object-ui/components` registered `html` (`ui:html` plus the bare key),
 * whose renderer wrote the authored `html` string into a `div` through
 * `dangerouslySetInnerHTML` with no sanitiser. `@objectstack/spec` declares no
 * `html` component. Two doors reached it:
 *
 *   1. a JSON node `{ "type": "html", "html": "…" }`;
 *   2. a `kind:'html'` page — the tier documented as parsed, never executed,
 *      and safe for untrusted authors. Its compile whitelists every registered
 *      type, so `<html html="…" />` compiled with NO diagnostic and the
 *      renderer injected the string. Measured on the base before the fix: an
 *      `img` carrying an `onerror` attribute reached the DOM through both doors.
 *
 * ## What each suite holds
 *
 *   1. the `kind:'html'` page refuses the tag at compile time and renders no
 *      authored markup (red on the base: zero diagnostics, the `img` with its
 *      `onerror` attribute in the DOM);
 *   2. the JSON node draws the unknown-component panel and no authored markup
 *      (red on the base: the markup was injected);
 *   3. CONTROL — the same page without the retired tag renders its authored
 *      content, so suite 1's absence is not a page that renders nothing.
 *
 * It lives in `apps/console` because the claim is about the whole registration
 * graph: `@object-ui/fields` registers a `field:html` editor that must not take
 * over the bare key once the display renderer is gone.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { compile, manifestFromConfigs } from '@object-ui/sdui-parser';

// The full registration graph — the pair `dev/manifest-dump.tsx` builds the
// published artifacts from, and the pair every live-path suite here reads.
import '@object-ui/components';
import '../register-plugins';

const dataSource = {
  find: async () => ({ data: [], total: 0, hasMore: false }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
  count: async () => 0,
  getObjectSchema: async (name: string) => ({ name, label: name, fields: {} }),
  getObjects: async () => [],
  onMutation: () => () => {},
} as any;

/**
 * The manifest an html-kind page validates against, built the way the renderer
 * builds it — `ComponentRegistry.getKnownTypes()` + each type's declared
 * `inputs`, mirroring `page.tsx`'s `getJsxManifest()`.
 */
const livePageManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((t) => {
      const meta = ComponentRegistry.getMeta(t);
      return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

function renderNode(schema: Record<string, unknown>) {
  return render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
}

/** Script-bearing markup, as an author would write it. Never executed here: happy-dom loads no image. */
const PAYLOAD = '<img src="x" data-probe="img13449" onerror="window.__xss13449=1"><b id="p13449">raw</b>';

/** Did any of the authored markup reach the DOM as elements? */
function injected(container: HTMLElement) {
  return {
    img: container.querySelector('img[data-probe="img13449"]') !== null,
    onerror: container.querySelector('[onerror]') !== null,
    bold: container.querySelector('#p13449') !== null,
  };
}

const NOTHING_INJECTED = { img: false, onerror: false, bold: false };

describe("suite 1 — a `kind:'html'` page cannot write the retired tag (objectui#13449)", () => {
  const SOURCE = `<main><html html='${PAYLOAD}' /></main>`;

  it('the live compile refuses `<html>` by name', () => {
    const diagnostics = compile(SOURCE, livePageManifest()).diagnostics;
    const onTag = diagnostics.filter((d) => (d as { tag?: string }).tag === 'html');
    expect(onTag.length).toBeGreaterThan(0);
    expect(onTag.every((d) => d.severity === 'error')).toBe(true);
  });

  it('the rendered page carries none of the authored markup', async () => {
    const { container } = renderNode({ type: 'page', kind: 'html', name: 'retired_html_page', source: SOURCE });
    // The page settles on its compile report; wait until it has drawn anything.
    await waitFor(() => expect(container.textContent ?? '').not.toEqual(''));
    expect(injected(container)).toEqual(NOTHING_INJECTED);
  });
});

describe('suite 2 — a JSON `html` node draws the unknown-component panel (objectui#13449)', () => {
  it('neither registry key survives, and the field editor did not take the bare one', () => {
    expect(ComponentRegistry.get('html')).toBeFalsy();
    expect(ComponentRegistry.get('ui:html')).toBeFalsy();
    // Lit control: the FIELD widget of the same name is still registered.
    expect(ComponentRegistry.get('field:html')).toBeTruthy();
  });

  it('the node renders no authored markup', async () => {
    const { container } = renderNode({ type: 'html', html: PAYLOAD });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(injected(container)).toEqual(NOTHING_INJECTED);
  });
});

describe('suite 3 — CONTROL: the same page without the retired tag renders its content', () => {
  it('an html-tier `p` reaches the DOM with its text', async () => {
    const { container } = renderNode({
      type: 'page',
      kind: 'html',
      name: 'control_page',
      source: '<main><p className="ctl13449">control text</p></main>',
    });
    await waitFor(() => expect(container.querySelector('p.ctl13449')?.textContent).toBe('control text'));
  });
});
