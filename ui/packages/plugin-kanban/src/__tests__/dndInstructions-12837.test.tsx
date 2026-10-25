/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Each kanban card's accessible description says how a card moves today, in
 * the viewer's language, and names no key — objectui#12837.
 *
 * The defect: the board passed no `screenReaderInstructions`, so every card's
 * `aria-describedby` pointed at dnd-kit's default English text ("To pick up a
 * draggable item, press the space bar …"). The board has no keyboard sensor,
 * so the key it named did nothing, and the text stayed English under zh.
 *
 * The instrument: the real board and the real `DndContext`. Only `useSensor`
 * is wrapped, to record which sensors the board builds; the wrapped call
 * returns what dnd-kit's own `useSensor` returns.
 *
 * The control: the board builds no `KeyboardSensor`, so a sentence that named
 * no key is the true one, and Space on a focused card still starts no drag.
 */

import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@object-ui/i18n'
import type { KanbanColumn } from '../types'

const built = vi.hoisted(() => ({ sensors: [] as unknown[] }))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const useSensor: typeof actual.useSensor = (sensor, options) => {
    built.sensors.push(sensor)
    return actual.useSensor(sensor, options)
  }
  return { ...actual, useSensor }
})

import { KeyboardSensor, PointerSensor, TouchSensor } from '@dnd-kit/core'
import KanbanBoard from '../KanbanImpl'

const columns = (): KanbanColumn[] => [
  { id: 'todo', title: 'To Do', cards: [{ id: 'c1', title: 'Content backlog' }] },
  // Empty, so the board paints its `kanban.noCards` placeholder: the control
  // that the catalogue is loaded and the provider really speaks the language.
  { id: 'done', title: 'Done', cards: [] },
]

const NO_CARDS = { en: 'No cards', zh: '暂无卡片' } as const

/** The bundle's `kanban.dnd.instructions`, in each language. */
const INSTRUCTIONS = {
  en: 'To move this card to another column, drag it with a pointer or by touch.',
  zh: '如需将此卡片移到其他列，请用鼠标或触控拖动它。',
} as const

/** Key names the description may not carry. */
const KEY_NAMES = ['space', 'Space', '空格', 'arrow', '方向键']

async function renderBoard(lang: 'en' | 'zh') {
  built.sensors = []
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <KanbanBoard columns={columns()} onCardMove={() => {}} />
    </I18nProvider>,
  )
  await screen.findByText(NO_CARDS[lang])
}

// The focusable control, which carries the description; since objectui#12883
// it is the `button` inside the card's `listitem`.
const card = () => screen.getByRole('button', { name: 'Content backlog' })

/** The text of the node the card's `aria-describedby` points at. */
function description(el: HTMLElement): string {
  const id = el.getAttribute('aria-describedby')
  expect(id).toBeTruthy()
  const node = document.getElementById(id as string)
  expect(node).not.toBeNull()
  return node?.textContent ?? ''
}

afterEach(() => {
  cleanup()
})

describe("each kanban card's description names no key (objectui#12837)", () => {
  it.each(['en', 'zh'] as const)('under %s the description is the bundle sentence', async (lang) => {
    await renderBoard(lang)
    const text = description(card())
    expect(text).toBe(INSTRUCTIONS[lang])
    for (const key of KEY_NAMES) expect(text).not.toContain(key)
  })

  it('CONTROL: the board builds pointer and touch sensors and no keyboard sensor', async () => {
    await renderBoard('en')
    expect(built.sensors).toContain(PointerSensor)
    expect(built.sensors).toContain(TouchSensor)
    expect(built.sensors).not.toContain(KeyboardSensor)
  })

  it('CONTROL: Space on a focused card starts no drag', async () => {
    await renderBoard('en')
    const el = card()
    el.focus()
    expect(el).toHaveFocus()
    const region = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? ''
    const before = region()
    fireEvent.keyDown(el, { key: ' ', code: 'Space' })
    expect(region()).toBe(before)
    expect(el).not.toHaveAttribute('aria-pressed', 'true')
  })
})
