// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Customize door's pure half: which types Studio customizes, the override
 * declaration a document carries, the body a pair's draft is written with, the
 * door's walled verdict, and a base object's extension body.
 *
 * ⛔ No component, no designer string table and no Studio chrome here. The
 * running app's save paths that load with a list or record page (a list's
 * view save, the record page's tabs and arrangement saves) read these;
 * importing the names from
 * `StudioCustomizeControls.tsx` statically pulled that component module, the
 * Studio header and the designer's English catalogue
 * (`@object-ui/i18n/namespaces/studio`) into those pages' first load
 * (objectstack#37444). `StudioCustomizeControls.tsx` re-exports every name,
 * so the designer's own imports are unchanged.
 */

import { useAuth } from '@object-ui/auth';
import type { TenancyPosture } from '@object-ui/auth';
import {
  OverrideDeclarationSchema,
  isOverridableMetadataType,
  type OverrideDeclarationParsed,
} from '@objectstack/spec/kernel';
import { EXTENSION_FIELD_SUFFIX, isExtensionFieldName, isPlainRecord } from '@objectstack/spec/data';
import { postureHasOrgWall, useTenancyPosture } from '../../hooks/useTenancyPosture.js';

/**
 * The types Studio's Customize door covers: a view, dashboard, report and page
 * (objectstack#30063: a page, block or source, is edited in its designer as a
 * dashboard is), and an app (objectstack#30059: the whole app is copied into
 * the pair on the first saved navigation edit). Each is an `overridable` type
 * of the spec's classification. Their door was the Interfaces pillar's header;
 * since objectstack#36502 retired that pillar, a read-only base's view,
 * dashboard, report or page is customized in the All metadata area's editor
 * (`StudioBundleItemEditor`, `metadataArea.ts#AREA_CUSTOMIZE_EDITOR_TYPES`),
 * and an app's navigation in the running app's design mode
 * (`layout/designModeMenuSave.ts`). Translations and email templates are
 * customized in that editor too (objectstack#28569), and so is a read-only
 * package's dataset, with its own designer (objectstack#30064).
 */
export const STUDIO_CUSTOMIZE_TYPES: readonly string[] = ['view', 'dashboard', 'report', 'page', 'app'];

/** Whether Studio customizes an item of `type` into a read-only base's pair. */
export function isStudioCustomizeType(type: string | undefined | null): boolean {
  return !!type && STUDIO_CUSTOMIZE_TYPES.includes(type) && isOverridableMetadataType(type);
}

/**
 * The override declaration of `base` that `doc` carries (`doc.overrides`,
 * parsed by the spec's `OverrideDeclarationSchema`), or `null`: a document
 * that declares nothing, declares another base, or carries a malformed
 * declaration declares no override of `base`.
 */
export function declaredOverrideOf(doc: unknown, base: string): OverrideDeclarationParsed | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const parsed = OverrideDeclarationSchema.safeParse((doc as { overrides?: unknown }).overrides);
  return parsed.success && parsed.data.package === base ? parsed.data : null;
}

/**
 * The body a customization's draft is written into the pair with: `doc`
 * without its top-level `_` keys (the read's decorations and the base's
 * protection envelope, `_packageId` included, belong to the base's item, not
 * to the pair's), declaring the override of `base`. A declaration of `base`
 * the document already carries (an item customized before) is kept as it is,
 * its `basedOn` included: re-basing is a person's call, never a save's.
 * `null` when there is no declaration to keep and no version to declare
 * (`basedOn: null`, a base whose listed manifest states none): nothing is
 * guessed, and the caller says so.
 */
export function overrideDraftBody(
  doc: Record<string, unknown>,
  base: string,
  basedOn: string | null,
): Record<string, unknown> | null {
  const declaration = declaredOverrideOf(doc, base) ?? (basedOn ? { package: base, basedOn } : null);
  if (declaration === null) return null;
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!key.startsWith('_')) body[key] = value;
  }
  body.overrides = declaration;
  return body;
}

/**
 * Whether the ensure door refuses this caller on this deployment. The door
 * (`POST /packages/:id/ensure-customization`) judges the caller as the
 * package install door does: under the walled `group` / `isolated` postures
 * only the platform operator may call it, and under `single` (or with no
 * posture served) the `manage_metadata` holder Studio already requires. Read
 * from the two facts the server publishes for that verdict, the posture
 * (`features.tenancyPosture`) and the session's `user.isPlatformAdmin`, the
 * ones `setup/packagedFlowLedger.ts#useFlowLedgerWalledReadOnly` reads. The
 * server stays the judge: a refusal after an attempt is shown as it is sent.
 */
export function customizeDoorWalled(input: {
  posture: TenancyPosture | undefined;
  isPlatformOperator: boolean;
}): boolean {
  return postureHasOrgWall(input.posture) && !input.isPlatformOperator;
}

/** {@link customizeDoorWalled} for this session and this deployment. */
export function useCustomizeDoorWalled(): boolean {
  const posture = useTenancyPosture();
  const { user } = useAuth();
  return customizeDoorWalled({ posture, isPlatformOperator: user?.isPlatformAdmin === true });
}

/**
 * The metadata type a base object's extension is written as: one row per
 * package per target object, filed under the target's name, its body
 * `ObjectExtensionSchema` (`extend`, `fields`, `fieldPatches`, …).
 */
export const OBJECT_EXTENSION_TYPE = 'object_extension';

/** The pair's extension of one base object: `extend` names the object. */
export type ObjectExtensionBody = Record<string, unknown> & { extend: string };

/**
 * `name` spelled as a customer extension field: the spec's suffix appended
 * once (`region` → `region__c`, `region__c` unchanged). Empty stays empty.
 */
export function extensionFieldName(name: string): string {
  if (!name) return name;
  return isExtensionFieldName(name) ? name : `${name}${EXTENSION_FIELD_SUFFIX}`;
}

/**
 * The extension body a read served for `objectName`: the document without
 * its `_` keys (the envelope a read stamps, which the strict schema refuses),
 * `extend` set to the object. `null` when the read served no document.
 */
export function objectExtensionBodyOf(doc: unknown, objectName: string): ObjectExtensionBody | null {
  if (!isPlainRecord(doc)) return null;
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!key.startsWith('_')) body[key] = value;
  }
  return { ...body, extend: objectName };
}
