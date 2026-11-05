// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30046 (Scope 6) — the list-view settings the object page's panel
 * did not offer, which only the view's own page (`surface=view:`, the view
 * inspector `ViewVariantInspector`) did: the view's conditional formatting
 * (条件格式化) and the sections of the spec's authoring form for a view
 * (`view.form.ts`: description, quick search, table options, pagination,
 * end-user controls, navigation and sharing, and each type's own block).
 *
 * A list view now opens on its object's page from every door, so these come
 * with it, below the panel's own sections, and nothing that page offered is
 * dropped. Both are the inspector's own parts, fed the same way:
 *
 *  - `ConditionalFormattingEditor`, over the body's `conditionalFormatting`;
 *    its CEL verdicts are reported to the host (`onBlockingIssuesChange`),
 *    which holds the list-view autosave on them, as the view page held its
 *    Save (objectui#4527);
 *  - the generic `SchemaForm`, over the spec's list-variant JSONSchema and
 *    the localized authoring form (`getViewForm`), with every key the panel
 *    already edits pruned from it, so no setting has two controls: the
 *    columns, the filter, the sort, the chart binding, and the blocks
 *    `ListViewTypeSection` draws. The kanban block stays: the card section
 *    edits its card, not its lanes or its summary field.
 *
 * ⛔ No per-key field list of what is shown: what the spec form declares flows
 * through. The section titles are the spec form's, localized where the locale
 * overlay carries them; #30039 owns translating the rest.
 */

import * as React from 'react';
import { ConditionalFormattingEditor } from '../metadata-admin/ConditionalFormattingEditor.js';
import { SchemaForm } from '../metadata-admin/SchemaForm.js';
import type { FormViewSpec } from '../metadata-admin/SchemaForm.js';
import { getListVariantSchema, getViewForm } from '../metadata-admin/view-schema.js';
import type { ObjectFieldOption } from '../metadata-admin/widgets.js';
import type { LoadState } from '../metadata-admin/loadState.js';
import { t } from '../metadata-admin/i18n.js';

type Row = Record<string, unknown>;

/**
 * The body keys the list-view panel edits with its own sections, pruned from
 * the spec form here: the columns (and the canvas), the filter, the sort, the
 * conditional formatting above, the chart binding (`ListViewChartSection`)
 * and the type blocks `ListViewTypeSection` draws. `data` and `name` the spec
 * form's own pruning already drops (`getViewForm`).
 */
const EDITED_BY_THE_PANEL: ReadonlySet<string> = new Set([
  'columns',
  'filter',
  'sort',
  'conditionalFormatting',
  'chart',
  'calendar',
  'gallery',
  'timeline',
  'gantt',
  'map',
  'tree',
]);

/** The fields the curated controls own, hidden from the form as the view inspector hides them. */
const HIDDEN_FIELDS = ['type', 'object', 'label'];

/** The localized spec form, without the keys the panel edits, and without a section left empty. */
function panelViewForm(locale: string): FormViewSpec | undefined {
  const form = getViewForm(locale);
  if (!form) return undefined;
  const fieldName = (f: unknown): unknown => (typeof f === 'string' ? f : (f as { field?: unknown } | null)?.field);
  const sections = (form.sections ?? [])
    .map((section) => ({
      ...section,
      fields: (section.fields ?? []).filter((f: unknown) => !EDITED_BY_THE_PANEL.has(String(fieldName(f)))),
    }))
    .filter((section) => section.fields.length > 0);
  return { ...form, sections };
}

/** `next` with every key the form does not edit as `body` holds it (present or absent). */
function repinned(next: Row, body: Row): Row {
  const merged: Row = { ...next };
  for (const key of [...EDITED_BY_THE_PANEL, 'data', 'name']) {
    if (key in body) merged[key] = body[key];
    else delete merged[key];
  }
  return merged;
}

export function ListViewMoreSection({
  body,
  writeBody,
  objectName,
  fieldNames,
  fieldCatalog,
  readOnly,
  locale,
  onBlockingIssuesChange,
}: {
  /** The view's list body (`config` of a view item). */
  body: Row;
  writeBody: (next: Row) => void;
  objectName: string | undefined;
  /** The object's field names, for the formatting rules' autocomplete. */
  fieldNames: string[];
  fieldCatalog: LoadState<ObjectFieldOption[]>;
  readOnly: boolean;
  locale: string;
  /** How many formatting rules' CEL does not parse: the host holds the autosave while it is not 0. */
  onBlockingIssuesChange?: (count: number) => void;
}): React.ReactElement {
  const tLocal = React.useCallback((key: string) => t(key, locale), [locale]);
  const rules = Array.isArray(body.conditionalFormatting) ? (body.conditionalFormatting as unknown[]) : [];
  const form = React.useMemo(() => panelViewForm(locale), [locale]);
  const schema = getListVariantSchema();
  return (
    <div className="space-y-3 border-t pt-3" data-testid="list-view-more">
      <div data-testid="list-view-conditional-formatting">
        <ConditionalFormattingEditor
          rules={rules as never}
          objectName={objectName}
          fieldNames={fieldNames}
          disabled={readOnly}
          t={tLocal}
          onChange={(next) => {
            const { conditionalFormatting: _dropped, ...rest } = body;
            writeBody(next.length > 0 ? { ...rest, conditionalFormatting: next } : rest);
          }}
          onBlockingIssuesChange={onBlockingIssuesChange}
        />
      </div>
      {schema && form && (
        <div className="border-t pt-3" data-testid="list-view-spec-form">
          <SchemaForm
            schema={schema}
            form={form}
            // A segment no field name can spell, so the ids cannot meet another form's.
            idPath="studio-list-view-more"
            value={body}
            hiddenFields={HIDDEN_FIELDS}
            readOnly={readOnly}
            widgetContext={{ conditionScope: 'none', objectFields: fieldCatalog }}
            // The form emits the whole body it was given. The keys it does not
            // edit are re-pinned from the body, as the view inspector re-pins
            // its canvas-owned ones, so an edit here never moves them.
            onChange={(next) => writeBody(repinned(next, body))}
          />
        </div>
      )}
    </div>
  );
}
