/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The DOM pass-through contract of the two spreading chat registrations
 * (objectui#4431, the first migration step of objectui#4425 phase 2).
 *
 * ## What these pin that the sweep gate cannot
 *
 * `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx` is the
 * cross-package ratchet: it proves NOTHING unexplained arrives. These cases are
 * the other half, in this package, next to the code:
 *
 *  - the exact attribute SET on the host element — so a key that stops being
 *    delivered (`role`, `aria-label`, `data-obj-id`) is as red as a key that
 *    leaks. The sweep structurally cannot see that direction: it looks for
 *    attributes that arrive, not for ones that go missing.
 *  - the two items objectui#4431's triage flagged BY NAME, each asserted as a
 *    pair so neither half can drift: `datasource` (the injected adapter) gone
 *    while the widget still renders on its real path, and the camelCase
 *    `arialabel` / `ariadescribedby` gone while the RESOLVED `aria-label` /
 *    `aria-describedby` — the spellings assistive technology actually reads —
 *    stay.
 *
 * ## Why the adapter is attached
 *
 * `dataSource` is not a schema key: `SchemaRenderer` strips the node's own
 * `dataSource` BINDING by name, and this is the injected ADAPTER a host hands
 * the renderer. It therefore only reaches a widget on a deployment that really
 * loads data — which is why PR #4428 shipped a six-key first pass measured
 * against a schema-only fixture and missed exactly this key. A test that
 * renders these widgets bare would repeat that mistake, so every render here
 * goes through `SchemaRendererProvider` WITH an adapter.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Side-effect import: this is what registers the chat components.
import '../renderer';

/** The injected adapter. Answers empty so nothing lands in an error state. */
const FAKE_ADAPTER = {
  find: async () => [],
  findOne: async () => null,
  aggregate: async () => [],
  count: async () => 0,
  getObject: async () => null,
};

/**
 * One node carrying every family the renderer hands a widget: authored SDUI
 * metadata, the camelCase ARIA the resolver converts, the DOM identity keys
 * that must survive, an open tail of keys no component declares, and a `props`
 * container whose contents the renderer spreads separately.
 */
function canaryNode(type: string): Record<string, unknown> {
  return {
    type,
    id: 'chat-node',
    name: 'canary_node',
    className: 'zz-authored-class',
    role: 'log',
    tabIndex: 0,
    bind: 'data.revenue',
    events: { onClick: [{ action: 'navigate', params: { url: '/x' } }] },
    ariaLabel: 'Canary label',
    ariaDescribedBy: 'canary-desc',
    autoResponse: false,
    zzcanary: 'CANARY-STR',
    zzcanaryobj: { nested: true },
    reference_to: 'contacts',
    props: { colorVariant: 'success', zzcanaryprop: 'CANARY-PROP' },
  };
}

/** Renders one registration through the real SDUI host and returns its root. */
async function renderNode(type: string, ready: string): Promise<HTMLElement> {
  render(
    <SchemaRendererProvider dataSource={FAKE_ADAPTER as never}>
      <SchemaRenderer schema={canaryNode(type) as never} dataSource={FAKE_ADAPTER as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => {
    if (!document.body.querySelector(ready)) {
      throw new Error(
        `${type}: \`${ready}\` never matched — the widget never reached its real ` +
          `markup, so scanning it would measure nothing. Body was:\n` +
          document.body.innerHTML.slice(0, 600),
      );
    }
  });
  const root = document.body.querySelector<HTMLElement>('[data-obj-id="chat-node"]');
  if (!root) {
    throw new Error(
      `${type}: no element carries data-obj-id — either the widget stopped ` +
        `forwarding the renderer's own identity attributes, or it never rendered.`,
    );
  }
  return root;
}

function attributeNames(element: Element): string[] {
  return Array.from(element.attributes)
    .map((attribute) => attribute.name)
    .sort();
}

beforeAll(() => {
  // `use-stick-to-bottom` (the enhanced composer's scroller) measures through
  // ResizeObserver, which happy-dom does not implement.
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
});

const TARGETS: ReadonlyArray<readonly [string, string]> = [
  ['plugin-chatbot:chatbot', 'input'],
  ['plugin-chatbot:chatbot-enhanced', 'textarea'],
];

describe.each(TARGETS)('%s host element (objectui#4431)', (type, ready) => {
  it('carries EXACTLY the whitelisted DOM attributes — no more, no fewer', async () => {
    const root = await renderNode(type, ready);

    // Exact set equality, the ledger's own discipline applied locally: a new
    // leak fails, and so does a DOM key that silently stops being delivered.
    // `style` is the component's own `max-height`, not pass-through.
    expect(attributeNames(root)).toEqual([
      'aria-describedby',
      'aria-label',
      'class',
      'data-obj-id',
      'data-obj-type',
      'id',
      'role',
      'style',
      'tabindex',
    ]);

    // The whitelisted keys carry their real values — an empty pass-through
    // would satisfy the set above only by also losing these.
    expect(root).toHaveAttribute('id', 'chat-node');
    expect(root).toHaveAttribute('data-obj-type', type);
    expect(root).toHaveAttribute('role', 'log');
    expect(root).toHaveAttribute('tabindex', '0');
    expect(root.className).toContain('zz-authored-class');
  });

  it('drops the injected adapter — `datasource` never reaches the DOM', async () => {
    const root = await renderNode(type, ready);

    // The named half…
    expect(root).not.toHaveAttribute('datasource');
    // …and the mechanism half: an object that reaches an attribute is
    // `String()`-ed, so a stringified object anywhere on the element means
    // something non-DOM got through under some other name.
    const stringified = Array.from(root.attributes).filter((attribute) =>
      attribute.value.includes('[object Object]'),
    );
    expect(stringified.map((attribute) => `${attribute.name}="${attribute.value}"`)).toEqual([]);
  });

  it('drops the camelCase ARIA and keeps the resolved spellings', async () => {
    const root = await renderNode(type, ready);

    // Meaningless to assistive technology — these are the authored keys, and
    // the resolver already emitted the hyphenated forms from them.
    expect(root).not.toHaveAttribute('arialabel');
    expect(root).not.toHaveAttribute('ariadescribedby');
    // The half that MUST survive: dropping these would be an a11y regression
    // dressed as a leak fix.
    expect(root).toHaveAttribute('aria-label', 'Canary label');
    expect(root).toHaveAttribute('aria-describedby', 'canary-desc');
  });

  it('drops the SDUI metadata, the `props` container and the open tail', async () => {
    const root = await renderNode(type, ready);

    for (const attribute of [
      // Injected / authored SDUI metadata.
      'bind',
      'events',
      'props',
      'schema',
      // `name` is legal on a form control, not on the container these widgets
      // render — it is one of the 14 attributes this card closed.
      'name',
      // The open tail a deny-list structurally cannot enumerate.
      'zzcanary',
      'zzcanaryobj',
      'reference_to',
      // The authored `props` container's contents.
      'colorvariant',
      'zzcanaryprop',
    ]) {
      expect(root, `${type} leaked ${attribute}`).not.toHaveAttribute(attribute);
    }
  });
});
