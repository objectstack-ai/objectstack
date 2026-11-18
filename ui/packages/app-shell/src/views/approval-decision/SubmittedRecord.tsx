/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The business record an approval request is about, drawn whole on the
 * request's page (objectstack#34588; maintainer 2026-11-17: 「审批页应该直接显示
 * 完整的记录；「动态」在最后」). It replaces the "As submitted" summary that drew
 * the amount and at most six fields (objectui#12483), so the approver no longer
 * leaves the page to read the rest of the record.
 *
 * Three faces, each drawn by the decision panel where the page puts it:
 *
 * - {@link SubmittedRecordCard}: every field the reader may read, in the
 *   sections and the order of the object's DEFAULT record page.
 * - {@link SubmittedChildTables}: the record's child tables, read-only.
 * - {@link SubmittedAttachmentsCard}: the record's attachment fields, in the
 *   page's right rail.
 *
 * ## The values are the submitted ones
 *
 * The values are the request's snapshot: the row's `payload`, the record as it
 * was SUBMITTED, kept at rest as the request's evidence (objectstack#10749) and
 * served redacted per reader. So the card stays headed "As submitted"
 * (`approvalsInbox.snapshotAsSubmitted`, ruling record 6499914328 on
 * objectstack#27502): a snapshot value never reads as the record's current one.
 *
 * A field changed after submission is marked "Changed", with its current value
 * beside it. The current values come from ONE read of the record
 * (`findOne`, no params, the read the record page sends), re-read when the
 * record is invalidated on the data bus. A read that is refused, fails or finds
 * nothing marks nothing, and the card says the current record could not be
 * read; it never says why (the platform answers a record outside the reader's
 * rows with the same 404 it gives a deleted one). How two values compare is
 * `valuesDiffer` in `./submittedRecordPlan`.
 *
 * ## The layout is the object's default record page
 *
 * The sections are `deriveRecordDetailSections`, the one derivation every
 * surface that builds the object's default record page reads (objectui#12442):
 * the object's field groups in declared order, else the primary section and
 * "More details". A `{ group }` section is resolved through
 * `deriveFieldGroupDetailSections`, the resolved form `record:details` draws,
 * and headed through the same per-object `sectionLabel` convention. Every
 * section is drawn open: the approver decides on all of it, so a group
 * declared collapsed is not folded here, and a group's `visibleWhen` is not
 * evaluated (it judges the live record's state, not the submitted one).
 *
 * Each titled section is headed the way the default record page heads it
 * (objectstack#34707): the frameless face of plugin-detail's `DetailSection`
 * (a semibold foreground title with the group's icon over a hairline), which
 * that package does not export apart from the field rendering it owns, so
 * {@link SectionHeading} repeats its classes. The heading wraps instead of
 * truncating: an approver on a phone reads the whole group name. With two or
 * more titled sections a strip of section links (the form section navigation's
 * face, objectstack#34605) jumps to each heading.
 *
 * ## Which fields are drawn
 *
 * A field is drawn when the object declares it, it is not `hidden: true`, it
 * is not framework bookkeeping (`isSystemManagedField`), and at least one of
 * the two rows serves it to this reader. Both rows pass through
 * `withoutDeniedFields` with the reader's field permissions first, as every
 * surface that draws a whole row does (objectui#10594), and the service has
 * already redacted the snapshot per reader. So a field the reader may not read
 * is never drawn, from either row. A field whose value is empty is drawn with
 * the empty placeholder, so the reader sees that it was submitted empty.
 *
 * Each value is drawn through the record page's own cell for its type. A
 * reference the service resolved is drawn by `payload_display`, the name the
 * service read for this reader; any other reference through the lookup cell,
 * which names it the way the record page does. Long-form types span the row
 * (`isWideFieldType`, the record page's own rule).
 *
 * ## Child tables are current values
 *
 * The snapshot keeps the record's own row only (the card's 不做: no change to
 * the snapshot's storage). So the child tables are the record's CURRENT rows,
 * each headed with that fact. They are the object's owned children
 * (`master_detail`) and its body tables (`relatedList: 'primary'`), from
 * `deriveRelatedLists`, the record page's derivation, gated on the reader's
 * read of the child object. Each is the plugin's `RelatedList` with no New,
 * Add, edit, delete or row action: the request page never edits the record.
 * They are drawn only once the record itself read.
 *
 * Module-internal: nothing re-exports it from the package entry.
 */

import * as React from 'react';
import { Badge, EmptyValue, LazyIcon, cn, type FormSectionNavItem } from '@object-ui/components';
import { isDeadlineSettled, withoutDeniedFields } from '@object-ui/core';
import { getCellRenderer, resolveCellRendererType } from '@object-ui/fields';
import { useSafeFieldLabel } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { deriveFieldGroupDetailSections, isWideFieldType, RelatedList } from '@object-ui/plugin-detail';
import {
  useAdapter,
  useDataInvalidation,
  useMetadata,
  useMetadataItem,
  useObjectTranslation,
  usePredicateScope,
  useRelatedRecordActions,
} from '@object-ui/react';
import type { FieldMetadata } from '@object-ui/types';
import { ExternalLink, Paperclip } from 'lucide-react';
import { deriveRecordDetailSections } from '../recordDetailSections.js';
import { deriveRelatedLists } from '../../utils/deriveRelatedLists.js';
import { servedObjectLabel, servedObjectPluralLabel } from '../../hooks/servedObjectLabel.js';
import {
  distinctLabels,
  planSubmittedRecord,
  type FieldDef,
  type SubmittedField,
  type SubmittedRecordPlan,
  type SubmittedSectionInput,
} from './submittedRecordPlan.js';

/** Rows each child table shows per page. */
const CHILD_TABLE_PAGE_SIZE = 10;

/** The record's current state, as one read answered it. */
export type CurrentRecordState =
  | { status: 'loading' }
  | { status: 'readable'; row: Record<string, unknown> }
  | { status: 'unreadable' };

/** Everything the three faces draw, from one definition read and one record read. */
export interface SubmittedRecordModel {
  objectName: string;
  recordId: string | null;
  objectDef: { name: string; label?: unknown; fields: Record<string, FieldDef | undefined> } & Record<string, unknown>;
  /** The snapshot narrowed for this reader: the values the faces draw. */
  snapshot: Record<string, unknown>;
  display: Record<string, string> | undefined;
  plan: SubmittedRecordPlan;
  current: CurrentRecordState;
}

/** An object's definition, when the one answered is `name`'s. */
function definitionOf(item: unknown, name: string): SubmittedRecordModel['objectDef'] | null {
  if (!item || typeof item !== 'object') return null;
  const def = item as { name?: unknown; fields?: unknown };
  // A definition answered for the PREVIOUS name is not drawn against this one.
  if (def.name !== undefined && def.name !== name) return null;
  const fields = def.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  return { ...(item as Record<string, unknown>), name, fields: fields as Record<string, FieldDef | undefined> };
}

/**
 * One read of the record as it is now. `findOne` with no params, the request
 * the record page sends, re-read in place when the record is invalidated.
 */
function useCurrentRecord(objectName: string | null, recordId: string | null): CurrentRecordState {
  const dataSource = useAdapter();
  const invalidation = useDataInvalidation(objectName ?? undefined);
  const key = objectName !== null && recordId !== null ? `${objectName}::${recordId}` : null;
  const canRead = typeof dataSource?.findOne === 'function';
  const [answer, setAnswer] = React.useState<{ key: string; row: Record<string, unknown> | null } | null>(null);

  React.useEffect(() => {
    if (key === null || objectName === null || recordId === null || !canRead) return;
    let cancelled = false;
    // The executor runs synchronously, so a source that THROWS lands with a rejection.
    new Promise<unknown>((resolve) => resolve(dataSource!.findOne(objectName, recordId))).then(
      (row) => {
        if (cancelled) return;
        setAnswer({
          key,
          row: row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null,
        });
      },
      () => {
        if (!cancelled) setAnswer({ key, row: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, objectName, recordId, canRead, dataSource, invalidation]);

  if (key === null || !canRead) return { status: 'unreadable' };
  if (!answer || answer.key !== key) return { status: 'loading' };
  return answer.row ? { status: 'readable', row: answer.row } : { status: 'unreadable' };
}

/**
 * The submitted record of a request: its object's definition, the snapshot
 * and the current row narrowed for the reader, and the plan of what to draw.
 * Null until the definition answers, and when there is no snapshot or no
 * definition: without the declarations there is no label, face or `hidden`
 * to honour.
 */
export function useSubmittedRecord(request: {
  object_name?: string | null;
  record_id?: string | null;
  payload?: unknown;
  payload_display?: Record<string, string> | null;
}): SubmittedRecordModel | null {
  const target = typeof request.object_name === 'string' && request.object_name !== '' ? request.object_name : null;
  const recordId = typeof request.record_id === 'string' && request.record_id !== '' ? request.record_id : null;
  const payload = request.payload;
  const hasSnapshot = !!payload && typeof payload === 'object' && !Array.isArray(payload);
  // No snapshot, nothing to draw: neither the definition nor the record is asked for.
  const { item } = useMetadataItem('object', hasSnapshot ? target : null);
  const current = useCurrentRecord(hasSnapshot ? target : null, hasSnapshot ? recordId : null);
  const perms = usePermissions();
  const { t } = useObjectTranslation();
  const { sectionLabel } = useSafeFieldLabel();

  const objectDef = target === null ? null : definitionOf(item, target);
  const display = request.payload_display ?? undefined;

  return React.useMemo(() => {
    if (target === null || objectDef === null || !hasSnapshot) return null;
    const snapshot = withoutDeniedFields(payload as Record<string, unknown>, perms, target);
    const currentRow = current.status === 'readable' ? withoutDeniedFields(current.row, perms, target) : null;
    const sections = resolveSections(objectDef, sectionLabel, t);
    const plan = planSubmittedRecord(sections, objectDef.fields, snapshot, currentRow);
    return { objectName: target, recordId, objectDef, snapshot, display, plan, current };
  }, [target, recordId, objectDef, hasSnapshot, payload, perms, current, sectionLabel, t, display]);
}

/**
 * The object's default record page sections, resolved to headings and field
 * names (see "The layout is the object's default record page" above).
 */
function resolveSections(
  objectDef: SubmittedRecordModel['objectDef'],
  sectionLabel: (objectName: string, sectionName: string, fallback: string) => string,
  t: (key: string, options?: Record<string, unknown>) => unknown,
): SubmittedSectionInput[] {
  const tr = (key: string, defaultValue: string) => String(t(key, { defaultValue }));
  const derived = deriveRecordDetailSections(objectDef, {
    moreDetails: sectionLabel(objectDef.name, 'details', tr('detail.sectionMoreDetails', 'More details')),
    ungrouped: tr('common.ungroupedSection', 'Other'),
  });
  const groups = new Map<string, Record<string, unknown>>(
    (deriveFieldGroupDetailSections(objectDef as never) ?? []).map((s) => [String(s.name), s]),
  );
  const names = (list: unknown): string[] =>
    (Array.isArray(list) ? list : [])
      .map((f) => (typeof f === 'string' ? f : (f as { name?: unknown } | null)?.name))
      .filter((n): n is string => typeof n === 'string' && n !== '');
  const columnsOf = (value: unknown) => (typeof value === 'number' && value > 0 ? value : undefined);

  return derived.map((section, i) => {
    if (typeof section.group === 'string') {
      const group = groups.get(section.group);
      const fallback = typeof group?.label === 'string' ? group.label : section.group;
      return {
        key: `group:${section.group}`,
        label: sectionLabel(objectDef.name, section.group, fallback),
        ...(typeof group?.icon === 'string' && group.icon !== '' ? { icon: group.icon } : {}),
        columns: columnsOf(section.columns ?? group?.columns),
        fields: names(group?.fields),
      };
    }
    const label = typeof section.label === 'string' && section.label !== '' ? section.label : undefined;
    return {
      key: typeof section.name === 'string' ? section.name : `section:${i}`,
      ...(label ? { label } : {}),
      columns: columnsOf(section.columns),
      fields: names(section.fields),
    };
  });
}

/**
 * A declared field's value, through the record page's own cell. A declared
 * deadline's `settledWhen` is judged against `record`, the row the value comes from
 * (objectui#11815): the snapshot's date against the snapshot's own state, the
 * current date against the current row's.
 */
function FieldFace({ objectName, def, value, record, fields }: {
  objectName: string;
  def: FieldDef;
  value: unknown;
  record: Record<string, unknown>;
  fields: Record<string, FieldDef | undefined>;
}) {
  const { translateOptions } = useSafeFieldLabel();
  const predicateScope = usePredicateScope();
  const options = def.options;
  const field = Array.isArray(options) && options.length > 0
    ? { ...def, options: translateOptions(objectName, def.name as string, options) }
    : def;
  const Cell = getCellRenderer(resolveCellRendererType(field as { type?: string; format?: string }));
  const deadlineSettled = isDeadlineSettled(def, record, { scope: predicateScope, fields });
  // eslint-disable-next-line react-hooks/static-components -- getCellRenderer returns the registry's module-level renderer for the type, not a component created during render
  return <Cell value={value} field={field as unknown as FieldMetadata} deadlineSettled={deadlineSettled} />;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

/** The labels every drawn field is shown under, told apart where they collide. */
function useFieldLabels(model: SubmittedRecordModel): Map<string, string> {
  const { fieldLabel } = useSafeFieldLabel();
  return React.useMemo(() => {
    const keys = [
      ...model.plan.sections.flatMap((s) => s.fields.map((f) => f.key)),
      ...model.plan.attachments.map((f) => f.key),
    ];
    const declared = (key: string) => {
      const label = model.objectDef.fields[key]?.label;
      return fieldLabel(model.objectName, key, typeof label === 'string' && label !== '' ? label : key);
    };
    const labels = distinctLabels(keys.map((key) => ({ key, label: declared(key) })));
    return new Map(keys.map((key, i) => [key, labels[i]]));
  }, [model, fieldLabel]);
}

/** One field: its submitted value, and when it changed, the mark and the current value. */
function SubmittedValue({ model, field }: { model: SubmittedRecordModel; field: SubmittedField }) {
  const { t } = useObjectTranslation();
  const def = { ...(model.objectDef.fields[field.key] as FieldDef), name: field.key };
  const submitted = isBlank(field.value)
    ? <EmptyValue />
    : model.display?.[field.key] ?? (
      <FieldFace objectName={model.objectName} def={def} value={field.value} record={model.snapshot} fields={model.objectDef.fields} />
    );
  if (!field.changed) return <>{submitted}</>;
  const currentRow = model.current.status === 'readable' ? model.current.row : {};
  return (
    <>
      {submitted}
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs" data-submitted-current>
        <Badge
          variant="outline"
          className="border-amber-500/60 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400"
          data-testid="submitted-field-changed"
        >
          {String(t('approvalsInbox.snapshotChanged', { defaultValue: 'Changed' }))}
        </Badge>
        <span className="text-muted-foreground">
          {String(t('approvalsInbox.snapshotCurrentValue', { defaultValue: 'Current value' }))}:
        </span>
        <span className="min-w-0">
          {isBlank(field.current)
            ? <EmptyValue />
            : <FieldFace objectName={model.objectName} def={def} value={field.current} record={currentRow} fields={model.objectDef.fields} />}
        </span>
      </div>
    </>
  );
}

/** The grid's column classes for a section's declared column count, clamped by the container's width. */
function gridColumns(columns: number | undefined): string {
  const n = Math.min(Math.max(columns ?? 3, 1), 4);
  if (n === 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-1 @md:grid-cols-2';
  if (n === 3) return 'grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3';
  return 'grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4';
}

/**
 * A section's heading icon: a declared Lucide name as the icon, anything else
 * (an emoji, a word) as text, the way the record page's section header draws it.
 */
function SectionIcon({ name }: { name: string }) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) return <span className="text-muted-foreground" aria-hidden>{name}</span>;
  return <LazyIcon name={name} className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * A titled section's heading, in the record page's frameless section face
 * (see "The layout is the object's default record page" above). A level below
 * the card's own "As submitted" heading. Never a disclosure: every section is
 * drawn open.
 */
function SectionHeading({ id, label, icon }: { id: string; label: string; icon?: string }) {
  return (
    <div className="border-b border-border" data-submitted-section-heading>
      <h4
        id={id}
        className="flex min-h-11 sm:min-h-9 w-full scroll-mt-3 items-center gap-2 py-1.5 text-left text-[13px] font-semibold text-foreground"
      >
        {icon && <SectionIcon name={icon} />}
        <span className="min-w-0 break-words">{label}</span>
      </h4>
    </div>
  );
}

/**
 * The section links over a record with two or more titled sections: one
 * entry per heading, in page order; a click scrolls its heading into view.
 * The form section navigation's strip (objectstack#34605), named by the
 * card's own heading. Nothing to unfold and no error counts here, so an entry
 * carries the item's key, label and anchor only. It sits at the top of the
 * card and does not stick: the page's scroller pads its content, so a sticky
 * strip would let the scrolled fields show through above it.
 */
function SectionNav({ items, labelledBy }: {
  items: ReadonlyArray<Pick<FormSectionNavItem, 'key' | 'label' | 'anchorId'>>;
  labelledBy: string;
}) {
  if (items.length < 2) return null;
  return (
    <nav
      aria-labelledby={labelledBy}
      data-testid="submitted-record-section-nav"
      className="flex gap-1 overflow-x-auto border-b border-border px-2 sm:px-4"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => document.getElementById(item.anchorId)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })}
          data-testid={`submitted-record-section-nav:${item.key}`}
          className={cn(
            '-mb-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 border-transparent px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * The record as submitted, in its default record page's sections, headed "As
 * submitted" with the object's label, and a link to the record when it read.
 */
export function SubmittedRecordCard({ model, className }: { model: SubmittedRecordModel; className?: string }) {
  const { t, language } = useObjectTranslation();
  const { objectLabel } = useSafeFieldLabel() as unknown as {
    objectLabel: (def: { name: string; label: string }) => string;
  };
  const labels = useFieldLabels(model);
  const recordLinks = useRelatedRecordActions();
  const headingId = React.useId();
  const { plan, current } = model;
  if (plan.sections.length === 0) return null;
  const anchorOf = (index: number) => `${headingId}-section-${index}`;

  const objectName = servedObjectLabel(model.objectDef, language, objectLabel, model.objectName);
  const href =
    current.status === 'readable' && model.recordId !== null && recordLinks?.recordHref
      ? recordLinks.recordHref(model.objectName, model.recordId)
      : null;

  return (
    <section
      className={cn('@container rounded-lg border bg-card', className)}
      aria-labelledby={headingId}
      data-testid="submitted-record"
      data-current={current.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 id={headingId} className="text-sm font-medium" data-submitted-heading>
            {String(t('approvalsInbox.snapshotAsSubmitted', { defaultValue: 'As submitted' }))}
          </h3>
          {objectName && <span className="truncate text-xs text-muted-foreground">{objectName}</span>}
        </div>
        {href && (
          <a
            href={href}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            data-testid="submitted-record-open"
            onClick={(event) => {
              // A plain left click is the host's in-app navigation; a modifier
              // or middle click keeps the anchor's own new-tab behaviour.
              if (!recordLinks?.openRecord || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              recordLinks.openRecord(model.objectName, model.recordId!);
            }}
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            {String(t('approvalsInbox.snapshotOpenRecord', { defaultValue: 'Open record' }))}
          </a>
        )}
      </div>
      {current.status === 'unreadable' && (
        <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="submitted-record-current-unreadable">
          {String(t('approvalsInbox.snapshotCurrentUnreadable', {
            defaultValue: 'The current record cannot be read, so changes made after submission are not marked.',
          }))}
        </p>
      )}
      <SectionNav
        labelledBy={headingId}
        items={plan.sections.flatMap((section, i) =>
          section.label ? [{ key: section.key, label: section.label, anchorId: anchorOf(i) }] : [],
        )}
      />
      <div className="space-y-6 px-4 py-3">
        {plan.sections.map((section, i) => (
          <div key={section.key} data-submitted-section={section.key}>
            {section.label && <SectionHeading id={anchorOf(i)} label={section.label} icon={section.icon} />}
            <dl className={cn('grid gap-x-6 gap-y-3 text-sm', section.label && 'pt-2.5', gridColumns(section.columns))}>
              {section.fields.map((field) => {
                const type = model.objectDef.fields[field.key]?.type;
                return (
                  <div
                    key={field.key}
                    className={cn('min-w-0', typeof type === 'string' && isWideFieldType(type) && 'col-span-full')}
                    data-submitted-field={field.key}
                    data-changed={field.changed ? 'true' : undefined}
                  >
                    <dt className="text-[11px] text-muted-foreground">{labels.get(field.key)}</dt>
                    <dd className="break-words" title={model.display?.[field.key]}>
                      <SubmittedValue model={model} field={field} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The record's attachment fields as submitted, for the page's right rail; nothing when none holds a file. */
export function SubmittedAttachmentsCard({ model, className }: { model: SubmittedRecordModel; className?: string }) {
  const { t } = useObjectTranslation();
  const labels = useFieldLabels(model);
  const { attachments } = model.plan;
  if (attachments.length === 0) return null;
  return (
    <section className={cn('rounded-lg border bg-card', className)} data-testid="submitted-attachments">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{String(t('approvalsInbox.attachmentsTitle', { defaultValue: 'Attachments' }))}</span>
        <span className="text-xs font-normal text-muted-foreground">{attachments.length}</span>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        {attachments.map((field) => (
          <div
            key={field.key}
            className="min-w-0"
            data-submitted-attachment={field.key}
            data-changed={field.changed ? 'true' : undefined}
          >
            <div className="text-[11px] text-muted-foreground">{labels.get(field.key)}</div>
            <SubmittedValue model={model} field={field} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The record's child tables, current rows, read-only (see "Child tables are
 * current values" above). Drawn once the record itself read.
 */
export function SubmittedChildTables({ model, className }: { model: SubmittedRecordModel; className?: string }) {
  const { t, language } = useObjectTranslation();
  const { objectPluralLabel } = useSafeFieldLabel() as unknown as {
    objectPluralLabel: (def: { name: string; label: string; pluralLabel?: string }) => string;
  };
  const { objects } = useMetadata();
  const perms = usePermissions();
  const dataSource = useAdapter();
  const readable = model.current.status === 'readable' && model.recordId !== null;

  const tables = React.useMemo(() => {
    if (!readable) return [];
    const derived = deriveRelatedLists(model.objectDef as never, objects as never, {
      canRead: perms?.isLoaded ? (name: string) => perms.can(name, 'read') : undefined,
      listLabel: (child) => servedObjectPluralLabel(child as never, language, objectPluralLabel, child.name),
    });
    const children = derived.filter((relation) => relation.isPrimary || relation.isOwned);
    return [...children.filter((r) => r.isPrimary), ...children.filter((r) => !r.isPrimary)];
  }, [readable, model.objectDef, objects, perms, language, objectPluralLabel]);

  if (!readable || tables.length === 0 || !dataSource) return null;
  const note = String(t('approvalsInbox.snapshotChildCurrent', {
    defaultValue: 'Current rows: the submission does not keep child rows.',
  }));
  return (
    <div className={cn('space-y-4', className)} data-testid="submitted-child-tables">
      {tables.map((relation) => {
        const childDef = (objects as Array<{ name?: string }>).find((o) => o?.name === relation.childObject) as
          | { name: string; label?: unknown; pluralLabel?: unknown }
          | undefined;
        const title = relation.title
          || (childDef ? servedObjectPluralLabel(childDef, language, objectPluralLabel, relation.childLabel) : relation.childLabel);
        return (
          <section
            key={`${relation.childObject}.${relation.referenceField}`}
            className="rounded-lg border bg-card px-4 py-3"
            data-submitted-child={relation.childObject}
          >
            <p className="mb-2 text-[11px] text-muted-foreground" data-submitted-child-note>{note}</p>
            <RelatedList
              title={title}
              type="table"
              api={relation.childObject}
              objectName={relation.childObject}
              referenceField={relation.referenceField}
              parentId={model.recordId as never}
              dataSource={dataSource as never}
              pageSize={CHILD_TABLE_PAGE_SIZE}
              {...(Array.isArray(relation.columns) && relation.columns.length > 0 ? { columns: relation.columns } : {})}
              {...(relation.sort && relation.sort.length > 0 ? { defaultSort: relation.sort } : {})}
              {...(relation.filter ? { filter: relation.filter as never } : {})}
            />
          </section>
        );
      })}
    </div>
  );
}
