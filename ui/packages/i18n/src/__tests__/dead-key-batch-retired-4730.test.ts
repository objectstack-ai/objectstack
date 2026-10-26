// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Twenty-five confirmed-dead locale keys are retired from all ten packs
 * (objectui#4730's key-level trim round; `calendar.agenda` closes objectui#5783).
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site -> key**, never key -> call site
 * (objectui#4145's mechanism, restated by #4392, #4730, #5504 and #6310):
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` asks whether each call site's key
 *     resolves in `en`. A key with no call site is never visited.
 *   - `all-locales-key-parity.test.ts` compares the ten packs' key SETS to each
 *     other. One dead key present in all ten is exactly what it wants.
 *   - `scripts/check-i18n-en-drift.mjs` only fires when an `en` value CHANGES.
 *   - `scripts/check-i18n-dead-keys.mjs` IS the reverse direction, and it is
 *     report-only by design and wired into no workflow (objectui#4658).
 *
 * So any retired row can return to all ten packs with every gate green. This
 * file is the only thing watching that direction for this batch.
 *
 * ## The three retirement shapes in this batch
 *
 * 1. **Superseded twin vocabularies.** `cellRender.*` and `rowAction.*` were
 *    whole namespaces duplicating a `grid.*` vocabulary that won: the live
 *    `RowActionMenu.tsx` is fully i18n-wired and reads `grid.openMenu` /
 *    `grid.edit` / `grid.delete`, and `ObjectGrid.tsx` reads `grid.empty` /
 *    `grid.yes` / `grid.no` / `grid.systemFields`. The twins had no reader.
 *    {@link SUPERSEDING_TWINS} pins the winners so this file cannot go green by
 *    deleting both halves.
 * 2. **Labels that outlived their control.** `calendar.agenda` labelled a view
 *    mode objectui#5740 retired from `CalendarViewMode` (now
 *    `'month' | 'week' | 'day'`); `home.quickActions.createApp*`,
 *    `layout.systemNav.createApp`, `actionDialog.defaultActionTitle` /
 *    `.ok` and `grid.bulk.selectPlaceholder` sit in namespaces whose consumers
 *    are live and i18n-wired but demonstrably read other siblings.
 * 3. **Surfaces that left the product.** `map.*` is the strongest form:
 *    `@object-ui/plugin-map` declares no `@object-ui/i18n` dependency and
 *    contains no `t()` call at all, so it cannot consume a locale string.
 *    `home.stats.*` and `recordDetail.viewersTooltip` name surfaces nothing
 *    renders.
 *
 * ## What this file does NOT claim
 *
 * It does not claim the reverse sweep's CONFIRMED tier is safe to bulk-delete.
 * Five keys that the sweep reported CONFIRMED-dead in this very round are LIVE
 * and were pulled back out of the batch — see {@link BLIND_SPOT_LIVE} below,
 * which is the most load-bearing assertion in this file.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The retired leaves, named rather than counted. */
const RETIRED = [
  'calendar.agenda',
  'calendar.noEvents',
  'map.invalidCoordinates',
  'map.invalidCoordinatesPlural',
  'map.locationDetails',
  'map.markersCount',
  'map.searchLocations',
  'cellRender.empty',
  'cellRender.no',
  'cellRender.systemFields',
  'cellRender.yes',
  'rowAction.delete',
  'rowAction.edit',
  'rowAction.openMenu',
  'home.stats.apps',
  'home.stats.recent',
  'home.stats.starred',
  'home.quickActions.createApp',
  'home.quickActions.createAppDesc',
  'actionDialog.defaultActionTitle',
  'actionDialog.ok',
  'layout.systemNav.createApp',
  'recordDetail.viewersTooltip',
  'chart.noData',
  'grid.bulk.selectPlaceholder',
] as const;

/** Namespace roots that held nothing but retired leaves and went with them. */
const RETIRED_ROOTS = ['map', 'cellRender', 'rowAction', 'recordDetail', 'home.stats'] as const;

/**
 * The `grid.*` vocabulary that superseded `cellRender.*` and `rowAction.*`.
 * Confirmed live by call site in `plugin-grid/src/ObjectGrid.tsx` and
 * `plugin-grid/src/components/RowActionMenu.tsx` — not merely by sitting nearby.
 * If a later cleanup deletes these too, the twins' retirement stops being a
 * de-duplication and becomes a loss of function; that goes red here.
 */
const SUPERSEDING_TWINS = [
  'grid.empty',
  'grid.yes',
  'grid.no',
  'grid.systemFields',
  'grid.openMenu',
  'grid.edit',
  'grid.delete',
] as const;

/**
 * Live siblings inside the namespaces this batch trimmed. Each confirmed live by
 * a `t()` call site, so a green here cannot be bought by deleting the
 * neighbourhood around each retired leaf.
 */
const SURVIVING = [
  'calendar.today',
  'calendar.day',
  'calendar.week',
  'calendar.month',
  'calendar.newEvent',
  'calendar.moreEvents',
  'calendar.allDay',
  'home.quickActions.title',
  'home.quickActions.manageObjects',
  'home.quickActions.systemSettings',
  'actionDialog.title',
  'actionDialog.description',
  'actionDialog.cancel',
  'actionDialog.confirm',
  'layout.systemNav.applications',
  'layout.systemNav.systemSettings',
  'layout.systemNav.objectManager',
  'chart.nullCategory',
  'grid.bulk.confirmDefault',
  'grid.bulk.affectedRecords',
  'grid.bulk.retry',
] as const;

/**
 * ⚠️ The most load-bearing list in this file.
 *
 * These keys were reported CONFIRMED-dead by `check-i18n-dead-keys.mjs` in the
 * same run that produced {@link RETIRED} — and they are LIVE. They were pulled
 * out of the batch after reading their consumer.
 *
 * `packages/app-shell/src/chrome/LoadingScreen.tsx` is bootstrap-critical UI: it
 * must render on the server-down boot, and must not show a pack still in
 * flight through the `en` fallback, so it does NOT read its copy through
 * `t()`. Instead it reads the resident packs directly (`en` and
 * `getLoadedBuiltInLocales()` from `'@object-ui/i18n'`) as PLAIN OBJECT
 * PROPERTIES: `pack?.initializing`, `strings.error.connectionFailed`, and so on.
 * (It takes only the active LANGUAGE from `useObjectTranslation()` —
 * objectui#12187.)
 *
 * That consumer is invisible to BOTH legs of the sweep's evidence standard:
 *
 *   - the AST pass only classifies `t()` / `tt()` calls, and there is no call;
 *   - the text safety net greps the FULL dotted key, and the full dotted key is
 *     never spelled — the namespace segment is bound to a local variable, so the
 *     source reads `strings.error.connectionFailed`, never
 *     `console.error.connectionFailed`.
 *
 * A reverse sweep therefore reports this whole family as CONFIRMED dead, at the
 * strongest tier, with no hint that anything was missed. Deleting it ships a
 * blank splash screen in ten locales on exactly the server-down boot the screen
 * exists to explain. Pinned by name so the next sweep round cannot repeat it.
 *
 * The list is what LoadingScreen still reads. objectui#12187 retired the boot
 * screen's step list and its hint line, and with them
 * `console.loadingSteps.{connecting,loadingConfig,preparingWorkspace}` and
 * `console.loadingHint`: those left every pack because their reader went, not
 * because a sweep called them dead, so their rows left this list too.
 */
const BLIND_SPOT_LIVE = [
  'console.error.connectionFailed',
  'console.error.checkServer',
  'console.initializing',
  'console.actions.retry',
  'console.actions.retrying',
] as const;

describe('objectui#4730 dead-key batch is retired from the ten packs', () => {
  it('covers all ten packs', () => {
    // Guards the premise the rest of the file rests on: a pin that iterates an
    // empty pack list is green for the wrong reason.
    expect(LANGS).toHaveLength(10);
  });

  it('no pack defines any retired key', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      for (const key of RETIRED) {
        if (at(builtInLocales[lang], key) !== undefined) revived.push(`${lang} :: ${key}`);
      }
    }
    // Named, not counted: a half-reverted retirement is repaired pack by pack.
    expect(
      revived,
      'A key retired by objectui#4730 is back in a locale pack. Each was ' +
        'confirmed dead individually: zero t() call sites, zero textual ' +
        'footprint outside the packs, and a read of its plausible consumer. No ' +
        'other i18n gate can see a dead key return, because every one of them ' +
        'runs call site -> key. If the surface a retired key named is being ' +
        'reintroduced, author its label alongside the control rather than ' +
        'restoring this row.',
    ).toEqual([]);
  });

  it('no pack defines a namespace root that held nothing but retired keys', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      for (const root of RETIRED_ROOTS) {
        if (at(builtInLocales[lang], root) !== undefined) revived.push(`${lang} :: ${root}`);
      }
    }
    expect(
      revived,
      'An empty namespace container retired by objectui#4730 is back. These ' +
        'roots held only retired leaves, so they went with them; a root that ' +
        'returns is either an empty object (noise the parity gate happily ' +
        'accepts) or a re-authored vocabulary that needs its own review.',
    ).toEqual([]);
  });

  it('keeps the `grid.*` vocabulary that superseded the retired twins', () => {
    const missing: string[] = [];
    for (const lang of LANGS) {
      for (const key of SUPERSEDING_TWINS) {
        if (typeof at(builtInLocales[lang], key) !== 'string') missing.push(`${lang} :: ${key}`);
      }
    }
    expect(
      missing,
      'A `grid.*` key that superseded a retired `cellRender.*` / `rowAction.*` ' +
        'twin is gone. Retiring the twin was de-duplication only because these ' +
        'still exist and are read by ObjectGrid.tsx / RowActionMenu.tsx; ' +
        'without them the retirement becomes a loss of function.',
    ).toEqual([]);
  });

  it('the deletion swept around the live siblings in every trimmed namespace', () => {
    const missing: string[] = [];
    for (const lang of LANGS) {
      for (const key of SURVIVING) {
        const value = at(builtInLocales[lang], key);
        if (typeof value !== 'string' || value.length === 0) missing.push(`${lang} :: ${key}`);
      }
    }
    expect(missing, 'a live sibling of a retired key is gone').toEqual([]);
  });

  it('keeps the bootstrap strings the reverse sweep reports as dead but are LIVE', () => {
    // See BLIND_SPOT_LIVE's docstring. These are consumed by property access on
    // the imported pack object, which neither the AST pass nor the dotted-key
    // text net can see, so the sweep reports them CONFIRMED dead. They are not.
    const missing: string[] = [];
    for (const lang of LANGS) {
      for (const key of BLIND_SPOT_LIVE) {
        if (typeof at(builtInLocales[lang], key) !== 'string') missing.push(`${lang} :: ${key}`);
      }
    }
    expect(
      missing,
      'A bootstrap string read by LoadingScreen.tsx is gone from a pack. ' +
        'LoadingScreen deliberately does not call t() — it must not show a pack ' +
        'in flight through the en fallback — and reads these as object properties ' +
        'off the resident pack (`strings.error.connectionFailed`). check-i18n-dead-keys.mjs reports ' +
        'them CONFIRMED dead because the full dotted key is never spelled in ' +
        'source; that report is WRONG for this family. Deleting these renders a ' +
        'blank splash screen in ten locales on a server-down boot.',
    ).toEqual([]);
  });
});
