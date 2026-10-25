// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SourcePageProperties — the Properties tab of a `kind: 'html'` / `'react'`
 * page in the Studio (objectui#12522). Such a page has no block tree, so the
 * tab says what the page IS: its label, its identifier, the language it is
 * written in, and the navigation entries that open it.
 *
 * It edits only what the page schema lets the Studio edit:
 *  - `label` (`I18nLabel`) is edited in the designer locale: a plain string is
 *    replaced, and a per-language map changes only that locale's entry
 *    (`renamedLabel`, objectui#11128), so no other language's text is lost.
 *  - `name` is the page's identity, which every save addresses
 *    (`PAGE_FIELDS_OWNED_ELSEWHERE`): read-only.
 *  - `kind` is chosen in the create dialog and is not changed in the Studio
 *    (`PageCreateFields`): read-only, worded as that dialog words it.
 *  - The navigation entries are the app's, not the page's: listed, never
 *    written from here.
 */

import * as React from 'react';
import { Input, Label } from '@object-ui/components';
import type { I18nLabel } from '@objectstack/spec/ui';
import { t } from '../i18n.js';
import { navItemLabelText, renamedLabel } from './navItemLabel.js';

/** A navigation entry that opens the page, as the host resolved it. */
export interface SourcePageNavEntry {
  /** The entry's spec `id`. */
  id: string;
  /** The entry's label in the designer locale. */
  label: string;
  /** The labels of the groups the entry sits in, outermost first. */
  trail: string[];
}

export interface SourcePagePropertiesProps {
  draft: Record<string, unknown>;
  /** The page's identifier: the name the Studio opened and saves it under. */
  name: string;
  /** The navigation entries whose target is this page. */
  navEntries: SourcePageNavEntry[];
  /** Patch the draft; undefined in read-only mode. */
  onPatch?: (patch: Record<string, unknown>) => void;
  readOnly?: boolean;
  /** The designer locale: the words, and the entry a label edit writes. */
  locale: string;
}

const ROW = 'flex flex-col gap-1';
const LABEL = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const VALUE = 'text-[13px] text-foreground';
const HINT = 'text-[11px] text-muted-foreground';

export function SourcePageProperties({
  draft,
  name,
  navEntries,
  onPatch,
  readOnly,
  locale,
}: SourcePagePropertiesProps) {
  const idBase = React.useId();
  const label = draft.label as I18nLabel | undefined;
  const labelEditable = !readOnly && !!onPatch;
  const kind = (draft as { kind?: string }).kind === 'react' ? 'react' : 'html';

  return (
    <div className="flex flex-col gap-4" data-testid="source-page-properties">
      <div className={ROW}>
        <Label htmlFor={`${idBase}-label`} className={LABEL}>
          {t('engine.studio.if.pageProps.label', locale)}
        </Label>
        {labelEditable ? (
          <Input
            id={`${idBase}-label`}
            value={navItemLabelText(label, locale)}
            onChange={(e) => onPatch!({ label: renamedLabel(label, e.target.value, locale) })}
            className="h-8 text-[13px]"
            data-testid="source-page-label"
          />
        ) : (
          <span id={`${idBase}-label`} className={VALUE} data-testid="source-page-label">
            {navItemLabelText(label, locale) || name}
          </span>
        )}
      </div>

      <div className={ROW}>
        <span className={LABEL}>{t('engine.studio.if.pageProps.identifier', locale)}</span>
        <span className="font-mono text-xs text-foreground" data-testid="source-page-identifier">
          {name}
        </span>
      </div>

      <div className={ROW}>
        <span className={LABEL}>{t('engine.studio.interfaces.create.pageKind', locale)}</span>
        <span className={VALUE} data-testid="source-page-kind" data-kind={kind}>
          {kind === 'react'
            ? t('engine.studio.interfaces.create.pageKindReact', locale)
            : t('engine.studio.interfaces.create.pageKindHtml', locale)}
        </span>
        <span className={HINT}>{t('engine.studio.if.pageProps.kindFixed', locale)}</span>
      </div>

      <div className={ROW}>
        <span className={LABEL}>{t('engine.studio.if.pageProps.navEntries', locale)}</span>
        {navEntries.length === 0 ? (
          <span className={HINT} data-testid="source-page-nav-none">
            {t('engine.studio.if.pageProps.noNavEntries', locale)}
          </span>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="source-page-nav-entries">
            {navEntries.map((entry) => (
              <li key={entry.id} className={VALUE} data-nav-id={entry.id}>
                {entry.trail.length > 0 && (
                  <span className="text-muted-foreground">{entry.trail.join(' › ')} › </span>
                )}
                {entry.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
