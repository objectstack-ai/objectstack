/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The swimlane that holds cards with no value in the swimlane field is DRAWN
 * from the pack, not from the board's English constant — objectui#12899.
 *
 * The defect: under zh the lane heading read "Uncategorized" and the lane
 * cell's accessible name "待规划 - Uncategorized 的卡片". Both now read
 * `kanban.uncategorized` through the board's translation hook. Only the
 * display moved: the bucket key is unchanged, so collapsing still works.
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

const columns = (lang: Lang): KanbanColumn[] => [
  {
    id: 'todo',
    title: COLUMN[lang],
    cards: [
      { id: 'c1', title: 'Valued', owner: 'ann' },
      { id: 'c2', title: 'Valueless' },
    ],
  },
  { id: 'done', title: 'Done', cards: [] },
]

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? '')

function renderBoard(lang: Lang) {
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <KanbanBoard columns={columns(lang)} onCardMove={() => {}} swimlaneField="owner" />
    </I18nProvider>,
  )
}

const cellName = (lang: Lang, lane: string) =>
  fill(PACKS[lang].kanban.laneCards, { column: COLUMN[lang], lane })

afterEach(() => cleanup())

describe('the no-value swimlane is drawn from the pack (objectui#12899)', () => {
  it('the packs disagree, so the zh cases pin something', () => {
    expect(zh.kanban.uncategorized).not.toBe(en.kanban.uncategorized)
  })

  it('under zh, the lane heading and the lane cell name carry the zh value', async () => {
    renderBoard('zh')
    const zhLabel = zh.kanban.uncategorized
    expect(await screen.findByText(zhLabel)).toBeInTheDocument()
    expect(screen.queryByText('Uncategorized')).toBeNull()
    expect(screen.getByRole('list', { name: cellName('zh', zhLabel) })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: cellName('zh', 'Uncategorized') })).toBeNull()
  })

  describe('CONTROL', () => {
    it('under en, the no-value lane reads Uncategorized as before', async () => {
      renderBoard('en')
      expect(await screen.findByText('Uncategorized')).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'To do - Uncategorized cards' })).toBeInTheDocument()
    })

    it('a lane with a real value is unchanged under zh', async () => {
      renderBoard('zh')
      expect(await screen.findByText('ann')).toBeInTheDocument()
      expect(screen.getByRole('list', { name: cellName('zh', 'ann') })).toBeInTheDocument()
    })

    it('collapsing the no-value lane still works (the bucket key is unchanged)', async () => {
      renderBoard('zh')
      const label = zh.kanban.uncategorized
      const name = cellName('zh', label)
      const toggle = (await screen.findByText(label)).closest('button') as HTMLElement
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('list', { name })).toBeNull()
      // The valued lane did not collapse with it.
      expect(screen.getByRole('list', { name: cellName('zh', 'ann') })).toBeInTheDocument()
      fireEvent.click(toggle)
      expect(screen.getByRole('list', { name })).toBeInTheDocument()
    })
  })
})
