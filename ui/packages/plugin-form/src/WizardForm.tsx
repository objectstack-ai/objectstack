/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * WizardForm Component
 * 
 * A multi-step wizard form that guides users through sections step by step.
 * Aligns with @objectstack/spec FormView type: 'wizard'
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { FormField, FormSchema, DataSource, ObjectFormSchema, ObjectFormSection } from '@object-ui/types';
import { Button, cn, toast } from '@object-ui/components';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { resolveFieldRuleState, evalFieldPredicate, isMissingForRequired, isServerOwnedValue } from '@object-ui/core';
import { createSafeTranslation } from '@object-ui/i18n';
import { FormSectionContainer } from './FormSection';
import { SchemaRenderer, useSafeFieldLabel, usePredicateScope } from '@object-ui/react';
import { buildSectionFields as buildSectionFieldsShared } from './sectionFields';
import { seedCreateValues, isCreateFormMode } from './schemaDefaults';
import { resolveInitialRecord } from './initialRecord';
import { usePermissions } from '@object-ui/permissions';
import { closedFormAffordance, fieldWriteGate, gateFormFields } from './fieldWriteGate';
import { ClosedAffordanceNotice } from './closedAffordanceNotice';
import { snapshotLoadedRecord, advanceLoadedRecord, type LoadedRecordSnapshot } from './sanitize';
import { formWritePayload } from './writePayload';
import { sectionedGridLayout } from './autoLayout';
import { resolveSuccessNavigate, type SubmitBehavior } from './successBehavior';
import { resolveSubmitRedirect, submitRedirectScope } from './submitRedirect';
import {
  useSubmitRedirectNavigation,
  type PendingSubmitRedirect,
} from './submitRedirectNavigation';
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

/**
 * A wizard STEP — the wizard's OWN authored group shape (objectui#6237).
 *
 * ## Why this is declared here rather than derived from the tabbed layout
 *
 * It used to be `Omit<FormSectionConfig, 'visibleWhen'>`, which subtracted the
 * predicate slot from `TabbedForm`'s section type. That closed the hole for the
 * ONE key it named and left the mechanism wide open: `FormSectionConfig` is the
 * predicate-CARRYING type, so every key added to it lands here by default and
 * the author has to remember to widen the `Omit`. The defect the 2026-08-30
 * ruling closes is the SILENCE — "在共享 `FormSectionConfig` 上声明 `visibleWhen`
 * 会**静默**给 WizardForm 的 step 也发一个谓词槽而那侧无实现" — and a subtractive
 * derivation reproduces that silence for the next key in the same family
 * (`readonlyWhen` / `requiredWhen`, both already this repo's field-level
 * predicate vocabulary). Declaring the step shape independently flips the
 * derivation from subtractive to additive: a key reaches a wizard step only
 * because someone wrote it here, on the type whose renderer has to honour it.
 *
 * This is also simply the house pattern. `SplitFormSectionConfig`,
 * `ModalFormSectionConfig` and `DrawerFormSectionConfig` each declare their own
 * group shape, each documents `className` / `gridClassName` in ITS layout's
 * terms, and each declares `visibleWhen` only because its layout honours it
 * (`SplitFormSectionConfig` even carries a key — `pane` — that exists nowhere
 * else). The wizard borrowing the tabbed layout's interface was the exception,
 * and it cost real accuracy: a wizard author reading the shared type was told
 * `name` is "used as tab value", `label` is "used as tab trigger text", and
 * `className` is "Unused in the tabbed layout" — while this renderer uses all
 * three, `className` at the step container (`FormSectionContainer` below).
 *
 * ## ⛔ Why there is no predicate slot, and why that is not an oversight
 *
 * A step predicate is not a port of the tab predicate, it is a different
 * contract. Steps are wizard component state keyed by section INDEX, only the
 * current step is mounted (unmounted-ness is every other step's NORMAL state,
 * which is why the final gate re-checks the whole declared field set), and the
 * predicate would read `formData` — which merges only at step boundaries. So a
 * step predicate is structurally STEP-BOUNDARY reactive where a tab's is ruled
 * LIVE-RECORD reactive: one keyword, two different "when". It also needs
 * machinery none of which is inherited — navigation policy for skipping hidden
 * steps, the indicator, `isLastStep`, the "Step X of Y" denominator, index
 * stability while hiding is live, re-selection when the CURRENT step hides, and
 * a final-gate exclusion for a hidden step's required fields.
 *
 * Declaring the key on a type this renderer ignores would make it WRITABLE on a
 * step — precisely the declared-but-unenforced shape this card family exists to
 * close. Its absence means TypeScript rejects the key on a wizard step literal,
 * which is where an author (or an agent authoring metadata) finds out.
 * `ObjectForm` additionally reports the gap at runtime for a section predicate
 * arriving on the wizard route, since untyped JSON reaches it too. Both halves
 * are pinned in `__tests__/tabbedFormSectionPredicate-6237.test.tsx`, including
 * a FAMILY-level pin that fails the build if any `*When` key ever appears here,
 * not just the one this card was about.
 *
 * Since the objectstack#13622 ruling (2026-08-31), the boundary is also an
 * AUTHOR-door refusal: `@objectstack/spec` refuses `visibleWhen` (and
 * `collapsible`/`collapsed: true`) on a wizard step at parse, so authored
 * form-view metadata carrying them never reaches this renderer at all. This
 * type and the runtime report remain the guard for what the spec door cannot
 * see — programmatic SDUI callers and metadata published before the
 * tightening. The step-predicate FUTURE contract stays tracked in
 * objectui#6237; the spec-side refusal is its single opening point.
 *
 * ⚠️ This changes nothing that used to work. The published surface is exactly
 * the key set `WizardStepConfig` already had — the derivation changed, not the
 * type — and `visibleWhen` was already a type error on a wizard step literal.
 */
export interface WizardStepConfig {
  /**
   * Step identifier. Used as the step's test handle
   * (`data-testid="wizard-step:<name>"`) and, with `label`, as what the
   * indicator names; falls back to the step INDEX when absent.
   */
  name?: string;

  /**
   * Step label — the text the step indicator shows.
   * Falls back to `Step <n>`, in the session locale (`wizard.stepFallback`).
   */
  label?: string;

  /**
   * Step description, rendered under the step heading.
   */
  description?: string;

  /**
   * How densely this step fills the grid (1–4). Outranked by the form view's
   * own `columns` (spec `FormView.columns`), which sets the grid WIDTH.
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
   * Custom CSS class for this step's container.
   *
   * Honoured, unlike its tabbed counterpart: a wizard mounts ONE step at a
   * time inside its own `FormSectionContainer`, so the step has a container to
   * carry it.
   */
  className?: string;

  /**
   * Custom CSS class for this step's field grid (overrides the column classes).
   */
  gridClassName?: string;
}

// The note a success toast carries when a declared `navigateOnSuccess` was
// refused (objectui#5034). It lives in `formChrome.ts` with the rest of the
// form family's feedback chrome and is re-exported here, where the tests have
// always imported it from.
export { NAVIGATE_ON_SUCCESS_REFUSED_NOTE } from './formChrome';

// Falls back to English when no i18n provider is mounted.
/**
 * Whether a step's submitted answers differ from what the wizard already held
 * for those fields — the form renderer's own dirtiness rule (`valuesEqualForDirty`
 * in `@object-ui/components`' form renderer): the empty-ish values are one
 * value, everything else compares by JSON. Read by the bus gate
 * (objectui#10715): an answer that differs is unsaved input the step form can
 * no longer report once it is reset to the merged record.
 */
const isEmptyishValue = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const stepValuesDiffer = (stepData: Record<string, unknown>, held: Record<string, unknown>): boolean =>
  Object.keys(stepData).some((name) => {
    const next = stepData[name];
    const prev = held[name];
    if (isEmptyishValue(next) && isEmptyishValue(prev)) return false;
    try {
      return JSON.stringify(next) !== JSON.stringify(prev);
    } catch {
      return next !== prev;
    }
  });

// Every row must stay byte-identical to the `en` pack value of the same key —
// `pnpm check:i18n-keys` compares this table against it. The table is what a
// provider-less host (a standalone embed, this package's own tests) renders.
//
// The wizard's own chrome (objectui#10999): the footer buttons, the step
// counter, the step indicator's accessible name, its fallback step label and
// the empty-step notice. The generic verbs reuse the shared keys; `wizard.back`
// and `wizard.submitting` are the wizard's own, because the shared spelling
// either says something else in some packs (zh reads `common.back` as "return",
// where a wizard says "previous step", as the import and bulk wizards already
// do) or does not exist (there is no generic `submitting`).
//
// The last six rows are the form family's feedback chrome (objectui#11039) —
// the success toast, the refused-navigation note, the thank-you heading, the
// loading line and the load-failure heading — the same keys and values as
// `formChrome.ts`, which the flat form reads.
const useWizardTranslation = createSafeTranslation(
  {
    'wizard.missingRequired': 'Please complete the required fields: {{fields}}',
    'common.cancel': 'Cancel',
    'wizard.back': 'Back',
    'common.next': 'Next',
    'wizard.submitting': 'Submitting…',
    'form.create': 'Create',
    'form.update': 'Update',
    'form.stepOf': 'Step {{current}} of {{total}}',
    'wizard.stepFallback': 'Step {{n}}',
    'wizard.progressLabel': 'Progress',
    'wizard.emptyStep': 'No fields configured for this step',
    'form.created': 'Created',
    'form.saved': 'Saved',
    'form.navigateRefused':
      'The `navigateOnSuccess` destination declared for this form was refused, '
      + 'so the navigation did not happen.',
    'publicForm.thankYouTitle': 'Thank you!',
    'publicForm.loading': 'Loading form…',
    'form.errorLoading': 'Error loading form',
    // objectui#8069 — the cross-step gate's refusal of a field `visibleWhen`
    // that could not be evaluated, and the locale's list separator it joins
    // the field labels with. The same keys and values the form renderer reads.
    'form.visibleWhenFaulted':
      "Can't submit: the visibleWhen rule of {{fields}} could not be evaluated. The rule must be fixed before this form can be submitted.",
    'validation.formInvalidJoiner': ', ',
  },
  'wizard.missingRequired',
);

/**
 * Empty for the purposes of a required check. Shared with the form renderer —
 * one predicate, mirroring the server's `isMissing`, so the wizard's
 * cross-step gate can't drift from the per-field verdict (cloud#972).
 */
const isEmptyValue = isMissingForRequired;

export interface WizardFormSchema {
  type: 'object-form';
  formType: 'wizard';
  
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
   * Wizard step sections
   */
  sections: WizardStepConfig[];

  /**
   * Inline field definitions (`object-form.customFields`). A member naming a
   * field a section lists is that field's definition, as on every other
   * `formType` (objectui#10254); `ObjectForm` hands the key over in its
   * `{...schema}` spread.
   */
  customFields?: FormField[];
  
  /**
   * Allow navigation to any step (not just sequential).
   *
   * This is navigation freedom, NOT an exemption from the object's rules: the
   * final submit still checks every step's required fields and sends the user
   * back to the first step that has one outstanding (#2959's validation half —
   * react-hook-form only validates the fields currently mounted, so a step
   * nobody opened used to reach the server unvalidated).
   * @default false
   */
  allowSkip?: boolean;

  /**
   * Grid width for each step (1–4). Aligns with @objectstack/spec
   * FormView.columns and OUTRANKS the per-step `columns`, which says how densely
   * that step fills the grid. Omitted = the step's own `columns`, else 1.
   */
  columns?: number;
  
  /**
   * Show step indicators
   * @default true
   */
  showStepIndicator?: boolean;
  
  /**
   * Text for Next button. Rendered as authored when set; otherwise the
   * session locale's `common.next`.
   * @default 'Next'
   */
  nextText?: string;
  
  /**
   * Text for Previous button. Rendered as authored when set; otherwise the
   * session locale's `wizard.back`.
   * @default 'Back'
   */
  prevText?: string;
  
  /**
   * Submit button text (shown on last step). Rendered as authored when set;
   * otherwise the session locale's `form.create` / `form.update`.
   */
  submitText?: string;

  /**
   * Declarative success toast text shown when no `onSuccess` handler is given
   * (metadata pages cannot pass a function). Falls back to the session
   * locale's `form.created` / `form.saved` ('Created' / 'Saved' in English).
   * Ignored when `submitBehavior` is set.
   */
  successMessage?: string;

  /** Navigate here after a successful create/update (declarative; metadata
   * pages can't pass onSuccess). Supports `{id}`/`{recordId}` interpolation
   * from the saved record. Same-origin-guarded. Takes precedence over the toast.
   * Ignored when `submitBehavior` is set. */
  navigateOnSuccess?: string;

  /** Reset the wizard (back to step 1, cleared) after a successful create so the
   * user can enter another. Ignored when `navigateOnSuccess` or `submitBehavior`
   * is set. */
  resetOnSuccess?: boolean;

  /**
   * Declarative post-submit behavior aligned with `@objectstack/spec`'s
   * `FormView.submitBehavior`. When present, takes precedence over
   * `successMessage` / `navigateOnSuccess` / `resetOnSuccess`.
   */
  submitBehavior?: SubmitBehavior;
  
  /**
   * Show cancel button
   * @default true
   */
  showCancel?: boolean;
  
  /**
   * Cancel button text. Rendered as authored when set; otherwise the session
   * locale's `common.cancel`.
   */
  cancelText?: string;
  
  /**
   * Initial values
   */
  initialValues?: Record<string, any>;
  
  /**
   * Initial data (alias)
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
   * Called when step changes
   */
  onStepChange?: (step: number) => void;
  
  /**
   * CSS class
   */
  className?: string;
}

export interface WizardFormProps {
  schema: WizardFormSchema;
  dataSource?: DataSource;
  className?: string;
}

/**
 * Record a create wizard's opening values in `ref` and hand them back to seed
 * the form with, so the seed and the baseline a save judges a picked owner
 * against are one value (objectui#12359).
 */
function holdCreateSeed(
  ref: { current: Record<string, unknown> | null },
  seed: Record<string, unknown>,
): Record<string, unknown> {
  ref.current = seed;
  return seed;
}

/**
 * WizardForm Component
 * 
 * Renders a multi-step wizard form with step indicators and navigation.
 * 
 * @example
 * ```tsx
 * <WizardForm
 *   schema={{
 *     type: 'object-form',
 *     formType: 'wizard',
 *     objectName: 'users',
 *     mode: 'create',
 *     sections: [
 *       { label: 'Step 1: Personal', fields: ['firstName', 'lastName'] },
 *       { label: 'Step 2: Contact', fields: ['email', 'phone'] },
 *       { label: 'Step 3: Review', fields: [] },
 *     ]
 *   }}
 *   dataSource={dataSource}
 * />
 * ```
 */
export const WizardForm: React.FC<WizardFormProps> = ({
  schema,
  dataSource,
  className,
}) => {
  const { fieldLabel } = useSafeFieldLabel();
  const perms = usePermissions();
  const { userId: currentUserId } = perms;
  const { t } = useWizardTranslation();
  // Upload-in-flight gate (objectui#10166). Scoped to the FINAL commit, not to
  // step navigation: moving between steps writes nothing, and blocking Next
  // would be a second behaviour this card did not ask for.
  const uploadGate = useUploadGate();
  const [objectSchema, setObjectSchema] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  // The persisted record as READ, kept apart from `formData` — the wizard
  // merges each step's answers into `formData`, so it stops being the prior
  // row after step one. Field-rule `previous` and the read-only submit strip
  // need the untouched read (objectui#3484).
  const [persistedRecord, setPersistedRecord] = useState<Record<string, any> | undefined>(undefined);
  // The same read, as the baseline an edit save diffs against so only the
  // fields that changed are written (objectui#10156, objectui#10563). Separate
  // from `persistedRecord` on purpose: this one ADVANCES after a save, while
  // field-rule `previous` keeps reading the record as first read. Set by the
  // `findOne` below and nowhere else, so a caller-supplied record is never a
  // baseline. A ref, not state: only the final commit reads it.
  const loadedRecordRef = React.useRef<LoadedRecordSnapshot | null>(null);
  // OCC-guarded edit save + its conflict dialog (see occSave.tsx).
  const { saveWithOcc, conflictDialog } = useOccSave();
  const [loading, setLoading] = useState(true);
  // objectui#10682 — the load error, kept per read (the object schema and the
  // record), each written only by the current run of its read and cleared when
  // a later run of that read commits: see `loadFailure.ts`. `error` is what
  // the error screen reports.
  const [loadFailures, setLoadFailures] = useState<LoadFailures>(NO_LOAD_FAILURES);
  const loadRunSeqRef = React.useRef<LoadRunSeq>({ schema: 0, record: 0 });
  const error = shownLoadFailure(loadFailures);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // Steps the final submit found an outstanding required field on, so their
  // indicator can say so — a rejection on a step the user is not looking at is
  // otherwise invisible and the submit just appears to do nothing.
  const [invalidSteps, setInvalidSteps] = useState<Set<number>>(new Set());
  // Terminal state for `submitBehavior: { kind: 'thank-you' | 'next-record' }`.
  // Without this the last step's form stayed mounted and fully filled after a
  // successful create, with nothing disabling "Create" — a second click fired
  // a second create request (duplicate record).
  //
  // `refusal` carries the second fact a REFUSED `redirect` destination has to
  // report (objectui#4989): the write succeeded — hence the confirmation this
  // state already renders — but the authored destination is out of contract, so
  // nothing was navigated to and the author needs the reason. Same reasoning as
  // ObjectForm's copy of this state: a refused destination is not a failed
  // submit, so it must not travel in an error channel.
  const [submitted, setSubmitted] = useState<
    { title?: string; message?: string; refusal?: string } | null
  >(null);
  // The accepted destination of a `submitBehavior: { kind: 'redirect' }` submit
  // plus the delay declared for it (objectui#5033). Same reasoning as
  // ObjectForm's copy of this state, and the same reason it is a state and not a
  // timer armed in the handler: a bare `setTimeout` there was owned by nobody, so
  // the pending full-page navigation outlived this wizard and yanked back a
  // submitter who had closed the modal/drawer variant or navigated on. The delay
  // is captured with the destination so the pause cannot be restarted mid-wait by
  // a host re-render carrying a different `delayMs`.
  const [pendingRedirect, setPendingRedirect] = useState<PendingSubmitRedirect | null>(null);

  // The delayed leg of a `redirect` submit behaviour, owned by this component:
  // unmounting cancels the wait. `delayMs` semantics are untouched — the pause is
  // still a pause, an unset value is still a zero timer, i.e. "go now". The host's
  // injected navigate is used when one was supplied, so a mounted host's basename
  // is applied (objectui#4989 defect 4); with no host seam this is the same
  // `window.location.assign` as before. Same hook as ObjectForm's redirect arm —
  // see `submitRedirectNavigation.ts`.
  useSubmitRedirectNavigation(pendingRedirect);

  // Stable id for the *inner* step form's <form> element. The wizard's
  // Next/Create buttons live in the footer, OUTSIDE that form, and submit it
  // natively via `type="submit" form={stepFormId}`. Going through the real
  // form submit (rather than calling handleStepSubmit with the wizard's stale
  // `formData`) runs the step's validation and collects every entered value
  // via RHF `getValues()` — selects, lookups and dates included — so the
  // accumulated record actually reaches the server. Without this the create
  // POST body was `{}` and the server rejected all required fields.
  const stepFormId = React.useId();
  // Bumped on resetOnSuccess to force the inner step form to remount fresh
  // (it's otherwise reused across steps so back/forward retains values).
  const [resetNonce, setResetNonce] = useState(0);
  // Seed `formData` only once. The data-loading effect below depends on
  // `dataSource`/`objectSchema`, whose identity can churn across renders;
  // re-running its create-mode branch would `setFormData({})` mid-wizard and
  // wipe everything the user entered on earlier steps (the create POST then
  // carried only the final step's fields). This guard makes the seed idempotent.
  const seededRef = React.useRef(false);
  // The values a create wizard OPENED with (objectui#12359). `formData` cannot
  // serve: every step's answers are merged into it, so a picked owner would
  // already be the baseline it is judged against. Set wherever the wizard is
  // seeded, and nowhere else.
  const createSeedRef = React.useRef<Record<string, unknown> | null>(null);
  // The record whose data `formData` currently holds. The fetch effect reads it
  // to tell a genuine record SWAP from a re-run of its own making —
  // `initialData`/`initialValues` are objects callers commonly rebuild every
  // render, and flashing the loading state for those would thrash, unmounting
  // the step form mid-entry (objectui#10726).
  const loadedRecordIdRef = React.useRef<string | number | undefined>(undefined);
  // objectui#10715 — the data-invalidation bus, read the way the default arm
  // reads it (the rule is stated once in `recordInvalidation.ts`): a change to
  // this record, to its object or to `'*'` re-reads the record IN PLACE through
  // the record read below while the wizard is pristine, and is held while it
  // holds unsaved input. A wizard has TWO kinds of unsaved input, and either
  // holds the re-read: what is typed on the current step (the step form's own
  // `onDirtyChange`), and the answers of steps already submitted with Next —
  // those live in `formData`, which the step form is reset to BY VALUE at every
  // step boundary and so reports as pristine. Refs, not state: only the bus
  // gate reads them. A re-read replaces `formData` wholesale, so it is taken
  // only when both are clear; it never touches `currentStep`.
  const { refetch: recordRefetch, onDirtyChange: onBusDirtyChange, saved: recordSaved } =
    useRecordInvalidation(schema.objectName, schema.recordId, !!schema.recordId && schema.mode !== 'create');
  const stepDirtyRef = React.useRef(false);
  const unsavedStepValuesRef = React.useRef(false);
  const reportUnsavedInput = useCallback(() => {
    onBusDirtyChange(stepDirtyRef.current || unsavedStepValuesRef.current);
  }, [onBusDirtyChange]);
  const handleStepDirtyChange = useCallback((dirty: boolean) => {
    stepDirtyRef.current = dirty;
    reportUnsavedInput();
  }, [reportUnsavedInput]);

  const totalSteps = schema.sections.length;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

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

  // Fetch initial data
  React.useEffect(() => {
    // objectui#10712 — a read a newer run has superseded (another `recordId`,
    // say, while it was in flight) commits nothing: not the values, not the
    // baseline or `persistedRecord`, and not the `loading` release the current
    // run owns. Otherwise the answer for the previous record could land last
    // and be shown under the new one. The shape the four other sectioned
    // layouts already use (recordSwapLoading.test.tsx).
    let cancelled = false;
    // objectui#10682 — this run's writes to the record read's failure; a newer
    // run of this effect makes them no-ops.
    const run = beginLoadRun(loadRunSeqRef, setLoadFailures, 'record');
    const fetchData = async () => {
      if (schema.mode === 'create' || !schema.recordId || !dataSource) {
        // Seeded from something other than a read: no baseline to diff against.
        loadedRecordRef.current = null;
        if (!seededRef.current) {
          // Declared static defaults are this wizard's opening values (#4047)
          // — see `schemaDefaults` for the create-only boundary and for why
          // runtime defaults are left to the server.
          setFormData(holdCreateSeed(createSeedRef, seedCreateValues(objectSchema, resolveInitialRecord(schema), { currentUserId })));
          seededRef.current = true;
        }
        // Not a read, so no earlier record read's failure describes the form.
        run.commit();
        setLoading(false);
        return;
      }
      
      // objectui#10726 — only a change of RECORD hides the form. A `recordId`
      // change re-enters this effect with the wizard still MOUNTED on the
      // previous record; without going back to loading, record A's values stay
      // on screen AND EDITABLE while B is in flight, and anything typed there
      // reads as A's but is submitted against B. The sectioned layouts' own
      // swap shape, pinned for each of them in recordSwapLoading.test.tsx.
      if (loadedRecordIdRef.current !== schema.recordId) setLoading(true);

      try {
        const data = await dataSource.findOne(schema.objectName, schema.recordId);
        if (cancelled) return;
        loadedRecordIdRef.current = schema.recordId;
        loadedRecordRef.current = snapshotLoadedRecord(schema, data);
        setFormData(data || {});
        setPersistedRecord(data || {});
        // What the wizard holds is now the record as read: no step's answer is
        // unsaved (objectui#10715).
        unsavedStepValuesRef.current = false;
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

  // Build section fields from object schema
  const buildSectionFields = useCallback(
    (section: WizardStepConfig): FormField[] => {
      const fields = buildSectionFieldsShared(section as any, {
        objectSchema,
        objectName: schema.objectName,
        readOnly: schema.readOnly,
        mode: schema.mode,
        // Feeds the "no persisted record" test that decides whether a runtime
        // `defaultValue` excuses a field from `required` (#4069). The wizard's
        // own final-submit gate (`gateFinalSubmit`) reads the `required`
        // this produces, so it agrees with the renderer for free.
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

  // objectui#11000 — the affordance the lock above found CLOSED for this
  // wizard's mode (`create`, or `edit` on an edit wizard), read from the same
  // predicate that disabled every field. A user it answers for cannot submit,
  // so the wizard does not walk them on: Next and the final submit are
  // disabled, the indicator does not jump forward, and a step submit that
  // arrives anyway (the keyboard) is not taken. Cancel and Back stay usable,
  // every step stays shown, and the notice says why.
  const closedAffordance = closedFormAffordance({
    perms,
    objectName: schema.objectName,
    mode: schema.mode,
    objectSchema,
  });

  // The same "no persisted record" test the seeding and the create-mode
  // `required` suppression use, so this wizard cannot be seeded as a create
  // form and gated as an edit one.
  const isCreateWizard = isCreateFormMode(schema);

  /**
   * The host shell's global predicate scope (`ExpressionProvider` →
   * `PredicateScopeProvider`) — `current_user` plus the ADR-0068 `user` /
   * `ctx.user` / `os.user` aliases, `data`, `features`. Empty `{}` when
   * no provider is mounted, which is the same "nothing to bind" the renderer
   * sees (objectui#6110).
   *
   * Read HERE, at the component's top level, because the only consumer is a
   * `useCallback` — a hook cannot be called inside one, and the gate below is
   * invoked from a submit handler where no React context is readable at all.
   * It joins that callback's dependency list for the same reason it joins the
   * renderer's (#6010): a scope change — the host switching organisations, so
   * `current_user.positions` changes — can flip a `visibleWhen` exactly as a
   * keystroke can, and a memoized gate holding the old scope would answer the
   * final submit with a principal the user no longer is.
   */
  const predicateScope = usePredicateScope();

  // Current section fields
  const currentSectionFields = useMemo(() => {
    if (currentStep >= 0 && currentStep < totalSteps) {
      return buildSectionFields(schema.sections[currentStep]);
    }
    return [];
  }, [currentStep, totalSteps, schema.sections, buildSectionFields]);

  /**
   * Required fields the record does not satisfy, grouped by the STEP that
   * declares them.
   *
   * react-hook-form only validates the fields currently MOUNTED, and a wizard
   * mounts one step at a time. Sequential navigation is safe (Next validates the
   * step you are leaving), but `allowSkip` jumps straight to any step — so a
   * required field on a step nobody opened was never registered, never
   * validated, and simply absent from the create payload, with nothing on screen
   * saying so. The final submit therefore re-checks the WHOLE declared field set
   * here.
   *
   * Uses the canonical rule engine (`resolveFieldRuleState`), the same one the
   * form renderer and the server's rule-validator use, so a conditionally
   * required/hidden field gets the same verdict from all three rather than a
   * second, divergent dialect.
   *
   * ## `faultedVisibleWhen` — the same pass, one more answer (objectui#8069)
   *
   * The fields whose `visibleWhen` could not be evaluated, grouped the same
   * way, read off the very `resolveFieldRuleState` call that decides the
   * required verdict (its `faults` report) — never a second evaluation.
   * ADR-0137 D2 as ruled (Q1 = B, one judge per rule): a faulted `visibleWhen`
   * refuses the final submit, because no server evaluates it; `requiredWhen`
   * / `readonlyWhen` keep their direction here and are the server's to refuse.
   * A step whose form the user never opened never ran the renderer's own
   * refusal, which is why the cross-step gate asks as well. A stored BLANK
   * `visibleWhen` is a fault like any other (ADR-0137 D2, `FieldRuleFaults`);
   * a `section-divider` row's `visibleWhen` is its section's layout gate, not
   * a field rule, and is not judged.
   *
   * ⚠️ This gate binds no `previous` in either mode (see the `serverOwnedValue`
   * note below), so a `visibleWhen` reading `previous` is unevaluable here even
   * on an EDIT wizard, and is refused. objectui#8069's ruling declined new
   * binding for `previous` ("no new binding pipelines", its option D) and
   * accepted the create-form half of that as the residual; the edit-wizard
   * half is the same mechanism, accepted as a residual under the same refusal
   * of option D on objectui#8069 — ⛔ so `persistedRecord` is deliberately NOT
   * bound here.
   */
  const gateFinalSubmit = useCallback(
    (
      record: Record<string, any>,
    ): { missing: Map<number, string[]>; faultedVisibleWhen: Map<number, string[]> } => {
      const out = new Map<number, string[]>();
      const faultedVisibleWhen = new Map<number, string[]>();
      schema.sections.forEach((section, index) => {
        for (const field of buildSectionFields(section)) {
          const name = field?.name;
          if (!name || (field as any).hidden === true) continue;
          const state = resolveFieldRuleState(
            {
              visibleWhen: (field as any).visibleWhen,
              readonlyWhen: (field as any).readonlyWhen,
              requiredWhen: (field as any).requiredWhen,
            },
            record,
            {
              required: !!field.required,
              readonly: (field as any).readonly === true,
              // Same suppression the form renderer applies (#4069 / #4085): on
              // a CREATE wizard a producer-owned control is left empty and its
              // key omitted, so neither the static flag nor a `requiredWhen`
              // resolving TRUE may hold the final submit. The mode is read from
              // the schema rather than from the absent `previous` argument
              // above — this gate passes no `previous` in EITHER mode, so
              // inferring create-ness from it would drop a `requiredWhen` an
              // EDIT wizard is supposed to enforce.
              serverOwnedValue: isServerOwnedValue(field, isCreateWizard),
            },
            undefined,
            // The host predicate scope, so `current_user` resolves here exactly
            // as it does in the form renderer that DREW this field (#6010).
            // Without it this gate faults on every `current_user` predicate and
            // fails OPEN, demanding a field the wizard itself hid (#6110).
            predicateScope,
            `field '${name}'`,
          );
          if (state.faults.visibleWhen !== undefined && field.type !== 'section-divider') {
            faultedVisibleWhen.set(index, [
              ...(faultedVisibleWhen.get(index) ?? []),
              field.label || name,
            ]);
          }
          // View-level FormField.visibleOn hides the field the same way a
          // field-level visibleWhen does — fold it into the verdict exactly
          // like the form renderer (form.tsx) does, or the gate demands a
          // field the view itself hides (#3090). Since #3090 this slot also
          // receives the ADR-0089 canonical view-level `visibleWhen` spelling.
          const viewVisible =
            (field as any).visibleOn == null ||
            evalFieldPredicate((field as any).visibleOn, record, true, undefined, predicateScope, {
              context: `visibleOn of field '${name}'`,
            });
          // A hidden or read-only field is not the user's to fill in.
          if (!viewVisible || !state.visible || state.readonly || !state.required) continue;
          if (!isEmptyValue(record[name])) continue;
          out.set(index, [...(out.get(index) ?? []), (field as any).label || name]);
        }
      });
      return { missing: out, faultedVisibleWhen };
    },
    [schema.sections, buildSectionFields, isCreateWizard, predicateScope],
  );

  // Handle step data collection (merge partial data into formData)
  const handleStepSubmit = useCallback(async (stepData: Record<string, any>) => {
    // objectui#11000 — Next and the final submit are disabled while the
    // affordance is closed; this is the guard for a submit that arrives
    // without them. Nothing is merged, advanced or written.
    if (closedAffordance) return;
    const mergedData = { ...formData, ...stepData };
    setFormData(mergedData);
    // An answer that differs from what the wizard held is unsaved input the
    // step form can no longer see once it is reset to `mergedData`, so it holds
    // a bus re-read until the save lands (objectui#10715). A step walked
    // through untouched leaves the wizard as pristine as it was.
    if (stepValuesDiffer(stepData, formData)) {
      unsavedStepValuesRef.current = true;
      reportUnsavedInput();
    }

    // Mark step as completed
    setCompletedSteps(prev => new Set(prev).add(currentStep));
    // This step just cleared its own validation, so drop any marker it carried.
    setInvalidSteps(prev => {
      if (!prev.has(currentStep)) return prev;
      const next = new Set(prev);
      next.delete(currentStep);
      return next;
    });

    if (isLastStep) {
      // An upload on this step is still in flight (objectui#10166). The record
      // would be written WITHOUT the attachment and reported as success, so the
      // commit is refused here — before the required-field gate below, because
      // this is about a value that has not arrived rather than one the user
      // failed to give. The Create button is disabled and labelled for it too;
      // this arm is the keyboard-submit guard.
      if (uploadGate.uploading) {
        toast.error(uploadGate.reason);
        return;
      }
      // Gate the submit on the FULL field set, not just this step's (see
      // gateFinalSubmit) — then point the user at the first step that is
      // short something, instead of letting the server answer with a 400 that
      // names fields the user cannot even see.
      const { missing, faultedVisibleWhen } = gateFinalSubmit(mergedData);
      // A faulted `visibleWhen` first (objectui#8069): it names the field and
      // the rule, and nothing typed on any step can clear it.
      if (faultedVisibleWhen.size > 0) {
        setInvalidSteps(new Set(faultedVisibleWhen.keys()));
        toast.error(
          t('form.visibleWhenFaulted', {
            fields: [...faultedVisibleWhen.values()].flat().join(t('validation.formInvalidJoiner')),
          }),
        );
        goToStep(Math.min(...faultedVisibleWhen.keys()));
        return;
      }
      if (missing.size > 0) {
        setInvalidSteps(new Set(missing.keys()));
        const labels = [...missing.values()].flat();
        const MAX = 3;
        toast.error(
          t('wizard.missingRequired', {
            fields: labels.slice(0, MAX).join(', ') + (labels.length > MAX ? '…' : ''),
          }),
        );
        goToStep(Math.min(...missing.keys()));
        return;
      }
      setInvalidSteps(new Set());

      // Final submission
      setSubmitting(true);
      try {
        // No submit TARGET: a declared `submitHandler` owns the write and needs no
        // adapter of its own (objectui#6176's seam), so only a form with NEITHER it
        // nor a `dataSource` is target-less. The one target-less form that is still
        // legitimate is the inline-fields collector, whose `onSuccess` IS the write.
        // This arm used to be `if (!dataSource)` alone: it confirmed EVERY
        // adapter-less submit, bypassing a declared host seam and persisting
        // nothing (objectui#6300). See `submitTarget.ts` for the whole rule.
        if (!dataSource && !schema.submitHandler && hasInlineFieldSource(schema)) {
          if (schema.onSuccess) {
            await schema.onSuccess(mergedData);
          }
          return mergedData;
        }
        
        let result;
        // What this save writes, through the ONE outbound sequence the simple
        // form uses (objectui#10563; `formWritePayload` holds the rule):
        // nothing a form never writes — server-owned, computed, read-only,
        // unknown, or refused by the caller's field-level security — and on an
        // EDIT only the fields that differ from the record this wizard read.
        // `mergedData` starts from that whole read, so without this every
        // column of the record went back. Computed ONCE so every persistence
        // route below — the host-owned seam included — writes the identical
        // payload. A simple form's mobile `stepper` renders through here too.
        const { writePayload } = formWritePayload(mergedData, schema, {
          objectSchema,
          canEdit: fieldWriteGate(perms, schema.objectName, schema.mode),
          snapshot: loadedRecordRef.current,
          // The values this wizard OPENED with, held apart from `formData`,
          // which accumulates every step's answers (objectui#12359).
          createBaseline: createSeedRef.current,
        });

        if (schema.submitHandler) {
          // The host owns persistence (e.g. MasterDetailForm batching the
          // parent + its child collections into ONE atomic transaction). The
          // form validates and hands the values over; it does NOT create/update
          // itself. Same seam and same precedence as SimpleObjectForm — every
          // renderer `ObjectForm` routes to must check it FIRST, or a declared
          // host-owned write silently becomes an independent one
          // (objectui#6176).
          result = await schema.submitHandler(writePayload);
        } else if (!dataSource) {
          // No route left: no host seam and no adapter. Refuse instead of reporting
          // success — the `catch` below hands this to `schema.onError` and rethrows.
          throw noSubmitTargetError();
        } else if (schema.mode === 'create') {
          result = await dataSource.create(schema.objectName, writePayload);
        } else if (schema.mode === 'edit' && schema.recordId) {
          // OCC-guarded: sends `ifMatch` from the record we read; a 409 asks
          // the user to keep editing (skip the success path) or overwrite.
          // `formData.updated_at` is still the fetched value — no wizard step
          // renders an input for it.
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
        // The write landed: the next save from this still-mounted wizard diffs
        // against the record as it now stands, not as first read.
        loadedRecordRef.current = advanceLoadedRecord(loadedRecordRef.current, schema, writePayload);
        // objectui#10715 — and what the wizard shows is what the server holds:
        // every step's answer is saved, and a bus change held while it had
        // unsaved input (its own write's echo included) is replayed now.
        unsavedStepValuesRef.current = false;
        recordSaved();

        if (schema.onSuccess) {
          await schema.onSuccess(result);
        } else if (!schema.submitHandler && schema.submitBehavior) {
          const behavior = schema.submitBehavior;
          switch (behavior.kind) {
            case 'redirect': {
              // objectstack#7496 ruled this url a RELATIVE in-app path with
              // `{{record.field_name}}` interpolation, URL-escaped when the
              // redirect is built. Same consumption as ObjectForm's redirect
              // arm, through the same module, so a wizard and a flat form cannot
              // disagree about one authored value — see `submitRedirect.ts` for
              // why the shape verdict is the spec's own and what it does not fix.
              //
              // The old line asked `isSameOriginUrl`, which accepts a same-origin
              // ABSOLUTE url the contract refuses at the authoring door, and
              // dropped everything else in SILENCE after a successful write
              // (objectui#4989 defects 2, 3 and 5).
              const verdict = resolveSubmitRedirect(
                behavior.url,
                submitRedirectScope(mergedData, result),
              );
              if (!verdict.ok) {
                // The write SUCCEEDED and only the destination is out of
                // contract: confirm the submit, replace the still-filled step
                // form so there is nothing left to resubmit, and show the spec's
                // own prescription for the author.
                toast.error(verdict.refusal);
                setSubmitted({
                  message: schema.successMessage
                    || (schema.mode === 'create' ? t('form.created') : t('form.saved')),
                  refusal: verdict.refusal,
                });
                break;
              }
              // Hand the accepted destination to the effect that owns the wait
              // (objectui#5033). The verdict flow above is unchanged: this arm
              // still decides WHETHER to navigate, no longer when.
              setPendingRedirect({ url: verdict.url, delayMs: behavior.delayMs ?? 0 });
              break;
            }
            case 'continue':
              // Back to a fresh step 1 for the next entry — "fresh" means the
              // same opening values the wizard had, defaults included (#4047),
              // not a blank object the first entry never started from.
              setFormData(holdCreateSeed(createSeedRef, seedCreateValues(objectSchema, resolveInitialRecord(schema), { currentUserId })));
              setCompletedSteps(new Set());
              setCurrentStep(0);
              setResetNonce((n) => n + 1);
              break;
            case 'next-record':
            case 'thank-you':
            default: {
              const message = behavior.kind === 'thank-you' && behavior.message
                ? behavior.message
                : schema.successMessage || (schema.mode === 'create' ? t('form.created') : t('form.saved'));
              toast.success(message);
              // Replace the (still fully filled) step form with a confirmation
              // panel so there's nothing left to resubmit.
              setSubmitted({ title: behavior.kind === 'thank-you' ? behavior.title : undefined, message });
              break;
            }
          }
        } else if (!schema.submitHandler) {
          // Legacy declarative success behaviors for metadata-only wizards.
          // Skipped when a `submitHandler` owns persistence: the host already
          // reports the outcome, so a second toast/redirect here would
          // double-confirm (the guard SimpleObjectForm applies for the same
          // reason).
          const nav = resolveSuccessNavigate(schema.navigateOnSuccess, result);
          if (nav) {
            // Landing on the saved record is the confirmation — no toast needed.
            //
            // WHO travels is what ObjectForm's arm does; see the long comment
            // there (objectui#5034, points 1 and 3). The destination goes to the
            // state the seam-owning effect above reads, so a mounted host's
            // basename is applied instead of the origin root. Unconditionally,
            // because `resolveSuccessNavigate` now accepts relative references
            // only — the `window.location.assign` arm that used to stand here is
            // unreachable and was deleted with the ruling that made it so.
            setPendingRedirect({ url: nav, delayMs: 0 });
            return result;
          }
          if (schema.navigateOnSuccess) {
            // Declared, and refused (objectui#5034 point 2). The write succeeded,
            // so this stays a success toast — with the one fact that was missing
            // attached to it. The template goes to the console for the author,
            // where naming it cannot mislead the submitter.
            console.warn(
              '[WizardForm] `navigateOnSuccess` was declared but produced no destination:',
              schema.navigateOnSuccess,
            );
            toast.success(
              schema.successMessage || (schema.mode === 'create' ? t('form.created') : t('form.saved')),
              { description: t('form.navigateRefused') },
            );
          } else {
            toast.success(schema.successMessage || (schema.mode === 'create' ? t('form.created') : t('form.saved')));
          }
          if (schema.resetOnSuccess && schema.mode === 'create') {
            // Back to a fresh step 1 for the next entry — same opening values
            // as the first entry, defaults included (#4047).
            setFormData(holdCreateSeed(createSeedRef, seedCreateValues(objectSchema, resolveInitialRecord(schema), { currentUserId })));
            setCompletedSteps(new Set());
            setCurrentStep(0);
            setResetNonce((n) => n + 1);
          }
        }
        return result;
      } catch (err) {
        if (schema.onError) {
          schema.onError(err as Error);
        }
        throw err;
      } finally {
        setSubmitting(false);
      }
    } else {
      // Move to next step
      goToStep(currentStep + 1);
    }
  }, [closedAffordance, formData, currentStep, isLastStep, schema, objectSchema, dataSource, perms, gateFinalSubmit, t, saveWithOcc, uploadGate.uploading, uploadGate.reason, reportUnsavedInput, recordSaved]);

  // Navigation
  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < totalSteps) {
      setCurrentStep(step);
      if (schema.onStepChange) {
        schema.onStepChange(step);
      }
    }
  }, [totalSteps, schema]);

  const handlePrev = useCallback(() => {
    goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  const handleCancel = useCallback(() => {
    if (schema.onCancel) {
      schema.onCancel();
    }
  }, [schema]);

  // Which steps the indicator may open: any step up to the current one, and a
  // later step only through `allowSkip` or a completed step — never while the
  // affordance is closed (objectui#11000), where a jump forward would walk the
  // user through steps they cannot submit.
  const canOpenStep = useCallback(
    (step: number) =>
      step <= currentStep || (!closedAffordance && (!!schema.allowSkip || completedSteps.has(step))),
    [currentStep, closedAffordance, schema.allowSkip, completedSteps],
  );

  const handleStepClick = useCallback((step: number) => {
    if (canOpenStep(step)) {
      goToStep(step);
    }
  }, [canOpenStep, goToStep]);

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

  if (submitted) {
    return (
      <div className={cn('w-full space-y-4', className, schema.className)}>
        <div className="rounded-md border bg-card p-8 text-center">
          <h3 className="text-lg font-semibold">{submitted.title ?? t('publicForm.thankYouTitle')}</h3>
          {submitted.message && (
            <p className="mt-2 text-sm text-muted-foreground">{submitted.message}</p>
          )}
        </div>
        {/*
          A refused `redirect` destination (objectui#4989) keeps the confirmation
          above — the record WAS written — and adds the reason nothing was
          navigated to. `role="alert"` because it appears after the submit the
          user just made, so it has to reach a screen reader without a focus move.
        */}
        {submitted.refusal && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {submitted.refusal}
          </div>
        )}
      </div>
    );
  }

  const currentSection = schema.sections[currentStep];
  // The one sectioned-form rule (objectui#12548), over the one section this
  // step draws, handed the AUTHORED counts: a form-level grid wider than the
  // step's own count goes 12 tracks wide, so the step still draws its own count
  // per row, and a step that declares nothing draws two per row from `@md`, as
  // the dialog does (objectui#12592).
  const stepGrid = sectionedGridLayout(schema.columns, [currentSection?.columns]);
  const stepGridColumns = stepGrid.columns;
  const stepFieldContainerClass = stepGrid.fieldContainerClass;

  // The current step's child `form` node, typed as the node it is
  // (objectui#11354). `SchemaRenderer`'s `schema` slot is `BaseSchema`, so a
  // literal written inline there was checked against `BaseSchema`, not
  // against the `FormSchema` the `form` renderer reads. Rendered only while
  // the step has a section with fields (below).
  const stepFormSchema: FormSchema = {
    type: 'form',
    objectName: schema.objectName,
    id: stepFormId,
    // Multi-column on the field container inside the form, not a
    // grid around the whole form (which leaves columns empty).
    //
    // Grid width: the form view's own `columns` first (spec
    // FormView.columns — it was being dropped, so a view that
    // declared 3 columns rendered single-column here while the same
    // metadata gave 3 in a modal), else this step's own `columns`.
    // Unlike the tabbed/split hosts there is no widest-section
    // fallback: wizard steps never share a viewport, so there is no
    // shared grid to size, and each step keeps its authored width.
    fields: stepGrid.layOut(currentSectionFields, currentSection?.columns),
    columns: stepGridColumns,
    ...(stepFieldContainerClass ? { fieldContainerClass: stepFieldContainerClass } : {}),
    layout: 'vertical',
    defaultValues: formData,
    // Persisted record → `previous` binding + read-only submit
    // strip (#3484). Never `formData`: that already carries the
    // answers from earlier steps.
    previousValues: schema.mode === 'edit' ? persistedRecord : undefined,
    showSubmit: false,
    showCancel: false,
    onSubmit: handleStepSubmit,
    // The step form's dirtiness feeds the bus gate above
    // (objectui#10715); the wizard adds its own unsaved steps.
    onDirtyChange: handleStepDirtyChange,
  };

  return (
    // `@container`: the step's field grid is sized with container queries
    // (`@md:grid-cols-2` …), which need a container ancestor to resolve against —
    // without one the classes are inert and a multi-column step silently stayed
    // single-column. Same wrapper TabbedForm / SplitForm carry.
    //
    // The gate provider wraps the whole step body so every upload widget on the
    // CURRENT step reports in (objectui#10166). It sits ABOVE the step body, so
    // it survives step changes: an upload started on a step the user has left
    // keeps holding it until the upload settles (objectui#10180), and the final
    // commit stays gated on it even though its widget is gone.
    <UploadGateProvider gate={uploadGate}>
    <div className={cn('w-full @container', className, schema.className)}>
      {/* Step Indicator */}
      {schema.showStepIndicator !== false && (
        <nav aria-label={t('wizard.progressLabel')} className="mb-8">
          <ol className="flex items-center">
            {schema.sections.map((section, index) => {
              const isActive = index === currentStep;
              const isCompleted = completedSteps.has(index);
              const isClickable = canOpenStep(index);
              // The last submit found a required field outstanding on this step.
              const hasError = invalidSteps.has(index);

              return (
                <li
                  key={index}
                  className={cn(
                    'relative flex-1',
                    index !== totalSteps - 1 && 'pr-8 sm:pr-12'
                  )}
                >
                  {/* Connector line */}
                  {index !== totalSteps - 1 && (
                    <div
                      className="absolute top-3 sm:top-4 left-6 -right-4 sm:left-10 sm:-right-2 h-0.5"
                      aria-hidden="true"
                    >
                      <div
                        className={cn(
                          'h-full',
                          isCompleted ? 'bg-primary' : 'bg-muted'
                        )}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    className={cn(
                      'group relative flex items-center',
                      isClickable ? 'cursor-pointer' : 'cursor-not-allowed'
                    )}
                    onClick={() => handleStepClick(index)}
                    disabled={!isClickable}
                    data-testid={`wizard-step:${section.name || index}`}
                    data-error={hasError || undefined}
                  >
                    {/* Step circle - smaller on mobile */}
                    <span
                      className={cn(
                        'flex h-6 w-6 sm:h-8 sm:w-8 items-center justify-center rounded-full text-xs sm:text-sm font-medium transition-colors',
                        // An outstanding required field outranks the completed
                        // tick: the step needs attention, whatever else it is.
                        hasError && 'border-2 border-destructive bg-background text-destructive',
                        !hasError && isCompleted && 'bg-primary text-primary-foreground',
                        !hasError && isActive && !isCompleted && 'border-2 border-primary bg-background text-primary',
                        !hasError && !isActive && !isCompleted && 'border-2 border-muted bg-background text-muted-foreground'
                      )}
                    >
                      {hasError ? (
                        <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden />
                      ) : isCompleted ? (
                        <Check className="h-3 w-3 sm:h-4 sm:w-4" />
                      ) : (
                        index + 1
                      )}
                    </span>

                    {/* Step label */}
                    <span className="ml-2 sm:ml-3 text-xs sm:text-sm font-medium hidden sm:block">
                      <span
                        className={cn(
                          hasError
                            ? 'text-destructive'
                            : isActive ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {section.label || t('wizard.stepFallback', { n: index + 1 })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {/* Why every field below is locked, when the lock is the form-wide one
          (objectui#11000). */}
      <ClosedAffordanceNotice
        affordance={closedAffordance}
        objectName={schema.objectName}
        objectSchema={objectSchema}
      />

      {/* Current Step Content */}
      <div className="min-h-[200px]">
        {currentSection && (
          <FormSectionContainer
            label={currentSection.label}
            description={currentSection.description}
            columns={1}
            className={currentSection.className}
            gridClassName={currentSection.gridClassName}
          >
            {currentSectionFields.length > 0 ? (
              <SchemaRenderer key={resetNonce} schema={stepFormSchema} />
            ) : (
              // A step can legitimately have NO inputs — a final "Review"/confirm
              // step is the canonical case (this component's own usage example
              // ends on `{ label: 'Step 3: Review', fields: [] }`). The footer
              // Next/Create buttons submit the step form *natively* by id, so
              // that form has to exist even when there is nothing to fill in:
              // without it the buttons point at a missing target, the click does
              // nothing at all, and a wizard that ends on a review step can never
              // be completed. Submitting contributes no new values — the record
              // is whatever the earlier steps accumulated in `formData`.
              <form
                id={stepFormId}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleStepSubmit({});
                }}
              >
                <div className="text-center py-8 text-muted-foreground">
                  {t('wizard.emptyStep')}
                </div>
              </form>
            )}
          </FormSectionContainer>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t">
        <div>
          {schema.showCancel !== false && (
            <Button
              variant="ghost"
              onClick={handleCancel}
            >
              {schema.cancelText || t('common.cancel')}
            </Button>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Step counter */}
          <span className="text-sm text-muted-foreground mr-2">
            {t('form.stepOf', { current: currentStep + 1, total: totalSteps })}
          </span>
          
          {!isFirstStep && (
            <Button
              variant="outline"
              onClick={handlePrev}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              {schema.prevText || t('wizard.back')}
            </Button>
          )}
          
          {isLastStep ? (
            <Button
              type="submit"
              form={stepFormId}
              disabled={submitting || schema.mode === 'view' || uploadGate.uploading || !!closedAffordance}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {uploadGate.uploading
                ? uploadGate.busyLabel
                : submitting
                  ? t('wizard.submitting')
                  : (schema.submitText || (schema.mode === 'create' ? t('form.create') : t('form.update')))}
            </Button>
          ) : (
            <Button
              type="submit"
              form={stepFormId}
              disabled={!!closedAffordance}
            >
              {schema.nextText || t('common.next')}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
      <UploadInFlightNotice gate={uploadGate} />
      {conflictDialog}
    </div>
    </UploadGateProvider>
  );
};

export default WizardForm;
