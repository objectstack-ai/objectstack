/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A collapsed lane's CJK title stands upright — objectstack#37274.
 *
 * The defect: a collapsed lane set its title `writing-mode: vertical-rl` and
 * then turned it 180°. vertical-rl already sets Han, kana and Hangul upright,
 * so the turn stood every glyph of 「已取消」 on its head, read bottom-to-top.
 * A title in those scripts now drops the turn and sets every glyph upright.
 *
 * CONTROL: a Latin title keeps the turn — it still reads bottom-to-top, as it
 * did before this card. jsdom lays nothing out, so the pin reads the classes
 * that decide the orientation; the rendered orientation was measured in
 * Chromium on the PR.
 */

import '@testing-library/jest-dom/vitest'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import KanbanBoard from '../KanbanImpl'
import type { KanbanColumn } from '../types'

const COLUMNS: KanbanColumn[] = [
  { id: 'open', title: 'Open', cards: [{ id: 'c1', title: 'A card' }] },
  { id: 'cancelled_zh', title: '已取消', collapsed: true, cards: [] },
  { id: 'cancelled_en', title: 'Cancelled', collapsed: true, cards: [] },
]

/** The span that carries the collapsed lane's title text. */
const titleSpan = (title: string) => screen.getByText(title, { selector: 'span' })

describe('a collapsed lane title runs down its spine readably (objectstack#37274)', () => {
  afterEach(cleanup)

  it('sets a CJK title upright, without the 180° turn; a Latin title keeps the turn', () => {
    render(<KanbanBoard columns={COLUMNS} onCardMove={() => {}} />)

    // Both lanes really render collapsed — a disclosure reporting closed.
    expect(screen.getByRole('button', { name: '已取消' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Cancelled' })).toHaveAttribute('aria-expanded', 'false')

    // THE SUBJECT — the CJK title: vertical, upright, not turned.
    const cjk = titleSpan('已取消')
    expect(cjk).toHaveClass('[writing-mode:vertical-rl]', '[text-orientation:upright]')
    expect(cjk).not.toHaveClass('rotate-180')

    // CONTROL — the Latin title renders exactly as before: vertical, turned.
    const latin = titleSpan('Cancelled')
    expect(latin).toHaveClass('[writing-mode:vertical-rl]', 'rotate-180')
    expect(latin).not.toHaveClass('[text-orientation:upright]')
  })
})
