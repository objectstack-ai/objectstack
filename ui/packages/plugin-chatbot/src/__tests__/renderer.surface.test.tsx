/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `surface` is authorable on `chatbot-enhanced` — both directions, and the
 * scope (objectui#6687, maintainer ruling 2026-08-29).
 *
 * ## What was wrong
 *
 * `content/docs/plugins/plugin-chatbot.mdx` documented `surface` in its
 * `Properties` table, but the key had ZERO read points: none of the three
 * `ComponentRegistry.register('chatbot*', ...)` sites forwarded it, and
 * `ChatbotSchema` did not declare it. `surface` was real only as a prop of the
 * React component (`ChatbotEnhanced.tsx`), reachable by a hand-written React
 * host and by nobody writing metadata. An author who wrote `surface: 'plain'`
 * got the `'card'` default and no error — the silent drop this file now makes
 * impossible to reintroduce quietly.
 *
 * ## Why these assertions, and why the DOM rather than the prop
 *
 * Asserting that the registration passes a `surface` PROP would pin the wiring
 * to itself: a test that mirrors the implementation cannot tell you the author
 * got the capability. So each case asserts the OBSERVABLE the two values exist
 * to produce — the root element's chrome. `card` is the embeddable bordered
 * panel (`rounded-lg border`); `plain` removes that chrome for a full-page
 * workspace. If someone forwards the key but `<ChatbotEnhanced>` stops acting
 * on it, these still go red, which is the point.
 *
 * The ABSENT case is pinned as hard as the authored one. It is the direction a
 * careless "just forward it" regresses — passing `surface={schema.surface ?? 'plain'}`,
 * or materializing the key into `defaultProps`, would change what every
 * existing unauthored document renders. The ruling names it explicitly:
 * absent still produces `'card'`, unchanged.
 *
 * The third case pins the SCOPE the docs row now claims. The ruling scoped the
 * key to the registration that renders `<ChatbotEnhanced>`; `chatbot` and
 * `chatbot-floating` render different components with no such chrome to switch.
 * The docs table says so in words — this says so in a measurement, so the table
 * cannot quietly start claiming more than the registrations deliver.
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

/**
 * Renders one registration through the real SDUI host and returns its root
 * element — the same path an authored document takes, not a bare component
 * render, so what is measured is what an AUTHOR gets.
 */
async function renderNode(
  type: string,
  ready: string,
  extra: Record<string, unknown>,
): Promise<HTMLElement> {
  render(
    <SchemaRendererProvider dataSource={FAKE_ADAPTER as never}>
      <SchemaRenderer
        schema={{ type, id: 'chat-node', ...extra } as never}
        dataSource={FAKE_ADAPTER as never}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => {
    if (!document.body.querySelector(ready)) {
      throw new Error(
        `${type}: \`${ready}\` never matched — the widget never reached its real ` +
          `markup, so measuring its chrome would measure nothing. Body was:\n` +
          document.body.innerHTML.slice(0, 600),
      );
    }
  });
  const root = document.body.querySelector<HTMLElement>('[data-obj-id="chat-node"]');
  if (!root) {
    throw new Error(`${type}: no element carries data-obj-id — it never rendered.`);
  }
  return root;
}

describe('chatbot-enhanced: `surface` is authorable (objectui#6687)', () => {
  it("authored `surface: 'plain'` drops the panel chrome — the frameless workspace", async () => {
    const root = await renderNode('plugin-chatbot:chatbot-enhanced', 'textarea', {
      surface: 'plain',
    });

    // The frameless workspace: no rounded card, no border.
    expect(root.className).not.toMatch(/\brounded-lg\b/);
    expect(root.className).not.toMatch(/\bborder\b/);
    expect(root.className).toMatch(/\bbg-background\b/);
  });

  it("ABSENT `surface` still renders the `'card'` bordered panel — unchanged by the wiring", async () => {
    const root = await renderNode('plugin-chatbot:chatbot-enhanced', 'textarea', {});

    // The embeddable bordered panel — what every existing unauthored document
    // has always rendered and must keep rendering.
    expect(root.className).toMatch(/\brounded-lg\b/);
    expect(root.className).toMatch(/\bborder\b/);
  });

  it("explicit `surface: 'card'` matches the absent case — the default is a real value, not a gap", async () => {
    const explicit = await renderNode('plugin-chatbot:chatbot-enhanced', 'textarea', {
      surface: 'card',
    });
    expect(explicit.className).toMatch(/\brounded-lg\b/);
    expect(explicit.className).toMatch(/\bborder\b/);
  });

  it('never reaches the DOM as an attribute — it is a config key, not a DOM prop', async () => {
    const root = await renderNode('plugin-chatbot:chatbot-enhanced', 'textarea', {
      surface: 'plain',
    });
    expect(root.hasAttribute('surface')).toBe(false);
  });
});

describe('the scope the docs `Properties` row claims (objectui#6687)', () => {
  it('`chatbot` does not read `surface` — authoring it changes nothing there', async () => {
    const authored = await renderNode('plugin-chatbot:chatbot', 'input', {
      surface: 'plain',
    });
    const authoredClass = authored.className;
    const authoredHtml = authored.innerHTML;
    cleanup();

    const bare = await renderNode('plugin-chatbot:chatbot', 'input', {});

    // Identical output with and without the key: `chatbot` renders `<Chatbot>`,
    // which has no surface chrome to switch. The docs row scopes the key to
    // `chatbot-enhanced` precisely because of this.
    expect(authoredClass).toBe(bare.className);
    expect(authoredHtml).toBe(bare.innerHTML);
    expect(bare.hasAttribute('surface')).toBe(false);
  });
});
