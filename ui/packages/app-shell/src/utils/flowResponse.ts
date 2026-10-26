/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The ONE place the console interprets a flow `trigger` / `resume` response.
 *
 * This is the `/actions` story again (see {@link ./actionResponse}), on the
 * automation route: the rule lived in THREE hand-rolled copies — the flow
 * handlers in `useConsoleActionRuntime` and `RecordDetailView`, plus
 * `FlowRunner`'s resume — and only the third one was complete. The two launch
 * copies checked the transport envelope and then treated *everything else* as
 * terminal success, so a flow that failed on its first node was
 * indistinguishable from one that ran to completion: no dialog, a green
 * "completed successfully" toast, and a refresh (#2958).
 *
 * ## The response wraps once, and failure has three shapes
 *
 * ```
 * {                        ← transport envelope
 *   success: true,
 *   data: {                ← AutomationResult (spec: contracts/automation-service)
 *     success: boolean,    ← required; FALSE when the run failed
 *     status?: 'completed' | 'paused' | 'failed',
 *     runId?, screen?,     ← set when paused at a `screen` node
 *     error?, errorMessage?, successMessage?,
 *     flowLabel?           ← the flow's authored label (see below)
 *   }
 * }
 * ```
 *
 * - **transport failure** — `!res.ok`, or the outer `success: false`. The run
 *   may never have started; nothing was consumed.
 * - **flow failure** — the run started and failed. HTTP **200**, outer
 *   `success: true`, and `data.success === false` (or `status: 'failed'`).
 *   `res.ok` is TRUE, so only the inner envelope shows it. This is the one the
 *   launch handlers missed.
 * - **paused** — suspended at a `screen` node awaiting input. NOT a failure:
 *   the engine always stamps `success: true` alongside `status: 'paused'`
 *   (service-automation `engine.ts`), which is why failure can be classified
 *   before pausing without swallowing a wizard.
 *
 * Callers get one more thing out of routing through here: `error` is always a
 * STRING. Handing a `{code, message}` object to `toast.error()` puts an object
 * where React expects a child and crashes the page (React #31) — the same trap
 * `actionErrorDetail` exists for.
 *
 * ## A failed run does NOT always arrive as HTTP 200 (`833c90047`)
 *
 * The three shapes above describe the route as it answers today. objectstack#8684
 * unifies the resume route onto real status codes — inheriting the objectstack-ai/objectstack#3962 ruling
 * that business failures must not ride HTTP 200 inside a double envelope — so the
 * SAME terminal node failure that answers `200 {data:{success:false}}` today will
 * answer `400` + `FLOW_FAILED` once that lands, in the ADR-0112 error envelope:
 *
 * ```
 * { success: false, error: { code, message, httpStatus, details? } }
 * ```
 *
 * That moves a terminal failure into the `!res.ok` branch, which is the
 * TRANSPORT branch — and the two are not interchangeable, because `retryable`
 * is what `FlowRunner` uses to decide whether to keep the wizard open. A
 * terminal failure classified as transport leaves the dialog open offering a
 * retry that is *guaranteed* to fail: the engine consumes the suspension before
 * running downstream nodes (resume-once), so the retry can only reach "No
 * suspended run". Hence the two non-retryable arms below, both keyed on what is
 * already on the wire rather than on which caller invoked us:
 *
 * - **400 + `FLOW_FAILED`** — the flow RAN and failed. Terminal. Only this code
 *   qualifies: the other 400s on this route (`INVALID_SIGNAL`,
 *   `INVALID_SCREEN_INPUT`) are refused by the engine *before* the signal
 *   reaches the variable map, so the suspension survives and a corrected
 *   resubmit is meaningful — they stay retryable, and that distinction is the
 *   whole point of the flag.
 * - **404** — there is no such run (or no such flow). Terminal for a different
 *   reason: not "your submission was rejected" but "there is nothing to submit
 *   to". Unlike the branch above this one is NOT dormant — the route already
 *   answers `404 No such suspended run` today (`RUN_NOT_FOUND`), and every one
 *   of those has been keeping the wizard open for a retry that can only 404
 *   again. Keyed on the STATUS alone, deliberately: a 404 from a proxy or an
 *   unmounted route carries no envelope to read a code out of, and the user's
 *   disposition must not depend on whether a body parsed.
 *
 * Landing this BEFORE the backend flip is the ruling's explicit sequencing
 * (objectstack#8684, maintainer ruling of 2026-08-15, sub-decision 3). It is
 * forward-compatible: nothing sends `400 FLOW_FAILED` on this route yet, so that
 * arm is simply dormant until it does.
 *
 * ## A terminal run is not always a COMPLETED one (objectui#7707)
 *
 * `status: 'refused'` names the run that reached an `end` node declaring
 * `outcome: 'refused'` — the maintainer ruling on objectstack#14945, whose
 * contract half is on the installed `@objectstack/spec` surface. It is a
 * successful evaluation that said no: `success` stays `true`, `successMessage`
 * is NOT set, and the authored reason is rendered per-record into
 * `refusalMessage`. Terminal exactly like `completed`, and distinct from
 * `failed` on purpose — nothing threw.
 *
 * It therefore gets its OWN kind rather than folding into either neighbour.
 * Folded into `failed` it would render as an error (destructive banner, error
 * toast) for a flow that worked; left in `done` — which is where it landed
 * before this arm existed — a runner toasts `Flow "…" completed` at a user who
 * was just told the run was refused, which is the reported defect.
 *
 * ⚠️ **The authorable `errorMessage` needs a slot on the wire.** A flow declares
 * `errorMessage` so the user sees its words instead of an engine string, and the
 * 200-path failure prefers it (`flowFailureMessage`). The error envelope has no
 * `data`, so the producer must carry it in `error.details` — the envelope's own
 * declared carrier for structured extras, and the only one that survives to the
 * wire (`splitSemanticCode` promotes `details.code` to `error.code` and keeps
 * the rest). That is the single location read below; there is deliberately no
 * alias chain hunting for it elsewhere (commandment #0.1 — one strict contract
 * beats N dialects). If it is absent the message degrades to the envelope's own
 * `error.message`, never to silence.
 *
 * ## A refusal met inside the run reads like the same refusal on a save (objectstack#24914)
 *
 * `message` names node ids and object API names, in English: a duplicate met
 * by a `create_record` node read `Node 'create_account' failed:
 * create_record(crm_account) failed: …`. Ruling B′ gave the run the record
 * save's two carriers — the producer-marked `userMessage` (the envelope's top
 * level on a 400, `AutomationResult.userMessage` on a 200) and `innerRefusal`
 * (`error.details` on a 400, the run's own member on a 200: the node's refusal
 * in its wire `code`, `message` already without the prefixes). Both failure
 * arms read them through {@link flowFailureMessage}, between the authored
 * `errorMessage` and `message`, and render the inner refusal by the record
 * form's rule. `message` itself is untouched on the wire.
 *
 * ## A LAUNCH is judged here too, not just interpreted (objectui#9973)
 *
 * Classifying the response was never the whole rule. The two launch handlers
 * also have to decide what happens NEXT: what the ActionRunner is told, which
 * follow-up surface opens, and whether the host's data is stale. They held two
 * hand-rolled copies of that decision, both branching on `failed` and `paused`
 * only, so a run that ended `refused` WITHOUT pausing at a screen fell into
 * their terminal-success tail. The action toasted its `successMessage`, the
 * view refreshed, and the authored refusal was never shown — the
 * objectstack#14945 ruling (Close only, no completion toast) broken on the one
 * route `FlowRunner` never sees. {@link judgeFlowLaunch} is that decision,
 * once, so the next change cannot land in only one of the two hosts.
 *
 * ## The flow's label is lifted here, once (objectui#11092)
 *
 * Every 200 that evaluated a registered flow carries `flowLabel`, the flow
 * definition's authored label (`AutomationResult.flowLabel`, objectstack#20633).
 * `FlowRunner` names the flow by it, so it has to reach the runner from both
 * launch hosts and from the runner's own resume. It is read in ONE place,
 * {@link servedFlowLabel}, and carried on the `paused` and `done` arms and on
 * the `screen` follow-up, typed by the contract rather than by a local copy.
 * The `refused` arm does not carry it: nothing that arm opens names the flow
 * (the launch notice is titled with the action's own label).
 *
 * ## A run's success copy has ONE precedence, however the run ends (objectui#12274)
 *
 * A run that pauses on a screen completes in `FlowRunner`, whose terminal toast
 * reads the invoking action's `successMessage`, then the flow's own
 * `successMessage`, then the catalog's flow-completed sentence (objectui#12234).
 * A run that goes straight through completes HERE, and the `done` arm used to
 * hand the ActionRunner a plain success. The runner's toast has rungs for the
 * action's copy and for its own default text, and none for the flow's — so a
 * flow's `successMessage` was read only when the run happened to pause, though
 * the spec carries it on `AutomationResult` for every terminal run, not only
 * screen runs (`FlowSchema.successMessage`).
 *
 * {@link flowSuccessCopy} is that precedence, once: `FlowRunner`'s terminal
 * toast and {@link judgeFlowLaunch}'s `done` arm both call it, and neither
 * restates it. On the launch side the answer decides who SPEAKS the toast:
 *
 * - the action's copy wins — the ActionRunner speaks it, exactly as before,
 *   through its own rung (which also fills `${result.*}`). Its `outcomeMessages`
 *   rung cannot fire on a flow answer: the spec refuses `outcomeMessages` on a
 *   `type: 'flow'` action, and `AutomationResult` declares no `outcome`;
 * - the flow's copy wins — the runner has no rung for it, so the result is
 *   `silent` (the runner adds no second, generic toast) and the judgement
 *   carries the copy as `successToast`, which `launchConsoleFlow` speaks;
 * - neither — the runner speaks its default text, as before.
 *
 * Each end keeps its own default sentence: the runner's on a straight-through
 * run, the flow-completed sentence on a paused one. Only the author's copy is
 * shared. A `refused` or failed run never reaches a `done` arm, so neither
 * shows a success toast on either end.
 *
 * ## A flow action's post-success hop follows a COMPLETED run (objectstack#25800)
 *
 * The spec admits `onSuccess` beside a `type: 'flow'` action, and the
 * ActionRunner performs that hop after a success, reading `${result.*}` off the
 * result's `data`. On a launch only the `done` arm completes the action: its
 * `data` is the run's `AutomationResult`, whose `output` carries the flow's
 * `isOutput` variables, so `${result.output.VAR}` resolves. The `paused` and
 * `refused` arms answer success too, and the runner cannot tell them apart from
 * a completion by `silent` — that flag is about the toast, and a `done` run
 * whose copy is the flow's own is `silent` as well. So {@link judgeFlowLaunch}
 * marks those two `handedOff`, the member the runner reads to skip the hop.
 *
 * ## The flow's own toasts are translated here, once (objectui#12075)
 *
 * The engine serves the flow's `successMessage` and `errorMessage` verbatim,
 * in the author's language, and an app's bundle translates them under
 * `flows.FLOW.successMessage` / `flows.FLOW.errorMessage` (objectstack#22507,
 * `FLOW_TERMINAL_MESSAGE_KEYS`). {@link interpretFlowResponse} is the one
 * place both are lifted off the wire, so it is the one place they are
 * translated: handed a {@link FlowCopyLocale} — the flow the run belongs to,
 * the active `flows` bundle and its locale — it answers the `done` arm's
 * `successMessage` and the `failed` arm's authored `errorMessage` through the
 * spec's `translateFlow`, each falling back to the served string. That reaches
 * `FlowRunner`'s resume and both launch hosts (through `launchConsoleFlow`)
 * alike, so a straight-through run and a paused one close on the same words.
 *
 * Only what the flow AUTHORS is translated: `translateFlow` overlays a toast
 * only where the served result carries one, so a bundle never turns a
 * caller's default sentence into copy the author never wrote, and the engine's
 * own failure prose (`error`) is passed through untouched — it has no key.
 */

import { actionCopySource, actionErrorDetail } from '@object-ui/core';
import type { ActionResult } from '@object-ui/core';
import { getLoadedBuiltInLocales } from '@object-ui/i18n';
import { declaredUserMessage, isPermissionError } from '@object-ui/react';
import { errorCodeIs } from '@object-ui/types';
import type { AutomationResult } from '@objectstack/spec/contracts';
import { translateFlow, type TranslationBundle } from '@objectstack/spec/system';

/**
 * What {@link interpretFlowResponse} needs to translate the flow's own toasts
 * (objectui#12075 — see the header): the flow the run belongs to, the active
 * language's `flows` bundle (`activeFlowsBundle` in `utils/flowsBundle`), and
 * that language.
 */
export interface FlowCopyLocale {
    flowName: string;
    bundle: TranslationBundle | undefined;
    locale: string;
}

/**
 * One of the flow's terminal toasts as the user should read it: the bundle's
 * `flows.FLOW.KEY` where it carries one, the served string otherwise. Asked
 * of the spec's `translateFlow`, which overlays only a string the flow serves.
 */
function translatedFlowMessage(
    key: 'successMessage' | 'errorMessage',
    served: string,
    copy: FlowCopyLocale | undefined,
): string {
    if (!copy) return served;
    const answered = translateFlow({ name: copy.flowName, [key]: served }, copy.bundle, { locale: copy.locale })[key];
    // `translateFlow` answers the served string back when the bundle has no
    // key; the type says optional only because `FlowLike` declares it so.
    return typeof answered === 'string' ? answered : served;
}

/**
 * The `AutomationResult` fields the console reads. Deliberately loose: this is
 * a parsed HTTP body, not a value the type system has vouched for.
 */
export interface FlowRunResult {
    success?: boolean;
    status?: 'completed' | 'paused' | 'failed' | 'refused' | string;
    runId?: string;
    screen?: unknown;
    error?: unknown;
    errorMessage?: unknown;
    successMessage?: unknown;
    /**
     * The rendered refusal — set by the engine when `status` is `'refused'`,
     * absent on every other status (`AutomationResult.refusalMessage`).
     */
    refusalMessage?: unknown;
    [key: string]: unknown;
}

/**
 * `S` is the caller's screen type (`ScreenSpec`, which lives in the views
 * layer). Generic rather than imported so this util stays a leaf.
 */
export type FlowResponseOutcome<S = unknown> =
    | {
        kind: 'refused';
        /**
         * The engine-rendered refusal, i.e. the `end` node's `message`
         * template interpolated against the run's variables — per-record text
         * ("Refused: Acme Corp is a confirmed duplicate"), not a flow-level
         * string. Read from the ONE member the contract declares for it
         * (`AutomationResult.refusalMessage`); there is deliberately no alias
         * chain hunting for it elsewhere (commandment #0.1).
         *
         * `''` when the producer sent none. `outcome: 'refused'` with no
         * `message` is refused at the authoring door by the spec's `end`
         * config, so an empty string here is an engine defect, not an
         * authorable shape — and the disposition it selects (Close only, no
         * completion toast) is a fact about the STATUS, so it must not depend
         * on whether the sentence arrived.
         */
        message: string;
        data: FlowRunResult;
    }
    | {
        kind: 'failed';
        /** Always a string — safe to hand to `toast.error()`. */
        error: string;
        /**
         * The request failed at the transport, so the run was NOT consumed —
         * a retry of the same run is meaningful. False for a flow failure:
         * the engine consumed the suspension before running downstream nodes
         * (resume-once), so retrying only reaches "No suspended run", and a
         * runner must not offer one.
         *
         * What a runner DOES with that is the runner's own decision, and it is
         * not "close" (`c40f3b8ca`): `FlowRunner` keeps the dialog up so the
         * refusal stays beside the input that caused it, and withdraws the
         * submit affordance instead. This flag says the run is gone, nothing
         * more.
         */
        retryable: boolean;
    }
    | ({ kind: 'paused'; runId?: string; screen: S; data: FlowRunResult } & Pick<AutomationResult, 'flowLabel'>)
    | ({ kind: 'done'; data: FlowRunResult | undefined; successMessage?: string } & Pick<AutomationResult, 'flowLabel'>);

/**
 * What a failed run's message is read from. On a 200 every member is the run's
 * own (`AutomationResult`); on a 400 `FLOW_FAILED` `errorMessage` and
 * `innerRefusal` are `error.details`' (`FlowFailureDetailsSchema`) and
 * `userMessage` is the envelope's top level (`ApiErrorSchema.userMessage`).
 */
interface FlowFailureCarriers {
    errorMessage?: unknown;
    /** Already read by `declaredUserMessage`, so non-empty or `null`. */
    userMessage: string | null;
    innerRefusal?: unknown;
}

/** The one subtree of a resident catalogue {@link permissionDeniedLine} reads. */
type PermissionLinePack = { form?: { noPermissionToSave?: unknown } } | undefined;

/**
 * The record form's permission line (`form.noPermissionToSave`) in `locale`,
 * read from the RESIDENT built-in catalogue — exact tag first, then its base
 * language, the registry's own order (the same read `LoadingScreen` makes).
 * The active language's catalogue is resident whenever the console runs in
 * it; anything else answers the resident `en` catalogue, which always is.
 * The literal is the last resort only for a registry that answers neither.
 *
 * Each read is one chain off `getLoadedBuiltInLocales()`, never a local
 * binding of its result, so `scripts/check-i18n-dead-keys.mjs` derives the
 * `en` read as a read of `form.noPermissionToSave` and the active-language
 * reads as runtime-indexed; its header bullet for this file says which leg
 * sees what.
 */
function permissionDeniedLine(locale: string | undefined): string {
    const usable = (line: unknown): string | undefined =>
        typeof line === 'string' && line.trim() ? line : undefined;
    const base = locale ? locale.toLowerCase().split('-')[0] : undefined;
    return (
        (locale ? usable((getLoadedBuiltInLocales()[locale] as PermissionLinePack)?.form?.noPermissionToSave) : undefined)
        ?? (base ? usable((getLoadedBuiltInLocales()[base] as PermissionLinePack)?.form?.noPermissionToSave) : undefined)
        ?? usable((getLoadedBuiltInLocales().en as PermissionLinePack)?.form?.noPermissionToSave)
        ?? "You don't have permission to save this record."
    );
}

/**
 * A failed run's message, by the record-save rule (objectstack#24914 ruling
 * B′): the flow's authored `errorMessage` — translated when the bundle carries
 * `flows.FLOW.errorMessage` (objectui#12075) — then the producer-marked
 * `userMessage`, then the refusal the run's write node met (`innerRefusal`,
 * whose `message` the spec serves without the node and operation prefixes),
 * then the run's own `message`.
 *
 * The inner refusal is rendered exactly as the record form renders the same
 * refusal on a save: a permission denial (`isPermissionError`) becomes the
 * form's localized permission line instead of server prose (objectstack#3821),
 * anything else reads its own sentence. `message` stays the last rung, so a
 * run that met no refusal still says something, never nothing.
 */
function flowFailureMessage(failure: FlowFailureCarriers, message: string, copy: FlowCopyLocale | undefined): string {
    const friendly = failure.errorMessage;
    if (typeof friendly === 'string' && friendly.length > 0) return translatedFlowMessage('errorMessage', friendly, copy);
    if (failure.userMessage) return failure.userMessage;
    const inner = failure.innerRefusal as { code?: unknown; message?: unknown } | null | undefined;
    if (inner && typeof inner === 'object' && typeof inner.code === 'string') {
        const refusal = { code: inner.code, message: typeof inner.message === 'string' ? inner.message : '' };
        if (isPermissionError(refusal)) return permissionDeniedLine(copy?.locale);
        if (refusal.message.trim()) return refusal.message;
    }
    return message;
}

/**
 * `error.details` out of an ADR-0112 error envelope, as the loose result shape
 * the failure-message rule reads. `{}` when there is none — this route's `error`
 * has always been able to arrive as a bare string, and a non-2xx may carry no
 * parseable body at all, so nothing here may assume an object.
 */
/**
 * The flow's authored label as the answer serves it (objectui#11092 — see the
 * header). Read from the ONE member the contract declares, with no alias chain
 * (commandment #0.1). `undefined` when the body carries no string there: a
 * backend older than objectstack#20633, or a body that is not an evaluation.
 */
function servedFlowLabel(data: FlowRunResult): AutomationResult['flowLabel'] {
    return typeof data.flowLabel === 'string' ? data.flowLabel : undefined;
}

function errorEnvelopeDetails(json: unknown): FlowRunResult {
    const envelope = (json as { error?: { details?: unknown } } | null | undefined)?.error;
    const details = envelope?.details;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
    return details as FlowRunResult;
}

/**
 * Classify a `POST /api/v1/automation/{flow}/trigger` or
 * `.../runs/{runId}/resume` response.
 *
 * `label` names the flow for fallback messages (e.g. `Flow "convert_lead"`).
 * `json` is the parsed body, or `null` when it could not be parsed. `copy`
 * translates the flow's own `successMessage` / `errorMessage` (objectui#12075
 * — see the header); without it both are answered as served.
 */
export function interpretFlowResponse<S = unknown>(
    res: { ok: boolean; status: number },
    json: any,
    label: string,
    copy?: FlowCopyLocale,
): FlowResponseOutcome<S> {
    if (!res.ok) {
        // The flow RAN and failed — same event as the inner-envelope failure
        // below, just carried on a real status code. Terminal, and the
        // authorable `errorMessage` stays preferred for it; the envelope's own
        // `message` is the fallback. See the header note.
        if (res.status === 400 && errorCodeIs(json?.error, 'FLOW_FAILED')) {
            const details = errorEnvelopeDetails(json);
            return {
                kind: 'failed',
                error: flowFailureMessage(
                    {
                        errorMessage: details.errorMessage,
                        userMessage: declaredUserMessage(json?.error),
                        innerRefusal: details.innerRefusal,
                    },
                    actionErrorDetail(json, `${label} failed`),
                    copy,
                ),
                retryable: false,
            };
        }

        // Nothing to resume (or no such flow). A retry cannot conjure the run
        // back; status alone decides, since a proxy 404 carries no envelope.
        if (res.status === 404) {
            return {
                kind: 'failed',
                error: actionErrorDetail(json, `${label} failed (HTTP ${res.status})`),
                retryable: false,
            };
        }

        // Every other non-2xx is a genuine transport failure: it did not consume
        // the suspension, so retrying the same run is meaningful.
        return {
            kind: 'failed',
            error: actionErrorDetail(json, `${label} failed (HTTP ${res.status})`),
            retryable: true,
        };
    }

    if (json && json.success === false) {
        // Outer envelope failure under a 2xx — the request was refused before
        // the run started, so nothing was consumed.
        return {
            kind: 'failed',
            error: actionErrorDetail(json, `${label} failed (HTTP ${res.status})`),
            retryable: true,
        };
    }

    const data: FlowRunResult = (json?.data ?? {}) as FlowRunResult;

    // Checked BEFORE `paused` on purpose — see the header note on why a paused
    // run can never land here.
    if (data.success === false || data.status === 'failed') {
        return {
            kind: 'failed',
            error: flowFailureMessage(
                {
                    errorMessage: data.errorMessage,
                    userMessage: declaredUserMessage(data),
                    innerRefusal: data.innerRefusal,
                },
                actionErrorDetail(data, `${label} failed`),
                copy,
            ),
            retryable: false,
        };
    }

    if (data.status === 'paused' && data.screen) {
        return { kind: 'paused', runId: data.runId, screen: data.screen as S, data, flowLabel: servedFlowLabel(data) };
    }

    // The run reached an `end` node declaring `outcome: 'refused'` (objectstack#14945):
    // a successful evaluation that said NO. Terminal exactly like `completed`
    // and deliberately distinct from `failed` — nothing threw, so classifying
    // it as a failure would be the opposite error — which is why it is checked
    // AFTER the two failure arms and answers with its own kind rather than
    // folding into either neighbour. Without this arm it falls through to
    // terminal success below, and a user who was just told "this is refused"
    // is told the flow completed (objectui#7707).
    if (data.status === 'refused') {
        return {
            kind: 'refused',
            message: typeof data.refusalMessage === 'string' ? data.refusalMessage : '',
            data,
        };
    }

    // Terminal success. `data` is the raw `json?.data` — `undefined` when the
    // body carried none, which is what `ActionResult.data` has always exposed.
    return {
        kind: 'done',
        data: json?.data as FlowRunResult | undefined,
        successMessage:
            typeof data.successMessage === 'string'
                ? translatedFlowMessage('successMessage', data.successMessage, copy)
                : undefined,
        flowLabel: servedFlowLabel(data),
    };
}

/**
 * The success copy {@link flowSuccessCopy} picked, and whose it is. `from`
 * matters only to a launch, which must know whether the ActionRunner can speak
 * it (see the header).
 */
export interface FlowSuccessCopy {
    text: string;
    /** `'action'`: the invoking action's `successMessage`. `'flow'`: the flow's own. */
    from: 'action' | 'flow';
}

/**
 * Copy is usable as a toast only as a non-empty string. Anything else — absent,
 * blank, or an `I18nLabel` map that reached here without passing through a
 * localizer — counts as no copy: the same rule the action runner's own success
 * toast applies to a rung, so the paths cannot disagree about what "declares a
 * successMessage" means.
 */
function usableCopy(copy: unknown): copy is string {
    return typeof copy === 'string' && copy.trim() !== '';
}

/**
 * The ONE precedence a flow run's success toast follows, whichever way the run
 * ended (objectui#12274 — see the header): the invoking action's
 * `successMessage`, then the flow's own `successMessage`. `undefined` when
 * neither is usable; the caller then speaks its own default sentence.
 *
 * `actionMessage` is the action's copy exactly as it reached the host's flow
 * handler, so already localized by the surface that dispatched it. It is a
 * string or the `template` envelope (objectui#13367), read through core's
 * `actionCopySource` as the action runner reads it, so an envelope still
 * outranks the flow's own copy. The text is answered as written: on the
 * straight-through run the runner speaks it and fills its holes.
 * `flowMessage` is the flow's own `successMessage` as `interpretFlowResponse`
 * answered it — the served `AutomationResult.successMessage`, translated
 * against `flows.FLOW.successMessage` where the bundle carries one
 * (objectui#12075).
 */
export function flowSuccessCopy(actionMessage: unknown, flowMessage: unknown): FlowSuccessCopy | undefined {
    const actionText = actionCopySource(actionMessage);
    if (usableCopy(actionText)) return { text: actionText, from: 'action' };
    if (usableCopy(flowMessage)) return { text: flowMessage, from: 'flow' };
    return undefined;
}

/**
 * The surface a launch hands off to, when it hands off to one. `S` is the
 * caller's screen type, as on {@link FlowResponseOutcome}.
 */
export type FlowLaunchFollowUp<S = unknown> =
    /**
     * Paused at a `screen` node: the host opens `FlowRunner` on this run,
     * handing it the served `flowLabel` with the screen (objectui#11092).
     */
    | ({ kind: 'screen'; runId: string; screen: S } & Pick<AutomationResult, 'flowLabel'>)
    /**
     * Ended `refused` without pausing: the host opens its Close-only refusal
     * notice. `message` is the engine-rendered sentence, `''` when the producer
     * sent none (see `FlowResponseOutcome`'s `refused` arm).
     */
    | { kind: 'refusal'; message: string };

/** What a flow-LAUNCH handler does with one trigger response. */
export interface FlowLaunchJudgement<S = unknown> {
    /** Returned to the ActionRunner as-is. */
    result: ActionResult;
    /** The follow-up surface to open, if the run handed off to one. */
    followUp?: FlowLaunchFollowUp<S>;
    /**
     * A success toast the ActionRunner cannot speak (objectui#12274 — see the
     * header). Set only on a `done` run whose copy, by {@link flowSuccessCopy},
     * is the FLOW's own `successMessage`; `result` is then `silent`.
     * `launchConsoleFlow` speaks it, so a host does nothing with it.
     */
    successToast?: string;
    /** Whether the host invalidates its data now. */
    refresh: boolean;
}

/**
 * Judge a flow LAUNCH: the one decision both console launch handlers
 * (`useConsoleActionRuntime`'s and `RecordDetailView`'s) act on, so they cannot
 * drift apart again (objectui#9973 — see the header). `refreshAfter` and
 * `actionSuccessMessage` are the invoking action's own flag and copy.
 *
 * Each arm also decides whether the action's post-success hop
 * (`ActionSchema.onSuccess`, objectstack#25800 — see the header) fires: only
 * the `done` arm completes the action, so it is the only one that hops.
 *
 * - `failed` — the ActionRunner's post-execution hook surfaces `error` as a
 *   toast; nothing refreshes, because nothing changed. No hop: the runner hops
 *   only after a success.
 * - `paused` — the action only OPENED the wizard, so the action-level success
 *   toast is suppressed (`silent`) and `FlowRunner` owns completion messaging
 *   and the refresh. The success is a hand-off (`handedOff`), so the runner
 *   performs no hop: navigating away would leave the screen behind, and the
 *   run has not answered with the output the hop reads. `FlowRunner` finishing
 *   the run later does not hop either.
 * - `refused` — the run ENDED, deliberately, and the answer was no
 *   (objectstack#14945). The result is the paused arm's, byte for byte:
 *   `silent`, because the ruling forbids the completion toast; `handedOff`,
 *   because the Close-only notice is the follow-up and a hop would navigate
 *   past it to a record the refusal never produced; `success: true`, because a
 *   refusal is a successful evaluation (`AutomationResult.success` stays
 *   `true`), and `success: false` would put the runner hooks' error state on
 *   it; and no `data` and no `reload`. Nothing refreshes — the run wrote
 *   nothing, and a refresh would say it did.
 * - `done` — terminal success, and the host refreshes unless the action opted
 *   out with `refreshAfter: false`. The toast follows {@link flowSuccessCopy}
 *   (objectui#12274): the runner speaks the action's copy or its own default
 *   as before, and when the copy is the flow's the result goes `silent` and
 *   carries it as `successToast` instead. Not `handedOff`, `silent` or not: the
 *   run completed, so the runner hops, reading `${result.*}` off `data`, the
 *   run's `AutomationResult` (`${result.output.VAR}` is one of its `isOutput`
 *   variables).
 */
export function judgeFlowLaunch<S = unknown>(
    outcome: FlowResponseOutcome<S>,
    refreshAfter: boolean | undefined,
    actionSuccessMessage?: unknown,
): FlowLaunchJudgement<S> {
    switch (outcome.kind) {
        case 'failed':
            return { result: { success: false, error: outcome.error }, refresh: false };
        case 'paused':
            return {
                result: { success: true, silent: true, handedOff: true },
                followUp: {
                    kind: 'screen',
                    runId: outcome.runId ?? '',
                    screen: outcome.screen,
                    flowLabel: outcome.flowLabel,
                },
                refresh: false,
            };
        case 'refused':
            return {
                result: { success: true, silent: true, handedOff: true },
                followUp: { kind: 'refusal', message: outcome.message },
                refresh: false,
            };
        case 'done': {
            const refresh = refreshAfter !== false;
            const result: ActionResult = { success: true, data: outcome.data, reload: refresh };
            const copy = flowSuccessCopy(actionSuccessMessage, outcome.successMessage);
            if (copy?.from !== 'flow') return { result, refresh };
            return { result: { ...result, silent: true }, successToast: copy.text, refresh };
        }
    }
}
