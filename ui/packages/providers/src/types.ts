import type { ReactNode } from 'react';
import type { ThemeMode } from '@object-ui/types';

export interface DataSourceProviderProps {
  dataSource: any;
  children: ReactNode;
}

export interface MetadataProviderProps {
  metadata?: any;
  children: ReactNode;
}

/**
 * The theme MODE this provider stores and applies: the `ThemeMode` vocabulary
 * (`auto | light | dark`) plus the one legacy spelling this package still
 * accepts.
 *
 * Named `ThemePreference`, not `Theme` (objectui#3161, objectstack#4115 ledger
 * batch 7). `Theme` names a whole theme DOCUMENT — `{ name, label, mode,
 * colors: { primary, background, … }, typography, … }` — so the old local
 * declaration was not a drifted copy of that document type at all; it was
 * `Theme['mode']` under `Theme`'s name, which is the more misleading of the
 * two failures: a session reading `Theme` here would conclude an ObjectStack
 * theme is a string. `ThemeMode`, the vocabulary's own name for what this
 * really is, could not be taken either (the "run the new name past the guard
 * first" rule from objectui#3169 — it would have traded one collision for
 * another); and it would be wrong anyway, because of `'system'`.
 *
 * Derivation history (objectui#5716): this union was born reading the spec's
 * `ThemeModeSchema` through its `_zod` input carrier. The spec then retired
 * its whole theme module (objectstack `35ad101bc`), objectui assumed ownership of
 * the theme document types, and the mode vocabulary's owner is now
 * `@object-ui/types` (`ThemeMode`, with the `THEME_MODES` runtime witness) —
 * so the derivation reads from there. A mode the owner adds still arrives
 * here and `ThemeProvider`'s branch must handle it. `'system'` stays as an
 * explicit local union member: it is the pre-spec spelling of `auto`, still
 * sitting in users' `localStorage`, and the provider treats the two
 * identically (#2942, pinned in `theme-mode-spec-parity`).
 */
export type ThemePreference = ThemeMode | 'system';

/**
 * Props of this package's `ThemeProvider`, which stores one
 * {@link ThemePreference} and applies it as the `light` / `dark` class.
 *
 * Named `ThemePreferenceProviderProps`, not `ThemeProviderProps`
 * (objectui#6349, batch 10). `@object-ui/react` publishes a
 * `ThemeProviderProps` with a different meaning: the props of its theme-system
 * `ThemeProvider`, which registers whole `Theme` documents and turns the
 * active one into CSS variables. There `defaultTheme` is a theme NAME and the
 * mode is `defaultMode`; here `defaultTheme` is the mode itself. One exported
 * name stood for both, so this, the narrower of the two, takes the specific
 * name and react keeps the general one.
 */
export interface ThemePreferenceProviderProps {
  defaultTheme?: ThemePreference;
  storageKey?: string;
  children: ReactNode;
}
