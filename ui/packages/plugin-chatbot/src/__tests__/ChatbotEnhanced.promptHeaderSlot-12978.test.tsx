/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12978 — `promptHeaderSlot`: a host's row at the top of the prompt
 * area, laid out in flow above the prompt input.
 *
 * The only host-supplied node near the input used to be `promptOverlaySlot`,
 * which is absolute-positioned (meant for slash-command palettes), so a host
 * that wanted a standing row there — the console's pending-drafts bar — floated
 * it, and on the full-page chat the float sat over the input's first line. A
 * row in flow cannot: the conversation above gives up the room.
 *
 * No layout runs here, so what is pinned is the structure that decides the
 * boxes: the row shares an element with the input that does not hold the
 * conversation (`role="log"`), nothing between them is out of flow, the row
 * comes first, and it is outside the input's form (a button in it never
 * submits the chat). The boxes are measured in a browser on the pull request.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

/** `el` and its ancestors, nearest first, walked by `parentElement` alone. */
function lineage(el: Element): Element[] {
  const chain: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
  return chain;
}

const OUT_OF_FLOW = /^(?:[\w-]+:)*(?:absolute|fixed|sticky)$/;

function placement(row: Element, input: Element) {
  const rowLine = lineage(row);
  const inputLine = lineage(input);
  const common = rowLine.find((el) => inputLine.includes(el))!;
  const below = (line: Element[]) => line.slice(0, line.indexOf(common));
  // Sibling counts, not identity: the form element read through
  // `parentElement` compares unequal to the one `children` lists here.
  const rowIndex = (line: Element[]) => {
    let index = 0;
    const own = below(line);
    for (let n = own[own.length - 1].previousElementSibling; n; n = n.previousElementSibling) index += 1;
    return index;
  };
  return {
    holdsConversation: common.querySelector('[role="log"]') !== null,
    outOfFlow: [...below(rowLine), ...below(inputLine)].flatMap((el) =>
      (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => OUT_OF_FLOW.test(c)),
    ),
    rowFirst: rowIndex(rowLine) < rowIndex(inputLine),
    insideForm: rowLine.some((el) => el.tagName === 'FORM'),
  };
}

describe('ChatbotEnhanced promptHeaderSlot (objectui#12978)', () => {
  it('lays the row out in flow above the prompt input, outside its form', () => {
    render(
      <ChatbotEnhanced
        surface="plain"
        placeholder="Ask anything"
        promptHeaderSlot={<div data-testid="host-row">1 change is not published yet</div>}
      />,
    );
    const input = screen.getByPlaceholderText('Ask anything');
    expect(placement(screen.getByTestId('host-row'), input)).toEqual({
      holdsConversation: false,
      outOfFlow: [],
      rowFirst: true,
      insideForm: false,
    });
  });

  it('without the prop the prompt area renders no row, and the prop never reaches the DOM as an attribute', () => {
    const { container } = render(<ChatbotEnhanced placeholder="Ask anything" />);
    expect(screen.queryByTestId('prompt-header-slot')).not.toBeInTheDocument();
    render(<ChatbotEnhanced placeholder="Ask anything" promptHeaderSlot={<span>row</span>} />);
    expect(document.querySelector('[promptheaderslot]')).toBeNull();
    expect(container.querySelector('[promptHeaderSlot]')).toBeNull();
  });
});
