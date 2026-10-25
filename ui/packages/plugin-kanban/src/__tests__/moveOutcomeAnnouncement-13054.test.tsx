/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A cross-column move is announced when its write settles, never at the drop
 * — objectui#13054.
 *
 * The defect: the drag announcer returned "Moved CARD to COLUMN." from
 * dnd-kit's `onDragEnd`, which runs the instant the pointer is released,
 * before the write has answered. A move the server refused (the showcase's
 * task state machine answers 400 "Invalid task status transition.") was
 * announced to a screen reader as done, while the sighted user saw the
 * refusal toast and the card snap back.
 *
 * The instrument: the real `ObjectKanban`, the real board, the real
 * `DndContext`, sensors and handlers, driven by pointer events, with the
 * 12716 test geometry in place of `collisionDetection` (the test DOM measures
 * every box as zero): the pointer's x picks the droppable, one band per
 * 100px, band 0 being the card over itself. Every text either live region —
 * dnd-kit's and the board's move status region — ever holds is recorded, so
 * "never holds Moved" is a reading of the whole drag, not of its last frame.
 *
 * There is no keyboard leg: the board builds no `KeyboardSensor`
 * (`dndInstructions-12837.test.tsx` pins it absent), so a pointer drag is the
 * only way a card moves.
 */

import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { registerAllFields } from '@object-ui/fields'
import { toast } from '@object-ui/components'
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types'
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

import { ObjectKanban } from '../ObjectKanban'
import KanbanBoard from '../KanbanImpl'

registerAllFields()

const CARD = 'Fix the widget'
const REFUSAL = 'Invalid task status transition.'

const objectDef = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: {
      type: 'picklist',
      label: 'Status',
      options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'in_progress', label: 'In Progress' },
      ],
    },
  },
}

const schema = {
  type: 'object-kanban',
  objectName: 'task',
  groupBy: 'status',
  cardTitle: 'title',
  columns: [
    { id: 'backlog', title: 'Backlog' },
    { id: 'in_progress', title: 'In Progress' },
  ],
} satisfies ObjectKanbanSchema

const serverRecords = () => [
  { id: 't1', title: CARD, status: 'backlog' },
  { id: 't2', title: 'Write the notes', status: 'backlog' },
]

function makeDataSource(update: DataSource['update']): DataSource {
  return {
    getObjectSchema: vi.fn(async () => objectDef),
    find: vi.fn(async () => ({ value: serverRecords() })),
    update,
  } as unknown as DataSource
}

const dndRegion = () => document.querySelector('[id^="DndLiveRegion"]')
const moveRegion = () => document.querySelector('[id^="KanbanMoveStatus"]')

/** Every text either live region held, in order, for the whole test. */
let heard: string[] = []
let observer: MutationObserver | null = null
function listen() {
  heard = []
  const sample = () => {
    for (const el of [dndRegion(), moveRegion()]) {
      const text = el?.textContent ?? ''
      if (text !== '' && heard[heard.length - 1] !== text) heard.push(text)
    }
  }
  observer = new MutationObserver(sample)
  observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  return sample
}

function cardsIn(columnTitle: string): string[] {
  const list = screen.getByRole('list', { name: `${columnTitle} cards` })
  return within(list).queryAllByRole('listitem').map((el) => el.getAttribute('aria-label') ?? '')
}

/** The sortable node of a card, tagged with its id so band 0 is the card over itself. */
function grab(title: string, id: string): HTMLElement {
  const el = screen.getByRole('button', { name: title })
  el.dataset.cardId = id
  return el
}

function pointerDrag(cardEl: HTMLElement, bands: Array<string | null>, sample: () => void) {
  geometry.bands = [cardEl.dataset.cardId ?? null, ...bands]
  fireEvent.pointerDown(cardEl, { isPrimary: true, button: 0, clientX: 50, clientY: 10 })
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 60, clientY: 10 })
  sample()
  bands.forEach((_, i) => {
    fireEvent.pointerMove(document, { isPrimary: true, clientX: (i + 1) * 100 + 50, clientY: 10 })
    sample()
  })
}
const escape = () => fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

async function mountObjectKanban(update: DataSource['update']) {
  render(<ObjectKanban schema={schema} dataSource={makeDataSource(update)} />)
  expect(await screen.findByText(CARD)).toBeInTheDocument()
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  await waitFor(() => expect(cardsIn('Backlog')).toEqual([CARD, 'Write the notes']))
}

let toastError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never)
})

afterEach(() => {
  escape()
  observer?.disconnect()
  observer = null
  cleanup()
  geometry.bands = []
  vi.restoreAllMocks()
})

describe('a cross-column move is announced when its write settles (objectui#13054)', () => {
  it('a refused move is never announced as moved; the board says the refusal the toast shows', async () => {
    const update = vi.fn(async () => {
      throw Object.assign(new Error(REFUSAL), { status: 400, code: 'invalid_transition' })
    })
    await mountObjectKanban(update as never)
    const sample = listen()

    pointerDrag(grab(CARD, 't1'), ['in_progress'], sample)
    await act(async () => {
      fireEvent.pointerUp(document, { isPrimary: true, button: 0 })
    })
    await waitFor(() => expect(moveRegion()?.textContent).not.toBe(''))
    sample()

    expect(update).toHaveBeenCalledWith('task', 't1', { status: 'in_progress' })
    // The refusal the board speaks is the toast's sentence, word for word.
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).toBe(REFUSAL)
    expect(moveRegion()?.textContent).toBe(REFUSAL)
    expect(moveRegion()).toHaveAttribute('aria-live', 'assertive')
    expect(moveRegion()).toHaveAttribute('role', 'status')
    // The gate: no region ever said the card moved.
    expect(heard.filter((text) => text.startsWith('Moved'))).toEqual([])
    expect(heard[heard.length - 1]).toBe(REFUSAL)
    // Control: the refusal really reverted the card.
    await waitFor(() => expect(cardsIn('Backlog')).toEqual([CARD, 'Write the notes']))
    expect(cardsIn('In Progress')).toEqual([])
  })

  it('an accepted move is announced as moved only after the write resolves', async () => {
    let accept: () => void = () => undefined
    const update = vi.fn(() => new Promise<void>((resolve) => { accept = resolve }))
    await mountObjectKanban(update as never)
    const sample = listen()

    pointerDrag(grab(CARD, 't1'), ['in_progress'], sample)
    await act(async () => {
      fireEvent.pointerUp(document, { isPrimary: true, button: 0 })
    })
    sample()
    // The write has not answered: nothing says the card moved.
    expect(update).toHaveBeenCalledTimes(1)
    expect(moveRegion()?.textContent).toBe('')
    expect(heard.filter((text) => text.startsWith('Moved'))).toEqual([])

    await act(async () => { accept() })
    await waitFor(() => expect(moveRegion()?.textContent).toBe('Moved Fix the widget to In Progress.'))
    sample()
    expect(heard[heard.length - 1]).toBe('Moved Fix the widget to In Progress.')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('controls: a same-column drop and a cancel keep their sentences and write nothing', async () => {
    const update = vi.fn(async () => undefined)
    await mountObjectKanban(update as never)
    const sample = listen()

    pointerDrag(grab(CARD, 't1'), ['t2'], sample)
    await act(async () => {
      fireEvent.pointerUp(document, { isPrimary: true, button: 0 })
    })
    expect(dndRegion()?.textContent).toBe('Dropped Fix the widget. It stays in Backlog.')

    pointerDrag(grab(CARD, 't1'), ['in_progress'], sample)
    await act(async () => { escape() })
    expect(dndRegion()?.textContent).toBe('Cancelled moving Fix the widget. It stays in Backlog.')

    expect(update).not.toHaveBeenCalled()
    expect(moveRegion()?.textContent).toBe('')
  })
})

describe('the board speaks what its mover reports (objectui#13054)', () => {
  const columns = (): KanbanColumn[] => [
    { id: 'todo', title: 'To Do', cards: [{ id: 'c1', title: 'Card one' }] },
    { id: 'done', title: 'Done', cards: [] },
  ]

  async function dropWith(onCardMove: React.ComponentProps<typeof KanbanBoard>['onCardMove']) {
    render(<KanbanBoard columns={columns()} onCardMove={onCardMove} />)
    const sample = listen()
    pointerDrag(grab('Card one', 'c1'), ['done'], sample)
    await act(async () => {
      fireEvent.pointerUp(document, { isPrimary: true, button: 0 })
    })
    await act(async () => { await Promise.resolve() })
    sample()
  }

  it('a deferred move (the mover asks for more input first) is announced by nothing at settle', async () => {
    await dropWith(async () => ({ kind: 'deferred' }))
    expect(moveRegion()?.textContent).toBe('')
    expect(heard.filter((text) => text.startsWith('Moved'))).toEqual([])
  })

  it('a board with no mover announces the move at once, as before', async () => {
    await dropWith(undefined)
    expect(moveRegion()?.textContent).toBe('Moved Card one to Done.')
  })
})
