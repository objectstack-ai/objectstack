/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The authoring -> runtime seam, through the REAL renderer path (objectui#4399).
 *
 * `chatMessageAdapter.test.ts` pins the conversion in isolation; these pin the
 * two decisions that are only observable as pixels, driven the way the SDUI
 * engine drives them: the registered `chatbot` renderer, its own
 * `useObjectChat`, its own `<Chatbot>`. The acceptance bar for the card is
 * ZERO rendered-output change, so both assertions describe what `main`
 * rendered before the adapter existed — they are regression pins, not
 * change pins.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { ChatbotSchema } from '@object-ui/types';
// Side-effect import: this is what registers the three chat components.
import '../renderer';

/** The registered renderer, resolved exactly as the SDUI engine resolves it. */
function chatbotRenderer() {
  const impl = ComponentRegistry.get('chatbot', 'plugin-chatbot');
  if (!impl) throw new Error('plugin-chatbot:chatbot is not registered');
  return impl as React.ComponentType<{ schema: unknown }>;
}

describe("a role:'tool' message renders as an assistant bubble", () => {
  it('shows its content and wears the assistant avatar', () => {
    const Chatbot = chatbotRenderer();
    // `'tool'` is authorable — `ChatMessageSchema` declares it — and has no
    // runtime counterpart. The named decision is that it IS an assistant
    // message (see `toRuntimeRole`), which is what the seam rendered before
    // this card by falling through `formatMessageProps`.
    render(
      <Chatbot
        schema={
          {
            type: 'chatbot',
            messages: [{ id: 't1', role: 'tool', content: 'search returned 3 rows' }],
            autoResponse: false,
            assistantAvatarFallback: 'AI',
            userAvatarFallback: 'You',
          } as unknown as ChatbotSchema
        }
      />,
    );

    const content = screen.getByText('search returned 3 rows');
    expect(content).toBeInTheDocument();

    // Assistant side: `<Chatbot>` reverses the row for user messages only, and
    // picks the assistant avatar fallback for everything else.
    const row = content.closest('.flex.gap-3');
    expect(row).not.toBeNull();
    expect(row).toHaveClass('flex-row');
    expect(row).not.toHaveClass('flex-row-reverse');
    expect(row?.textContent).toContain('AI');
    expect(row?.textContent).not.toContain('You');

    // …and NOT the centred system pill, which is the other non-user branch.
    expect(content.closest('.justify-center')).toBeNull();
  });
});

describe('a Date timestamp reaches the DOM as a string', () => {
  it('renders the ISO form rather than throwing on an object child', () => {
    const Chatbot = chatbotRenderer();
    // `timestamp: z.union([z.string(), z.date()])` is authorable. `<Chatbot>`
    // renders `{message.timestamp}` straight into a React child, so an
    // unabsorbed `Date` is the "Objects are not valid as a React child" throw.
    render(
      <Chatbot
        schema={
          {
            type: 'chatbot',
            messages: [
              {
                id: 'd1',
                role: 'assistant',
                content: 'stamped',
                timestamp: new Date('2026-08-12T02:08:13.000Z'),
              },
            ],
            showTimestamp: true,
            autoResponse: false,
          } as unknown as ChatbotSchema
        }
      />,
    );

    expect(screen.getByText('stamped')).toBeInTheDocument();
    expect(screen.getByText('2026-08-12T02:08:13.000Z')).toBeInTheDocument();
  });
});
