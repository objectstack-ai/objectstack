// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30046 — the title of an `object` leaf's header: object / view ▾,
 * the way the running list's title reads (`ObjectViewTitleSwitcher`). The
 * view part is that same switcher: the object's list views by label, with a
 * search box, and New view, which opens the console's Create View dialog.
 *
 * It is the Studio's switcher, so it offers none of the reader's own
 * features: no ☆, no 📌, no recent views, no Save as my view. A Studio author
 * is shaping what every reader gets, not keeping a list of their own. It shows
 * for an object with one list view too, so New view is always one click away.
 *
 * A pick goes through the host (`onSwitchView`), which sends a pending edit
 * first or asks before one is dropped. New view is offered where the package
 * takes a new item (`canCreate`): a read-only package switches views and
 * creates nothing.
 *
 * On a narrow row the object's name gives way before the view's: it
 * truncates first, down to a few characters, and the view's name truncates
 * last, its whole text in the trigger's tooltip.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useMetadata } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { ObjectViewTitleSwitcher, type TitleSwitcherView } from '../objectViewTitleSwitcher.js';
import { CreateViewDialog, type CreateViewDialogProps } from '../CreateViewDialog.js';
import { useObjectFields } from '../metadata-admin/previews/useObjectFields.js';
import { tFormat } from '../metadata-admin/i18n.js';
import { findByName } from '../../hooks/useNavTargetLabel.js';
import { listViewsOf } from './studio-canvas-preview.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';
import { issueRefusal } from './metadataError.js';
import {
  listViewLabelOf,
  listViewNameOf,
  type NewViewPayload,
  type ObjectListViewDraft,
} from './ObjectListViewInspector.js';

export interface ObjectListViewTitleProps {
  listView: ObjectListViewDraft;
  /** The object's display name, as the leaf's rail row names it. */
  objectText: string;
  locale: string;
  /** Whether New view is offered: the package takes a new view. */
  canCreate: boolean;
  /**
   * The host's switch to another view of the object: it sends the panel's
   * pending edit first, or asks before one is dropped, then shows the view
   * (`listView.showView`). Without it, the view shows at once.
   */
  onSwitchView?: (viewId: string) => void;
  /**
   * Called as New view opens its dialog: the host sends the panel's pending
   * edit now, since the view shown changes once the new one is created.
   */
  onAddViewOpen?: () => void;
  /** Called once New view has saved the view and shows it: a selection named a column of the view before. */
  onViewCreated?: () => void;
}

export function ObjectListViewTitle({
  listView,
  objectText,
  locale,
  canCreate,
  onSwitchView,
  onAddViewOpen,
  onViewCreated,
}: ObjectListViewTitleProps): React.ReactElement {
  const { t } = useObjectTranslation();
  const target = listView.target;
  const objectName = target?.objectName;
  // The dialog's required-field pickers offer the fields the panel's own
  // pickers offer, by label: the object's fields minus the columns the
  // platform injects and hides (`isStudioHiddenSystemField`).
  const fieldState = useObjectFields(objectName);
  const dialogObject = React.useMemo<CreateViewDialogProps['objectDef']>(
    () =>
      objectName
        ? {
            name: objectName,
            fields: Object.fromEntries(
              fieldState.fields
                .filter((f) => !isStudioHiddenSystemField({ system: f.system, hidden: f.hidden }))
                .map((f) => [f.name, { name: f.name, label: f.label, type: f.type, hidden: f.hidden, options: f.options }]),
            ),
          }
        : undefined,
    [objectName, fieldState.fields],
  );
  const metadata = useMetadata();
  const objectDef = objectName ? findByName(metadata.objects, objectName) : undefined;
  const [addOpen, setAddOpen] = React.useState(false);
  if (!target) return <>{objectText}</>;

  const views: TitleSwitcherView[] = listView.views.map((choice) => ({
    id: choice.target.viewId,
    label: listViewLabelOf(choice.target, choice.label, locale),
    // A default view no row holds yet is the object's grid.
    type: choice.type ?? 'grid',
    // Kept in the order the choices list them: none is the reader's own.
    authored: true,
  }));
  const activeLabel = listViewNameOf(listView, target, listView.row, locale);
  const switchView = (viewId: string) => {
    if (viewId === target.viewId) return;
    if (onSwitchView) onSwitchView(viewId);
    else listView.showView(viewId);
  };
  const addView = async (config: NewViewPayload): Promise<boolean> => {
    const refusal = await listView.createView(config);
    if (!refusal) {
      onViewCreated?.();
      return true;
    }
    // The dialog stays open with the author's input; this says why.
    toast.error(
      'taken' in refusal
        ? tFormat('engine.studio.inspector.listView.addViewTaken', locale, { name: refusal.taken })
        : issueRefusal(refusal.error, locale).message,
    );
    return false;
  };
  const existingViewLabels = Object.values(listViewsOf(objectDef))
    .map((v) =>
      v && typeof v === 'object' ? resolveI18nLabel((v as { label?: I18nLabel }).label, locale) : '',
    )
    .filter((l): l is string => !!l);
  const canAdd = canCreate && !fieldState.loading && !fieldState.error;

  return (
    <span className="flex min-w-0 items-baseline gap-1.5" data-testid="if-list-view-title">
      <span className="min-w-[2.5em] shrink-[1000] truncate" data-testid="if-list-view-title-object" title={objectText}>
        {objectText}
      </span>
      <span aria-hidden="true" className="shrink-0 font-normal text-muted-foreground">
        /
      </span>
      <ObjectViewTitleSwitcher
        views={views}
        activeViewId={target.viewId}
        activeLabel={activeLabel}
        // The view's whole name, for a title too narrow to show it.
        description={activeLabel}
        onViewChange={switchView}
        favorites={null}
        onAddView={
          canAdd
            ? () => {
                onAddViewOpen?.();
                setAddOpen(true);
              }
            : undefined
        }
        t={t}
      />
      {addOpen && (
        <CreateViewDialog
          open
          onOpenChange={setAddOpen}
          onCreate={addView}
          objectDef={dialogObject}
          existingLabels={existingViewLabels}
        />
      )}
    </span>
  );
}
