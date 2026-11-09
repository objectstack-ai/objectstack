/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The served-object-label rule (objectstack#30311, objectstack#30390), as pure
 * functions: a label the server served is already translated for the session,
 * so it is drawn as given, and the client bundle is asked only when none is
 * served.
 *
 * Homed here (objectstack#30486) rather than in `@object-ui/app-shell`, where
 * it was written, because `@object-ui/plugin-detail`'s related list and
 * reference rail name an object too and cannot import `app-shell` (which
 * depends on them). This package is the one both already import, it holds no
 * provider, and it already reads `@objectstack/spec/ui` at runtime. app-shell's
 * `hooks/servedObjectLabel.ts` re-exports these names for its own importers.
 * ⛔ Do not copy the rule into another package: one rule, one home.
 *
 * @module
 */

import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';

/**
 * A metadata label (plain string or inline locale map) as display text, or
 * `undefined` when there is none. Shared with app-shell's `useRecentItemLabel`,
 * which asks the same question of a page or a report (objectui#11678).
 */
export function metadataText(label: unknown, language: string | undefined): string | undefined {
  const text = resolveInlineI18nLabel(label as Parameters<typeof resolveInlineI18nLabel>[0], language);
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

/** `''` from a bundle lookup that found nothing and had no metadata to fall back to. */
function nonEmpty(text: string | undefined): string | undefined {
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

/** `useObjectLabel().objectPluralLabel` — the client bundle's list-title lookup. */
export type ObjectPluralLabelLookup = (objectDef: { name: string; label: string; pluralLabel?: string }) => string;

/** `useObjectLabel().objectLabel` — the client bundle's record-noun lookup. */
export type ObjectLabelLookup = (objectDef: { name: string; label: string }) => string;

/**
 * What a served object's LIST is called (objectstack#30311): its served
 * `pluralLabel`, else its served `label`, drawn as given. The server
 * translated both, by its label order for an overridden item, so running the
 * bundle over them was a second translation pass in which the base package's
 * string won a rename back. The bundle's `objectPluralLabel` under the
 * object's name is asked only when the definition carries neither, with
 * `fallback` (client text no server translated — the object's name, say) as
 * the bundle's own last resort; `''` when nothing names it. Shared by every
 * surface that titles an object's list — the object page's header, the app
 * header, a recent object row, a related list, a reference rail card.
 */
export function servedObjectPluralLabel(
  objectDef: { name: string; label?: unknown; pluralLabel?: unknown },
  language: string | undefined,
  objectPluralLabel: ObjectPluralLabelLookup,
  fallback = '',
): string {
  // `pluralLabel` is a plain string in the spec, so only a string is one.
  const plural = typeof objectDef.pluralLabel === 'string' ? nonEmpty(objectDef.pluralLabel) : undefined;
  return plural
    ?? metadataText(objectDef.label, language)
    ?? objectPluralLabel({ name: objectDef.name, label: fallback });
}

/**
 * What ONE record of a served object is called — the singular sibling of
 * {@link servedObjectPluralLabel} (objectstack#30390): the served `label`,
 * drawn as given, since the server already translated it; the bundle's
 * `objectLabel` under the object's name only when the definition carries
 * none, with `fallback` as the bundle's own last resort. Every record-scoped
 * surface reads it — the record page, its form, drawer and preview card, and
 * the packaged-actions table's object column.
 */
export function servedObjectLabel(
  objectDef: { name: string; label?: unknown },
  language: string | undefined,
  objectLabel: ObjectLabelLookup,
  fallback = '',
): string {
  return metadataText(objectDef.label, language) ?? objectLabel({ name: objectDef.name, label: fallback });
}
