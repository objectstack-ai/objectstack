// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `KeyVals`'s zero-rows branch is a block-level empty-COLLECTION state
 * (objectui#8520). It used to render a bare em dash in a plain `<div>`:
 *
 *     if (rows.length === 0) return <div className="…italic">—</div>;
 *
 * with no role, no label and no text alternative, so a screen-reader user
 * reaching a rail block whose keys all resolved to `undefined` heard a naked
 * punctuation mark. It survived three censuses across objectui#8491 /
 * PR #8503 / objectui#8504 because every instrument in that thread was
 * anchored on `<span`, and this carrier is a `<div>`.
 *
 * The two carriers this pin has to keep out are BOTH plausible fixes, not
 * only the obviously-worse one:
 *
 *   1. the original bare `—` (nothing announced), and
 *   2. `<EmptyValue />` — the sibling component the other nine carriers in
 *      this class converted to. It looks like the fix, renders a placeholder,
 *      and is wrong here: its docblock scopes it to a missing cell/field
 *      VALUE, it renders a `<span>`, and its `aria-label` resolves
 *      `detail.noValue` — "No value" — which is a false statement about a
 *      collection that simply has no members.
 *
 * ⚠️ Navigation vs. assertion. The harness reaches the state through the rail
 * block's own title ("Planning", owned by `RailBlock`), never through anything
 * the empty state renders. If it navigated by `data-slot="empty-description"`
 * — the thing under change — then any caricature that removes the description
 * would kill the harness instead of failing the assertion, and the pin would
 * read as a strong refusal while measuring nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { AgentPreview } from './AgentPreview';

afterEach(cleanup);

const BASE = {
  name: 'sales_copilot',
  label: 'Sales Copilot',
  active: true,
  model: { provider: 'openai', model: 'gpt-4o' },
  instructions: 'You are a helpful sales assistant.',
  skills: ['summarize_account'],
} satisfies Record<string, unknown>;

/**
 * `planning` is present (so the rail block renders at all) but carries none of
 * the keys `KeyVals` is asked for, so every row filters out — the zero-rows
 * branch, reached exactly the way an author reaches it.
 */
const EMPTY_COLLECTION_DRAFT = { ...BASE, planning: { retries: 3 } };

/** Same block, one resolvable key: the populated branch. */
const POPULATED_DRAFT = { ...BASE, planning: { maxIterations: 8 } };

function renderPreview(draft: Record<string, unknown>) {
  return render(<AgentPreview type="agent" name="sales_copilot" draft={draft} />);
}

/**
 * The rail block's body slot, reached by the block's TITLE. `RailBlock` renders
 * `<div><div>{icon}{title}</div>{children}</div>`, so the title's parent is the
 * block root and its second child is whatever `KeyVals` returned.
 */
/**
 * Self-inclusive `querySelector` over the rail block's body. `KeyVals` returns
 * the empty state AS that body element, and `Element.querySelectorAll` never
 * matches the element it is called on — so a plain descendant query silently
 * misses the very node under test.
 */
function self(selector: string): Element | null {
  const body = planningBody();
  return body.matches(selector) ? body : body.querySelector(selector);
}

function planningBody(): HTMLElement {
  const title = screen.getByText('Planning');
  const block = title.parentElement;
  expect(block).toBeTruthy();
  const body = block!.children[1] as HTMLElement | undefined;
  expect(body).toBeTruthy();
  return body!;
}

describe('AgentPreview: an empty rail collection announces itself in words', () => {
  it('states the condition instead of drawing a bare em dash', () => {
    renderPreview(EMPTY_COLLECTION_DRAFT);
    const body = planningBody();
    expect(within(body).getByText('No values set.')).toBeTruthy();
  });

  it('announces letters, not punctuation — the axis both wrong fixes fail', () => {
    renderPreview(EMPTY_COLLECTION_DRAFT);
    const text = (planningBody().textContent ?? '').trim();
    expect(text.length).toBeGreaterThan(0);
    // A bare `—` and an `<EmptyValue />` glyph both leave this false.
    expect(/\p{Letter}/u.test(text)).toBe(true);
  });

  it('leaves no em dash behind for a screen reader to read as the whole state', () => {
    renderPreview(EMPTY_COLLECTION_DRAFT);
    // queryAllByText, not queryByText: the latter throws on MULTIPLE matches,
    // which would report a second carrier as a harness crash rather than a miss.
    expect(within(planningBody()).queryAllByText('—')).toHaveLength(0);
  });

  it('is not labelled "No value" — that is a claim about a field, not a collection', () => {
    renderPreview(EMPTY_COLLECTION_DRAFT);
    // `self` and not `querySelectorAll`: `KeyVals` returns the empty state as
    // the rail block's body ELEMENT, and `querySelectorAll` never matches the
    // element it is called on. Written the naive way this assertion sat green
    // through a measured `<EmptyValue />` caricature — the labelled
    // discriminator was the one axis of six that did NOT fire (objectui#8520).
    expect(self('[data-slot="empty-value"]')).toBeNull();
    expect(self('[aria-label="No value"]')).toBeNull();
  });

  it('is a block-level member of the shared Empty family, not a hand-rolled div', () => {
    renderPreview(EMPTY_COLLECTION_DRAFT);
    expect(self('[data-slot="empty-description"]')).toBeTruthy();
  });

  it('still renders the rows when the collection has any', () => {
    renderPreview(POPULATED_DRAFT);
    const body = planningBody();
    expect(within(body).getByText('maxIterations')).toBeTruthy();
    expect(within(body).getByText('8')).toBeTruthy();
    expect(within(body).queryByText('No values set.')).toBeNull();
  });
});
