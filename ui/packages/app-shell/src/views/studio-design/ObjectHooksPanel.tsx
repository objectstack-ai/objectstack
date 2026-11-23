/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Data pillar — Hooks view.
 *
 * Hooks are a SEPARATE `hook` metadata type whose `object` field targets one
 * object, a list, or `*`, so each is saved on its own, not with the object.
 * The list, the open hook's buffer and its Save live in the pillar's
 * {@link ObjectHooksBuffer} (`objectHooksBuffer.ts`, objectstack#36511): this
 * view draws them and survives being unmounted by a tab switch. An edit stays
 * on the page until the top bar's Save, which makes the hook live at once.
 *
 * Master-detail, editable: a left list of the hooks that fire on this object,
 * and on the right the hook's inspector (the platform's generic metadata form,
 * SchemaForm, until the curated one registers). A new hook targets the object
 * it is created from. Its target picker is told which objects belong to this
 * package (objectui#11820), so it lists them first and puts every other object
 * under a heading that warns about the reach.
 */

import React from 'react';
import { Webhook, Plus, Loader2 } from 'lucide-react';
import { SchemaForm } from '../metadata-admin/SchemaForm.js';
import { useRegisteredMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry.js';
import { HookTargetScopeContext } from '../metadata-admin/inspectors/HookDefaultInspector.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { formatMetadataError } from '@object-ui/data-objectstack';
import type { HookItem, ObjectHooksBuffer } from './objectHooksBuffer.js';

export function ObjectHooksPanel({
  buffer,
  disabled,
  hookSchema,
}: {
  /** The pillar's hooks buffer for the open object. */
  buffer: ObjectHooksBuffer;
  disabled?: boolean;
  /**
   * The live server JSONSchema for the `hook` type (`/meta/types`). Drives the
   * SchemaForm so the fields, enums and grouping come from the real hook
   * metadata contract rather than being synthesised from the value shape.
   */
  hookSchema?: Record<string, unknown>;
}) {
  const locale = useMetadataLocale();
  // Curated hook authoring surface; falls back to the generic SchemaForm if
  // unregistered, and swaps the curated surface in if it is registered later
  // (objectui#11939).
  const HookInspector = useRegisteredMetadataDefaultInspector('hook');
  const {
    hooks,
    refusedHooks,
    loading,
    error,
    selected,
    draft,
    dirty,
    saving,
    renamedFrom,
    blockingIssues,
    hookTargetScope,
    select: setSelected,
    patch,
    replace,
    addHook,
    reportCel,
    dialog: hookConflictDialog,
  } = buffer;

  // objectui#12514 — an object no hook targets is one centered block whose
  // button runs the list header's own "New".
  if (!loading && hooks.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {hookConflictDialog}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive whitespace-pre-line">
            {error}
          </div>
        )}
        <StudioEmptyState
          testId="hooks-empty"
          icon={Webhook}
          sentence={t('engine.studio.hooks.none', locale)}
          action={
            disabled ? undefined : (
              <StudioEmptyStateAction
                data-testid="hooks-empty-new"
                label={t('engine.studio.hooks.newButton', locale)}
                onClick={addHook}
                disabled={saving}
              />
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {hookConflictDialog}
      {/* hook list */}
      <div className="flex w-72 shrink-0 flex-col rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Webhook className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{t('engine.studio.data.tab.hooks', locale)}</span>
          <span className="text-[11px] text-muted-foreground">({hooks.length})</span>
          {!disabled && (
            <button
              type="button"
              onClick={addHook}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
            >
              <Plus className="h-3 w-3" /> {t('engine.studio.new', locale)}
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">{t('engine.studio.loading', locale)}</p>
          ) : (
            hooks.map((h) => (
              <button
                key={String(h.name)}
                type="button"
                onClick={() => setSelected(h.name ?? null)}
                className={
                  'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-[12px] ' +
                  (selected === h.name ? 'bg-muted' : 'hover:bg-muted/50')
                }
              >
                <Webhook className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{h.label || h.name}</span>
                {h.async && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    {t('engine.studio.hooks.async', locale)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* detail — the platform's generic metadata form */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border">
        {error && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive whitespace-pre-line">
            {error}
          </div>
        )}
        {!draft && selected !== null && refusedHooks.has(selected) ? (
          // objectstack#29148 — why this hook opens nothing to edit, the
          // server's own sentence behind Details (the Studio refusal strip's look).
          <div
            data-testid="hooks-draft-unreadable"
            className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive"
          >
            <p role="alert" className="whitespace-pre-line">
              {t('engine.studio.refusal.draftUnreadable', locale)}
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer select-none opacity-80">{t('engine.studio.refusal.details', locale)}</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono opacity-90">
                {formatMetadataError(refusedHooks.get(selected))}
              </pre>
            </details>
          </div>
        ) : !draft ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground">
            {t('engine.studio.hooks.pick', locale)}
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{String(draft.label || draft.name)}</span>
              {/* objectstack#36511 — the top bar's Save sends the hook; the
                  line says only that it is on its way, and why an edit is
                  held when an expression error holds it. */}
              {disabled ? null : saving ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="hooks-saving">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('engine.studio.autoSaving', locale)}
                </span>
              ) : renamedFrom !== null ? null : blockingIssues > 0 && dirty ? (
                <span className="text-[11px] text-destructive" data-testid="hooks-save-held">
                  {t('perm.cel.saveBlocked', locale)}
                </span>
              ) : null}
            </div>
            {renamedFrom !== null && !disabled && (
              <p
                role="status"
                data-testid="hooks-rename-held"
                className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"
              >
                {tFormat('engine.studio.hooks.renameHeld', locale, { name: renamedFrom })}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {HookInspector ? (
                <HookTargetScopeContext.Provider value={hookTargetScope}>
                  {/* eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataDefaultInspector returns a registered component (stable), not one created during render */}
                  <HookInspector
                    type="hook"
                    name={String(draft.name ?? '')}
                    draft={draft as Record<string, unknown>}
                    onPatch={(change) => patch(change as Partial<HookItem>)}
                    readOnly={!!disabled}
                    locale={locale}
                    serverSchema={hookSchema}
                    onBlockingIssuesChange={reportCel}
                  />
                </HookTargetScopeContext.Provider>
              ) : (
                <div className="p-3">
                  <SchemaForm
                    schema={hookSchema}
                    value={draft as Record<string, unknown>}
                    onChange={(next) => replace(next as HookItem)}
                    readOnly={!!disabled}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
