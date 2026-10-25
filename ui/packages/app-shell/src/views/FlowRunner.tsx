/**
 * FlowRunner — renders the interactive `screen` of a paused screen-flow run
 * (framework screen-flow runtime, ADR-0019) and resumes it with the collected
 * input.
 *
 * A `type: 'flow'` action launches a flow; when the run pauses at a `screen`
 * node the launch response carries `{ status: 'paused', runId, screen }`. The
 * host view (ObjectView / RecordDetailView) opens this modal with that state.
 * On submit it POSTs `/api/v1/automation/{flow}/runs/{runId}/resume` with the
 * field values as `inputs`; a `paused` response renders the next screen
 * (multi-screen wizards), a terminal response closes and refreshes the view.
 *
 * The screen BODY (flat fields / object-form) is rendered by the shared
 * {@link ScreenView} — the same renderer the Studio design preview reuses, so
 * the two can never drift (cf. #1927).
 *
 * ## The resume RESULT has to reach the user (`c40f3b8ca`)
 *
 * A dogfood walkthrough reported that a `400 FLOW_FAILED` and a successful run
 * "render identically: the dialog closes and the page is unchanged". Half of
 * that was already fixed by the time it was triaged — `interpretFlowResponse`
 * reads the ADR-0112 envelope and the `toast.error` below has carried its prose
 * since #4899 — but three gaps survived, and they are what this component now
 * answers:
 *
 * 1. **A terminal failure closed the dialog, taking the user's input with it.**
 *    The reason it closed is still sound and is NOT reversed here: on a
 *    `FLOW_FAILED` the engine has already consumed the suspension
 *    (resume-once), so a retry can only reach "No suspended run", and offering
 *    one is a lie. What #4899 concluded from that — *close* — is one way to
 *    withhold the dead retry, and it is the expensive one: the user has just
 *    typed a form they can no longer see, and the sentence explaining the
 *    refusal names a value that is now gone from the screen. So the dialog
 *    stays OPEN and the run's disposition is expressed the narrow way instead:
 *    `retryable === false` withdraws the submit affordance (the flat footer
 *    swaps Submit for a single Close; an `object-form` step drops `showSubmit`,
 *    which also stops a second Save from creating a DUPLICATE record — its
 *    first one was already persisted before the resume failed). Nothing offers
 *    a retry that cannot work; the input and the reason stay on screen
 *    together.
 * 2. **The message had one carrier, and it was the transient one.** The toast
 *    is kept — it is the console's failure idiom and it is viewport-fixed —
 *    and an inline destructive `Alert` (`role="alert"`) now carries the same
 *    sentence inside the dialog, next to the values that produced it. It sits
 *    above the scrolling body (objectui#12080), so it stays in view however
 *    far a tall screen is scrolled.
 * 3. **Success invalidated the wrong thing.** Both hosts answer `onComplete`
 *    with `notifyDataChanged({ objectName: <this page's object> })`, which is
 *    the record the user is LOOKING at — never the record the flow WROTE. The
 *    reported run created a `crm_quote` from an Opportunity page, so the
 *    related list that would now contain it was never told, and the quote did
 *    not appear until a manual reload. This component cannot know which objects
 *    a flow touched (reading that out of the flow's output is a contract
 *    question, deliberately not answered here), so it invalidates `'*'` — the
 *    same scope, for the same stated reason, that `RecordDetailView`'s manual ⟳
 *    uses: everything mounted refetches in place over the #2269 bus, with no
 *    remount, so tab / scroll / inline-edit state all survive (AGENTS.md §5 #8).
 *
 * ## A REFUSED end is a notice, not a completion (objectui#7707)
 *
 * A flow can now end by saying no: an `end` node declaring `outcome: 'refused'`
 * carries a `message` template the engine interpolates per-record, and the run
 * records `refused` — terminal like `completed`, distinct from `failed` because
 * nothing went wrong (the maintainer ruling on objectstack#14945, whose contract
 * half is on the installed `@objectstack/spec` surface).
 *
 * Before that outcome existed the only channel that could interpolate
 * per-record text was a message-only `screen` node, which is an INPUT step
 * wearing a notice's clothes: it renders Submit, and submitting resumes the run
 * to `end`, where the terminal-success branch below toasted `Flow "…"
 * completed` at a user who had just been told the run was refused.
 *
 * So on `refused` this component renders the engine's sentence as a plain
 * (non-destructive) notice and takes the terminal disposition it already had a
 * route to: Submit withdrawn, a single Close. What it does NOT do is as ruled
 * as what it does — no toast of either colour, no `onComplete`, no
 * invalidation. The invoking action stays quiet on its own account, exactly as
 * today: a paused run returns `{ success: true, silent: true }` and `silent`
 * suppresses the action's `successMessage` at the ActionRunner's toast sink.
 * ⛔ That last part is a thing that WORKS — it is pinned, not touched.
 *
 * ## A refused end shows the message alone (objectui#13342)
 *
 * The notice used to sit above the screen the run had paused on, and that
 * screen stayed mounted under it: its inputs visible and editable, the values
 * going nowhere, since a refused run is never resumed. So on `refused` the
 * screen body is no longer rendered — the dialog keeps its header (the flow's
 * label and the step's heading, which still say what was being done), the
 * notice, and the Close. An `object-form` step's Close came from the form's
 * own button bar, which went with the body, so a refused run draws the
 * runner's footer on that step too; the dialog takes the narrow width, since
 * nothing wide is left in it.
 *
 * Only `refused` takes this. A terminal FAILURE keeps the screen and its
 * values under the reason on purpose (the resume-RESULT section above): there
 * the user is reading why what they typed was not accepted. And a screen still
 * waiting for input renders exactly as before.
 *
 * ## The invoking action's `successMessage` closes the run (objectui#12234)
 *
 * The `silent` above holds the action's message back AT THE PAUSE, because
 * nothing has completed yet. It used to be held back for good: the run then
 * completed here, and this toast knew only the FLOW's words, so an action
 * declaring "Case escalated" closed on the generic `Flow "…" completed`. The
 * same action whose run did not pause got its own message from the action
 * runner, so the copy a user read depended on whether the flow happened to
 * ask for input.
 *
 * So the launch host hands the action's message over with the run
 * (`ScreenFlowState.actionSuccessMessage`), and the terminal-success toast
 * reads, in order: that message, the flow's own `successMessage`, the
 * catalog's flow-completed sentence. The action's copy wins over the flow's
 * for the reason above — it is what the same click shows when the run does
 * not pause. It is handed over already localized: every surface that
 * dispatches a declared action runs it through `useActionTextLocalizer`
 * first, and the handler receives that copy, so there is no second
 * localization step here. Nothing else moves: the pause stays silent, an
 * intermediate step still toasts `flowRunner.nextStep`, and a `refused` or
 * failed end still shows no success toast.
 *
 * The order of the first two is not this file's: it is `flowSuccessCopy` in
 * `utils/flowResponse`, which a run that goes straight through follows too
 * (objectui#12274). This file adds only its own default, the catalog's
 * sentence.
 *
 * ## The AUTHOR's copy is localized; the chrome is not (objectui#5920, objectui#12075)
 *
 * A screen's heading, its body text, each field's copy and each option's
 * label, and the flow's own completion and failure toasts are the flow
 * author's words; an app's translation bundle carries them under `flows.FLOW`
 * (`TranslationData.flows`, the vocabulary objectstack#7646 declared and
 * objectstack#22507 extended). Who translates each is the spec's ruling:
 *
 * - **The heading and the body text are served already translated.** Both
 *   are `{{ }}` templates the engine renders per run, so it picks the
 *   translated template in the run's locale before it fills the holes
 *   (maintainer ruling A on objectstack#22507: "a client overlay never
 *   touches a server-rendered slot"). This dialog draws `ScreenSpec.title`
 *   and `ScreenSpec.description` exactly as served, and overlays neither —
 *   an overlay here would put the raw translated template back, holes drawn
 *   literally.
 * - **Each field's copy and option labels are overlaid here.** The server
 *   forwards a field verbatim, and the client already holds both addresses,
 *   `ScreenSpec.nodeId` and `ScreenFieldSpec.name` (why objectstack#11287
 *   picked the client side). The per-field overlay walks the spec's
 *   `FLOW_SCREEN_FIELD_COPY_KEYS` (`label`, `placeholder`, `inlineHelpText`
 *   today) — imported, never retyped, so a key the spec adds or drops reaches
 *   this dialog without an edit here — and a field's `options` go through the
 *   spec's `resolveFlowScreenFieldOptions`, each option addressed by its value
 *   read as text. Every key, and every option, falls back to the authored
 *   string on its own.
 * - **The flow's own toasts** — `FlowSchema.successMessage` and
 *   `errorMessage`, served verbatim on the run result — are translated by
 *   `interpretFlowResponse` (`utils/flowResponse`), handed this run's flow and
 *   bundle, so the resume and both launch hosts answer the same words.
 *
 * WHERE the bundle comes from is the channel the console already has:
 * `activeFlowsBundle` (`utils/flowsBundle`) reads the `flows` group back out
 * of the i18next resource tree the provider loaded, for the active language.
 * There is no second loader.
 *
 * Deliberately NOT localized here: the runner chrome (Cancel / Submit /
 * Submitting… / the terminal toast's default sentence) — the console's own
 * words, ruled into its message catalog (objectstack#7646). The flow NAME
 * inside that sentence is not chrome; see the objectui#11092 section below.
 *
 * ## The flow is named by its label, in the user's language (objectui#11092)
 *
 * The runner used to name the flow only by its API name, and only in the
 * completion toast. Every answer that evaluated the flow now carries the
 * flow's authored label (`AutomationResult.flowLabel`, objectstack#20633),
 * lifted once by `interpretFlowResponse` and handed in on
 * {@link ScreenFlowState}; a resume answer that pauses again replaces it. The
 * name the user reads resolves as: the active language's `flows.<flow>.label`,
 * then the served `flowLabel`, then the API name (an answer from a backend
 * that serves no label). The first two steps are the spec's `translateFlow`,
 * read from the same bundle the screen copy above is, so the address is the
 * spec's and there is still no second loader.
 *
 * It is drawn in two places: a line above the screen heading in the dialog
 * header (the heading stays the step's own title, and stays the dialog's
 * accessible name), and the completion toast, in place of the API name.
 *
 * Chrome goes through `@object-ui/i18n` (via the `@object-ui/react` re-export)
 * like its neighbours; the only English left in this file is the inline
 * `defaultValue` each key carries, which `check:i18n-keys` pins to its `en`
 * value. The server's own refusal sentence is passed through untranslated by
 * design — it is prose the backend composed, not a string with a key.
 *
 * ## A long screen still reaches its Submit (objectui#12080)
 *
 * The dialog is height-bounded on every screen, not only on an `object-form`
 * step: at most `90vh` tall, with the header (and any notice under it) on top,
 * the screen body in the ONE scrolling region, and the footer below it. The
 * upstream `DialogContent` has no height bound, so a flat screen taller than
 * the window used to overflow both edges of a fixed, scroll-locked overlay —
 * the heading above the top, Submit below the bottom, and nothing a mouse
 * wheel could move. Keeping the footer OUTSIDE the scrolling region is what
 * keeps Submit on screen however long the screen is.
 *
 * Width follows the screen's length, not a layout key: no spec key asks for
 * one, and the renderer can size by content. A flat screen declaring more
 * than {@link NARROW_SCREEN_MAX_FIELDS} fields gets the `object-form` step's
 * wider dialog and two columns from `sm` up; a shorter one keeps the narrow
 * single column it always had. The count is the DECLARED one, so a field a
 * `visibleWhen` reveals mid-edit never makes the dialog jump width.
 * `ActionParamDialog` takes the same bound for a long `params` list.
 */
import { Suspense, useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DIALOG_VIEWPORT_GUTTER,
  Button,
  cn,
} from '@object-ui/components';
import { notifyDataChanged, useObjectTranslation } from '@object-ui/react';
import type { ActionCopyTemplate } from '@object-ui/core';
import {
  FLOW_SCREEN_FIELD_COPY_KEYS,
  resolveFlowScreenFieldOptions,
  translateFlow,
  type TranslationBundle,
} from '@objectstack/spec/system';
import type { AutomationResult } from '@objectstack/spec/contracts';
import { toast } from 'sonner';
import {
  ScreenView,
  isObjectFormScreen,
  initialScreenValues,
  screenFieldBoundViolations,
  screenFields,
  visibleScreenFields,
  type ScreenFieldSpec,
  type ScreenSpec,
} from './ScreenView.js';
import { flowSuccessCopy, interpretFlowResponse } from '../utils/flowResponse.js';
import { activeFlowsBundle, type FlowsTranslation } from '../utils/flowsBundle.js';

export type { ScreenSpec, ScreenFieldSpec } from './ScreenView.js';

/**
 * The most declared fields a flat screen keeps the narrow single-column dialog
 * for; a longer one gets the wide two-column dialog (objectui#12080 — see the
 * header). Eight is the most single-line fields the narrow column was
 * measured to show whole, with no scrolling, inside the `90vh` bound on a
 * 1440×900 window — a reading taken once in Chromium for objectui#12080 and
 * recorded on its pull request; nothing here re-derives it.
 */
const NARROW_SCREEN_MAX_FIELDS = 8;

/** The per-field copy node, `flows.<flow>.screens.<node_id>.fields.<field_name>`. */
type FlowScreenFieldTranslation = NonNullable<
  NonNullable<NonNullable<FlowsTranslation[string]['screens']>[string]['fields']>[string]
>;

/** One field with the spec's per-field copy keys overlaid, each key falling back to the authored value. */
function overlayFieldCopy(field: ScreenFieldSpec, copy: FlowScreenFieldTranslation | undefined): ScreenFieldSpec {
  if (!copy) return field;
  let next = field;
  for (const key of FLOW_SCREEN_FIELD_COPY_KEYS) {
    const translated = copy[key];
    if (typeof translated === 'string' && translated.length > 0) next = { ...next, [key]: translated };
  }
  return next;
}

/**
 * One field's option labels through the spec's `resolveFlowScreenFieldOptions`
 * (objectui#12075), each option addressed by its value read as text and
 * falling back to its authored label. The field comes back as-is when the
 * resolver answers the same array, its "nothing resolved" signal.
 */
function overlayFieldOptions(
  field: ScreenFieldSpec,
  flowName: string,
  nodeId: string,
  bundle: TranslationBundle,
  language: string,
): ScreenFieldSpec {
  // Handed the two members it reads: the served `ScreenFieldSpec` is an
  // interface, so it does not meet the resolver's open `FlowScreenFieldLike`.
  const options = resolveFlowScreenFieldOptions(
    bundle,
    flowName,
    nodeId,
    { name: field.name, options: field.options },
    { locale: language },
  );
  if (options === field.options) return field;
  // The resolver copies each served option and replaces only its `label` with
  // a string, so the answer has the served shape.
  return { ...field, options: options as ScreenFieldSpec['options'] };
}

/**
 * The screen as the user should read it: each field's copy through
 * `FLOW_SCREEN_FIELD_COPY_KEYS` and its option labels through
 * `resolveFlowScreenFieldOptions`. The heading and the body text are drawn as
 * served — the engine already translated them (objectstack#22507 ruling A, see
 * the header) — and everything else is the payload, untouched. With no bundle
 * the input comes back as-is.
 */
function localizeScreen(
  screen: ScreenSpec,
  flowName: string,
  bundle: TranslationBundle | undefined,
  language: string,
): ScreenSpec {
  if (!bundle || !Array.isArray(screen.fields)) return screen;
  const fieldCopy = bundle[language]?.flows?.[flowName]?.screens?.[screen.nodeId]?.fields;
  const fields = screen.fields.map((field) =>
    overlayFieldOptions(overlayFieldCopy(field, fieldCopy?.[field.name]), flowName, screen.nodeId, bundle, language),
  );
  return { ...screen, fields };
}

/**
 * The name the user reads for the flow (objectui#11092 — see the header): the
 * active language's `flows.<flow>.label`, then the served `flowLabel`, then
 * `flowName`. `translateFlow` takes the first two steps: handed the served
 * label as the authored one, it answers the bundle's string where the bundle
 * has one and that label otherwise.
 */
function displayFlowLabel(
  flowName: string,
  flowLabel: string | undefined,
  bundle: TranslationBundle | undefined,
  language: string,
): string {
  return translateFlow({ name: flowName, label: flowLabel }, bundle, { locale: language }).label || flowName;
}

/**
 * The paused run a host opens the runner on. `flowLabel` is the flow's
 * authored label exactly as the trigger answer served it
 * (`AutomationResult.flowLabel`), absent when the answer carried none; the
 * runner localizes it (see the header).
 */
export interface ScreenFlowState extends Pick<AutomationResult, 'flowLabel'> {
  flowName: string;
  runId: string;
  screen: ScreenSpec;
  /**
   * The `successMessage` the ACTION that launched this run declares, exactly
   * as that action reached the host's flow handler — so already localized by
   * the surface that dispatched it, and the same value the action runner
   * toasts when the run completes without pausing (objectui#12234 — see the
   * header). Absent when no action launched the run or the action declares
   * none; the runner then keeps the flow-completed toast it always had.
   * A string or the `template` envelope (objectui#13367), read by
   * `flowSuccessCopy`.
   */
  actionSuccessMessage?: ActionCopyTemplate;
}

/**
 * A refused resume, held so the dialog can show it beside the input that
 * produced it. `retryable` is `interpretFlowResponse`'s verdict, forwarded
 * unchanged: `false` means the suspension is gone and no resubmit of this run
 * can succeed, so the submit affordance is withdrawn (see the header note).
 */
interface ResumeError {
  message: string;
  retryable: boolean;
}

/**
 * A run that ended with `outcome: 'refused'`, held so the dialog can render it
 * as a notice (objectui#7707). Kept SEPARATE from {@link ResumeError} rather
 * than reusing it with `retryable: false`, because the two are different events
 * that happen to share a disposition: a failure is something that went wrong
 * and reads as `destructive` with an error toast, while a refusal is the flow
 * working — a successful evaluation that said no. Collapsing them would make
 * the renderer unable to tell them apart again.
 *
 * `message` is the sentence the ENGINE rendered (the `end` node's `{token}`
 * template interpolated against the run's variables, so it names the record);
 * it is passed through untranslated for the same reason the server's refusal
 * sentence above is — it is data, not copy with a key.
 */
interface RefusedOutcome {
  message: string;
}

export interface FlowRunnerProps {
  /** The paused screen-flow to drive, or `null` when closed. */
  state: ScreenFlowState | null;
  /** Authenticated fetch (shared with the host view). */
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** API base (e.g. `import.meta.env.VITE_SERVER_URL || ''`). */
  baseUrl: string;
  /** User dismissed the runner without completing. */
  onClose: () => void;
  /** The flow ran to completion — host should refresh. */
  onComplete: () => void;
  /**
   * Data source — required to render `object-form` wizard steps. ObjectForm
   * fetches the object schema and persists (incl. atomic master-detail batch)
   * through this adapter.
   */
  dataSource?: any;
  /**
   * Object definitions — used to derive an `object-form` step's inline
   * master-detail `subforms` (mirrors RecordFormPage's create form).
   */
  objects?: any[];
}

export function FlowRunner({ state, authFetch, baseUrl, onClose, onComplete, dataSource, objects }: FlowRunnerProps) {
  const { t, i18n, language } = useObjectTranslation();
  const [screen, setScreen] = useState<ScreenSpec | null>(null);
  const [runId, setRunId] = useState('');
  const [flowName, setFlowName] = useState('');
  const [flowLabel, setFlowLabel] = useState<ScreenFlowState['flowLabel']>(undefined);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [resumeError, setResumeError] = useState<ResumeError | null>(null);
  const [refused, setRefused] = useState<RefusedOutcome | null>(null);

  useEffect(() => {
    if (state) {
      setScreen(state.screen);
      setRunId(state.runId);
      setFlowName(state.flowName);
      setFlowLabel(state.flowLabel);
      setValues(initialScreenValues(state.screen));
      // A fresh run must not open under the previous run's refusal.
      setResumeError(null);
      setRefused(null);
    }
  }, [state]);

  if (!state || !screen) return null;

  // The copy the user reads (objectui#5920 — see the header). Recomputed on
  // every render rather than memoised: it is a handful of property reads, and
  // it follows the live resource tree and a language switch with no identity
  // to keep stable (AGENTS.md §5 #10). `screen` stays the payload the run is
  // driven by; `shown` differs from it in copy only, so every DISPLAY read —
  // including the names in the missing-fields toast below — goes through it.
  const bundle = activeFlowsBundle(i18n, language, flowName);
  const shown = localizeScreen(screen, flowName, bundle, language);
  // The flow's name as the user reads it (objectui#11092), from the same bundle.
  const shownFlowLabel = displayFlowLabel(flowName, flowLabel, bundle, language);

  const setVal = (name: string, v: unknown) => {
    setValues((p) => ({ ...p, [name]: v }));
    // Editing is the start of a retry, so the banner it answers goes — but only
    // where a retry exists. A terminal refusal must stay on screen: its whole
    // job is to explain why the (now absent) Submit is not coming back.
    setResumeError((e) => (e && e.retryable ? null : e));
  };

  // Resume the paused run with `inputs` (applied as bare flow variables) and
  // advance: render the next screen (multi-step wizard) or finish + refresh.
  // Shared by the flat-field submit and the object-form save callback.
  const resumeWith = async (inputs: Record<string, unknown>): Promise<void> => {
    const res = await authFetch(
      `${baseUrl}/api/v1/automation/${encodeURIComponent(flowName)}/runs/${encodeURIComponent(runId)}/resume`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs }) },
    );
    const json = await res.json().catch(() => null);
    // Shared with the two flow-LAUNCH handlers (useConsoleActionRuntime,
    // RecordDetailView) so the resume path and the launch path can never again
    // disagree about what a failure looks like — they did, and the launch
    // copies reported failures as success (#2958). `outcome.error` is always a
    // STRING: handing the nested `{code, message}` object to `toast.error()`
    // renders nothing at best and crashes the page as a React child (React
    // #31). See utils/flowResponse.
    // Handed this run's flow and bundle, it also answers the flow's own
    // `successMessage` / `errorMessage` in the active language (objectui#12075
    // — see the header).
    const outcome = interpretFlowResponse<ScreenSpec>(res, json, 'Resume', { flowName, bundle, locale: language });
    if (outcome.kind === 'failed') {
      // Two carriers on purpose (`c40f3b8ca`): the toast is the console's
      // viewport-fixed failure idiom; the inline Alert stays in the dialog,
      // above the scrolling body, with the values that caused it.
      toast.error(outcome.error);
      setResumeError({ message: outcome.error, retryable: outcome.retryable });
      return;
    }
    setResumeError(null);
    // The run reached an `end` node declaring `outcome: 'refused'` — a
    // successful evaluation that said no (objectstack#14945, ruling of
    // 2026-09-05). Checked BEFORE the terminal-success tail below, which is
    // where it used to land: the refusal was swallowed and the user who had
    // just been told "this is refused" got `Flow "…" completed`.
    //
    // Three things deliberately do NOT happen here, and each is the ruling:
    // no toast (neither the completion one this replaces nor an error one —
    // nothing failed), no `notifyDataChanged` / `onComplete` (the run did not
    // complete; the host is not told to treat its data as stale), and no
    // close (the notice is the whole point, so it stays up until the user
    // dismisses it).
    if (outcome.kind === 'refused') {
      setRefused({ message: outcome.message });
      return;
    }
    if (outcome.kind === 'paused') {
      setScreen(outcome.screen);
      setRunId(outcome.runId || runId);
      setFlowLabel(outcome.flowLabel);
      setValues(initialScreenValues(outcome.screen));
      toast.success(t('flowRunner.nextStep', { defaultValue: 'Saved — next step' }));
    } else {
      // Terminal success — the invoking action's own `successMessage` first
      // (objectui#12234 — see the header), then the flow's declared completion
      // message, already translated against `flows.FLOW.successMessage` by
      // `interpretFlowResponse` (objectui#12075), by the one precedence a
      // straight-through run follows too (objectui#12274); else the catalog's
      // sentence naming the flow by the label this answer served.
      toast.success(
        flowSuccessCopy(state.actionSuccessMessage, outcome.successMessage)?.text
          || t('flowRunner.completed', {
            flow: displayFlowLabel(flowName, outcome.flowLabel, bundle, language),
            defaultValue: 'Flow "{{flow}}" completed',
          }),
      );
      // The flow may have written ANY object — a quote created from an
      // Opportunity page lands in a related list this component cannot name.
      // See the header note on why the scope is `'*'` and not the host record.
      notifyDataChanged({ objectName: '*' });
      onComplete();
    }
  };

  const submit = async () => {
    // Enforce `required` over the fields ACTUALLY ON SCREEN, not the whole
    // declared list. A `visibleWhen` field that is required *when shown* is not
    // required while hidden — the user was never asked for it, and the flow is
    // not waiting on it. Validating the full list here is what dead-ended
    // objectstack-ai/objectstack#3528: HotCRM's lead conversion declares `opportunityName` required with
    // `visibleWhen: createOpportunity == true`, so leaving the checkbox
    // unticked blocked Submit on an input that was not on screen, and the run
    // sat paused with no resume request ever issued.
    const missing = visibleScreenFields(shown, values).filter(
      (f) => f.required && (values[f.name] === undefined || values[f.name] === '' || values[f.name] === null),
    );
    if (missing.length) {
      toast.error(
        t('wizard.missingRequired', {
          fields: missing.map((f) => f.label || f.name).join(', '),
          defaultValue: 'Please complete the required fields: {{fields}}',
        }),
      );
      return;
    }
    // The declared `min` / `max` (objectstack#17306), refused here naming the
    // field, beside `required` and over the same on-screen list. A courtesy,
    // not the enforcement: the engine re-checks the bounds on resume, and
    // `screenFieldBoundViolations` applies its comparison — inclusive, a
    // present number only, so an empty optional field is never refused.
    const outOfBounds = screenFieldBoundViolations(shown, values);
    if (outOfBounds.length) {
      toast.error(
        outOfBounds
          .map(({ field, bound, limit }) => {
            const label = field.label || field.name;
            return bound === 'min'
              ? t('validation.min', { field: label, min: limit, defaultValue: '{{field}} must be at least {{min}}' })
              : t('validation.max', { field: label, max: limit, defaultValue: '{{field}} must be at most {{max}}' });
          })
          .join(t('validation.formInvalidJoiner', { defaultValue: ', ' })),
      );
      return;
    }
    setSubmitting(true);
    try {
      await resumeWith(values);
    } catch (err) {
      // The request never produced a response (network / abort), so the
      // suspension was not consumed — this one IS retryable.
      const message = (err as Error).message;
      toast.error(message);
      setResumeError({ message, retryable: true });
    } finally {
      setSubmitting(false);
    }
  };

  // Object-form step: ObjectForm has already persisted the record (and its
  // children, atomically). Resume the run with the new record's id bound to the
  // step's `idVariable` so later steps can reference it (e.g. the Opportunity
  // form's `account` FK = the Customer step's new id).
  const onObjectFormSaved = async (saved: any) => {
    const id = saved?.id ?? saved?.data?.id ?? saved?.record?.id;
    const inputs = screen.idVariable && id != null ? { [screen.idVariable]: id } : {};
    setSubmitting(true);
    try {
      await resumeWith(inputs);
    } catch (err) {
      const message = (err as Error).message;
      toast.error(message);
      setResumeError({ message, retryable: true });
    } finally {
      setSubmitting(false);
    }
  };

  const isObjectForm = isObjectFormScreen(screen);
  // The run is gone: this dialog can still be read and copied from, but nothing
  // in it may offer to resubmit. See the header note. A refusal reaches the same
  // disposition by the other route — the run ended, deliberately, and a refused
  // end is never resumed — so it shares this flag rather than a parallel one:
  // withdrawing the submit affordance is one behaviour with two causes, and
  // splitting it is how the `object-form` arm of it gets forgotten.
  const terminal = refused !== null || (resumeError !== null && !resumeError.retryable);
  // A refused end shows its message alone (objectui#13342 — see the header):
  // the screen it paused on is not drawn under it. Narrower than `terminal` on
  // purpose — a terminal failure keeps the screen and the values it explains.
  const showScreenBody = refused === null;
  // A long flat screen widens to two columns (objectui#12080 — see the header).
  const isLongScreen = !isObjectForm && screenFields(screen).length > NARROW_SCREEN_MAX_FIELDS;
  const isWide = showScreenBody && (isObjectForm || isLongScreen);

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      {/* Bounded on every screen (objectui#12080): a flex column at most 90vh
          tall, in which only the body below can give up height (`min-h-0`)
          and scroll, so the header and the footer always stay on screen. */}
      <DialogContent
        className={cn('flex max-h-[90vh] flex-col', isWide ? `sm:max-w-3xl ${DIALOG_VIEWPORT_GUTTER}` : 'sm:max-w-md')}
      >
        <DialogHeader>
          {/* The flow being run (objectui#11092), above the step's own heading,
              which stays the dialog's title. */}
          <p className="text-xs font-medium text-muted-foreground">{shownFlowLabel}</p>
          <DialogTitle>{shown.title || t('flowRunner.title', { defaultValue: 'Input' })}</DialogTitle>
          {/* Heading and body text are drawn as served: the engine already
              translated both in the run's locale (objectstack#22507 ruling A,
              see the header), so neither is overlaid here. */}
          {shown.description && <DialogDescription>{shown.description}</DialogDescription>}
        </DialogHeader>

        {refused && refused.message && (
          // `default`, not `destructive`: a refusal is the flow working. The
          // sentence is the engine's, rendered per-record from the `end` node's
          // template, and is passed through verbatim and untranslated — data,
          // not copy with a key, exactly like the server sentence below.
          <Alert>
            <AlertDescription>{refused.message}</AlertDescription>
          </Alert>
        )}

        {resumeError && (
          <Alert variant="destructive">
            {/* The server composed this sentence for a human — ADR-0112
                `error.message` is already user-grade prose ("Node 'create_quote'
                failed: … at most 2 decimal places"). It is passed through
                verbatim and untranslated: it is data, not copy with a key. */}
            <AlertDescription>{resumeError.message}</AlertDescription>
          </Alert>
        )}

        {/* The ONE scrolling region (objectui#12080). `-mx-6 px-6` runs it to
            the dialog's edges, so the scrollbar sits on the border and a
            control's focus ring is not clipped at the sides. */}
        {showScreenBody && (
          <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6" data-testid="flow-screen-body">
            {/* The screen body pulls in lazily-loaded chunks (an `object-form` step
                mounts ObjectForm, whose field widgets are lazy). Without a boundary
                HERE, that suspension unwinds to the host's nearest <Suspense> — a
                route-level one on some surfaces — which swaps the whole page for a
                fallback and destroys the host's state, taking this dialog (and the
                run it is driving) with it. */}
            <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">{t('common.loading', { defaultValue: 'Loading…' })}</div>}>
              <ScreenView
                screen={shown}
                values={values}
                onValueChange={setVal}
                dataSource={dataSource}
                objects={objects}
                // Two columns from `sm` up; `space-y-0` replaces the body's own
                // stack spacing, which would offset every grid cell but the last.
                className={isLongScreen ? 'grid gap-4 space-y-0 sm:grid-cols-2' : undefined}
                objectForm={{
                  onSuccess: onObjectFormSaved,
                  onCancel: onClose,
                  // Withdrawn once the run is gone: the record this step created was
                  // already persisted, so a second Save would duplicate it AND still
                  // have no suspension to resume.
                  showSubmit: !terminal,
                  showCancel: true,
                  submitText: t('flowRunner.saveAndContinue', { defaultValue: 'Save & Continue' }),
                  cancelText: terminal
                    ? t('common.close', { defaultValue: 'Close' })
                    : t('common.cancel', { defaultValue: 'Cancel' }),
                }}
              />
            </Suspense>
          </div>
        )}

        {/* An `object-form` step brings its own button bar inside the body, so
            the runner's footer is drawn there only once that body is gone. */}
        {(!isObjectForm || !showScreenBody) && (
          <DialogFooter>
            {terminal ? (
              <Button variant="outline" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose} disabled={submitting}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
                <Button onClick={submit} disabled={submitting}>
                  {submitting
                    ? t('flowRunner.submitting', { defaultValue: 'Submitting…' })
                    : t('common.submit', { defaultValue: 'Submit' })}
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
