/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SplitForm Component
 *
 * A form variant that displays sections in a resizable split-panel layout.
 * Each section declares its panel via `pane` (spec FormSection.pane); when
 * omitted the legacy positional rule applies — the first section renders in the
 * left/top panel, every other section in the right/bottom one.
 * Aligns with @objectstack/spec FormView type: 'split'
 *
 * Both panels are ONE form (#2153). The panel group is a layout the form
 * renderer owns via `FormSchema.fieldPanes`, so a single `<form>` /
 * react-hook-form instance spans the divider. Rendering a form per panel — per
 * SECTION, in fact — meant an action bar submitted only its own section and
 * silently dropped everything typed on the other side, and a field condition
 * could not see across the split at all.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { FormField, FormSchema, DataSource, ObjectFormSchema, ObjectFormSection } from '@object-ui/types';
import { cn, toast } from '@object-ui/components';
import { SchemaRenderer, useSafeFieldLabel } from '@object-ui/react';
import { buildSectionFields as buildSectionFieldsShared } from './sectionFields';
import { seedCreateValues } from './schemaDefaults';
import { resolveInitialRecord } from './initialRecord';
import { usePermissions } from '@object-ui/permissions';
import { closedFormAffordance, fieldWriteGate, gateFormFields } from './fieldWriteGate';
import { ClosedAffordanceNotice } from './closedAffordanceNotice';
import { snapshotLoadedRecord, advanceLoadedRecord, type LoadedRecordSnapshot } from './sanitize';
import { formWritePayload } from './writePayload';
import { sectionedGridLayout } from './autoLayout';
import { useOccSave } from './occSave';
import {
  NO_LOAD_FAILURES,
  beginLoadRun,
  shownLoadFailure,
  type LoadFailures,
  type LoadRunSeq,
} from './loadFailure';
import { hasInlineFieldSource, noSubmitTargetError } from './submitTarget';
import { useRecordInvalidation } from './recordInvalidation';
import { useUploadGate, UploadGateProvider, UploadInFlightNotice } from './uploadGate';
import { useFormChromeTranslation } from './formChrome';

export interface SplitFormSectionConfig {
  name?: string;
  label?: string;
  description?: string;
  columns?: 1 | 2 | 3 | 4;
  /**
   * Which panel this section renders in. Aligns with @objectstack/spec
   * FormSection.pane — explicit per-section placement, so reordering sections
   * never silently moves them across the divider. Omitted → the legacy
   * positional rule (first section 'primary', every other 'secondary').
   */
  pane?: 'primary' | 'secondary';
  /**
   * The same three entry shapes as `ObjectFormSection.fields`, by reference:
   * a field name, the form view's `{ field, … }` entry, or an inline
   * `FormField` (objectui#11615).
   */
  fields: NonNullable<ObjectFormSection['fields']>;
  /**
   * ADR-0089 `FormSection.visibleWhen` — conditional visibility for the
   * section's divider HEADER, evaluated by the form renderer with the canonical
   * engine and the host predicate scope (#6010/#6111). Fails OPEN.
   */
  visibleWhen?: string | { dialect?: string; source: string };
  /**
   * The fault direction of {@link visibleWhen}, by reference to
   * `ObjectFormSection.visibleWhenFault` (objectui#13055): `'hidden'` (a field
   * group's predicate) hides the section when it cannot be evaluated.
   */
  visibleWhenFault?: ObjectFormSection['visibleWhenFault'];
  /** Custom CSS class for the section's header row. */
  className?: string;
  /**
   * Custom CSS class for the section's field grid. Applied to the panel's grid
   * when that panel holds this section alone (the common case — the first
   * section owns the left/top panel); a panel stacking several sections shares
   * one grid inside the single form (#2153), so there is none to override.
   */
  gridClassName?: string;
}

export interface SplitFormSchema {
  type: 'object-form';
  formType: 'split';
  objectName: string;
  mode: 'create' | 'edit' | 'view';
  /** Record ID (for edit/view modes). A string, per the one record-id rule on `DataSource` (objectui#9511) — `ObjectForm` builds this schema from the authorable `ObjectFormSchema.recordId`, which is a string, and `findOne` takes a string. */
  recordId?: string;
  sections: SplitFormSectionConfig[];
  /**
   * Inline field definitions (`object-form.customFields`). A member naming a
   * field a section lists is that field's definition, as on every other
   * `formType` (objectui#10254); `ObjectForm` hands the key over in its
   * `{...schema}` spread.
   */
  customFields?: FormField[];
  
  /**
   * Split direction.
   * @default 'horizontal'
   */
  splitDirection?: 'horizontal' | 'vertical';
  
  /**
   * Size of the first panel (percentage 1-99).
   * @default 50
   */
  splitSize?: number;
  
  /**
   * Whether panels can be resized.
   * @default true
   */
  splitResizable?: boolean;

  /**
   * Grid width for the whole form (1–4). Aligns with @objectstack/spec
   * FormView.columns and OUTRANKS the per-section `columns`, which say how a
   * section fills the grid rather than how wide it is. Omitted = the widest
   * section's density.
   */
  columns?: number;

  // Common form props
  showSubmit?: boolean;
  submitText?: string;
  showCancel?: boolean;
  cancelText?: string;
  initialValues?: Record<string, any>;
  initialData?: Record<string, any>;
  readOnly?: boolean;
  /**
   * Override persistence — the seam a host uses to own the write. Declared as
   * `ObjectFormSchema['submitHandler']` rather than restated, so this variant
   * and the canonical key `ObjectForm` forwards can never drift apart.
   * When supplied, the form validates and hands the collected values
   * to this handler INSTEAD of calling `dataSource.create` /
   * `dataSource.update`; the returned record is passed on to `onSuccess`.
   * In `edit` mode, for a record this form read itself, it hands over what it
   * would have written: the fields that differ from that read, or the full
   * sanitized payload when nothing changed (objectui#10156, objectui#10563;
   * the whole rule is on `ObjectFormSchema['submitHandler']`).
   *
   * `MasterDetailForm` supplies it to route the parent AND its child
   * collections through one atomic `batchTransaction` (#2679 / ADR-0034
   * item 4). A renderer that does not read it writes the parent on its own and
   * escapes that transaction — objectui#6176.
   */
  submitHandler?: ObjectFormSchema['submitHandler'];

  onSuccess?: (data: any) => void | Promise<void>;
  onError?: (error: Error) => void;
  onCancel?: () => void;
  className?: string;
}

export interface SplitFormProps {
  schema: SplitFormSchema;
  dataSource?: DataSource;
  className?: string;
}

export const SplitForm: React.FC<SplitFormProps> = ({
  schema,
  dataSource,
  className,
}) => {
  const { fieldLabel } = useSafeFieldLabel();
  // The loading line, the load-failure heading and the default submit label,
  // in the session locale (objectui#11039). See `formChrome.ts`.
  const { t } = useFormChromeTranslation();
  const perms = usePermissions();
  const { userId: currentUserId } = perms;
  // Upload-in-flight gate (objectui#10166): a `file`/`image` value is only its
  // fileId once the presigned upload settles, so a save during that window
  // stored the record WITHOUT the attachment and reported success.
  const uploadGate = useUploadGate();
  const [objectSchema, setObjectSchema] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  // OCC-guarded edit save + its conflict dialog (see occSave.tsx).
  const { saveWithOcc, conflictDialog } = useOccSave();
  const [loading, setLoading] = useState(true);
  // objectui#10682 — the load error, kept per read (the object schema and the
  // record), each written only by the current run of its read and cleared when
  // a later run of that read commits: see `loadFailure.ts`. `error` is what
  // the error screen reports.
  const [loadFailures, setLoadFailures] = useState<LoadFailures>(NO_LOAD_FAILURES);
  const loadRunSeqRef = useRef<LoadRunSeq>({ schema: 0, record: 0 });
  const error = shownLoadFailure(loadFailures);

  // Fetch object schema
  useEffect(() => {
    // objectui#10712 — a read an `objectName` or data-source change has
    // superseded commits nothing: not the schema, and not the `loading` release
    // the current read owns (the record read's `cancelled` below, applied here).
    let cancelled = false;
    // objectui#10682 — this run's writes to the schema read's failure; a newer
    // run of this effect makes them no-ops.
    const run = beginLoadRun(loadRunSeqRef, setLoadFailures, 'schema');
    const fetchSchema = async () => {
      if (!dataSource) {
        setLoading(false);
        return;
      }
      try {
        const data = await dataSource.getObjectSchema(schema.objectName);
        if (cancelled) return;
        setObjectSchema(data);
        run.commit();
      } catch (err) {
        if (cancelled) return;
        run.fail(err);
        setLoading(false);
      }
    };
    fetchSchema();
    return () => { cancelled = true; };
  }, [schema.objectName, dataSource]);

  // The record whose data `formData` currently holds. The fetch effect reads it
  // to tell a genuine record SWAP from a re-run of its own making —
  // `initialData`/`initialValues` are objects callers commonly rebuild every
  // render, and flashing the loading state for those would thrash.
  const loadedRecordIdRef = useRef<string | number | undefined>(undefined);
  // The record itself as read — the baseline an edit save diffs against, so
  // only the fields that changed are written (objectui#10156, objectui#10563).
  // Kept apart from `formData`, which seeds the form and supplies the OCC
  // token: advancing it after a save would reseed the one and move the other.
  // Set by the `findOne` below and nowhere else, so a caller-supplied record is
  // never a baseline.
  const loadedRecordRef = useRef<LoadedRecordSnapshot | null>(null);
  // objectui#10715 — the data-invalidation bus, read the way the default arm
  // reads it (the rule is stated once in `recordInvalidation.ts`): a change to
  // this record, to its object or to `'*'` re-reads the record IN PLACE through
  // the effect below while the form is pristine, and is held while it is dirty.
  // Dirtiness is the form renderer's `onDirtyChange`, wired below.
  const { refetch: recordRefetch, onDirtyChange: handleDirtyChange, saved: recordSaved } =
    useRecordInvalidation(schema.objectName, schema.recordId, !!schema.recordId && schema.mode !== 'create');

  // Fetch initial data
  useEffect(() => {
    // A `recordId` change re-enters this effect with the form still MOUNTED on
    // the previous record, which needs handling on two fronts (pinned by
    // recordSwapLoading.test.tsx):
    //  - go back to the loading state, so record A's values are not left on
    //    screen AND EDITABLE while B is in flight, to be swapped underneath in
    //    place when it lands. Anything typed there read as A's on screen but
    //    would have been submitted against B.
    //  - ignore a response that is no longer the one being awaited, so two
    //    overlapping reads land in REQUEST order, not completion order.
    let cancelled = false;
    // objectui#10682 — this run's writes to the record read's failure; a newer
    // run of this effect makes them no-ops.
    const run = beginLoadRun(loadRunSeqRef, setLoadFailures, 'record');
    const fetchData = async () => {
      if (schema.mode === 'create' || !schema.recordId) {
        // Seeded from something other than a read: no baseline to diff against.
        loadedRecordRef.current = null;
        // Declared static defaults are this form's opening values (#4047) —
        // see `schemaDefaults` for the create-only boundary and for why
        // runtime defaults are left to the server.
        setFormData(seedCreateValues(objectSchema, resolveInitialRecord(schema), { currentUserId }));
        // Not a read, so no earlier record read's failure describes the form.
        run.commit();
        setLoading(false);
        return;
      }

      if (!dataSource) {
        loadedRecordRef.current = null;
        setFormData(resolveInitialRecord(schema));
        // Not a read either.
        run.commit();
        setLoading(false);
        return;
      }

      // Only a change of RECORD hides the form.
      if (loadedRecordIdRef.current !== schema.recordId) setLoading(true);

      try {
        const data = await dataSource.findOne(schema.objectName, schema.recordId);
        if (cancelled) return;
        loadedRecordIdRef.current = schema.recordId;
        loadedRecordRef.current = snapshotLoadedRecord(schema, data);
        setFormData(data || {});
        // The record on screen is the one this run read, so an earlier record
        // read's failure no longer describes it. A schema failure stays: this
        // read says nothing about the object's fields.
        run.commit();
      } catch (err) {
        if (cancelled) return;
        run.fail(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // A bus re-read (objectui#10715, `recordRefetch` below) re-runs this
    // effect for the record already on screen: it lands IN PLACE, since the
    // loading branch above is keyed on a change of record, and a re-read a
    // later run has superseded commits nothing, as above.
    if (objectSchema || !dataSource) {
      fetchData();
    }
    return () => { cancelled = true; };
  }, [objectSchema, schema.mode, schema.recordId, schema.initialData, schema.initialValues, dataSource, schema.objectName, recordRefetch]);

  // Build form fields from section config
  const buildSectionFields = useCallback(
    (section: SplitFormSectionConfig): FormField[] => {
      const fields = buildSectionFieldsShared(section as any, {
        objectSchema,
        objectName: schema.objectName,
        readOnly: schema.readOnly,
        mode: schema.mode,
        // Feeds the "no persisted record" test that decides whether a runtime
        // `defaultValue` excuses a field from `required` (#4069).
        recordId: schema.recordId,
        fieldLabel,
        // A member naming a section's field is that field's definition, as it
        // is on every other arm (objectui#10254).
        customFields: schema.customFields,
      });
      // The ONE field-gate step every layout draws through (`gateFormFields`,
      // objectui#10612), applied to the RESOLVED fields. Its field-level half
      // (`80c54122e`): `ObjectForm` gates a section's field OBJECTS before
      // routing here, but a field named by a bare string has no `name` to ask
      // about until it is resolved just above. Without this pass a field the
      // caller may read but not edit rendered as a live input, and with the
      // save's strip in place (`formWritePayload`, objectui#10563) whatever the
      // user typed there would be dropped behind a 200. A field already gated
      // upstream is gated again to the same answer. Its managed-object half
      // (ADR-0092 D4): every field is disabled when the object's affordance for
      // the mode is closed — before objectui#10612 only the default arm drew
      // that lock, and this layout drew live inputs on a managed object.
      return (gateFormFields(fields, {
        perms,
        objectName: schema.objectName,
        mode: schema.mode,
        objectSchema,
      }) ?? fields) as FormField[];
    },
    [objectSchema, schema.readOnly, schema.mode, schema.recordId, schema.objectName, schema.customFields, fieldLabel, perms],
  );

  // Handle form submission
  const handleSubmit = useCallback(async (data: Record<string, any>) => {
    // Refuse while an upload is in flight (objectui#10166). Save is relabelled
    // and the notice beside the form says why. This arm also covers a keyboard
    // submit, and it is the only guard on this host: its button is rendered by
    // the `form` node renderer, which exposes no per-button disable.
    if (uploadGate.uploading) {
      toast.error(uploadGate.reason);
      return;
    }
    // No submit TARGET: a declared `submitHandler` owns the write and needs no
    // adapter of its own (objectui#6176's seam), so only a form with NEITHER it
    // nor a `dataSource` is target-less. The one target-less form that is still
    // legitimate is the inline-fields collector, whose `onSuccess` IS the write.
    // This arm used to be `if (!dataSource)` alone: it confirmed EVERY
    // adapter-less submit, bypassing a declared host seam and persisting
    // nothing (objectui#6300). See `submitTarget.ts` for the whole rule.
    if (!dataSource && !schema.submitHandler && hasInlineFieldSource(schema)) {
      if (schema.onSuccess) {
        await schema.onSuccess(data);
      }
      return data;
    }

    try {
      let result;
      // What this save writes, through the ONE outbound sequence the simple
      // form uses (objectui#10563; `formWritePayload` holds the rule): nothing
      // a form never writes — server-owned, computed, read-only, unknown, or
      // refused by the caller's field-level security — and on an EDIT only the
      // fields that differ from the record this form read. Computed ONCE so
      // every persistence route below — the host-owned seam included — writes
      // the identical payload.
      const { writePayload } = formWritePayload(data, schema, {
        objectSchema,
        canEdit: fieldWriteGate(perms, schema.objectName, schema.mode),
        snapshot: loadedRecordRef.current,
        // On a create, `formData` is the seed this form opened with and
        // nothing else, so a picked owner is written and a seeded one left
        // alone is not (objectui#12359).
        createBaseline: formData,
      });

      if (schema.submitHandler) {
        // The host owns persistence (e.g. MasterDetailForm batching the parent
        // + its child collections into ONE atomic transaction). The form
        // validates and hands the values over; it does NOT create/update
        // itself. Same seam and same precedence as SimpleObjectForm — every
        // renderer `ObjectForm` routes to must check it FIRST, or a declared
        // host-owned write silently becomes an independent one (objectui#6176).
        result = await schema.submitHandler(writePayload);
      } else if (!dataSource) {
        // No route left: no host seam and no adapter. Refuse instead of reporting
        // success — the `catch` below hands this to `schema.onError` and rethrows.
        throw noSubmitTargetError();
      } else if (schema.mode === 'create') {
        result = await dataSource.create(schema.objectName, writePayload);
      } else if (schema.mode === 'edit' && schema.recordId) {
        // OCC-guarded: sends `ifMatch` from the record we read; a 409 asks the
        // user to keep editing (skip the success path) or overwrite.
        const outcome = await saveWithOcc({
          dataSource,
          objectName: schema.objectName,
          recordId: schema.recordId,
          payload: writePayload,
          baseRecord: formData,
        });
        if (outcome.status === 'cancelled') return;
        result = outcome.result;
      }
      // The write landed: the next save from this still-mounted form diffs
      // against the record as it now stands, not as first read.
      loadedRecordRef.current = advanceLoadedRecord(loadedRecordRef.current, schema, writePayload);
      // objectui#10715 — and what the form shows is what the server holds: a
      // bus change held while it was dirty (its own write's echo included) is
      // replayed now rather than behind input that is no longer unsaved.
      recordSaved();
      if (schema.onSuccess) {
        await schema.onSuccess(result);
      }
      return result;
    } catch (err) {
      if (schema.onError) {
        schema.onError(err as Error);
      }
      throw err;
    }
  }, [schema, dataSource, objectSchema, perms, saveWithOcc, formData, uploadGate.uploading, uploadGate.reason, recordSaved]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (schema.onCancel) {
      schema.onCancel();
    }
  }, [schema]);

  // Which panel each section renders in: explicit `section.pane` first (spec
  // FormSection.pane), else the legacy positional rule — first section primary,
  // rest secondary — so keyless metadata keeps its exact layout. Placement
  // follows the KEY, not the array position: reordering sections with panes
  // declared never moves them across the divider.
  const paneOf = (section: SplitFormSectionConfig, index: number): 'primary' | 'secondary' =>
    section.pane === 'primary' || section.pane === 'secondary'
      ? section.pane
      : index === 0 ? 'primary' : 'secondary';
  const leftSections = useMemo(
    () => schema.sections.filter((s, i) => paneOf(s, i) === 'primary'),
    [schema.sections],
  );
  const rightSections = useMemo(
    () => schema.sections.filter((s, i) => paneOf(s, i) === 'secondary'),
    [schema.sections],
  );

  const direction = schema.splitDirection || 'horizontal';
  const panelSize = schema.splitSize || 50;

  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded-md">
        <h3 className="text-red-800 font-semibold">{t('form.errorLoading')}</h3>
        <p className="text-red-600 text-sm mt-1">{error.message}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        <p className="mt-2 text-sm text-gray-600">{t('publicForm.loading')}</p>
      </div>
    );
  }

  // The form is ONE grid; each section then lays ITS fields out at its own
  // declared density within that grid via colSpan (objectstack-ai/objectstack#2578) — the same arrangement
  // the stacked/tabbed sectioned forms use. The grid lives on the FIELD
  // container inside the form, never wrapped around the form (that leaves the
  // extra columns permanently empty, #2128).
  //
  // The one sectioned-form rule (objectui#12548), handed the AUTHORED counts:
  // grid width = the form view's own `columns` (spec FormView.columns), else
  // the widest section, an undeclared section drawing two per row from `@md`
  // (objectui#12592); each section at its own count on the shared grid — 12
  // tracks wide when the counts do not all fit. ModalForm, ObjectForm,
  // TabbedForm and WizardForm call the same rule, so one piece of metadata
  // lays out the same in every host.
  const sectionGrid = sectionedGridLayout(schema.columns, schema.sections.map((s) => s.columns));
  const formColumns = sectionGrid.columns;
  const containerFieldClass = sectionGrid.fieldContainerClass;

  /**
   * One panel's field list: each section contributes an inline `section-divider`
   * header row followed by its fields. A per-section Card would need a
   * per-section form, which is the defect above.
   */
  const paneFields = (sections: SplitFormSectionConfig[], paneKey: string): FormField[] => {
    const out: FormField[] = [];
    sections.forEach((section, index) => {
      const body = buildSectionFields(section);
      if (!body.length) return;
      if (section.label || section.description) {
        out.push({
          name: `__section_${section.name || `${paneKey}_${index}`}`,
          label: section.label,
          description: section.description,
          type: 'section-divider',
          // ADR-0089 section predicate (#6111) — the renderer evaluates it on
          // this pseudo-field with the host predicate scope bound (#6010).
          visibleWhen: section.visibleWhen,
          visibleWhenFault: section.visibleWhenFault,
          // The membership claim (#6236): resolved member names, so the
          // predicate gates the whole group.
          fields: body.map(f => f.name),
          colSpan: 4,
          className: section.className,
        } as any);
      }
      out.push(...sectionGrid.layOut(body, section.columns));
    });
    return out;
  };

  // A pane holding exactly one section can still honour that section's
  // `gridClassName` — it owns the panel's grid outright.
  const panes = [
    { key: 'primary', sections: leftSections, defaultSize: panelSize },
    { key: 'secondary', sections: rightSections, defaultSize: 100 - panelSize },
  ]
    .map((pane) => ({
      ...pane,
      fields: paneFields(pane.sections, pane.key),
      containerClass: pane.sections.length === 1 ? pane.sections[0].gridClassName : undefined,
    }))
    .filter((pane) => pane.fields.length > 0);

  // The child `form` node, typed as the node it is (objectui#11354).
  // `SchemaRenderer`'s `schema` slot is `BaseSchema`, so a literal written
  // inline there was checked against `BaseSchema`, not against the
  // `FormSchema` the `form` renderer reads.
  const splitFormSchema: FormSchema = {
    type: 'form',
    objectName: schema.objectName,
    // Every pane's fields, in one list, for the one form instance. The
    // panes below claim them back by name for layout only.
    fields: panes.flatMap((pane) => pane.fields),
    columns: formColumns,
    ...(containerFieldClass ? { fieldContainerClass: containerFieldClass } : {}),
    layout: 'vertical',
    defaultValues: formData,
    // Persisted record → `previous` binding + read-only submit strip (#3484).
    previousValues: schema.mode === 'edit' && schema.recordId ? formData : undefined,
    // While an upload is in flight the button says so, the same answer
    // ActionParamDialog gives its Confirm (objectui#10166).
    submitLabel: uploadGate.uploading
      ? uploadGate.busyLabel
      : schema.submitText || (schema.mode === 'create' ? t('form.create') : t('form.update')),
    cancelLabel: schema.cancelText,
    showSubmit: schema.showSubmit !== false && schema.mode !== 'view',
    showCancel: schema.showCancel !== false,
    onSubmit: handleSubmit,
    onCancel: handleCancel,
    // The renderer's dirtiness feeds the bus gate above (objectui#10715).
    onDirtyChange: handleDirtyChange,
    // A single pane is not a split — the renderer then falls back to a
    // plain field list rather than a one-panel resizable group.
    fieldPanes: panes.map((pane) => ({
      key: pane.key,
      fields: pane.fields.map((f) => f.name),
      defaultSize: pane.defaultSize,
      ...(pane.containerClass ? { containerClass: pane.containerClass } : {}),
    })),
    fieldPanesOrientation: direction,
    fieldPanesResizable: schema.splitResizable !== false,
  };

  return (
    <UploadGateProvider gate={uploadGate}>
    <div className={cn('w-full @container', className, schema.className)}>
      {/* Why every field below is locked, when the lock is the form-wide one
          (objectui#11000). */}
      <ClosedAffordanceNotice
        affordance={closedFormAffordance({
          perms,
          objectName: schema.objectName,
          mode: schema.mode,
          objectSchema,
        })}
        objectName={schema.objectName}
        objectSchema={objectSchema}
      />
      <SchemaRenderer schema={splitFormSchema} />
      <UploadInFlightNotice gate={uploadGate} />
      {conflictDialog}
    </div>
    </UploadGateProvider>
  );
};

export default SplitForm;
