/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Theme Component Zod Validators (all RETIRED)
 *
 * This module exports NOTHING any more. It is kept as the tombstone for the
 * theme component-kind validators, and `__tests__/spec-subschema-parity.test.ts`
 * dynamic-imports it to pin the retired names OUT of it.
 *
 * Two retirement waves emptied it:
 *
 * - The six `@objectstack/spec/ui` theme-schema re-exports
 *   (`ColorPaletteSchema`, `TypographySchema`, `BorderRadiusSchema`,
 *   `ShadowSchema`, `ThemeModeSchema`, `ThemeDefinitionSchema` — the spec's
 *   `ThemeSchema`): objectstack `35ad101bc` (ADR-0049 enforce-or-remove)
 *   deleted the spec's whole `ui/theme.zod.ts` module —
 *   values AND types, `AnimationSchema`/`ZIndexSchema` having gone earlier in
 *   17.0.0-rc.3 (objectstack#5021) — and the maintainer's ruling on
 *   objectstack#10856 (2026-08-22, Options A + C) had objectui REMOVE these
 *   dangling imports (executed as objectui#5710); restoring the spec exports
 *   (Option B) was explicitly not taken.
 *
 * - The theme COMPONENT kinds: `ThemeComponentSchema` (`type: 'theme'`)
 *   RETIRED in `78cbdb530` under the 2026-08-21 maintainer ruling
 *   (option B, executed upstream by objectstack `35ad101bc`); then `ThemeSwitcherSchema`
 *   (`type: 'theme-switcher'`), `ThemePreviewSchema` (`type: 'theme-preview'`)
 *   and `ThemeUnionSchema` — which after `78cbdb530` held only those two
 *   members — RETIRED in objectui#5647, by inheritance of the same ruling on
 *   identical evidence. No renderer ever registered any of the three literals:
 *   absent from every `ComponentRegistry.register(...)` / `registerLazy(...)`
 *   site under every package's `src/`, from `PROTOCOL_COMPONENTS` /
 *   `PALETTE_PLACEHOLDER_BLOCKS`
 *   (`packages/components/src/renderers/placeholders.tsx`), and from every
 *   fixture — so a page declaring one got the registry's "Unknown component
 *   type" panel (OBJUI-001), never a rendered component. Declared-but-
 *   unenforced, the ADR-0049 shape to retire. `AnyComponentSchema`
 *   (`./index.zod.ts`) now refuses all three kinds, and
 *   `__tests__/phase2-schemas.test.ts` pins the refusals.
 *
 * The theme SYSTEM is retained by the same rulings: the `Theme` TYPE surface
 * lives in `../theme.ts` (owned there since objectui#5716), `ThemeEngine`
 * turns a theme document into CSS variables, and `ThemeProvider` applies it.
 * Do NOT hand-write local mirrors of any retired schema here: that
 * localization is a contract decision no ruling has taken, and
 * `__tests__/spec-subschema-parity.test.ts` pins the retired names out of
 * this module.
 *
 * @module zod/theme
 * @packageDocumentation
 */

// Kept a module on purpose — the parity pin above dynamic-imports this file —
// with nothing left to export.
export {};
