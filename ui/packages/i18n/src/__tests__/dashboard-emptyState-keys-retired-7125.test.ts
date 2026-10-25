/**
 * `dashboard.noRows` and `dashboard.noDataAvailable` are retired from all ten
 * packs (objectui#7125). Sixth in the retirement-pin series (objectui#4145,
 * objectui#4392, objectui#4730, objectui#5504, objectui#6310), same shape: the
 * retired leaves asserted absent from every pack, plus surviving-sibling
 * assertions so a green here cannot be bought by deleting the neighbourhood.
 *
 * ## What was removed and why
 *
 * objectui#7063 routed the three dashboard empty-state renders — `DatasetWidget`,
 * `ObjectDataTable`, `PivotTable` — through one shared `WidgetEmptyState`, which
 * resolves its own copy from the `dashboard.empty.*` family. That left the two
 * keys the old per-widget placeholders used with no call site at all: two rows in
 * each of the ten packs, 20 entries.
 *
 * Re-measured on the retiring branch rather than inherited from the card: zero
 * `t()`/`tt()` call sites for either FULLY QUALIFIED key; every surviving textual
 * occurrence under `packages/` is a COMMENT recording the consolidation
 * (`WidgetEmptyState.tsx`, `DatasetWidget.tsx`, `ObjectDataTable.tsx`,
 * `PivotTable.tsx`); no dynamic `dashboard.` head exists for a substitution to
 * resolve onto them (the package's one template family is `dashboard.trend.`);
 * and `scripts/check-i18n-call-site-keys.mjs` stays green across the deletion,
 * with the `en` pack going 2,964 -> 2,962 keys and every in-scope call-site key
 * still resolving.
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site -> key**, so none of them can see
 * a dead key come BACK into the packs:
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` visits keys a call site asks for; a
 *     key with no call site is never reached.
 *   - `all-locales-key-parity.test.ts` compares the ten packs' key SETS to each
 *     other, and ten packs agreeing on a dead key is exactly what it wants.
 *   - `scripts/check-i18n-en-drift.mjs` fires only when an `en` VALUE changes; it
 *     says so itself about added/removed keys, and printed `2 removed — those are
 *     all-locales-key-parity's` on this very deletion.
 *   - `scripts/check-i18n-dead-keys.mjs` IS the reverse direction, and it is
 *     report-only by design and wired into no workflow (objectui#4658).
 *
 * So both rows can return to all ten packs with every gate green, and "the empty
 * state has no `noRows` string" is a plausible way for a translator or a widget
 * author to put them back — the surrounding block still describes empty states.
 * Restoring either one goes red here.
 *
 * ## What this file does NOT claim
 *
 * - **`table.noRows` (`'No rows to display'`) is a DIFFERENT key** in a different
 *   namespace, and this retirement did not touch it. The case that pins it below
 *   is a claim about THIS deletion's precision, ⛔ not a claim that `table.noRows`
 *   is live — the reverse sweep lists it as a CONFIRMED candidate in its own
 *   right. Retiring it is a separate card with its own evidence; if that is what
 *   you are doing, delete that case along with the rows. If you are here because a
 *   BARE-NAME sweep took it out as collateral of the dashboard retirement, restore
 *   it: three keys in this repo are spelled `noRows`, and only the `dashboard.` one
 *   was retired.
 * - **`engine.form.noRows` is a third, live key** —
 *   `packages/app-shell/src/views/metadata-admin/i18n.ts`, read at
 *   `widgets.tsx`. It lives in a module-local table, not in these packs, and is out
 *   of this file's reach by dependency direction (`@object-ui/app-shell` depends on
 *   `@object-ui/i18n`, not the reverse) — the same boundary
 *   `appDesigner-fieldDesigner-formula-retired-6310.test.ts` states for
 *   `designer.field.formula`.
 * - **`dashboard` is a live namespace.** Only two leaves went; {@link SURVIVING}
 *   exists so the neighbourhood cannot be deleted for a green.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The retired leaves, named rather than counted, and fully qualified. */
const RETIRED = ['dashboard.noDataAvailable', 'dashboard.noRows'] as const;

/**
 * Rows the deletion swept around — each confirmed live by a `t()`/`tt()` call
 * site, not merely by sitting nearby. The `dashboard.empty.*` family is the copy
 * that REPLACED the retired rows (`WidgetEmptyState.tsx`, `ObjectChart.tsx`), so a
 * revert that removed the replacement instead of restoring the placeholders lands
 * here first; `noDataSourceFor` is the row that sat immediately beside the retired
 * `noDataAvailable` in every pack and describes a DIFFERENT state — a misconfigured
 * binding rather than an empty result (`ObjectDataTable.tsx`); `total` is read by
 * `PivotTable.tsx` and `DatasetWidget.tsx`.
 */
const SURVIVING = [
  'dashboard.empty.title',
  'dashboard.empty.message',
  'dashboard.empty.sourceLabel',
  'dashboard.noDataSourceFor',
  'dashboard.total',
] as const;

/**
 * The same NAME, a different KEY. Deleting `dashboard.noRows` by bare name takes
 * this row with it in all ten packs, and no other gate would notice: the packs
 * would still be at full parity with each other, and `table.noRows` has no call
 * site to report a missing key. See "What this file does NOT claim" above for why
 * this is a precision assertion rather than a liveness one.
 */
const DIFFERENT_NAMESPACE = 'table.noRows';

describe('the dashboard empty-state placeholders are retired from the ten packs (objectui#7125)', () => {
  it('covers all ten packs and a live `dashboard` root', () => {
    // Guards the premise the rest of the file rests on: a pin that iterates an
    // empty pack list, or asserts absence inside a namespace that itself
    // vanished, is green for the wrong reason.
    expect(LANGS).toHaveLength(10);
    for (const lang of LANGS) {
      const root = at(builtInLocales[lang], 'dashboard');
      expect(root, `${lang} lost the dashboard root`).toBeDefined();
      expect(Object.keys(root as Record<string, unknown>).length, lang).toBeGreaterThanOrEqual(15);
    }
  });

  it('no pack defines either retired placeholder', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      for (const key of RETIRED) {
        if (at(builtInLocales[lang], key) !== undefined) revived.push(`${lang} :: ${key}`);
      }
    }
    // Named, not counted: a half-reverted retirement is repaired pack by pack.
    expect(
      revived,
      'A retired dashboard empty-state placeholder is back in a locale pack. ' +
        'objectui#7063 replaced all three per-widget placeholders with the shared ' +
        '`WidgetEmptyState`, which reads `dashboard.empty.*`, so nothing reads these ' +
        'two — and no other i18n gate can see a dead key return, because every one ' +
        'of them runs call site -> key (objectui#7125). If a widget needs its own ' +
        'empty-state copy again, author it with the control that renders it rather ' +
        'than restoring these rows.',
    ).toEqual([]);
  });

  it('the deletion swept around its neighbours', () => {
    const missing: string[] = [];
    for (const lang of LANGS) {
      for (const key of SURVIVING) {
        const value = at(builtInLocales[lang], key);
        if (typeof value !== 'string' || value.length === 0) missing.push(`${lang} :: ${key}`);
      }
    }
    expect(
      missing,
      'a live `dashboard` row is gone. `dashboard.empty.*` is the copy that ' +
        'REPLACED the retired placeholders; losing it renders the shared empty ' +
        'state as raw keys, which no parity gate can see because all ten packs ' +
        'would have lost it together',
    ).toEqual([]);
  });

  it('leaves the same-named key in another namespace alone', () => {
    const swept: string[] = [];
    for (const lang of LANGS) {
      if (typeof at(builtInLocales[lang], DIFFERENT_NAMESPACE) !== 'string') {
        swept.push(`${lang} :: ${DIFFERENT_NAMESPACE}`);
      }
    }
    expect(
      swept,
      '`table.noRows` is gone from a pack. It is NOT the key objectui#7125 ' +
        'retired — three keys in this repo are spelled `noRows` (`table.noRows`, ' +
        'the retired `dashboard.noRows`, and `engine.form.noRows` in ' +
        "app-shell's module-local table), and a bare-name sweep is how the wrong " +
        'one goes. If `table.noRows` is being retired on its own evidence, delete ' +
        'this case with it rather than working around it.',
    ).toEqual([]);
  });
});
