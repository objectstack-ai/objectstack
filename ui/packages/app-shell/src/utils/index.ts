/**
 * Utility functions for ObjectStack Console
 */

// Re-export the unified record display-name resolver (ADR-0079) so existing
// importers of `@object-ui/app-shell`'s `getRecordDisplayName` /
// `formatRecordTitle` keep working unchanged. The implementation now lives in
// `@object-ui/core` (pure util, shared by every view plugin and field widget).
export {
  getRecordDisplayName,
  deriveTitleField,
  isTitleEligibleField,
  // `formatTitleTemplate` is the new canonical name; alias it to the legacy
  // `formatRecordTitle` export this module has always provided.
  formatTitleTemplate as formatRecordTitle,
} from '@object-ui/core';
export type { RecordDisplayNameOptions } from '@object-ui/core';

export {
  resolveRecordFormTarget,
  resolveFormViewLayout,
} from './recordFormNavigation.js';
export type {
  ObjectDefinitionForNavigation,
  RecordFormTarget,
  ObjectDefinitionForFormView,
  FormViewDefinition,
  FormViewModalLayout,
} from './recordFormNavigation.js';

export { deriveRelatedLists } from './deriveRelatedLists.js';
export type { DerivedRelatedList } from './deriveRelatedLists.js';

export { preferLocal } from './preferLocal.js';

// Admin-override affordance + audit marker (objectui#5178). Exported because
// the Approval Center (`apps/console`) renders the second timeline and must ask
// the SAME question about a row as the record page's panel does — two copies of
// "is this an override" is exactly the dialect this repo rules against.
export {
  isOverrideOnlyViewer,
  actionAdmittedByOverride,
  isOverrideDecision,
  bypassedApproverNames,
  isViaOverrideRow,
} from './approvalOverride.js';
export {
  appRouteSegment,
  matchAppBySegment,
  filterActiveApps,
  resolveHostAppSegment,
  appStudioDesignPath,
  appStudioSurfacePath,
  appStudioRoutePath,
  resolveNotificationTarget,
} from './appRoute.js';
export type { NotificationTarget } from './appRoute.js';

// Where "home" is (objectui#7256) — the declared landing, read once and shared
// by the `/` redirect (apps/console) and the chrome's Home affordances.
export { HOME_LAUNCHER_PATH, resolveDeclaredHomePath } from './homePath.js';
export type { DeclaredHomeApp } from './homePath.js';

/**
 * Resolves objectui's KEYED i18n label to a plain string.
 *
 * The keyed form is `{ key, defaultValue?, params? }` — a reference INTO a
 * translation bundle. With a `t` function it resolves the key through i18next;
 * without one it falls back to `defaultValue`, then the key itself.
 *
 * Renamed from `resolveI18nLabel` in objectui#4167: `@objectstack/spec`
 * 17.0.0-rc.6 publishes a function of that exact name over the INLINE LOCALE MAP
 * vocabulary (`{ en: 'Owner', 'zh-CN': '负责人' }`, resolved against a BCP-47
 * locale), and rc.6's widening of `I18nLabel` to `string | Record< string,
 * string >` means the same authored value can now reach either function — each
 * answering wrongly, and silently, for the other's input. The full account is at
 * the `@object-ui/react` twin (`packages/react/src/utils/i18n.ts`), which is the
 * same vocabulary without a `t`. Import the spec's as `resolveInlineI18nLabel`
 * when you need the map form; the two names now say which is which.
 *
 * NOTE — the inline object literal below is `KeyedI18nLabel` from
 * `@object-ui/types` (#4581), which named this shape and retired the two other
 * copies (`packages/react/src/utils/i18n.ts`,
 * `packages/layout/src/NavigationRenderer.tsx`). This third one is left spelled
 * out ON PURPOSE: PR #4208 — the rc.6 train, still open and blocked on #4165 —
 * has a pending change to this file, and a type-spelling swap here would be a
 * rebase conflict for the train rather than a cleanup. Swap it to the named
 * type once #4208 lands.
 */
export function resolveKeyedI18nLabel(
  label: string | { key: string; defaultValue?: string; params?: Record<string, any> } | undefined,
  t?: (key: string, options?: any) => string,
): string | undefined {
  if (label === undefined || label === null) return undefined;
  if (typeof label === 'string') return label;
  if (t) {
    const result = t(label.key, { defaultValue: label.defaultValue, ...label.params });
    if (result && result !== label.key) return result;
  }
  return label.defaultValue || label.key;
}

/**
 * Capitalize the first letter of a string.
 * Preferred over CSS `capitalize` for i18n compatibility.
 */
export function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// NOTE (ADR-0079): `formatRecordTitle` (now canonically `formatTitleTemplate`)
// and `getRecordDisplayName` moved to `@object-ui/core` and are re-exported
// from the top of this module. The previous local copies — a titleFormat-only
// resolver that fell back to a hard-coded `name`/`title`/… list and bottomed
// out at the literal 'Untitled' — are gone, so every surface now also honors
// the object's `displayNameField` + type-aware derivation + `Record #<id>`.
