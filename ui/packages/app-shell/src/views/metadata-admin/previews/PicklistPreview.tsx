// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PicklistPreview — the read-only page of a shared picklist (objectui#10202).
 *
 * A picklist is one list of select options that fields on several objects name
 * with `picklist: 'NAME'` instead of carrying their own (`PicklistSchema`,
 * `@objectstack/spec` `data/picklist.zod.ts`). The kind is PACKAGE-OWNED: its
 * registry entry declares `allowRuntimeCreate: false` and `allowEnvironmentOverlay:
 * false`, so the generic engine already offers no create and renders the item
 * read-only. This preview is the page's detail view and it is read-only too:
 * it offers no create, edit or delete of any kind, because the server refuses
 * all three for this kind.
 *
 * It shows what the protocol declares, and nothing it does not:
 *
 *   • the list's `label`, `name`, `description` and its owning package
 *     (`_packageId`, the loader's protection stamp on every registered item);
 *   • its `options`, each with its label and value;
 *   • its EXTENSIONS: the options other packages add with
 *     `picklistExtensions: [{ extend: NAME, options }]`, each under the package
 *     that declares it.
 *
 * ## Where the extensions come from
 *
 * `GET /meta/picklist/NAME` serves the owning list only: the runtime merges the
 * extensions into each bound FIELD's resolved `options`, not into the list's
 * own read. The declaring package of each extension is served on the package
 * read instead — every installed package's manifest carries its
 * `picklistExtensions` as authored (`PicklistExtensionSchema`: `extend` +
 * `options`) — so this page reads `GET /meta/package` and keeps the entries
 * whose `extend` names this list. That read is a {@link LoadState}: a failed
 * read says the extensions are unknown, never that there are none.
 */

import * as React from 'react';
import { ListOrdered, Lock, Package } from 'lucide-react';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { useMetadataClient } from '../useMetadata.js';
import { usePickerLoad, type LoadState } from '../loadState.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';
import { extensionsOf, shownOptions, type PicklistExtensionRow, type ShownOption } from './picklist-extensions.js';

function usePicklistExtensions(picklist: string): LoadState<PicklistExtensionRow[]> {
  const client = useMetadataClient();
  // Made once per mount and held in state (AGENTS.md #10): a loader keyed on a
  // memoised `client` re-runs `usePickerLoad` on every render of a host whose
  // client is not referentially stable. The edit page keys this preview per
  // item, so one mount is one picklist.
  const [load] = React.useState(() =>
    picklist ? async () => extensionsOf(picklist, (await client.list<unknown>('package')) ?? []) : null,
  );
  return usePickerLoad(load);
}

function OptionTable({ options, locale }: { options: ShownOption[]; locale?: string }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="px-2 py-1 text-left font-medium">{tr('engine.picklistPreview.colLabel', locale)}</th>
          <th className="px-2 py-1 text-left font-medium">{tr('engine.picklistPreview.colValue', locale)}</th>
        </tr>
      </thead>
      <tbody>
        {options.map((o) => (
          <tr key={o.value} className="border-t">
            <td className="px-2 py-1">{o.label}</td>
            <td className="px-2 py-1 font-mono text-[11px] text-muted-foreground">{o.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExtensionsSection({ picklist, locale }: { picklist: string; locale?: string }) {
  const state = usePicklistExtensions(picklist);
  return (
    <section className="space-y-1.5" aria-label={tr('engine.picklistPreview.extensions', locale)}>
      <div>
        <div className="text-xs font-medium">{tr('engine.picklistPreview.extensions', locale)}</div>
        <div className="text-[11px] text-muted-foreground">{tr('engine.picklistPreview.extensionsHint', locale)}</div>
      </div>
      {state.status === 'error' ? (
        <p role="status" className="text-[11px] leading-snug text-amber-600 dark:text-amber-300">
          {tr('engine.picklistPreview.extensionsFailed', locale)}{' '}
          <span className="break-words font-mono text-[10px] opacity-80">{state.message}</span>
        </p>
      ) : state.status !== 'loaded' ? (
        <p className="text-[11px] text-muted-foreground">{tr('engine.picklistPreview.extensionsLoading', locale)}</p>
      ) : state.data.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{tr('engine.picklistPreview.noExtensions', locale)}</p>
      ) : (
        state.data.map((ext, i) => (
          <div key={`${ext.packageId}:${i}`} className="rounded border" data-testid="picklist-extension">
            <div className="flex items-center gap-1.5 border-b bg-muted/30 px-2 py-1 text-[11px]">
              <Package className="h-3 w-3 text-muted-foreground" />
              <span>
                {tFormat('engine.picklistPreview.addedBy', locale, {
                  package: ext.packageName ? `${ext.packageName} (${ext.packageId})` : ext.packageId,
                })}
              </span>
            </div>
            <OptionTable options={ext.options} locale={locale} />
          </div>
        ))
      )}
    </section>
  );
}

export function PicklistPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const picklistName = String(d.name ?? name ?? '');
  const label = typeof d.label === 'string' && d.label ? d.label : picklistName;
  const description = typeof d.description === 'string' ? d.description : '';
  const owner = typeof d._packageId === 'string' ? d._packageId : undefined;
  const options = shownOptions(d.options);

  if (!picklistName) {
    return (
      <PreviewShell hint="picklist">
        <PreviewMessage>{tr('engine.picklistPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint="picklist">
      <PreviewErrorBoundary>
        <div className="p-3 space-y-4">
          <div className="rounded border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <ListOrdered className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{picklistName}</span>
                </div>
                {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
              </div>
            </div>
            {owner && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Package className="h-3 w-3" />
                <span>{tr('engine.picklistPreview.ownedBy', locale)}</span>
                <code className="font-mono">{owner}</code>
              </div>
            )}
            <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{tr('engine.picklistPreview.readOnly', locale)}</span>
            </div>
          </div>

          <section className="space-y-1.5" aria-label={tr('engine.picklistPreview.options', locale)}>
            <div className="text-xs font-medium">{tr('engine.picklistPreview.options', locale)}</div>
            {options.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{tr('engine.picklistPreview.noOptions', locale)}</p>
            ) : (
              <div className="rounded border">
                <OptionTable options={options} locale={locale} />
              </div>
            )}
          </section>

          <ExtensionsSection picklist={picklistName} locale={locale} />
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}
