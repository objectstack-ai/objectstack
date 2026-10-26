/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The recipient kinds a `recipient-picker` field stores, and where each kind's
 * candidates and labels come from (objectui#12613).
 *
 * ONE table, two readers: `RecipientPickerField` (the edit widget) lists a
 * kind's candidates from it, and the console's read face for the field
 * (`@object-ui/app-shell`'s widget reference cells) names a stored recipient
 * from it. They lived inside the widget until the face needed the same answer;
 * a second copy beside the face is the drift this module exists to prevent, so
 * a kind added here reaches both faces at once. Published from the package
 * barrel for that reader. The picker's candidate query is not shared: it stops
 * at 500 rows by name, and the face reads stored ids by exact id instead.
 *
 * No React here.
 */

export interface RecipientMapping {
  object: string;
  /** Which record field to persist into recipient_id. */
  storeField: 'id' | 'name';
  /** Candidate display-label fields, in preference order. */
  labelFields: string[];
  /**
   * i18n key for the "choose one" placeholder. Keyed per type rather than
   * interpolating the enum value into an English sentence — "Select a
   * business unit" and "选择业务单元" share no structure (objectstack#3821).
   */
  placeholderKey: string;
}

/**
 * The recipient kinds whose candidates are RECORDS of one directory object,
 * stored by the record field the evaluator matches on:
 *
 *   user                  → sys_user, store `id`
 *   team                  → sys_team, store `id`
 *   business_unit         → sys_business_unit, store `id`
 *   unit_and_subordinates → sys_business_unit, store `id`
 */
export const RECIPIENT_RECORD_KINDS: Readonly<Record<string, RecipientMapping>> = {
  user: { object: 'sys_user', storeField: 'id', labelFields: ['name', 'full_name', 'email'], placeholderKey: 'fields.recipient.selectUser' },
  team: { object: 'sys_team', storeField: 'id', labelFields: ['name', 'label'], placeholderKey: 'fields.recipient.selectTeam' },
  business_unit: { object: 'sys_business_unit', storeField: 'id', labelFields: ['name', 'label'], placeholderKey: 'fields.recipient.selectBusinessUnit' },
  unit_and_subordinates: { object: 'sys_business_unit', storeField: 'id', labelFields: ['name', 'label'], placeholderKey: 'fields.recipient.selectUnitAndSubordinates' },
};

/** A recipient kind whose candidates are catalog items of one metadata type. */
export interface RegistryRecipientMapping {
  /** The metadata type listed — the registry's `GET /api/v1/meta/<type>`. */
  type: string;
  /** Catalog items are referenced by machine name (ADR-0131 D4). */
  storeField: 'name';
  /** Candidate display-label keys, in preference order. */
  labelFields: string[];
  /** i18n key for the "choose one" placeholder (see {@link RecipientMapping}). */
  placeholderKey: string;
}

/**
 * The recipient kinds whose candidates come from the registry (objectui#7611).
 *
 * ADR-0131 D3 gives positions one home, the environment registry, and D7 says
 * a picker LISTS that registry: one source, with no second list of
 * `sys_position` rows merged in. The read goes through the console's metadata
 * store (`useMetadata().ensureType`), the same reader that serves apps and
 * objects, so the list is fetched once per session and shared with every
 * other registry consumer.
 */
export const RECIPIENT_REGISTRY_KINDS: Readonly<Record<string, RegistryRecipientMapping>> = {
  position: { type: 'position', storeField: 'name', labelFields: ['label', 'name'], placeholderKey: 'fields.recipient.selectPosition' },
};

/**
 * The RECORD-RELATIVE recipient kind (maintainer ruling objectstack#14103,
 * executor objectstack#15072). It is deliberately absent from
 * `RECIPIENT_RECORD_KINDS`: there is no target object to query and no record id to
 * store. `recipient_id` holds the NAME of a user-valued column on the SHARED
 * object, and the recipients are whoever that column names on each matched
 * record — so this mode reads the object chosen in the sibling `object_name`
 * field (the same dependency the `filter-condition` widget already reads) and
 * offers that object's user-valued fields.
 */
export const FIELD_RECIPIENT_TYPE = 'field';

/**
 * The display label of one candidate: the first non-empty member of the
 * kind's `labelFields`, then the record id. The picker labels its options with
 * it and the read cell names a stored recipient with it, so a recipient reads
 * the same in the list and in the open picker.
 */
export function recipientCandidateLabel(labelFields: readonly string[] | undefined, row: unknown): string {
  const r = row as Record<string, unknown> | null | undefined;
  for (const f of labelFields ?? ['name']) if (r?.[f]) return String(r[f]);
  return String(r?.id ?? '');
}
