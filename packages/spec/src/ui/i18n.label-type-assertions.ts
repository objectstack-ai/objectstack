// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Compile-level pins for the hand-tied `InlineLocaleMap` key narrowing (#9925).
 *
 * `InlineLocaleMap` is the one part of the label contract that does NOT derive
 * from its schema: the BCP-47 key regex is a runtime refinement `z.input`
 * cannot see, so the derived type was `Record<string, string>` and the retired
 * `{ key, defaultValue }` key-reference form (#5055) stayed structurally
 * assignable to every `I18nLabel` surface in both repos. It shipped that way
 * for a full release: objectui#5264 declared the retired form on a metric
 * widget's title, the wrong shape compiled, and the raw dotted i18n key
 * rendered as the visible KPI label. The maintainer ruling on #9925
 * (2026-08-19, option B) narrows the emitted type so that shape is a compile
 * error everywhere at once; `i18n.zod.ts` carries the annotation, this file
 * pins it.
 *
 * Why a plain src module and not a test: `packages/spec/tsconfig.json`
 * EXCLUDES every test file, and the CI gate for this package is `tsc --noEmit`
 * over the `src` tree (lint.yml), so probes must live in a non-test src file
 * to be checked at all (`app.nav-type-assertions.ts` is the precedent, and its
 * two silent-drift incidents are the reason the pattern exists). The file is
 * referenced by no tsup entry and re-exported by no barrel; it exists purely
 * to make `tsc --noEmit` fail when the narrowing regresses.
 *
 * The `@ts-expect-error` probes assert the NEGATIVE direction — if the type
 * ever widens back to `Record<string, string>` (e.g. someone drops
 * `InlineLocaleMapSchema`'s explicit `z.ZodType<…>` annotation as "redundant",
 * or re-widens the shape that annotation spells),
 * every one of them becomes an "Unused '@ts-expect-error' directive" compile
 * error naming this file. The positive probes are the other half: the
 * narrowing must NOT cost any valid authoring shape — the measured pick over
 * the template-literal alternative hinged on exactly that (see the
 * `InlineLocaleMap` doc in `i18n.zod.ts`).
 */

import type { z } from 'zod';

import type { DashboardWidgetSchema } from './dashboard.zod';
import type { AriaPropsSchema, I18nLabel, InlineLocaleMap } from './i18n.zod';

/* ────────────────────────────────────────────────────────────────────────────
 * Positive half — every authorized shape still assigns.
 * These mirror the runtime-accepted fixtures in `i18n.test.ts`, plus the
 * computed-key and widened-record sources whose survival is what makes the
 * ruling's escape-hatch condition moot (no hatch is needed, so none exists).
 * ──────────────────────────────────────────────────────────────────────────── */

/** The repo's real authoring shape — literal BCP-47 tags. */
export const literalMap: I18nLabel = { en: 'All Active', 'zh-CN': '全部活跃' };

/** Script- and region-qualified tags, plus the untagged `default` entry. */
export const qualifiedMap: InlineLocaleMap = {
  default: 'Members',
  'zh-Hans-CN': '成员',
  'pt-BR': 'Membros',
};

/** Plain string — form 1 is untouched by the narrowing. */
export const plainString: I18nLabel = 'All Active';

/**
 * Computed-key site: an index signature has no declared `key`/`defaultValue`.
 * Real values, not `declare const` ambients — `alias-integrity.test.ts` imports
 * every src module at runtime, so a value position referencing an ambient is a
 * `ReferenceError` there. The widening to `string` (vs the literal type) is
 * what makes these the computed-key/widened-record probes.
 */
const someLocale: string = 'en';
const someText: string = 'All Active';
export const computedKeyMap: I18nLabel = { [someLocale]: someText };

/** A plain `Record<string, string>` still assigns — no call site needs loosening. */
const widenedRecord: Record<string, string> = { en: 'All Active' };
export const widenedAssign: I18nLabel = widenedRecord;

/* ────────────────────────────────────────────────────────────────────────────
 * Negative half — the objectui#5264 harm class refuses at compile time.
 * ──────────────────────────────────────────────────────────────────────────── */

// @ts-expect-error — the retired key-reference form must not compile (#9925)
export const retiredPair: I18nLabel = { key: 'views.task_list.label', defaultValue: 'Task List' };

// @ts-expect-error — property order must not matter (the runtime pin's twin)
export const retiredPairFlipped: I18nLabel = { defaultValue: 'Task List', key: 'views.task_list.label' };

// @ts-expect-error — a lone `key` refuses too (the template-literal candidate failed exactly this probe)
export const retiredLoneKey: I18nLabel = { key: 'views.task_list.label' };

// @ts-expect-error — a lone `defaultValue` refuses too
export const retiredLoneDefault: I18nLabel = { defaultValue: 'Task List' };

// @ts-expect-error — directly against the map type, not just the union
export const retiredOnMap: InlineLocaleMap = { key: 'views.task_list.label', defaultValue: 'Task List' };

/* ────────────────────────────────────────────────────────────────────────────
 * Embedded surfaces — the narrowing must arrive through `z.input` derivation,
 * not only on the alias. `ariaLabel` is the carrier in `i18n.zod.ts` itself;
 * `DashboardWidgetSchema.title` is this repo's closest analogue of the
 * objectui#5264 metric-widget title (the shipped harm's label position).
 * ──────────────────────────────────────────────────────────────────────────── */

type AriaPropsInput = z.input<typeof AriaPropsSchema>;
type DashboardWidgetInput = z.input<typeof DashboardWidgetSchema>;

export const ariaInline: AriaPropsInput = {
  ariaLabel: { en: 'Close dialog', 'zh-CN': '关闭对话框' },
};

export const ariaRetired: AriaPropsInput = {
  // @ts-expect-error — the retired form must refuse on the embedded surface too
  ariaLabel: { key: 'common.close_dialog', defaultValue: 'Close dialog' },
};

export const widgetInline: DashboardWidgetInput = {
  id: 'probe_widget',
  dataset: 'probe_dataset',
  values: ['amount'],
  title: { en: 'Revenue', 'zh-CN': '营收' },
};

export const widgetRetired: DashboardWidgetInput = {
  id: 'probe_widget',
  dataset: 'probe_dataset',
  values: ['amount'],
  // @ts-expect-error — objectui#5264's exact shape, in the KPI-title position
  title: { key: 'widgets.revenue.title', defaultValue: 'Revenue' },
};
