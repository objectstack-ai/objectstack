// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Home item-type label parity (objectui#6165).
 *
 * Three Home surfaces render a label for the same item kind — the rail
 * (`HomeRail.HomeContinue`), the Recently-Accessed cards (`RecentApps`) and
 * the Starred cards (`StarredApps`) — through one key namespace,
 * `home.recentApps.itemType.*`. They disagreed on the FALLBACK: the cards
 * rendered `capitalizeFirst(type)` while the rail rendered the bare `type`,
 * so an unkeyed kind read `Report` on the cards and `report` in the rail, on
 * the same screen.
 *
 * ⚠️ WHY THE FIXTURE USES A SYNTHETIC KIND. Every member of the union today
 * (`object|dashboard|page|report|record|metadata`, plus `nav` on the favorite
 * side) HAS a key, so a test built on a real member takes the keyed path and
 * never reaches the fallback — it passes both before and after the fix and
 * proves nothing. The pin therefore uses a kind with NO key. That is the
 * whole point of the card: the defect is dormant for today's members and
 * wakes up for the next one added.
 *
 * ⚠️ WHAT IS ASSERTED. The defect is DISAGREEMENT BETWEEN CONSUMERS, so the
 * assertion is agreement — all three surfaces resolving one kind to one
 * string — not any single component's output in isolation.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

import type { RecentItem } from '../../../hooks/useRecentItems.js';
import type { FavoriteItem } from '../../../hooks/useFavorites.js';
import { capitalizeFirst } from '../../../utils/index.js';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

/**
 * One translator for all three surfaces.
 *
 * The keyed entry is spelled in zh (verbatim from
 * `packages/i18n/src/locales/zh.ts`) on purpose: `capitalizeFirst` could
 * never produce `报表`, so the keyed control below cannot pass by accidentally
 * running the fallback. Anything not in this map misses, exactly as i18next
 * misses an absent key, and the call site's `defaultValue` decides.
 */
vi.mock('@object-ui/i18n', async (importOriginal) => {
  const KEYED: Record<string, string> = {
    'home.recentApps.itemType.report': '报表',
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useObjectTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        KEYED[key] ?? String(options?.defaultValue ?? key),
      language: 'zh',
    }),
  };
});

import { useObjectTranslation } from '@object-ui/i18n';
import { HomeContinue } from '../HomeRail.js';
import { recentItemTypeLabel } from '../recentItemTypeLabel.js';
import { useRecentItemLabel } from '../../../hooks/useRecentItemLabel.js';
import { RecentApps } from '../RecentApps.js';
import { StarredApps } from '../StarredApps.js';

/** A kind with NO `home.recentApps.itemType.*` key. */
const UNKEYED_KIND = 'playbook';
/** A kind WITH a key — the control that must stay untouched. */
const KEYED_KIND = 'report';

const ITEM_LABEL = 'Quarterly revenue';

/**
 * The rail takes `t` as a prop while the cards pull it from the hook. Reading
 * it from the same hook here is what makes this a parity test rather than two
 * unrelated renders: all three surfaces are driven by one translator.
 */
function Rail({ items }: { items: RecentItem[] }) {
  const { t } = useObjectTranslation();
  // HomePage hands the rail its labeller the same way (objectui#11678).
  const labelOf = useRecentItemLabel();
  // The rail's trail opens with the kind for every kind but a record, which
  // `HomePage`'s resolver reads through the one helper (objectui#12604).
  return (
    <HomeContinue
      items={items}
      onOpen={() => {}}
      t={t}
      labelOf={labelOf}
      describe={(it) => ({ context: recentItemTypeLabel(t, it.type) })}
    />
  );
}

/**
 * Every surface renders the item label followed by the type label inside the
 * item node, so the type label is what remains once the known label is
 * removed. The two `expect`s are instrument checks — they fail loudly if a
 * surface stops rendering in that shape, instead of silently returning `''`
 * and making a comparison of two empty strings look like agreement.
 */
function typeLabelOf(node: HTMLElement, itemLabel: string): string {
  const text = (node.textContent ?? '').trim();
  expect(text.startsWith(itemLabel)).toBe(true);
  // The rail's trail goes on to the visit time ("Report · just now",
  // objectui#12604); the kind is its first part.
  const typeLabel = text.slice(itemLabel.length).split(' · ')[0].trim();
  expect(typeLabel).not.toBe('');
  return typeLabel;
}

function renderAllThree(kind: string) {
  // A synthetic kind is no member of the `RecentItem` union, so the entry is
  // cast. It carries BOTH `name` (what a named kind — `report` here — is
  // labelled from when no metadata is loaded) and `label` (what any other kind
  // shows), so every surface renders ITEM_LABEL whichever arm the kind falls in
  // (objectui#11678).
  const recent = [
    {
      id: 'r1',
      name: ITEM_LABEL,
      label: ITEM_LABEL,
      href: '/x',
      type: kind,
      visitedAt: new Date().toISOString(),
    },
  ] as unknown as RecentItem[];
  const favorites: FavoriteItem[] = [
    {
      id: 'f1',
      label: ITEM_LABEL,
      href: '/x',
      type: kind as FavoriteItem['type'],
      favoritedAt: new Date().toISOString(),
    },
  ];

  render(
    <>
      <div data-testid="rail-surface">
        <Rail items={recent} />
      </div>
      <RecentApps items={recent} />
      <StarredApps items={favorites} />
    </>,
  );

  return {
    rail: typeLabelOf(within(screen.getByTestId('rail-surface')).getByRole('button'), ITEM_LABEL),
    recentCard: typeLabelOf(screen.getByTestId('recent-item-r1'), ITEM_LABEL),
    starredCard: typeLabelOf(screen.getByTestId('starred-item-f1'), ITEM_LABEL),
  };
}

describe('Home item-type label parity across the three consumers', () => {
  it('fixture guard: the two candidate spellings differ for the unkeyed kind', () => {
    // Without this, a single-character or already-capitalized kind would make
    // both spellings identical and the pin below would agree trivially —
    // passing while proving nothing.
    expect(UNKEYED_KIND.length).toBeGreaterThan(1);
    expect(capitalizeFirst(UNKEYED_KIND)).not.toBe(UNKEYED_KIND);
  });

  it('THE PIN: a kind with no translation key renders one identical label on all three surfaces', () => {
    const { rail, recentCard, starredCard } = renderAllThree(UNKEYED_KIND);

    // Agreement is the assertion. Before objectui#6165 the rail answered
    // 'playbook' here while both cards answered 'Playbook'.
    expect(rail).toBe(recentCard);
    expect(rail).toBe(starredCard);

    // And the agreed spelling is the readable one the two cards already used
    // — pinning the DIRECTION of the convergence, so a future "make them all
    // agree" that converges on the bare lowercase fails here too.
    expect(rail).toBe(capitalizeFirst(UNKEYED_KIND));
  });

  it('control: a kind WITH a translation key still resolves through the key on all three surfaces', () => {
    // Passes before and after the fix by design: the change is bounded to the
    // fallback, and this is what proves it. `报表` is unreachable from the
    // fallback, so a green here means the keyed path genuinely ran.
    const { rail, recentCard, starredCard } = renderAllThree(KEYED_KIND);

    expect(rail).toBe('报表');
    expect(recentCard).toBe('报表');
    expect(starredCard).toBe('报表');
  });
});
