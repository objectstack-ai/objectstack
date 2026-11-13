// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which existing objects a package changes, shown before the install
 * (objectstack#31542): beside `PluginDisclosure`, in the hosted install dialog
 * for every package and in the local-install confirm.
 *
 * The list is the catalog's `object_extensions` for the version installed, or,
 * on a catalog that does not serve the key, the same reading of the served
 * manifest (`InstallPreview.objectExtensions`). What each value says:
 *
 * - a list: each target with the fields, field display patches, validation
 *   rules and indexes it adds, and whether it overrides the object's label.
 *   A platform (`sys_*`) target is flagged; platform targets come first.
 * - `[]`: the package changes no existing object, and nothing is drawn.
 * - `null`: what it changes could not be read. ⛔ Never drawn as "changes
 *   nothing": an unread package may change platform objects too.
 * - `undefined`: still reading.
 *
 * When any target is a platform object and the surface passes
 * `onAcknowledgedChange`, an acknowledgment checkbox is drawn; the surface
 * holds its install until it is checked (`needsPlatformAcknowledgment`).
 */

import { Badge, Checkbox, Label } from '@object-ui/components';
import { AlertTriangle, Layers } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { MarketplaceObjectExtension } from './marketplaceApi.js';

/** The extension list a surface draws: a list, `null` (could not read), or `undefined` (reading). */
export type ObjectExtensionsReading = readonly MarketplaceObjectExtension[] | null | undefined;

/** True when the install changes a platform object, so it waits for the acknowledgment. */
export function needsPlatformAcknowledgment(extensions: ObjectExtensionsReading): boolean {
  return !!extensions && extensions.some((e) => e.platform);
}

function Names({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      {items.map((it, i) => (
        <span key={it}>
          {i > 0 ? ' ' : null}
          <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-muted break-all">{it}</code>
        </span>
      ))}
    </div>
  );
}

export function ObjectExtensionDisclosure({
  extensions,
  acknowledged = false,
  onAcknowledgedChange,
  idPrefix = 'object-extensions',
}: {
  extensions: ObjectExtensionsReading;
  acknowledged?: boolean;
  onAcknowledgedChange?: (acknowledged: boolean) => void;
  /** Distinguishes the checkbox id when two surfaces could be mounted at once. */
  idPrefix?: string;
}) {
  const { t } = useObjectTranslation();

  if (extensions === undefined) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="object-extensions-reading">
        {t('marketplace.objectExtensions.reading')}
      </p>
    );
  }
  if (extensions === null) {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
        data-testid="object-extensions-unknown"
      >
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
        <span>{t('marketplace.objectExtensions.unknown')}</span>
      </div>
    );
  }
  if (extensions.length === 0) return null;

  const platform = needsPlatformAcknowledgment(extensions);
  const ackId = `${idPrefix}-ack`;

  return (
    <div
      className={`rounded-md border p-3 space-y-3 text-sm ${platform ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}
      data-testid="object-extensions"
    >
      <div className="flex items-center gap-2 font-medium">
        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {t('marketplace.objectExtensions.title')}
      </div>
      <p className="text-xs text-muted-foreground">{t('marketplace.objectExtensions.intro')}</p>
      {platform && (
        <p
          className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
          data-testid="object-extensions-platform-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('marketplace.objectExtensions.platformWarning')}</span>
        </p>
      )}
      <ul className="space-y-2">
        {extensions.map((ext) => (
          <li
            key={ext.object}
            data-testid="object-extension"
            data-object={ext.object}
            data-platform={ext.platform ? 'true' : 'false'}
            className={`space-y-1 rounded-sm border-l-2 pl-2 text-xs ${ext.platform ? 'border-amber-500' : 'border-muted'}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="font-mono text-sm font-medium">{ext.object}</code>
              {ext.platform && (
                <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                  {t('marketplace.objectExtensions.platformBadge')}
                </Badge>
              )}
            </div>
            <Names label={t('marketplace.objectExtensions.fields')} items={ext.fields} />
            <Names label={t('marketplace.objectExtensions.fieldPatches')} items={ext.field_patches} />
            <Names label={t('marketplace.objectExtensions.validations')} items={ext.validations} />
            {ext.indexes > 0 && (
              <div className="text-muted-foreground">{t('marketplace.objectExtensions.indexes', { count: ext.indexes })}</div>
            )}
            {ext.relabels && <div className="text-muted-foreground">{t('marketplace.objectExtensions.relabels')}</div>}
          </li>
        ))}
      </ul>
      {platform && onAcknowledgedChange && (
        <div className="flex items-start gap-2">
          <Checkbox
            id={ackId}
            checked={acknowledged}
            onCheckedChange={(c) => onAcknowledgedChange(c === true)}
          />
          <Label htmlFor={ackId} className="text-sm font-normal cursor-pointer leading-snug">
            {t('marketplace.objectExtensions.acknowledge')}
          </Label>
        </div>
      )}
    </div>
  );
}
