/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A focused kanban card opens on Enter and on Space, through the SAME
 * `onCardClick` a pointer click takes — objectui#12883.
 *
 * The defect: every card is a keyboard tab stop (dnd-kit's `tabIndex`), but
 * its only activation was `onClick`, so Enter and Space on a focused card did
 * nothing and a keyboard user could not open a record from the board. The
 * card was a bare `listitem`, a role no key activates.
 *
 * The instrument: the real board, the real `DndContext`, real DOM events.
 * Space is free for the card: the board builds no `KeyboardSensor`
 * (objectui#12837's pin), and only that sensor binds a key.
 *
 * The controls: a key on an element inside the card is that element's own and
 * opens nothing; a pointer click still calls `onCardClick` once, with the click.
 */

import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@object-ui/i18n'
import type { KanbanCard, KanbanColumn } from '../types'
import KanbanBoard from '../KanbanImpl'

const TITLE = 'Content backlog'

const columns = (): KanbanColumn[] => [
  {
    id: 'todo',
    title: 'To Do',
    cards: [
      {
        id: 'c1',
        title: TITLE,
        // Two interactive elements inside the card: the controls' targets.
        cardFieldCells: [
          { field: 'site', label: 'Site', node: <a href="#site">example.com</a> },
          { field: 'note', label: 'Note', node: <input aria-label="Note" defaultValue="" /> },
        ],
      },
    ],
  },
  { id: 'done', title: 'Done', cards: [] },
]

type Call = { card: KanbanCard; type: string | undefined }

async function renderBoard() {
  const calls: Call[] = []
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <KanbanBoard
        columns={columns()}
        onCardMove={() => {}}
        onCardClick={(card, event) => calls.push({ card, type: event?.type })}
      />
    </I18nProvider>,
  )
  await screen.findByText('No cards')
  return calls
}

/** The card's focusable control. */
const card = () => screen.getByRole('button', { name: TITLE })

afterEach(() => {
  cleanup()
})

describe('a focused kanban card opens on Enter and Space, as a click does (objectui#12883)', () => {
  it('the card is a button inside the listitem its list needs', async () => {
    await renderBoard()
    const item = screen.getByRole('listitem', { name: TITLE })
    expect(within(item).getByRole('button', { name: TITLE })).toBe(card())
    expect(item.closest('[role="list"]')).not.toBeNull()
    // Still a tab stop: the focus is what the keys act on.
    expect(card()).toHaveAttribute('tabindex', '0')
  })

  it('Enter on the focused card calls onCardClick once, with that card and the key event', async () => {
    const calls = await renderBoard()
    const el = card()
    el.focus()
    expect(el).toHaveFocus()
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' })
    expect(calls).toHaveLength(1)
    expect(calls[0].card.id).toBe('c1')
    expect(calls[0].type).toBe('keydown')
  })

  it('Space activates on release, as a button does; the press itself opens nothing', async () => {
    const calls = await renderBoard()
    const el = card()
    el.focus()
    const pressed = fireEvent.keyDown(el, { key: ' ', code: 'Space' })
    // The press is claimed (no page scroll) and opens nothing yet.
    expect(pressed).toBe(false)
    expect(calls).toHaveLength(0)
    fireEvent.keyUp(el, { key: ' ', code: 'Space' })
    expect(calls).toHaveLength(1)
    expect(calls[0].card.id).toBe('c1')
    expect(calls[0].type).toBe('keyup')
  })

  it('CONTROL: a key on an element inside the card does not open the card', async () => {
    const calls = await renderBoard()
    const link = screen.getByRole('link', { name: 'example.com' })
    const input = screen.getByRole('textbox', { name: 'Note' })
    expect(card()).toContainElement(link)
    expect(card()).toContainElement(input)
    for (const el of [link, input]) {
      fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' })
      fireEvent.keyDown(el, { key: ' ', code: 'Space' })
      fireEvent.keyUp(el, { key: ' ', code: 'Space' })
    }
    expect(calls).toHaveLength(0)
  })

  it('CONTROL: other keys on the focused card open nothing', async () => {
    const calls = await renderBoard()
    const el = card()
    el.focus()
    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown']) {
      fireEvent.keyDown(el, { key })
      fireEvent.keyUp(el, { key })
    }
    expect(calls).toHaveLength(0)
  })

  it('CONTROL: a pointer click still calls onCardClick once, with the click', async () => {
    const calls = await renderBoard()
    fireEvent.click(card())
    expect(calls).toHaveLength(1)
    expect(calls[0].card.id).toBe('c1')
    expect(calls[0].type).toBe('click')
  })
})
