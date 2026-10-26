/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#10756 — on a `kind:'html'` page, `<code>inline</code>` renders the
 * text inside a real `code` element; the `field:code` widget still renders as
 * the widget under its own key.
 *
 * ## The defect
 *
 * `html-elements.tsx`'s header called `code` "registered elsewhere", but the
 * only bare `code` registration was the `field:code` widget's namespace
 * fallback: a code EDITOR reading `value`, with no declared inputs and no child
 * slot. The console's html-tier compile whitelists
 * `ComponentRegistry.getKnownTypes()`, so `<code>inline</code>` compiled, the
 * renderer resolved the bare key to the editor, and the authored text was
 * dropped. The lit controls — `pre`, `strong`, `em`, `span` — rendered their
 * children through the passthrough all along.
 *
 * ## The fix, and what each pin holds
 *
 * `code` joins `TAGS` in `html-elements.tsx` (registered `ui:code`, className +
 * child slot), joins `HTML_TIER_INTRINSICS`, and `@object-ui/fields` registers
 * `code` with `skipFallback` so the passthrough is the one bare claimant.
 *
 *   1. the html page renders the text in a `code` element (red on the base:
 *      the editor rendered, no `code` element carried the text);
 *   2. the live compile reports nothing for `<code>` with children (red on the
 *      base: `not-a-container` — the widget declared no slot);
 *   3. CONTROL — `field:code` still resolves to the widget and renders it;
 *   4. the bare key is owned by the passthrough, the namespaced key by the widget.
 *
 * It lives in `apps/console` because the claim is about the whole registration
 * graph: `@object-ui/components` registers the passthrough and `plugin-form`
 * pulls in `@object-ui/fields`, which registers the widget — the pair whose
 * import ORDER decided the bare key before the widget stood down.
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

const HTML_SOURCE = '<main><p>Read <code className="k">inline</code> here.</p></main>';

describe("kind:'html' — `<code>` renders its text (objectui#10756)", () => {
  it('renders the authored text inside a `code` element, with the authored className', async () => {
    const { container } = renderNode({ type: 'page', kind: 'html', name: 'code_page', source: HTML_SOURCE });
    await waitFor(() => expect(container.querySelector('code')).toBeTruthy());
    const code = container.querySelector('code')!;
    expect(code.textContent).toBe('inline');
    expect(code.classList.contains('k')).toBe(true);
    expect(code.closest('p')?.textContent).toBe('Read inline here.');
    // The editor the bare key used to resolve to is not what an html author gets.
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('compiles cleanly against the live page manifest — no `forbidden-tag`, no `not-a-container`', () => {
    const diagnostics = compile(HTML_SOURCE, livePageManifest()).diagnostics;
    expect(diagnostics.map((d) => `${d.code}:${d.tag ?? ''}`)).toEqual([]);
  });

  it('lit control — `pre` and `strong` render their children the same way', async () => {
    const { container } = renderNode({
      type: 'page',
      kind: 'html',
      name: 'control_page',
      source: '<main><pre>block</pre><p><strong>bold</strong></p></main>',
    });
    await waitFor(() => expect(container.querySelector('pre')).toBeTruthy());
    expect(container.querySelector('pre')!.textContent).toBe('block');
    expect(container.querySelector('strong')!.textContent).toBe('bold');
  });
});

describe('`field:code` still renders the widget (objectui#10756 control)', () => {
  it('resolves to the field widget under its namespaced key, while the bare key is the passthrough', () => {
    expect(ComponentRegistry.getConfig('field:code')?.type).toBe('field:code');
    expect(ComponentRegistry.getConfig('code')?.type).toBe('ui:code');
    expect(ComponentRegistry.get('code')).not.toBe(ComponentRegistry.get('field:code'));
    // The passthrough declares what the manifest carries; the widget declares nothing.
    expect((ComponentRegistry.getMeta('code')?.inputs ?? []).map((i) => i.name)).toEqual(['className', 'children']);
  });

  it('renders the widget — read-only, `value` comes out in the widget\'s own `pre` block', async () => {
    const { container } = renderNode({ type: 'field:code', value: 'const answer = 42;', readonly: true });
    // `CodeField` is lazy; its read-only branch is a `pre` carrying the value.
    await waitFor(() => expect(container.querySelector('pre')).toBeTruthy());
    expect(container.querySelector('pre')!.textContent).toBe('const answer = 42;');
  });
});
