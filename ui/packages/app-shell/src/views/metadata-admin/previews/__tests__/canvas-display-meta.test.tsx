// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5837 — the page canvas draws chrome for what a page CAN CONTAIN,
 * not for what the palette OFFERS.
 *
 * `BLOCK_TYPE_META` is the palette's offer list ("what may an author drag in").
 * `PageBlockCanvas` was reading it to pick a node's icon and colour tone, which
 * is a different question ("what may an author already have in this page").
 * The two coincide for every palette exclusion whose reason is that the block
 * is not page content at all — and diverge for an alias pair, where one renderer
 * has two spellings and the palette deliberately advertises only one of them.
 * The unadvertised spelling renders perfectly and got the unknown-block box.
 *
 * ## What this file pins, and how it avoids two easy ways of being wrong
 *
 * 1. RENDERABILITY, NOT EXCLUSION. `BLOCK_RENDERER_ALIAS_GROUPS` is only
 *    allowed to list spellings that the runtime registry resolves to the very
 *    same component. That is asserted here against the real `ComponentRegistry`
 *    (identity, not "both defined"), so the declaration cannot quietly grant
 *    friendly chrome to a type that has no renderer behind it. The counter-probe
 *    is `element:text_input`: excluded for an unrelated reason, no twin, and it
 *    must keep the generic box.
 *
 * 2. NO ORIENTATION IS HARD-CODED. Which member of the pair the palette
 *    advertises is a maintainer decision that already flipped once (#5495 moved
 *    it from the legacy alias to the canonical name). Every assertion below
 *    DERIVES the offered/unoffered split from `BLOCK_TYPE_META` instead of
 *    naming a side, and one test flips the catalogue outright to prove the
 *    resolver follows.
 *
 * The offer list itself must not move: "the icon appears" is also satisfiable by
 * quietly making the type draggable, which is exactly the invariant #2943 built
 * `PALETTE_EXCLUSIONS` to protect. That is the third block of tests.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Side-effect import: registers `record:chatter` and `record:discussion`. The
// app-shell test setup does not pull plugin-detail in, and relying on another
// file having imported it first would make this suite order-dependent.
import '@object-ui/plugin-detail';
import {
  BLOCK_TYPE_META,
  BLOCK_CATEGORY_TONE,
  BLOCK_RENDERER_ALIAS_GROUPS,
  PALETTE_EXCLUSIONS,
  TYPES_BY_CATEGORY,
  UnknownBlockIcon,
  resolveBlockDisplayMeta,
  resolveBlockTone,
} from '../block-types';
import { PageBlockCanvas } from '../PageBlockCanvas';

afterEach(cleanup);

const offered = BLOCK_TYPE_META as Record<string, { category: string; Icon: unknown } | undefined>;
const mutableMeta = BLOCK_TYPE_META as unknown as Record<string, unknown>;

/** The declared groups, split into what the palette advertises and what it does not. */
const groupSplits = BLOCK_RENDERER_ALIAS_GROUPS.map((group) => ({
  group,
  advertised: group.filter((t) => offered[t] !== undefined),
  unadvertised: group.filter((t) => offered[t] === undefined),
}));

describe('BLOCK_RENDERER_ALIAS_GROUPS — the declaration is keyed on renderer identity (#5837)', () => {
  const config = (type: string) =>
    ComponentRegistry.getConfig(type) as { component?: React.ComponentType<unknown> } | undefined;

  it('declares at least one group, each with at least two spellings', () => {
    // Non-vacuity: every "for each group" assertion below passes over an empty
    // list, and a one-member group has nothing to borrow from.
    expect(BLOCK_RENDERER_ALIAS_GROUPS.length).toBeGreaterThan(0);
    for (const group of BLOCK_RENDERER_ALIAS_GROUPS) {
      expect(group.length, `${JSON.stringify(group)} is not a pair`).toBeGreaterThan(1);
    }
  });

  it('every spelling in a group resolves to the SAME registered renderer', () => {
    // This is how "renderable" is determined — not from the exclusion ledger,
    // which records unrelated reasons too, but from the registry itself. Two
    // independently registered renderers that happened to diverge would pass a
    // defined/defined check; identity is what makes borrowing chrome honest.
    for (const group of BLOCK_RENDERER_ALIAS_GROUPS) {
      const configs = group.map((t) => ({ type: t, cfg: config(t) }));
      for (const { type, cfg } of configs) {
        expect(cfg, `\`${type}\` is declared an alias but nothing registers it`).toBeDefined();
        expect(cfg!.component, `\`${type}\` registers no component`).toBeDefined();
      }
      const [first, ...rest] = configs;
      for (const other of rest) {
        expect(
          other.cfg!.component,
          `\`${other.type}\` and \`${first.type}\` are declared one renderer but resolve to two`,
        ).toBe(first.cfg!.component);
      }
    }
    // Non-vacuity for the lookup: a `getConfig` that returned a truthy object
    // for anything at all would make every assertion above meaningless.
    expect(config('record:zzNotARegisteredType')).toBeUndefined();
  });

  it('each group has exactly one advertised spelling, and the rest carry an exclusion reason', () => {
    for (const { group, advertised, unadvertised } of groupSplits) {
      expect(
        advertised.length,
        `${JSON.stringify(group)} must have exactly one palette entry — one entry per renderer`,
      ).toBe(1);
      for (const type of unadvertised) {
        expect(
          PALETTE_EXCLUSIONS[type],
          `\`${type}\` is unoffered but absent from the exclusion ledger`,
        ).toBeTruthy();
      }
    }
  });
});

describe('canvas chrome for a renderable-but-unoffered spelling (#5837)', () => {
  it('the unadvertised spelling borrows the icon and tone of its twin', () => {
    for (const { advertised, unadvertised } of groupSplits) {
      const twin = offered[advertised[0]]!;
      for (const type of unadvertised) {
        const display = resolveBlockDisplayMeta(type);
        expect(display, `\`${type}\` still resolves to no display meta`).toBeDefined();
        expect(display!.Icon, `\`${type}\` draws a different icon than \`${advertised[0]}\``)
          .toBe(twin.Icon);
        expect(display!.Icon).not.toBe(UnknownBlockIcon);
        expect(display!.category).toBe(twin.category);
        expect(resolveBlockTone(type)).toBe(resolveBlockTone(advertised[0]));
        expect(resolveBlockTone(type)).not.toBe(BLOCK_CATEGORY_TONE.misc);
      }
    }
  });

  it('an offered type still resolves to its own entry, unchanged', () => {
    for (const [type, meta] of Object.entries(BLOCK_TYPE_META)) {
      const display = resolveBlockDisplayMeta(type);
      expect(display!.Icon, type).toBe(meta.Icon);
      expect(display!.category, type).toBe(meta.category);
    }
  });

  it('follows the pair when the palette flips which spelling it advertises', () => {
    // #5495 moved the advertised spelling from the legacy alias to the canonical
    // name; nothing stops a future ruling moving it back. A fix that named a
    // direction would re-open this gap on that day, so the resolver is proved
    // symmetric here rather than asserted in prose.
    const { advertised, unadvertised } = groupSplits[0];
    const wasOffered = advertised[0];
    const wasUnoffered = unadvertised[0];
    const saved = mutableMeta[wasOffered];
    try {
      delete mutableMeta[wasOffered];
      mutableMeta[wasUnoffered] = saved;
      const flipped = resolveBlockDisplayMeta(wasOffered);
      expect(flipped, 'the formerly-offered spelling lost its chrome after the flip').toBeDefined();
      expect(flipped!.Icon).toBe((saved as { Icon: unknown }).Icon);
      expect(resolveBlockTone(wasOffered)).not.toBe(BLOCK_CATEGORY_TONE.misc);
    } finally {
      delete mutableMeta[wasUnoffered];
      mutableMeta[wasOffered] = saved;
    }
    // The catalogue is back exactly as it was — a leaked mutation would make
    // every later assertion in this process report on a palette nobody ships.
    expect(offered[wasOffered]).toBe(saved);
    expect(offered[wasUnoffered]).toBeUndefined();
  });

  it('an exclusion with no renderer twin keeps the generic box', () => {
    // Counter-probe. `element:text_input` is unoffered for its own reason and is
    // in no alias group; a fix keyed on "is excluded" would hand it a friendly
    // icon it has not earned.
    // `element:form` was a fourth probe here until `@objectstack/spec` 17.3.0
    // retired it from `PageComponentType` and objectui dropped its now-stale
    // palette exclusion with it (objectui#7122). Two probes still exercise
    // the same property on two different exclusion reasons, so the
    // counter-probe keeps its force. `ai:chat_window` was the third until
    // `@objectstack/spec` 17.7.0 retired it from `PageComponentType` the same way
    // and its palette exclusion went with it (objectui#11717); it stays a probe
    // below, as the retired type a stored page may still carry.
    for (const type of ['element:text_input', 'element:record_picker']) {
      expect(PALETTE_EXCLUSIONS[type], `${type} is not an exclusion any more`).toBeTruthy();
      expect(resolveBlockDisplayMeta(type), `${type} borrowed display meta`).toBeUndefined();
      expect(resolveBlockTone(type), `${type} borrowed a tone`).toBe(BLOCK_CATEGORY_TONE.misc);
    }
    // And an outright unknown type, which is what the fallback exists for — a
    // retired spec type included.
    for (const type of ['zz:not-a-block', 'ai:chat_window']) {
      expect(PALETTE_EXCLUSIONS[type], `${type} is an exclusion`).toBeUndefined();
      expect(resolveBlockDisplayMeta(type), `${type} borrowed display meta`).toBeUndefined();
      expect(resolveBlockTone(type), `${type} borrowed a tone`).toBe(BLOCK_CATEGORY_TONE.misc);
    }
  });
});

describe('the palette offer list is untouched (#2943 ledger invariant)', () => {
  it('no alias-group member became offerable', () => {
    for (const { unadvertised } of groupSplits) {
      for (const type of unadvertised) {
        expect(type in (BLOCK_TYPE_META as Record<string, unknown>)).toBe(false);
      }
    }
  });

  it('the drag-in list is exactly the palette catalogue, nothing more', () => {
    // `TYPES_BY_CATEGORY` is what the Add-block picker iterates. Deriving the
    // expectation from `BLOCK_TYPE_META` keeps this true across palette edits
    // while still failing the moment a display-only type leaks into the picker.
    const draggable = TYPES_BY_CATEGORY.flatMap((g) => g.types).sort();
    expect(draggable).toEqual(Object.keys(BLOCK_TYPE_META).sort());
    for (const excluded of Object.keys(PALETTE_EXCLUSIONS)) {
      expect(draggable, `\`${excluded}\` became draggable`).not.toContain(excluded);
    }
  });
});

describe('PageBlockCanvas — the chrome reaches the DOM (#5837)', () => {
  const pair = groupSplits[0];
  const advertised = pair.advertised[0];
  const unadvertised = pair.unadvertised[0];

  const draftWith = (types: string[]) => ({
    name: 'p',
    type: 'record',
    regions: [{ name: 'main', components: types.map((t) => ({ type: t })) }],
  });

  it('the unadvertised spelling gets the tone of its twin on the type badge', () => {
    render(<PageBlockCanvas draft={draftWith([advertised, unadvertised, 'element:text_input'])} />);
    const badgeClass = (type: string) => screen.getByText(type).getAttribute('class') ?? '';

    const twinClass = badgeClass(advertised);
    expect(badgeClass(unadvertised)).toBe(twinClass);
    // Positive half: the shared class really is the record tone, not two nodes
    // that both fell through to grey.
    expect(twinClass).toContain(BLOCK_CATEGORY_TONE[offered[advertised]!.category as 'record'].badge);
    // Counter-probe on the same render: the un-twinned exclusion stays grey.
    expect(badgeClass('element:text_input')).toContain(BLOCK_CATEGORY_TONE.misc.badge);
    expect(badgeClass('element:text_input')).not.toBe(twinClass);
  });

  it('the unadvertised spelling gets the icon of its twin', () => {
    // The canvas draws a node's ICON in its container branch (a leaf node shows
    // a live preview instead), so the probe uses container-shaped nodes — an
    // empty `properties.children` is all `childGroups` needs.
    const container = (type: string) => ({ type, properties: { children: [] } });
    render(
      <PageBlockCanvas
        draft={{
          name: 'p',
          type: 'record',
          regions: [{ name: 'main', components: [container(advertised), container(unadvertised), container('element:text_input')] }],
        }}
      />,
    );
    const iconClass = (type: string) => {
      // A container row prints the type twice — once as the fallback label
      // (`blockLabel` falls back to the raw type) and once in the badge — and
      // both live inside the same row button, so either match finds the row.
      const row = screen.getAllByText(type)[0].closest('button');
      return row?.querySelector('svg.lucide')?.getAttribute('class') ?? '';
    };
    expect(iconClass(advertised)).not.toBe('');
    expect(iconClass(unadvertised)).toBe(iconClass(advertised));
    expect(iconClass('element:text_input')).not.toBe(iconClass(advertised));
  });
});
