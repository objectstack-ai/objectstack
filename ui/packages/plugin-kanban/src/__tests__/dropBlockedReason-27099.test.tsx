/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #27099 — the board half of "a closed lane says why", read on the board
 * itself rather than through `ObjectKanban` (whose rule-message half is pinned
 * by `ObjectKanban.dropBlockedReason-27099.test.tsx`).
 *
 *  - the swimlane layout draws its own lane cells and carries the reason on
 *    the closed column's cell in every swimlane row;
 *  - a host that passes `canDropCard` and no `dropBlockedReason` still gets a
 *    sentence, the pack's `kanban.dropBlocked` with the two column titles, in
 *    the provider's language;
 *  - a host's `dropBlockedReason` wins over that sentence.
 *
 * The instrument is the real board and the real `DndContext`: a pointer
 * pick-up past the 5px activation distance starts the drag, as
 * `ariaLabelTemplates-12838.test.tsx` does.
 */

import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@object-ui/i18n'
import { en, zh } from '@object-ui/i18n/locales'
import KanbanBoard, { type KanbanBoardProps } from '../KanbanImpl'
import type { KanbanColumn } from '../types'

const CARD = 'Content backlog'

const columns = (): KanbanColumn[] => [
  { id: 'todo', title: 'To do', cards: [{ id: 'c1', title: CARD, owner: 'ann' }] },
  { id: 'doing', title: 'Doing', cards: [{ id: 'c2', title: 'Draft', owner: 'bob' }] },
  { id: 'done', title: 'Done', cards: [] },
]

/** A card in `todo` may enter `doing` only. */
const canDropCard: KanbanBoardProps['canDropCard'] = (from, to) => !(from === 'todo' && to === 'done')

/** Fill `{{name}}` holes the way the packs spell them. */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? '')

function renderBoard(lang: 'en' | 'zh', props: Partial<KanbanBoardProps> = {}) {
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <KanbanBoard columns={columns()} onCardMove={() => {}} canDropCard={canDropCard} {...props} />
    </I18nProvider>,
  )
}

/** Pick the card up with the pointer, past the board's 5px activation distance. */
function pickUp() {
  const el = screen.getByRole('button', { name: CARD })
  fireEvent.pointerDown(el, { isPrimary: true, button: 0, clientX: 50, clientY: 10 })
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 70, clientY: 10 })
}

/** A swimlane cell: the element around its card list. */
const cell = (column: string, lane: string) =>
  screen.getByRole('list', { name: `${column} - ${lane} cards` }).parentElement as HTMLElement

afterEach(cleanup)

describe('kanban board — a closed lane says why (#27099)', () => {
  it('carries the reason on the closed column cell in every swimlane row', async () => {
    renderBoard('en', { swimlaneField: 'owner' })
    await screen.findByRole('list', { name: 'Done - ann cards' })
    pickUp()

    const sentence = fill(en.kanban.dropBlocked, { from: 'To do', to: 'Done' })
    for (const row of ['ann', 'bob']) {
      const closed = cell('Done', row)
      expect(closed).toHaveAttribute('data-kanban-drop-blocked')
      expect(closed).toHaveAttribute('title', sentence)
      expect(closed).toHaveAccessibleDescription(sentence)
    }
    // CONTROL: the open column's cells explain nothing.
    for (const row of ['ann', 'bob']) {
      const open = cell('Doing', row)
      expect(open).not.toHaveAttribute('data-kanban-drop-blocked')
      expect(open).not.toHaveAttribute('title')
      expect(open).not.toHaveAttribute('aria-describedby')
    }
  })

  it("falls back to the pack's sentence, in the provider's language", async () => {
    // The two packs disagree, or this would pin nothing.
    expect(zh.kanban.dropBlocked).not.toBe(en.kanban.dropBlocked)
    renderBoard('zh')
    await screen.findByText(zh.kanban.noCards)
    pickUp()

    const sentence = fill(zh.kanban.dropBlocked, { from: 'To do', to: 'Done' })
    const closed = screen.getByRole('group', { name: 'Done' })
    expect(closed).toHaveAttribute('title', sentence)
    expect(closed).toHaveAccessibleDescription(sentence)
  })

  it("prefers the host's reason over the board sentence", async () => {
    renderBoard('en', {
      dropBlockedReason: (from, to) => (from === 'todo' && to === 'done' ? 'Review it first.' : undefined),
    })
    await screen.findByText(en.kanban.noCards)
    pickUp()

    expect(screen.getByRole('group', { name: 'Done' })).toHaveAttribute('title', 'Review it first.')
    expect(screen.getByRole('group', { name: 'Done' })).toHaveAccessibleDescription('Review it first.')
    expect(screen.getByRole('group', { name: 'Doing' })).not.toHaveAttribute('title')
  })
})
