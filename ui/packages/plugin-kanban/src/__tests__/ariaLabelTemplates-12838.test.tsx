/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The kanban board's interpolating accessible names are one pack sentence
 * each, so under zh a screen reader hears zh words around the label —
 * objectui#12838.
 *
 * The defect: three names were English templates around a value, so under zh
 * the lane list read "待规划 cards", a swimlane cell "待规划 - ann cards", and
 * the drag overlay "Dragging 内容待办". They now read `kanban.columnCards`,
 * `kanban.laneCards` and `kanban.dnd.dragging` through the board's own
 * translation hook, with the label interpolated.
 *
 * Every zh name is read against the PACK with the value filled in, and each
 * case first proves the two packs disagree, or it would pin nothing. The
 * CONTROL: under en the three names read exactly as before.
 *
 * The instrument is the real board and the real `DndContext`: a pointer
 * pick-up past the 5px activation distance paints the real `DragOverlay`.
 */

import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@object-ui/i18n'
import { en, zh } from '@object-ui/i18n/locales'
import KanbanBoard from '../KanbanImpl'
import type { KanbanColumn } from '../types'

type Lang = 'en' | 'zh'
const PACKS = { en, zh } as const

const COLUMN = { en: 'To do', zh: '待规划' } as const
const CARD = { en: 'Content backlog', zh: '内容待办' } as const
const LANE = 'ann'

const columns = (lang: Lang): KanbanColumn[] => [
  { id: 'todo', title: COLUMN[lang], cards: [{ id: 'c1', title: CARD[lang], owner: LANE }] },
  // Empty, so the board paints its `kanban.noCards` placeholder: the control
  // that the catalogue is loaded and the provider really speaks the language.
  { id: 'done', title: 'Done', cards: [] },
]

/** Fill `{{name}}` holes the way the packs spell them. */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? '')

async function renderBoard(lang: Lang, swimlaneField?: string) {
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <KanbanBoard columns={columns(lang)} onCardMove={() => {}} swimlaneField={swimlaneField} />
    </I18nProvider>,
  )
  // The swimlane layout paints no `kanban.noCards` placeholder in an empty
  // cell; its cases wait on the name itself, which is read from the same pack.
  if (!swimlaneField) await screen.findByText(PACKS[lang].kanban.noCards)
}

/** The three names, read off the rendered board. */
const laneListName = (lang: Lang) => fill(PACKS[lang].kanban.columnCards, { column: COLUMN[lang] })
const swimlaneCellName = (lang: Lang) => fill(PACKS[lang].kanban.laneCards, { column: COLUMN[lang], lane: LANE })
const overlayName = (lang: Lang) => fill(PACKS[lang].kanban.dnd.dragging, { card: CARD[lang] })

/** Pick the card up with the pointer, past the board's 5px activation distance. */
function pickUp(lang: Lang) {
  const el = screen.getByRole('button', { name: CARD[lang] })
  fireEvent.pointerDown(el, { isPrimary: true, button: 0, clientX: 50, clientY: 10 })
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 70, clientY: 10 })
}

/**
 * The drag overlay's wrapper: the board's own `aria-live="assertive"` element,
 * not dnd-kit's live region nor the board's move status region (objectui#13054)
 * — both assertive too, each with its own id.
 */
const overlay = () =>
  document.querySelector('[aria-live="assertive"]:not([id^="DndLiveRegion"]):not([id^="KanbanMoveStatus"])')

afterEach(() => {
  // Cancel a drag a failed test left live, so it cannot end in the next board.
  fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
  cleanup()
})

describe('the kanban board names its card lists and its drag overlay from the pack (objectui#12838)', () => {
  it('the packs disagree, so each zh case pins something', () => {
    expect(zh.kanban.columnCards).not.toBe(en.kanban.columnCards)
    expect(zh.kanban.laneCards).not.toBe(en.kanban.laneCards)
    expect(zh.kanban.dnd.dragging).not.toBe(en.kanban.dnd.dragging)
  })

  it('under zh, the lane list is named by the zh sentence with the column interpolated', async () => {
    await renderBoard('zh')
    expect(screen.getByRole('list', { name: laneListName('zh') })).toBeInTheDocument()
    expect(laneListName('zh')).toBe('待规划 的卡片')
    expect(screen.queryByRole('list', { name: `${COLUMN.zh} cards` })).toBeNull()
  })

  it('under zh, a swimlane cell is named by the zh sentence with the column and lane interpolated', async () => {
    await renderBoard('zh', 'owner')
    expect(await screen.findByRole('list', { name: swimlaneCellName('zh') })).toBeInTheDocument()
    expect(swimlaneCellName('zh')).toBe('待规划 - ann 的卡片')
    expect(screen.queryByRole('list', { name: `${COLUMN.zh} - ${LANE} cards` })).toBeNull()
  })

  it('under zh, the drag overlay is named by the zh sentence with the card interpolated', async () => {
    await renderBoard('zh')
    expect(overlay()?.getAttribute('aria-label') ?? null).toBeNull()
    pickUp('zh')
    expect(overlay()).toHaveAttribute('aria-label', overlayName('zh'))
    expect(overlayName('zh')).toBe('正在拖动 内容待办')
  })

  describe('CONTROL: under en the three names read exactly as before', () => {
    it('the lane list', async () => {
      await renderBoard('en')
      expect(screen.getByRole('list', { name: 'To do cards' })).toBeInTheDocument()
      expect(laneListName('en')).toBe('To do cards')
    })

    it('a swimlane cell', async () => {
      await renderBoard('en', 'owner')
      expect(await screen.findByRole('list', { name: 'To do - ann cards' })).toBeInTheDocument()
      expect(swimlaneCellName('en')).toBe('To do - ann cards')
    })

    it('the drag overlay', async () => {
      await renderBoard('en')
      pickUp('en')
      expect(overlay()).toHaveAttribute('aria-label', 'Dragging Content backlog')
      expect(overlayName('en')).toBe('Dragging Content backlog')
    })

    it('with no provider, the board falls back to the same English sentences', async () => {
      render(<KanbanBoard columns={columns('en')} onCardMove={() => {}} />)
      expect(await screen.findByRole('list', { name: 'To do cards' })).toBeInTheDocument()
      pickUp('en')
      expect(overlay()).toHaveAttribute('aria-label', 'Dragging Content backlog')
    })
  })
})
