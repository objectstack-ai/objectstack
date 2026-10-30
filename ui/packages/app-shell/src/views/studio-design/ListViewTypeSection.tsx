// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27895 — the settings of a list view's own type, in the
 * list-view panel: a calendar's start date and title fields, a gallery's
 * cover and card fields, a timeline's dates, scale and grouping, and the
 * blocks of a gantt, a map and a tree.
 *
 * Each type keeps its settings in the list body's block of the same name
 * (`calendar`, `gallery`, …, on the spec's `ListViewSchema`). The section is
 * that block, rendered from the spec's own JSONSchema for it
 * (`getListVariantSchema`) by the generic {@link SchemaForm}: which settings
 * a type has, which are required and which values an enum allows all come
 * from the spec, so a key the spec adds to a block shows up here with no
 * change. ⛔ No per-type field list. A setting that names a field (`*Field`,
 * `*Fields`) is a picker over the object's fields, by label, as the form
 * draws it wherever it is given a field catalog.
 *
 * Not here: `grid`, which has no block; `kanban`, whose card has its own
 * section (`KanbanCardSection`); and `chart`, whose block binds an ADR-0021
 * dataset and that dataset's measures, not the object's fields: its section
 * is `ListViewChartSection` (objectstack#27933).
 *
 * A required setting can be cleared (the field picker offers "None"). That
 * edit is held, not sent, as the pillar holds every edit the spec refuses
 * only for an unset input (`listViewTypeHeldEdit`): the draft door would
 * refuse it with a 422, and every later save with it. The chart's block is
 * held by the same rule, named by its own section's labels.
 */

import * as React from 'react';
import type { ListViewVisualization } from '@object-ui/core';
import { ListViewSchema } from '@objectstack/spec/ui';
import { SchemaForm } from '../metadata-admin/SchemaForm.js';
import { getListVariantSchema } from '../metadata-admin/view-schema.js';
import type { ObjectFieldOption } from '../metadata-admin/widgets.js';
import type { LoadState } from '../metadata-admin/loadState.js';
import { t, tFormat, translateSchemaFieldLabel } from '../metadata-admin/i18n.js';
import { prettifyFieldName } from '../metadata-admin/field-source-label.js';
import { DraftChip } from './StudioDraftMark.js';
import { objectHeldInput, type StudioHeld } from './metadataError.js';
import { chartInputLabel } from './ListViewChartSection.js';

type Row = Record<string, unknown>;
type JsonSchema = Record<string, any>;

function isPlainObject(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The view types whose block is edited somewhere else, or not by object field (see the module docblock). */
const EDITED_ELSEWHERE: ReadonlySet<string> = new Set(['kanban', 'chart']);

/**
 * The copy of each view type's name. A total record over the visualizations,
 * so a type the spec adds fails the build here until it has a name; every key
 * is spelled out, so the i18n gates can see it.
 */
const VIEW_TYPE_LABEL_KEYS: Record<ListViewVisualization, string> = {
  grid: 'engine.inspector.view.type.grid',
  kanban: 'engine.inspector.view.type.kanban',
  calendar: 'engine.inspector.view.type.calendar',
  gallery: 'engine.inspector.view.type.gallery',
  timeline: 'engine.inspector.view.type.timeline',
  gantt: 'engine.inspector.view.type.gantt',
  map: 'engine.inspector.view.type.map',
  chart: 'engine.inspector.view.type.chart',
  tree: 'engine.inspector.view.type.tree',
};

/**
 * The spec's JSONSchema for the block a list body of `type` keeps its own
 * settings in, or `null` when this section does not edit that type: a value
 * the spec's `type` enum does not carry, a type with no block, or one edited
 * elsewhere.
 */
export function listViewTypeBlockSchema(type: unknown): JsonSchema | null {
  if (typeof type !== 'string' || EDITED_ELSEWHERE.has(type)) return null;
  const list = getListVariantSchema();
  const types: unknown = list?.properties?.type?.enum;
  if (!Array.isArray(types) || !types.includes(type)) return null;
  const block = list?.properties?.[type];
  return isPlainObject(block) && block.type === 'object' && isPlainObject(block.properties) ? block : null;
}

/**
 * The field names a type's block holds, read by the form's own convention for
 * a field setting: a string under a `*Field` key, the strings under a
 * `*Fields` key.
 */
export function fieldNamesHeldByTypeBlock(block: unknown): string[] {
  if (!isPlainObject(block)) return [];
  const held: string[] = [];
  for (const [key, value] of Object.entries(block)) {
    if (/.Field$/.test(key) && typeof value === 'string' && value) held.push(value);
    else if (/Fields$/.test(key) && Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string' && v) held.push(v);
    }
  }
  return held;
}

function typeLabelOf(type: string, locale: string): string {
  const key = (VIEW_TYPE_LABEL_KEYS as Record<string, string | undefined>)[type];
  return key ? t(key, locale) : type;
}

/**
 * The edit the pillar holds for a list body whose type's block the spec
 * refuses only because a required setting is unset, or `null`. Asked of the
 * spec's `ListViewSchema` (`objectHeldInput`): a block that is finished but
 * wrong is sent, and its refusal shows as before. `input` is the setting's
 * label as the section draws it, so "Show me" focuses that control. A chart's
 * block is asked the same, its input named by `ListViewChartSection`.
 */
export function listViewTypeHeldEdit(body: Row, locale: string): StudioHeld<null> | null {
  const type = body.type;
  if (type === 'chart') {
    const key = objectHeldInput(body, ListViewSchema, 'chart');
    if (key === null) return null;
    const input = chartInputLabel(key, locale) ?? prettifyFieldName(key);
    return {
      clause: tFormat('engine.studio.held.listViewTypeNeedsInput', locale, { input, type: typeLabelOf(type, locale) }),
      target: null,
      input,
    };
  }
  const schema = listViewTypeBlockSchema(type);
  if (!schema || typeof type !== 'string') return null;
  const key = objectHeldInput(body, ListViewSchema, type);
  if (key === null) return null;
  const input =
    translateSchemaFieldLabel(key, schema.properties[key]?.title as string | undefined, locale) || prettifyFieldName(key);
  return {
    clause: tFormat('engine.studio.held.listViewTypeNeedsInput', locale, { input, type: typeLabelOf(type, locale) }),
    target: null,
    input,
  };
}

export function ListViewTypeSection({
  type,
  schema,
  body,
  writeBody,
  fieldCatalog,
  readOnly,
  locale,
  marked,
}: {
  type: string;
  /** {@link listViewTypeBlockSchema} of `type`. */
  schema: JsonSchema;
  body: Row;
  writeBody: (next: Row) => void;
  fieldCatalog: LoadState<ObjectFieldOption[]>;
  readOnly: boolean;
  locale: string;
  /** objectui#12725 — the copilot drafted a setting of this block. */
  marked: boolean;
}): React.ReactElement {
  const block = isPlainObject(body[type]) ? body[type] : undefined;
  const typeLabel = typeLabelOf(type, locale);
  return (
    <div data-testid="list-view-type-settings" data-view-type={type} className="space-y-3 rounded-md border p-2">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium">
          {tFormat('engine.studio.inspector.listView.typeSettings', locale, { type: typeLabel })}
          {marked && <DraftChip locale={locale} of={type} />}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {t('engine.studio.inspector.listView.typeSettings.intro', locale)}
        </p>
      </div>
      <SchemaForm
        schema={schema}
        // A segment no field name can spell, so the ids cannot meet another form's.
        idPath={`studio-list-view-${type}`}
        value={block}
        readOnly={readOnly}
        widgetContext={{ conditionScope: 'none', objectFields: fieldCatalog }}
        // The block stays written when it is emptied: a required setting
        // cleared is then an unset input, which the pillar holds.
        onChange={(next) => writeBody({ ...body, [type]: next })}
      />
    </div>
  );
}
