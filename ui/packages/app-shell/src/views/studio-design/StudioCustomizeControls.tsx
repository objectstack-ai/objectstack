// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28562 (ADR-0146 D2, D3) — Customize in Studio: a read-only
 * base's view, dashboard or report becomes an item of the base's paired
 * customization package `<base>.custom`, declared as an override of the
 * base's item, and "Restore package original" brings the base's item back.
 *
 * What this module holds, and what it reads:
 *
 *  - which types Studio customizes ({@link STUDIO_CUSTOMIZE_TYPES}): the
 *    Interfaces pillar's three, each an `overridable` type of the spec's closed
 *    classification (`isOverridableMetadataType`);
 *  - the body the pair's draft is written with ({@link overrideDraftBody}):
 *    the document the pillar holds, without its `_` keys, declaring
 *    `overrides: { package, basedOn }`;
 *  - the declaration the server serves for an item ({@link useServedOverride}):
 *    the pair's draft as the draft door serves it, else the layered read's
 *    `overlay` (the pair's row the read serves over the base, N-10). The badge
 *    reads it, ⛔ never a computation (no diff, no `.custom` spelling);
 *  - whether the ensure door refuses this caller
 *    ({@link customizeDoorWalled}), from the two facts the server publishes;
 *  - the header's Customize button, the override badge and the item menu's
 *    Restore entry with its confirmation.
 *
 * The pair's id for a write is the ensure door's answer
 * (`packages-io.ts#ensureCustomizationPackage`); the pillar asks it.
 */

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenuItem,
  DropdownMenuSeparator,
  cn,
} from '@object-ui/components';
import { useAuth } from '@object-ui/auth';
import type { TenancyPosture } from '@object-ui/auth';
import { extractDraftBody, type MetadataClient } from '@object-ui/data-objectstack';
import {
  OverrideDeclarationSchema,
  isOverridableMetadataType,
  type OverrideDeclarationParsed,
} from '@objectstack/spec/kernel';
import { Layers, Pencil, RotateCcw } from 'lucide-react';
import { postureHasOrgWall, useTenancyPosture } from '../../hooks/useTenancyPosture.js';
import { t, tFormat } from '../metadata-admin/i18n.js';

/**
 * The types Studio's Customize door covers: the Interfaces pillar's view,
 * dashboard and report (an `object` leaf's list view is a `view`). Each is an
 * `overridable` type of the spec's classification; translations and email
 * templates are too, but no pillar designs them here.
 */
export const STUDIO_CUSTOMIZE_TYPES: readonly string[] = ['view', 'dashboard', 'report'];

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

/** The override the server serves for one item, and where it is served from. */
export interface ServedOverride {
  declaration: OverrideDeclarationParsed | null;
  /** `draft`: the pair's pending draft declares it; `active`: the served row does. */
  state: 'draft' | 'active' | null;
}

const NO_OVERRIDE: ServedOverride = { declaration: null, state: null };

/**
 * The override of `base` the server serves for `item`: the pair's pending
 * draft, read through the draft door at `pair`, when it declares one; else the
 * layered read's `overlay` at `base`, which is the pair's row the read serves
 * over the base's item. Read again whenever `nonce` moves (a publish, a
 * restore, the item's first save into the pair). `item: null` reads nothing.
 *
 * A failed read is no declaration, as an absent one: no fact, no badge.
 */
export function useServedOverride(
  client: Pick<MetadataClient, 'getDraft' | 'layered'>,
  item: { type: string; name: string } | null,
  base: string | null,
  pair: string | null,
  nonce: string | number,
): ServedOverride {
  const itemType = item?.type ?? '';
  const itemName = item?.name ?? '';
  const key = itemType && itemName && base ? JSON.stringify([itemType, itemName, base]) : '';
  const [answer, setAnswer] = React.useState<{ key: string; served: ServedOverride }>({ key: '', served: NO_OVERRIDE });
  React.useEffect(() => {
    if (!key || !base) return;
    let cancelled = false;
    (async (): Promise<ServedOverride> => {
      if (pair) {
        const draft = await client.getDraft(itemType, itemName, { packageId: pair }).catch(() => null);
        const declared = declaredOverrideOf(extractDraftBody(draft), base);
        if (declared) return { declaration: declared, state: 'draft' };
      }
      const layered = await client.layered(itemType, itemName, { packageId: base }).catch(() => null);
      const declared = declaredOverrideOf(layered?.overlay, base);
      return declared ? { declaration: declared, state: 'active' } : NO_OVERRIDE;
    })().then((served) => {
      if (!cancelled) setAnswer({ key, served });
    });
    return () => {
      cancelled = true;
    };
  }, [client, key, itemType, itemName, base, pair, nonce]);
  // A re-read of the same item keeps the last answer until it lands, so the
  // badge does not blink off and on after a save.
  return key && answer.key === key ? answer.served : NO_OVERRIDE;
}

/** Why Customize is not offered for an item it covers, or `null` when it is. */
export type CustomizeBlock = 'walled' | 'noVersion' | null;

/**
 * The header's Customize button. Pressing it only unlocks the item's editors:
 * nothing is written until the first edit is saved. Disabled with its reason
 * as the wrapper's tooltip and description (objectui#12303's pattern: a
 * natively disabled button shows no `title`).
 */
export function StudioCustomizeButton({
  block,
  baseLabel,
  locale,
  onCustomize,
}: {
  block: CustomizeBlock;
  baseLabel: string;
  locale: string;
  onCustomize: () => void;
}): React.ReactElement {
  const reasonId = React.useId();
  const reason =
    block === 'walled'
      ? t('engine.studio.customize.walled', locale)
      : block === 'noVersion'
        ? tFormat('engine.studio.customize.noVersion', locale, { base: baseLabel })
        : null;
  const button = (
    <button
      type="button"
      data-testid="studio-customize"
      disabled={reason !== null}
      aria-describedby={reason !== null ? reasonId : undefined}
      title={reason === null ? tFormat('engine.studio.customize.actionTitle', locale, { base: baseLabel }) : undefined}
      onClick={onCustomize}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {t('engine.studio.customize.action', locale)}
    </button>
  );
  if (reason === null) return button;
  return (
    <span
      tabIndex={0}
      title={reason}
      aria-describedby={reasonId}
      data-testid="studio-customize-blocked"
      data-block={block ?? undefined}
      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {button}
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </span>
  );
}

/**
 * The header's badge: the item overrides the base. Drawn from a served
 * declaration ({@link useServedOverride}); `basedOn` is the version it names.
 */
export function StudioOverrideChip({
  baseLabel,
  basedOn,
  locale,
}: {
  baseLabel: string;
  basedOn: string;
  locale: string;
}): React.ReactElement {
  return (
    <span
      data-testid="studio-override-chip"
      title={tFormat('engine.studio.customize.overridesTitle', locale, { base: baseLabel, basedOn })}
      className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[5px] bg-sky-500/10 px-2 text-[11px] font-medium text-sky-700 dark:text-sky-300"
    >
      <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
      {tFormat('engine.studio.customize.overrides', locale, { base: baseLabel })}
    </span>
  );
}

/**
 * "Restore package original" on the item's ⋯ menu. The confirmation is
 * {@link StudioRestoreOriginalDialog}, held by the host outside the menu: a
 * menu's content unmounts as the menu closes on select, and a dialog inside it
 * would close with it.
 */
export function StudioRestoreOriginalItem({
  disabled,
  locale,
  onSelect,
}: {
  disabled?: boolean;
  locale: string;
  onSelect: () => void;
}): React.ReactElement {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="studio-restore-original" disabled={disabled} onSelect={onSelect}>
        <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        {t('engine.studio.customize.restore', locale)}
      </DropdownMenuItem>
    </>
  );
}

/**
 * The confirmation of "Restore package original": it says what goes, the
 * customization, and its unpublished draft when one is pending. `onConfirm`
 * sends both deletes; nothing is sent on Cancel.
 */
export function StudioRestoreOriginalDialog({
  open,
  onOpenChange,
  label,
  baseLabel,
  hasDraft,
  locale,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item's display label; its machine name when it has none. */
  label: string;
  baseLabel: string;
  hasDraft: boolean;
  locale: string;
  onConfirm: () => void;
}): React.ReactElement {
  const vars = { item: label, base: baseLabel };
  const body = tFormat('engine.studio.customize.restoreBody', locale, vars);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="studio-restore-original-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{tFormat('engine.studio.customize.restoreConfirm', locale, vars)}</AlertDialogTitle>
          <AlertDialogDescription>
            {hasDraft ? `${body} ${t('engine.studio.customize.restoreDraft', locale)}` : body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="studio-restore-original-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="studio-restore-original-confirm"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {t('engine.studio.customize.restore', locale)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
