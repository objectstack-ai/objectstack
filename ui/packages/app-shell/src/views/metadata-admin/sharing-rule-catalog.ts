// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's DECLARED sharing rules — the environment-scope list of the
 * `sharing_rule` registry type (objectui#12982, objectstack ADR-0131 D6 regime
 * C, ruling A on objectstack#24378).
 *
 * ## Two pages, one source each
 *
 * A sharing rule has two homes, and Setup lists each from its own read:
 *
 * - a rule a package DECLARES lives in the registry. `GET /meta/sharing_rule`
 *   lists every declaration, switched off or not, with its provenance
 *   (`_packageId`). This scope's list page reads it, read-only.
 * - a rule an organization AUTHORS is a `sys_sharing_rule` record. Its page is
 *   that object's ordinary data view, editable, with the server's own search,
 *   sort and paging.
 *
 * ⛔ No page lists both, and nothing here fetches one list to merge into the
 * other (objectui#7611's rule: there is no merged two-source list).
 * `GET /sharing/rules` answers both kinds in one list, but it serves no
 * declared rule the activation ledger switches off, so a rule switched off
 * there could never be switched back on; it is read here for ONE rule, the
 * source of a clone (below), never as a list.
 *
 * ## What a declared rule offers
 *
 * - **Disable / Enable**: the rule's row in the activation ledger, through the
 *   catalog activation door (`catalog-activation.ts`; `sharing_rule` is one of
 *   `SETUP_CATALOG_TYPES`). Under a wall the door is the platform operator's;
 *   any other caller is refused and the page shows the server's sentence.
 * - **Clone**: a NEW organization rule pre-filled from the declaration, under
 *   a name no declaration holds ({@link suggestCloneName}), written through the
 *   `sys_sharing_rule` data door. The server refuses a declared name with
 *   `409 RESOURCE_CONFLICT`, shown as sent. Once the copy exists the dialog
 *   offers to switch the declared rule off.
 *
 * ## Where a clone's fields come from
 *
 * The declaration is the authoring shape (a CEL `condition`, `sharedWith`);
 * the record is the runtime shape (`criteria_json`, `recipient_type`,
 * `recipient_id`). The server compiles one into the other, so the clone reads
 * the server's compiled projection of that one rule,
 * `GET /sharing/rules/:name` — ⛔ never a client compilation of the CEL. The
 * service serves no projection of a rule switched off, so such a rule clones
 * without its criteria: the copy's form asks for them.
 */

import { actionErrorDetail } from '@object-ui/core';
import { apiBase } from '../../utils/apiBase.js';

/** The registry type of a declared sharing rule. */
export const DECLARED_SHARING_RULE_TYPE = 'sharing_rule';

/** The object an organization-authored sharing rule is a record of. */
export const ORGANIZATION_SHARING_RULE_OBJECT = 'sys_sharing_rule';

/**
 * Registry types whose environment-scope list is declarations only: items an
 * environment authors are records of `authoredObject`, never metadata items.
 * The metadata-admin pages offer no create and no edit for such a type in
 * that scope, and point at the object's own page instead.
 */
export const DECLARATION_ONLY_CATALOGS: Readonly<Record<string, { authoredObject: string }>> = {
  [DECLARED_SHARING_RULE_TYPE]: { authoredObject: ORGANIZATION_SHARING_RULE_OBJECT },
};

/** The object an environment authors `type`'s items as, when it is one. */
export function declarationOnlyAuthoredObject(type: string): string | undefined {
  return DECLARATION_ONLY_CATALOGS[type]?.authoredObject;
}

/** The runtime fields of one rule, as `GET /sharing/rules/:name` answers them. */
export interface SharingRuleProjection {
  name: string;
  object_name?: string;
  criteria?: unknown;
  recipient_type?: string;
  recipient_id?: string;
  access_level?: string;
}

/**
 * The server's compiled projection of the rule `name`, or `null` when the
 * service serves none (`404`: the rule is switched off, or not served in this
 * caller's scope). Any other refusal rejects with the server's sentence.
 */
export async function readSharingRuleProjection(
  name: string,
  signal?: AbortSignal,
): Promise<SharingRuleProjection | null> {
  const res = await fetch(`${apiBase()}/sharing/rules/${encodeURIComponent(name)}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (res.status === 404) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(actionErrorDetail(json, `HTTP ${res.status}`));
  const row = (json && typeof json === 'object' && 'data' in json ? (json as { data: unknown }).data : json) as
    | SharingRuleProjection
    | null;
  return row && row.name === name ? row : null;
}

/**
 * A name for the copy of `source` that no listed declaration holds:
 * `<source>_copy`, then `<source>_copy_2`, … The server stays the judge (a
 * declaration the list does not show is still refused with `409`); this only
 * keeps the dialog from ever OFFERING a declared name.
 */
export function suggestCloneName(source: string, declaredNames: Iterable<string>): string {
  const taken = new Set(declaredNames);
  const base = `${source}_copy`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The `sys_sharing_rule` record a clone writes. Identity and description come
 * from the dialog and the declaration; the runtime half from the server's
 * projection. A field the projection lacks is left out, so the server's
 * required-field refusal names it rather than a guessed value standing in.
 */
export function cloneRecordOf(
  declaration: Record<string, unknown>,
  projection: SharingRuleProjection | null,
  target: { name: string; label: string },
): Record<string, unknown> {
  const record: Record<string, unknown> = { name: target.name, label: target.label };
  if (typeof declaration.description === 'string' && declaration.description) {
    record.description = declaration.description;
  }
  const objectName = projection?.object_name ?? declaration.object;
  if (typeof objectName === 'string' && objectName) record.object_name = objectName;
  if (projection?.criteria != null) record.criteria_json = JSON.stringify(projection.criteria);
  const sharedWith = declaration.sharedWith as { type?: unknown; value?: unknown } | undefined;
  const recipientType = projection?.recipient_type ?? sharedWith?.type;
  const recipientId = projection?.recipient_id ?? sharedWith?.value;
  if (typeof recipientType === 'string' && recipientType) record.recipient_type = recipientType;
  if (typeof recipientId === 'string' && recipientId) record.recipient_id = recipientId;
  const access = projection?.access_level ?? declaration.accessLevel;
  if (typeof access === 'string' && access) record.access_level = access;
  return record;
}
