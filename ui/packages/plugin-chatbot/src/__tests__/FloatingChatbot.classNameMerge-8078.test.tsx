/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8078 — an authored `className` on a `chatbot-floating` node reaches
 * the rendered panel.
 *
 * `<FloatingChatbot>` ended its `<ChatbotEnhanced>` element with a bare
 * `className="h-full border-0 rounded-none"` literal written AFTER
 * `{...chatbotProps}`, so the authored value — correctly forwarded all the way
 * from the registration, which destructures `className` as its own named prop —
 * was REPLACED rather than merged. It type-checked, it parsed, and it was
 * silently a no-op on the rendered panel: the escape hatch AGENTS.md #3
 * requires every widget to expose ("Always expose `className` in schema props
 * so users can override via JSON"), exposed and inert.
 *
 * The card was scrupulous that it had measured this statically and "not yet
 * confirmed through a live render". This file is that render: every assertion
 * below reads the class list of the real panel element, mounted through the
 * real SDUI host.
 *
 * BOTH halves, or only half the requirement is measured:
 *   - an authored `rounded-xl` / `border-2` / `bg-*` REACHES the panel, and
 *   - the panel's own `h-full` fit is still there beside it.
 *
 * Plus the control that keeps the fix honest: a node authoring NO `className`
 * renders the exact class list it rendered before the fix, so the default face
 * does not move.
 *
 * `maxHeight="100%"` two lines up is NOT a second instance of the same defect,
 * and the control below pins why. `ChatbotFloatingSchema` does not declare
 * `maxHeight` at all — its own docblock states the key is "NOT declared, on
 * purpose", because the panel pins its inner chat to `100%` of the panel
 * height — and the `chatbot-floating` registration forwards no such prop. So
 * there is no authored value to drop on this face: the panel keeps it BY FORCE,
 * deliberately, and the assertion records that rather than changing it.
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
  // The floating chatbot's portal container is appended to `document.body` and
  // is NOT owned by RTL, so `cleanup()` does not take it with it — left behind,
  // it would make the next test's body scan see this test's markup.
  for (const node of Array.from(document.querySelectorAll('#floating-chatbot-portal'))) {
    node.remove();
  }
});

/**
 * Renders a `chatbot-floating` node with the panel open through the real SDUI
 * host and hands back the rendered panel — the `<ChatbotEnhanced>` root, which
 * is the element the authored `className` is supposed to land on.
 *
 * It is found by `data-obj-id`, the attribute `SchemaRenderer` derives from the
 * node's own `id` and the registration forwards through `toDomProps`; the
 * caller then asserts on the classes, so a wrong element would fail loudly
 * rather than silently pass.
 */
async function renderFloatingPanel(extra: Record<string, unknown>): Promise<HTMLElement> {
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
    if (!document.body.querySelector('[data-obj-id="chat-node"]')) {
      throw new Error(
        `the floating panel never reached the DOM. Body was:\n${document.body.innerHTML.slice(0, 600)}`,
      );
    }
  });
  return document.body.querySelector('[data-obj-id="chat-node"]') as HTMLElement;
}

/** The rendered class list as a token set, so assertions do not depend on order. */
function classesOf(element: HTMLElement): string[] {
  return Array.from(element.classList).sort();
}

describe('chatbot-floating: an authored className reaches the rendered panel (objectui#8078)', () => {
  it('keeps the authored classes AND the panel fit the author said nothing about', async () => {
    const panel = await renderFloatingPanel({
      className: 'rounded-xl border-2 bg-amber-50',
    });
    const classes = classesOf(panel);

    // The defect, driven rather than read: before the fix the literal replaced
    // the authored value outright, so none of these three were on the element.
    expect(classes).toContain('bg-amber-50');
    // Radius and border width are the two AGENTS.md #3 aesthetics the card is
    // about; `cn` is `twMerge(clsx(...))`, so the author's declaration — written
    // last — wins over the panel's default for the same utility group.
    expect(classes).toContain('rounded-xl');
    expect(classes).toContain('border-2');
    expect(classes).not.toContain('rounded-none');
    expect(classes).not.toContain('border-0');

    // The other half: the panel's own fit survives the merge. An author who
    // declares nothing about size still gets it (this node declared only colour,
    // radius and border width).
    expect(classes).toContain('h-full');
    // And the surface classes `<ChatbotEnhanced>` contributes itself are intact.
    expect(classes).toContain('flex');
    expect(classes).toContain('min-h-0');
    expect(classes).toContain('overflow-hidden');
  });

  it('lets an author who DOES declare a size replace the panel default', async () => {
    const panel = await renderFloatingPanel({ className: 'h-64' });
    const classes = classesOf(panel);

    // `h-full` is the panel's DEFAULT fit, not its property: the boundary this
    // card set is that the panel owns the fit only when the author declares
    // nothing about size.
    expect(classes).toContain('h-64');
    expect(classes).not.toContain('h-full');
  });

  it('CONTROL — a node authoring no className renders exactly what it rendered before', async () => {
    const panel = await renderFloatingPanel({});

    // Byte-for-byte the pre-fix face: `cn(panelDefaults, undefined)` is
    // `panelDefaults`. This is what makes the fix a merge and not a redesign —
    // it fails if the panel's own default face moves.
    expect(panel.className).toBe(
      'flex min-h-0 flex-col overflow-hidden bg-background h-full border-0 rounded-none',
    );

    // The panel's ONE forced value, and the ruling that it is forced on purpose:
    // `ChatbotFloatingSchema` declares no `maxHeight` and the registration
    // forwards none, so nothing authored is being dropped — while
    // `<ChatbotEnhanced>`'s own `maxHeight` default (`'500px'`) would cap the
    // conversation well inside a panel that can be 800px tall, or the whole
    // viewport in fullscreen.
    expect(panel.style.maxHeight).toBe('100%');
  });
});
