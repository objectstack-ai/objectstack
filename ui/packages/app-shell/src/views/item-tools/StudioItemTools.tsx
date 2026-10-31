// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioItemTools — the item toolbar of a Studio pillar's item header
 * (objectstack#28239, epic objectstack#28236 rulings D-5 / D-7): the five
 * tools Setup's item page opens — Layers, References, History with rollback,
 * Audit and Source — as icon buttons, each opening the same panel Setup's
 * sheet holds.
 *
 * What it keeps from Setup:
 *   - History and Audit are offered only to a caller the authoring-trail doors
 *     admit (`useCanReadAuthoringTrail`), and their sheets are not mounted for
 *     anyone else.
 *   - Rollback is offered on the gate Setup's Save asks: an authoring caller
 *     on an item that is not read-only. A read-only package shows its history
 *     without it.
 *
 * What it leaves to Studio: Setup's autosave toggle and draft review panel.
 * Studio keeps its own draft → publish and pending-changes review.
 *
 * Source edits the pillar's own buffer when the pillar hands one over
 * (`source.onChange`) and the item is not read-only, so an edit there is
 * saved by the pillar's autosave like any other. Without a buffer it shows
 * the item's effective body, read-only.
 */

import * as React from 'react';
import { FileCode2, History, Layers3, Link2, Loader2, ShieldCheck } from 'lucide-react';
import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@object-ui/components';
import type { MetadataLayered } from '@object-ui/data-objectstack';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { useCanAuthorMetadata, useCanReadAuthoringTrail } from '../../hooks/useCanAuthorMetadata.js';
import { LayeredDiff } from './LayeredDiff.js';
import { ReferencesPanel, useReferencesScan } from './ReferencesPanel.js';
import { HistoryPanel } from './ResourceHistoryPage.js';
import { AuditPanel } from './AuditPanel.js';
import { JsonSourceEditor } from './JsonSourceEditor.js';

/** The tool a sheet holds. */
export type StudioItemTool = 'layers' | 'references' | 'history' | 'audit' | 'source';

export interface StudioItemToolsProps {
  /** The item's metadata type (`object`, `flow`, `page`, …). */
  type: string;
  /** The item's machine name. */
  name: string;
  /** The package the item belongs to: scopes the layers read (ADR-0048). */
  packageId?: string | null;
  /** The pillar's read-only gate: no rollback, and Source is read-only. */
  readOnly?: boolean;
  /**
   * The pillar's edit buffer for this item. Source shows `value`; with
   * `onChange` and an item that is not read-only, an edit replaces it.
   * Omitted, Source shows the item's effective body, read-only.
   */
  source?: {
    value: Record<string, unknown>;
    onChange?: (next: Record<string, unknown>) => void;
  };
  /** After a rollback landed: the pillar re-reads the item. */
  onRolledBack?: () => void;
  locale?: string;
}

/** The layers read, asked the first time a sheet needs it. */
type LayersState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; layered: MetadataLayered<any> }
  | { status: 'error'; message: string };

const TOOL_BUTTON = 'relative h-7 w-7 p-0';

/**
 * One toolbar per item: a new item starts with nothing read, so a sheet never
 * shows the previous item's references or layers.
 */
export function StudioItemTools(props: StudioItemToolsProps): React.ReactElement {
  return <StudioItemToolsFor key={`${props.type}/${props.name}`} {...props} />;
}

function StudioItemToolsFor({
  type,
  name,
  packageId,
  readOnly = false,
  source,
  onRolledBack,
  locale,
}: StudioItemToolsProps): React.ReactElement {
  const client = useMetadataClient();
  const canReadTrail = useCanReadAuthoringTrail();
  const canAuthor = useCanAuthorMetadata();
  const [open, setOpen] = React.useState<StudioItemTool | null>(null);
  const refs = useReferencesScan(client, type, name);
  const [layers, setLayers] = React.useState<LayersState>({ status: 'idle' });

  // Re-entry guard as the references scan's: a read in flight or done is not
  // asked again; `idle` and `error` fall through, so Retry is this same call.
  async function loadLayers() {
    if (layers.status === 'loading' || layers.status === 'loaded') return;
    setLayers({ status: 'loading' });
    try {
      const layered = await client.layered<any>(type, name, packageId ? { packageId } : {});
      setLayers({ status: 'loaded', layered });
    } catch (err: any) {
      setLayers({ status: 'error', message: String(err?.message ?? err) });
    }
  }

  React.useEffect(() => {
    if (open === 'references') void refs.load();
    if (open === 'layers' || (open === 'source' && !source)) void loadLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canRollback = !readOnly && canAuthor;
  const sourceEditable = !readOnly && !!source?.onChange;
  const close = (o: boolean) => {
    if (!o) setOpen(null);
  };
  const toolButton = (tool: StudioItemTool, label: string, Icon: React.ElementType, badge?: React.ReactNode) => (
    <Button
      variant="ghost"
      size="sm"
      data-testid={`studio-item-tool-${tool}`}
      aria-label={label}
      title={label}
      aria-pressed={open === tool}
      onClick={() => setOpen(tool)}
      className={cn(TOOL_BUTTON, open === tool && 'bg-muted text-foreground')}
    >
      <Icon className="h-3.5 w-3.5" />
      {badge}
    </Button>
  );
  const sheet = (tool: StudioItemTool, title: string, body: React.ReactNode, description?: string, wide = false) => (
    <Sheet open={open === tool} onOpenChange={close}>
      <SheetContent
        side="right"
        data-testid={`studio-item-tool-sheet-${tool}`}
        className={cn('w-[92vw] p-0 flex flex-col gap-0', wide ? 'sm:max-w-[860px]' : 'sm:max-w-[720px]')}
      >
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="text-xs">
            {type} / {name}
            {description ? ` · ${description}` : null}
          </SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
  const layersBody =
    layers.status === 'error' ? (
      <div className="space-y-3 p-4 text-sm" data-testid="studio-item-tool-layers-error">
        <p className="text-destructive">
          {tFormat('engine.studio.itemTools.layersFailed', locale, { message: layers.message })}
        </p>
        <Button variant="outline" size="sm" onClick={() => void loadLayers()}>
          {t('engine.studio.itemTools.layersRetry', locale)}
        </Button>
      </div>
    ) : (
      <LayeredDiff
        layered={layers.status === 'loaded' ? layers.layered : null}
        loading={layers.status !== 'loaded'}
        locale={locale}
      />
    );

  return (
    <>
      <div
        role="group"
        aria-label={t('engine.studio.itemTools.group', locale)}
        data-testid="studio-item-tools"
        className="flex shrink-0 items-center rounded-md border bg-background p-0.5"
      >
        {toolButton('layers', t('engine.edit.layers', locale), Layers3)}
        {toolButton(
          'references',
          t('engine.edit.references', locale),
          Link2,
          refs.state.status === 'loaded' && refs.state.items.length > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-muted text-foreground text-[9px] leading-[14px] text-center font-medium border">
              {refs.state.items.length}
            </span>
          ) : undefined,
        )}
        {canReadTrail && toolButton('history', t('engine.edit.history', locale), History)}
        {canReadTrail && toolButton('audit', t('engine.edit.auditTab', locale), ShieldCheck)}
        {toolButton('source', t('engine.edit.inspector.source', locale), FileCode2)}
      </div>

      {sheet('layers', t('engine.edit.layers', locale), <div className="flex-1 min-h-0 overflow-auto p-4">{layersBody}</div>)}

      {sheet(
        'references',
        t('engine.edit.references', locale),
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <ReferencesPanel state={refs.state} locale={locale} onRetry={() => void refs.load()} />
        </div>,
      )}

      {canReadTrail &&
        sheet(
          'history',
          t('engine.edit.history', locale),
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <HistoryPanel
              type={type}
              name={name}
              client={client}
              locale={locale}
              // Setup's gate: the rollback door asks the capability and wall
              // verdicts the save door asks, so it is offered where Save is.
              onRollback={
                canRollback
                  ? () => {
                      setLayers({ status: 'idle' });
                      onRolledBack?.();
                    }
                  : undefined
              }
              rollbackLabel={t('engine.edit.rollback', locale)}
              rollbackConfirm={(version) =>
                t('engine.edit.rollbackConfirm', locale).replace('{version}', String(version))
              }
            />
          </div>,
        )}

      {canReadTrail &&
        sheet(
          'audit',
          t('engine.edit.auditTab', locale),
          <div className="flex-1 min-h-0 overflow-hidden p-3">
            <AuditPanel type={type} name={name} client={client} locale={locale} />
          </div>,
          undefined,
          true,
        )}

      {sheet(
        'source',
        t('engine.edit.inspector.source', locale),
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {source || layers.status === 'loaded' ? (
            <JsonSourceEditor
              value={source ? source.value : layers.status === 'loaded' ? (layers.layered.effective ?? {}) : {}}
              onChange={(next) => {
                if (sourceEditable) source?.onChange?.(next);
              }}
              readOnly={!sourceEditable}
            />
          ) : layers.status === 'error' ? (
            layersBody
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="studio-item-tool-source-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.edit.loading', locale)}
            </div>
          )}
        </div>,
        sourceEditable ? undefined : t('engine.studio.itemTools.sourceReadOnly', locale),
      )}
    </>
  );
}
