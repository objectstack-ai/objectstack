/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The board's drag live region names the card by its title and the column by
 * its label, never by the record id or the option value — objectui#12716.
 *
 * The defect: the board's `DndContext` passed no `accessibility`, so dnd-kit's
 * default sentences read its ids to a screen reader, in English whatever the
 * locale ("Draggable item gZguOoFVfxm_pSPG was moved over droppable area
 * 4iDmJaZr0O0St1fb"). Every case below reads the REAL live region dnd-kit
 * renders.
 *
 * The instrument: the real board, the real `DndContext`, the real sensors and
 * the real handlers. Only `collisionDetection` is replaced, by a test geometry
 * in which the pointer's x picks the droppable (one band per 100px), because
 * the test DOM measures every box as zero — the form designer's instrument
 * (objectui#11802). Band 0 is where the pointer goes down: the card over
 * itself, which is what a browser reports at pick-up. The browser reading the
 * bands copy is on the pull request: at pick-up the card is over itself, over
 * a neighbouring card it is over that card's id, and over a column's empty
 * area it is over the column's option value.
 *
 * The control rides every drop: the column the region names is compared with
 * the move the board hands `onCardMove`, so a sentence cannot stay green while
 * the drop does something else.
 */

import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@object-ui/i18n'
import type { KanbanColumn } from '../types'

const geometry = vi.hoisted(() => ({ bands: [] as Array<string | null> }))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const ReactMod = await import('react')
  const byBand: import('@dnd-kit/core').CollisionDetection = ({ pointerCoordinates }) => {
    const id = pointerCoordinates ? (geometry.bands[Math.floor(pointerCoordinates.x / 100)] ?? null) : null
    return id ? [{ id }] : []
  }
  const GeometryDndContext = (props: Record<string, unknown>) =>
    ReactMod.createElement(actual.DndContext, { ...props, collisionDetection: byBand } as never)
  return { ...actual, DndContext: GeometryDndContext }
})

import KanbanBoard from '../KanbanImpl'

/** Record ids and option values shaped like the showcase board's. */
const CONTENT = 'gZguOoFVfxm_pSPG'
const SEO = '4iDmJaZr0O0St1fb'
const EVIDENCE = 'R-rXBJewHjmPzNfF'
const TODO = 'todo'
const DOING = 'in_progress'
const DONE = 'done'
const IDS = [CONTENT, SEO, EVIDENCE, TODO, DOING, DONE]

const columns = (): KanbanColumn[] => [
  {
    id: TODO,
    title: 'To Do',
    cards: [
      { id: CONTENT, title: 'Content backlog' },
      { id: EVIDENCE, title: 'Evidence collection' },
    ],
  },
  { id: DOING, title: 'In Progress', cards: [{ id: SEO, title: 'SEO migration plan' }] },
  // Empty, so the board paints its `kanban.noCards` placeholder: the control
  // that the zh catalogue is loaded and the provider really speaks zh.
  { id: DONE, title: 'Done', cards: [] },
]

let moves: unknown[][] = []

/** The empty column's placeholder, the pack's `kanban.noCards`, in each language. */
const NO_CARDS = { en: 'No cards', zh: '暂无卡片' } as const

/**
 * Render the board under a provider in `lang`, and wait until the board's own
 * copy reads in that language: the catalogue a sentence reads is loaded.
 */
async function renderBoard(lang: 'en' | 'zh') {
  moves = []
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <KanbanBoard columns={columns()} onCardMove={(...args: unknown[]) => { moves.push(args) }} />
    </I18nProvider>,
  )
  await screen.findByText(NO_CARDS[lang])
}

/** What the live region says now. */
const said = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? null
/**
 * What the board's move status region says now: a cross-column move is
 * announced there once its write settles, not by dnd-kit at the drop
 * (objectui#13054). This board's mover writes nothing, so it settles at once.
 */
const settled = () => document.querySelector('[id^="KanbanMoveStatus"]')?.textContent ?? null
// The sortable node — the `button` inside each card's `listitem` (objectui#12883).
const card = (title: string) => screen.getByRole('button', { name: title })

/**
 * Pick the card up with the pointer, then move it through `bands` (band 1, 2,
 * …), recording what the region says after the pick-up and after each move.
 */
function pointerDrag(cardEl: HTMLElement, bands: Array<string | null>): string[] {
  geometry.bands = [cardEl.dataset.cardId ?? null, ...bands]
  const heard: string[] = []
  fireEvent.pointerDown(cardEl, { isPrimary: true, button: 0, clientX: 50, clientY: 10 })
  // Past the board's 5px activation distance: the drag starts at band 0.
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 60, clientY: 10 })
  heard.push(said() ?? '')
  bands.forEach((_, i) => {
    fireEvent.pointerMove(document, { isPrimary: true, clientX: (i + 1) * 100 + 50, clientY: 10 })
    heard.push(said() ?? '')
  })
  return heard
}
const pointerDrop = () => fireEvent.pointerUp(document, { isPrimary: true, button: 0 })
// The pointer sensor listens for Escape on the document while a drag is live.
const escape = () => fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

afterEach(() => {
  // A test that failed mid-drag leaves the pointer sensor listening on the
  // document; cancel that drag so it cannot end inside the next test's board.
  escape()
  cleanup()
  geometry.bands = []
})

/** The dragged card, tagged with its id so band 0 is the card over itself. */
function grab(title: string, id: string): HTMLElement {
  const el = card(title)
  el.dataset.cardId = id
  return el
}

/** No sentence carries a record id or an option value. */
function expectNoIds(sentences: Array<string | null>) {
  for (const sentence of sentences) {
    for (const id of IDS) expect(sentence ?? '').not.toContain(id)
  }
}

describe('the kanban board announces titles and labels, not ids (objectui#12716)', () => {
  it('picked up, over a card of another column, over a column, over nothing, cancelled', async () => {
    await renderBoard('en')
    const heard = pointerDrag(grab('Content backlog', CONTENT), [SEO, DONE, null])

    // The card over itself names the place the pick-up named, so the region
    // keeps the pick-up sentence rather than replacing it.
    expect(heard[0]).toBe('Picked up Content backlog in To Do.')
    expect(heard[1]).toBe('Moving Content backlog over SEO migration plan in In Progress.')
    expect(heard[2]).toBe('Moving Content backlog over Done.')
    expect(heard[3]).toBe('Moving Content backlog. It is not over a column.')

    escape()
    expect(said()).toBe('Cancelled moving Content backlog. It stays in To Do.')
    expectNoIds([...heard, said()])
    // Control: a cancelled drag moved nothing.
    expect(moves).toEqual([])
  })

  it('a drop on a card of another column announces the column the board moves it to', async () => {
    await renderBoard('en')
    const heard = pointerDrag(grab('Content backlog', CONTENT), [SEO])
    pointerDrop()

    expect(settled()).toBe('Moved Content backlog to In Progress.')
    // dnd-kit's region says nothing at the drop: it still holds the last place.
    expect(said()).toBe('Moving Content backlog over SEO migration plan in In Progress.')
    expectNoIds([...heard, said(), settled()])
    // Control: the board moved the card to the column the region names.
    expect(moves).toHaveLength(1)
    expect(moves[0].slice(0, 3)).toEqual([CONTENT, TODO, DOING])
  })

  it('a drop in its own column announces that the card stays', async () => {
    await renderBoard('en')
    const heard = pointerDrag(grab('Content backlog', CONTENT), [EVIDENCE])
    expect(heard[1]).toBe('Moving Content backlog over Evidence collection in To Do.')
    pointerDrop()

    expect(said()).toBe('Dropped Content backlog. It stays in To Do.')
    expectNoIds([...heard, said()])
    // Control: a drop inside its own column moves nothing.
    expect(moves).toEqual([])
  })

  it('says it in zh', async () => {
    // Control: the provider speaks zh — `renderBoard` waits for the empty
    // column's placeholder, the zh pack's `kanban.noCards`.
    await renderBoard('zh')
    expect(screen.queryByText('No cards')).toBeNull()

    const heard = pointerDrag(grab('Content backlog', CONTENT), [SEO, DONE])
    expect(heard[0]).toBe('已拿起 Content backlog，当前在 To Do。')
    expect(heard[1]).toBe('Content backlog 正移到 In Progress 中的 SEO migration plan 上。')
    expect(heard[2]).toBe('Content backlog 正移到 Done。')

    escape()
    expect(said()).toBe('已取消拖动。Content backlog 仍在 To Do。')
    expectNoIds([...heard, said()])
  })

  it('names a card with a blank title by a neutral phrase, never by its id', async () => {
    moves = []
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <KanbanBoard
          columns={[
            { id: TODO, title: 'To Do', cards: [{ id: CONTENT, title: '' }] },
            { id: DOING, title: ' ', cards: [] },
          ]}
          onCardMove={(...args: unknown[]) => { moves.push(args) }}
        />
      </I18nProvider>,
    )
    await screen.findByText(NO_CARDS.en)
    const el = document.querySelector('[aria-roledescription="sortable"][role="button"]') as HTMLElement
    el.dataset.cardId = CONTENT
    const heard = pointerDrag(el, [DOING])
    expect(heard[0]).toBe('Picked up an untitled card in To Do.')
    expect(heard[1]).toBe('Moving an untitled card over an unnamed column.')
    await act(async () => { pointerDrop() })
    expect(settled()).toBe('Moved an untitled card to an unnamed column.')
    expectNoIds([...heard, said(), settled()])
    expect(moves[0].slice(0, 3)).toEqual([CONTENT, TODO, DOING])
  })
})
