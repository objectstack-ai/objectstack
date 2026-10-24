/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7708 — the fix, not the tripwire.
 *
 * `chatbot-floating`'s registration ended its `<FloatingChatbot>` element with
 * a raw `{...props}` spread, LAST, where its two siblings (`chatbot`,
 * `chatbot-enhanced`) spread `{...toDomProps(props)}` FIRST. The card ruled
 * "fence" (comment 5550678895 on the card, PM dispatch): move the spread to
 * the head and filter it through `toDomProps`, matching the siblings.
 *
 * Three consequences followed from the unfenced spread; this file owns the
 * two that were NOT already pinned as a measurement:
 *
 *   - The authored `messages` seed overrode the LIVE `messages={runtimeMessages}`
 *     prop written above it, so a message the user actually sent on a floating
 *     node never rendered — neither the user's own bubble nor the auto-reply.
 *     This is the p2 half of the card's grade (triage comment 5550678895):
 *     user-visible, on every floating chatbot. HEADLINE test below.
 *   - Node keys the panel does not consume by name (`displayMode`,
 *     `systemPrompt`, `model`) reached the panel root as DOM attributes
 *     (objectui#4425's leak class) — even though `systemPrompt` / `model` ARE
 *     legitimately read, by `useObjectChat`, off `schema` directly. The spread
 *     forwarded them a SECOND time, raw, as unrelated top-level props.
 *
 * The third consequence — `showAvatars` / `surface` / `processVisibility`
 * going dark on `chatbot-floating` — was already measured as a tripwire in
 * `renderer.authoring-faces-7655.test.tsx` section 4; this card flips those
 * pins from lit to dark rather than re-measuring them here.
 *
 * Pinning a bug as expected behaviour is the wrong shape (see this file's own
 * name): these two cases did not exist anywhere as a pin before this fix, so
 * the fix owns them fresh, as regression tests for the FIXED outcome.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Side-effect import: this is what registers the chat components.
import '../renderer';

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
  // The floating chatbot's portal container is appended to `document.body`
  // and is NOT owned by RTL, so `cleanup()` does not take it with it — left
  // behind, it would make the next test's body scan see this test's markup
  // (same trap `widget-dom-leak-sweep.test.tsx` documents).
  for (const node of Array.from(document.querySelectorAll('#floating-chatbot-portal'))) {
    node.remove();
  }
});

/** Renders a `chatbot-floating` node with the panel open through the real SDUI host. */
async function renderFloating(extra: Record<string, unknown>): Promise<HTMLTextAreaElement> {
  render(
    <SchemaRendererProvider dataSource={FAKE_ADAPTER as never}>
      <SchemaRenderer
        schema={{
          type: 'plugin-chatbot:chatbot-floating',
          id: 'chat-node',
          floatingConfig: { defaultOpen: true, title: 'Chat' },
          ...extra,
        } as never}
        dataSource={FAKE_ADAPTER as never}
      />
    </SchemaRendererProvider>,
  );
  // The panel mounts through a portal onto `document.body`, so query there.
  await waitFor(() => {
    if (!document.body.querySelector('textarea')) {
      throw new Error(`the floating panel never reached its composer. Body was:\n${document.body.innerHTML.slice(0, 600)}`);
    }
  });
  return document.body.querySelector('textarea') as HTMLTextAreaElement;
}

describe('chatbot-floating: a sent message renders on the panel (fixed, objectui#7708)', () => {
  it('the authored `messages` seed no longer overrides the live runtime messages', async () => {
    const composer = await renderFloating({
      messages: [{ id: 'seed', role: 'assistant', content: 'seed-message-marker' }],
      autoResponse: true,
      autoResponseText: 'auto-reply-marker',
      autoResponseDelay: 0,
    });

    // Before the fix: the raw `{...props}` spread, LAST, put the AUTHORED
    // `messages` array (the one-element seed above) back onto the panel after
    // `messages={runtimeMessages}` had already written the live array — so
    // nothing sent through the composer ever appeared, no matter how long the
    // test waited. Fenced through `toDomProps`, `messages` is no longer in the
    // forwarded set at all: the named `messages={runtimeMessages}` prop is the
    // only carrier.
    const form = composer.closest('form');
    expect(form).not.toBeNull();
    (composer as unknown as { value: string }).value = 'user-sent-marker';
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // The user's own message renders immediately (no timer involved).
    await waitFor(() => {
      expect(document.body.textContent).toContain('user-sent-marker');
    });
    // The auto-reply renders once the (zero-delay) timer fires.
    await waitFor(() => {
      expect(document.body.textContent).toContain('auto-reply-marker');
    });
    // The seed message is untouched by the fix — it rendered before too (the
    // card's own probe table: "seed shown" on both sides of the fence).
    expect(document.body.textContent).toContain('seed-message-marker');
  });
});

describe('chatbot-floating: node keys stop landing as DOM attributes on the panel (fixed, objectui#7708)', () => {
  it('`systemPrompt` / `model` / `displayMode` no longer leak, though `systemPrompt` and `model` are still read by name', async () => {
    await renderFloating({
      systemPrompt: 'leak-canary-system-prompt',
      model: 'leak-canary-model',
      // `displayMode` is a retired `?: never` tombstone on the TS face
      // (objectui#7654) but `BaseSchema` is `.passthrough()`, so an untyped
      // JSON document can still carry it — the spread does not know the
      // difference, so the probe stays honest about the raw channel.
      displayMode: 'leak-canary-display-mode',
    } as Record<string, unknown>);

    const root = document.body.querySelector('[data-obj-id="chat-node"]');
    expect(root, 'no element carries data-obj-id — the panel root was not found').not.toBeNull();

    // The named half: `useObjectChat` still reads `systemPrompt` / `model` off
    // `schema` directly (unaffected by fencing the SEPARATE top-level-prop
    // channel) — this suite does not re-assert that plumbing, only that the
    // leak is gone. The DOM half:
    expect(root).not.toHaveAttribute('systemprompt');
    expect(root).not.toHaveAttribute('model');
    expect(root).not.toHaveAttribute('displaymode');

    // The mechanism half — the stringified-object canary from
    // `renderer.domProps.test.tsx`: nothing non-DOM survives under any name.
    const stringified = Array.from((root as Element).attributes).filter((attribute) =>
      attribute.value.includes('[object Object]'),
    );
    expect(stringified.map((attribute) => `${attribute.name}="${attribute.value}"`)).toEqual([]);
  });
});
