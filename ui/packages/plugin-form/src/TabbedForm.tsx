/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TabbedForm Component
 * 
 * A form component that organizes sections into tabs.
 * Aligns with @objectstack/spec FormView type: 'tabbed'
 */

import React, { useState, useCallback, useRef } from 'react';
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

export interface FormSectionConfig {
  /**
   * Section identifier (used as tab value)
   */
  name?: string;
  
  /**
   * Section label (used as tab trigger text)
   */
  label?: string;
  
  /**
   * Section description
   */
  description?: string;
  
  /**
   * Number of columns in the section
   * @default 1
   */
  columns?: 1 | 2 | 3 | 4;
  
  /**
   * The same three entry shapes as `ObjectFormSection.fields`, by reference:
   * a field name, the form view's `{ field, … }` entry, or an inline
   * `FormField` (objectui#11615).
   */
  fields: NonNullable<ObjectFormSection['fields']>;

  /**
   * ADR-0089 `FormSection.visibleWhen` — the TABBED arm of the one grouping
   * contract ruled 2026-08-29 (objectui#6237, option A). Spelled exactly as the
   * sibling `ModalFormSectionConfig.visibleWhen`, because it IS the same
   * authored key: `ObjectForm` copies a section's predicate here, this layout
   * copies it onto the tab it synthesises (`FormFieldTab.visibleWhen`), and the
   * form renderer evaluates it on the canonical engine with the live record and
   * the host predicate scope bound (#6010) — the same path a field's own
   * `visibleWhen` takes. A broken predicate fails OPEN (the tab stays visible).
   *
   * Ruled semantics (maintainer 2026-08-27, the same ruling for tabs as for
   * sections), inherited from the renderer rather than re-implemented here:
   * visibility decides what is DRAWN and nothing else — a hidden tab's values
   * still submit — and a hidden tab's fields skip CLIENT-side validation, so a
   * user is never blocked by an error pointing at a control they cannot see.
   * The server-side contract stays the loud floor for genuinely-required data;
   * see the boundary note on `WizardStepConfig` and objectui#6237 for the
   * measured reason the server cannot read this predicate.
   *
   * ⛔ Deliberately NOT on the wizard's step type, and that boundary is now
   * structural rather than subtractive (maintainer ruling 2026-08-30,
   * objectui#6237). `WizardForm` used to type its steps as
   * `Omit<FormSectionConfig, 'visibleWhen'>` — a derivation that defended the
   * one key it named while every FUTURE key added here still reached a wizard
   * step by default. `WizardStepConfig` is now declared independently, exactly
   * as `SplitFormSectionConfig` / `ModalFormSectionConfig` /
   * `DrawerFormSectionConfig` already are, so this type and the wizard's share
   * nothing: a key is authorable on a wizard step only if someone writes it
   * there, on the type whose renderer has to honour it.
   */
  visibleWhen?: string | { dialect?: string; source: string };
  /**
   * The fault direction of {@link visibleWhen}, by reference to
   * `ObjectFormSection.visibleWhenFault` (objectui#13055): `'hidden'` (a field
   * group's predicate) hides the section when it cannot be evaluated.
   */
  visibleWhenFault?: ObjectFormSection['visibleWhenFault'];

  /**
   * Custom CSS class for the section's Card wrapper.
   *
   * Unused in the tabbed layout: all tabs share ONE form (#2959), so a tab's
   * panel has no per-section Card to carry it.
   */
  className?: string;

  /**
   * Custom CSS class for the section's field grid — applied to this tab's panel
   * grid (overrides the shared column classes).
   */
  gridClassName?: string;
}

export interface TabbedFormSchema {
  type: 'object-form';
  formType: 'tabbed';
  
  /**
   * Object name for ObjectQL schema lookup
   */
  objectName: string;
  
  /**
   * Form mode
   */
  mode: 'create' | 'edit' | 'view';
  
  /**
   * Record ID (for edit/view modes). A string, per the one record-id rule on
   * `DataSource` (objectui#9511) — `ObjectForm` builds this schema from the
   * authorable `ObjectFormSchema.recordId`, which is a string, and `findOne`
   * takes a string.
   */
  recordId?: string;
  
  /**
   * Tab sections configuration
   */
  sections: FormSectionConfig[];

  /**
   * Inline field definitions (`object-form.customFields`). A member naming a
   * field a section lists is that field's definition, as on every other
   * `formType` (objectui#10254); `ObjectForm` hands the key over in its
   * `{...schema}` spread.
   */
  customFields?: FormField[];
  
  /**
   * Grid width for the whole form (1–4). Aligns with @objectstack/spec
   * FormView.columns and OUTRANKS the per-section `columns`, which say how a
   * section fills the grid rather than how wide it is. Omitted = the widest
   * section's density.
   */
  columns?: number;

  /**
   * Default active tab (section name)
   */
  defaultTab?: string;

  /**
   * Tab position
   * @default 'top'
   */
  tabPosition?: 'top' | 'bottom' | 'left' | 'right';
  
  /**
   * Show submit button
   * @default true
   */
  showSubmit?: boolean;
  
  /**
   * Submit button text
   */
  submitText?: string;
  
  /**
   * Show cancel button
   * @default true
   */
  showCancel?: boolean;
  
  /**
   * Cancel button text
   */
  cancelText?: string;
  
  /**
   * Initial values
   */
  initialValues?: Record<string, any>;
  
  /**
   * Initial data (alias for initialValues)
   */
  initialData?: Record<string, any>;
  
  /**
   * Read-only mode
   */
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

  /**
   * Callbacks
   */
  onSuccess?: (data: any) => void | Promise<void>;
  onError?: (error: Error) => void;
  onCancel?: () => void;
  
  /**
   * CSS class
   */
  className?: string;
}

export interface TabbedFormProps {
  schema: TabbedFormSchema;
  dataSource?: DataSource;
  className?: string;
}

/**
 * TabbedForm Component
 * 
 * Renders a form with sections organized as tabs.
 * 
 * @example
 * ```tsx
 * <TabbedForm
 *   schema={{
 *     type: 'object-form',
 *     formType: 'tabbed',
 *     objectName: 'contacts',
 *     mode: 'create',
 *     sections: [
 *       { label: 'Basic Info', fields: ['firstName', 'lastName', 'email'] },
 *       { label: 'Address', fields: ['street', 'city', 'country'] },
 *     ]
 *   }}
 *   dataSource={dataSource}
 * />
 * ```
 */
export const TabbedForm: React.FC<TabbedFormProps> = ({
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
  const [objectSchema, setObjectSchema] = useState<any>(null);
  // Upload-in-flight gate (objectui#10166): a `file`/`image` value is only its
  // fileId once the presigned upload settles, so a save during that window
  // stored the record WITHOUT the attachment and reported success.
  const uploadGate = useUploadGate();
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
  // Which tab opens first. The live tab state belongs to the form renderer from
  // here on — it owns the panels, so only it can jump to the tab holding a
  // rejected field on a failed submit (#2959).
  const initialTab =
    schema.defaultTab || schema.sections[0]?.name || schema.sections[0]?.label || 'tab-0';

  // Fetch object schema
  React.useEffect(() => {
    // objectui#10712 — a read an `objectName` or data-source change has
    // superseded commits nothing (the record read's `cancelled` below, applied
    // here), so it cannot land last and replace the current object's schema.
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
        const schemaData = await dataSource.getObjectSchema(schema.objectName);
        if (cancelled) return;
        setObjectSchema(schemaData);
        run.commit();
      } catch (err) {
        if (cancelled) return;
        run.fail(err);
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

  // Fetch initial data for edit/view modes
  React.useEffect(() => {
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
      if (schema.mode === 'create' || !schema.recordId || !dataSource) {
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
    (section: FormSectionConfig): FormField[] => {
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

  // Generate tab value
  const getTabValue = (section: FormSectionConfig, index: number): string => {
    return section.name || section.label || `tab-${index}`;
  };

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

  // ONE form for ALL tabs (#2959). A SchemaRenderer per tab gave each tab its
  // own react-hook-form instance, and Radix unmounted the inactive panel — so
  // every tab the user left behind lost its input and only the visible tab's
  // fields reached the submit payload. The renderer now owns the tab strip and
  // panels (`fieldTabs`): all panels stay mounted inside a single <form>, which
  // is also what lets cross-tab conditions and validation see every field.
  //
  // Multi-column stays on the field container INSIDE the form: each tab's fields
  // carry their own colSpan against the shared grid (sectionFormLayout parity),
  // never a grid wrapped around the form — that would leave the extra columns
  // empty (#2128).
  // The one sectioned-form rule (objectui#12548), handed the AUTHORED counts:
  // grid width = the form view's own `columns` (spec FormView.columns), else
  // the widest section, an undeclared tab drawing two per row from `@md`
  // (objectui#12592); each tab at its own count on the shared grid — 12 tracks
  // wide when the counts do not all fit. Every sectioned host calls the same
  // rule, so one piece of metadata lays out the same in every host.
  const sectionGrid = sectionedGridLayout(schema.columns, schema.sections.map((s) => s.columns));
  const formColumns = sectionGrid.columns;
  const containerFieldClass = sectionGrid.fieldContainerClass;

  const tabGroups = schema.sections.map((section, index) => {
    const body = buildSectionFields(section);
    return {
      key: getTabValue(section, index),
      label: section.label || `Tab ${index + 1}`,
      description: section.description,
      containerClass: section.gridClassName,
      // The authored section predicate (objectui#6237). Carried on the group so
      // BOTH synthesis paths below can read it — the tab arm and the sub-two-tab
      // degradation — instead of each re-deriving it from `schema.sections`.
      visibleWhen: section.visibleWhen,
      visibleWhenFault: section.visibleWhenFault,
      fields: sectionGrid.layOut(body, section.columns),
    };
  });

  // ── "Collapse below two tabs", the ruling's third binding semantic ─────────
  // Two different situations wear that name, and only one of them was answered
  // by the renderer:
  //
  //  (a) A PREDICATE hides one of two tabs. Answered upstream and inherited: the
  //      renderer judges whether the tab arm engages on the DECLARED tabs, so a
  //      predicate can only filter what is drawn — it never collapses the strip
  //      mid-interaction (which would remount every surviving field, destroying
  //      focus and in-progress edits, and would draw the hidden tab's fields
  //      flat, breaking the ruled semantics). Nothing to do here.
  //
  //  (b) The form DECLARES fewer than two tabs. The renderer's tab arm needs
  //      more than one usable tab to engage, so a single-section `tabbed` form
  //      is already rendered as the untabbed layout — there is no tab to carry a
  //      predicate, and the key would be silently inert exactly as it was before
  //      this card. That is the case this block answers, and answering it is not
  //      optional: leaving it out would let `ObjectForm` stop reporting the gap
  //      (the arm now "supports" the key) while one shape of the gap survived.
  //
  // The defined degradation is the untabbed layout's OWN predicate mechanism
  // (#6236): a `section-divider` row that CLAIMS its member fields by name, so
  // the verdict gates the whole group through the identical unmount path and the
  // ruled semantics stay byte-for-byte the same across the two shapes.
  //
  // Deliberately chrome-less — no `label`, no `description`. A single-section
  // tabbed form draws no tab strip today, so its section heading is already
  // absent; synthesising a visible header here would change the layout of every
  // such form rather than just honouring the key. `SectionDivider` renders
  // `null` without a label or description, so the row costs nothing visually and
  // exists only to carry the claim. Emitted ONLY for sections that actually
  // authored a predicate: a form with no predicate is byte-identical to before.
  const rendersAsTabs = tabGroups.length > 1;
  const degradedSectionGates: FormField[] = rendersAsTabs
    ? []
    : tabGroups
        .filter((g) => g.visibleWhen != null)
        .map((g) => ({
          name: `__section_gate_${g.key}`,
          type: 'section-divider',
          visibleWhen: g.visibleWhen,
          visibleWhenFault: g.visibleWhenFault,
          fields: g.fields.map((f) => f.name),
          colSpan: 4,
        } as unknown as FormField));

  const allFields: FormField[] = [
    ...degradedSectionGates,
    ...tabGroups.flatMap((g) => g.fields),
  ];

  // The child `form` node, typed as the node it is (objectui#11354).
  // `SchemaRenderer`'s `schema` slot is `BaseSchema`, so a literal written
  // inline there was checked against `BaseSchema`, not against the
  // `FormSchema` the `form` renderer reads.
  const tabbedFormSchema: FormSchema = {
    type: 'form',
    objectName: schema.objectName,
    fields: allFields,
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
    fieldTabs: tabGroups.map((g) => ({
      key: g.key,
      label: g.label,
      description: g.description,
      fields: g.fields.map((f) => f.name),
      containerClass: g.containerClass,
      // The tab's predicate slot (objectui#6237) — the same authored
      // `FormSection.visibleWhen` the modal arm copies onto its tab and
      // the flat arm copies onto its divider. The renderer evaluates it
      // and hides trigger, panel and fields together under the ruled
      // hidden-group semantics; re-selection when the ACTIVE tab hides is
      // the renderer's too (`activeFieldTab` derives over the VISIBLE
      // tabs), so this layout inherits all three ruled semantics instead
      // of re-implementing any of them.
      visibleWhen: g.visibleWhen,
      visibleWhenFault: g.visibleWhenFault,
    })),
    defaultFieldTab: initialTab,
    fieldTabsPosition: schema.tabPosition || 'top',
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
      <SchemaRenderer schema={tabbedFormSchema} />
      <UploadInFlightNotice gate={uploadGate} />
      {conflictDialog}
    </div>
    </UploadGateProvider>
  );
};

export default TabbedForm;
