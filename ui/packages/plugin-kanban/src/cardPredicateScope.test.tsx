/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Kanban card conditional formatting must bind the HOST PREDICATE SCOPE
 * alongside the card (ADR-0058 / #1583 parity with grid rows): a
 * `features.*` / `current_user.*` condition authored once has to reach the
 * identical verdict on grid rows and kanban cards. Before this suite, kanban
 * evaluated cards without the ambient scope, so such a condition silently
 * never matched here while working on the grid.
 *
 * objectui#8932 deleted `KanbanEnhanced`, the second board this suite used to
 * drive. Its positive leg went with it — the `KanbanBoard` leg pins the same
 * verdict on the one registered board. The two legs that only ever ran on it
 * now run on `KanbanBoard`: the fail-soft reading outside the provider, which
 * is the negative control that makes the live positive leg a reading, and the
 * objectui#5741 bare-field canon.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import { PredicateScopeProvider } from '@object-ui/react';
import KanbanBoard from './KanbanImpl';

// happy-dom may lack ResizeObserver (KanbanBoard's container-aware column
// sizing) — a no-op polyfill keeps the static render working.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = NoopResizeObserver;
}

const HOT_BG = 'rgb(254, 226, 226)';
const columns = [{ id: 'todo', title: 'Todo', cards: [{ id: 'c1', title: 'Card One' }] }];
// A features-gated spec rule — resolves ONLY when the host predicate scope is
// bound alongside the card.
const featureRules = [
  { condition: 'features.urgentHighlight && record.id == "c1"', style: { backgroundColor: HOT_BG } },
] as any;

/** The first element carrying the given inline background, if any. */
function findByBg(container: HTMLElement, bg: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (el) => el.style && el.style.backgroundColor === bg,
  );
}

afterEach(cleanup);

describe('kanban card conditional formatting · host predicate scope (ADR-0058)', () => {
  it('KanbanBoard (impl) binds the ambient predicate scope alongside the card', () => {
    const { container } = render(
      <PredicateScopeProvider scope={{ features: { urgentHighlight: true } }}>
        <KanbanBoard columns={columns} conditionalFormatting={featureRules} />
      </PredicateScopeProvider>,
    );
    expect(findByBg(container, HOT_BG)).toBeTruthy();
  });

  it('a scope-gated condition fails SOFT (no style) outside the provider', () => {
    const { container } = render(
      <KanbanBoard columns={columns} conditionalFormatting={featureRules} />,
    );
    expect(findByBg(container, HOT_BG)).toBeUndefined();
  });

  it('a bare-field condition no longer binds the card (objectui#5741) — no style; `record.*` does', () => {
    // The bare shorthand retired with Phase 2 of the objectui#5330 canon: it is
    // unbound, faults, and conditional formatting's existing policy is fail-soft
    // to "no style". The canonical spelling on the same card is the control
    // that proves the rule was consulted at all.
    const bareRules = [{ condition: 'id == "c1"', style: { backgroundColor: HOT_BG } }] as any;
    const bare = render(<KanbanBoard columns={columns} conditionalFormatting={bareRules} />);
    expect(findByBg(bare.container, HOT_BG)).toBeUndefined();
    cleanup();
    const canonRules = [{ condition: 'record.id == "c1"', style: { backgroundColor: HOT_BG } }] as any;
    const canon = render(<KanbanBoard columns={columns} conditionalFormatting={canonRules} />);
    expect(findByBg(canon.container, HOT_BG)).toBeTruthy();
  });
});

/**
 * Relation fields on a kanban card (objectui#3501). `ObjectKanban` expands
 * relations for display exactly as the grid does, so a rule comparing one
 * compared an OBJECT to a string and could only ever be false — on the board
 * only, while the same rule on the same list matched on the grid. Handing the
 * board the object's field types is what collapses the value back to the
 * foreign key the server stores.
 */
describe('kanban card conditional formatting · relation fields (#3501)', () => {
  const FIELDS = { account: { type: 'lookup', reference: 'accounts' } };
  const rule = [
    { condition: 'record.account == "A1"', style: { backgroundColor: HOT_BG } },
  ] as any;
  const expanded = [
    { id: 'todo', title: 'Todo', cards: [{ id: 'c1', title: 'Card One', account: { id: 'A1', name: 'Acme' } }] },
  ];
  const plain = [
    { id: 'todo', title: 'Todo', cards: [{ id: 'c1', title: 'Card One', account: 'A1' }] },
  ];

  it('matches an EXPANDED relation against the id it stands for', () => {
    const { container } = render(
      <KanbanBoard columns={expanded as any} conditionalFormatting={rule} objectFields={FIELDS} />,
    );
    expect(findByBg(container, HOT_BG)).toBeTruthy();
  });

  it('reaches the SAME verdict on an unexpanded card', () => {
    const { container } = render(
      <KanbanBoard columns={plain as any} conditionalFormatting={rule} objectFields={FIELDS} />,
    );
    expect(findByBg(container, HOT_BG)).toBeTruthy();
  });

  it('does not match a different id', () => {
    const other = [
      { id: 'todo', title: 'Todo', cards: [{ id: 'c1', title: 'Card One', account: { id: 'A2' } }] },
    ];
    const { container } = render(
      <KanbanBoard columns={other as any} conditionalFormatting={rule} objectFields={FIELDS} />,
    );
    expect(findByBg(container, HOT_BG)).toBeFalsy();
  });

  it('leaves the payload verbatim when no schema is supplied — the schema-only entry point', () => {
    // `kanban-ui` has no object schema to offer, so an expanded relation stays
    // an object there. Pinned so the omission is a documented boundary rather
    // than something a future reader "fixes" by guessing at shapes.
    const { container } = render(
      <KanbanBoard columns={expanded as any} conditionalFormatting={rule} />,
    );
    expect(findByBg(container, HOT_BG)).toBeFalsy();
  });
});
