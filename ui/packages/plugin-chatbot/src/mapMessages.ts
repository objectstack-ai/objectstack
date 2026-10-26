/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Utilities for mapping Vercel AI SDK v6 `UIMessage` shapes (the `parts`
 * model — `[ { type: 'text' | 'reasoning' | 'tool-*' | 'dynamic-tool' |
 * 'source-url' | … } ]`) into the simpler `ChatMessage` shape consumed by
 * `<ChatbotEnhanced>`.
 *
 * Shared between `useObjectChat` (which composes `useChat` internally) and
 * apps that drive `useChat` themselves (e.g. Studio, which needs a custom
 * `prepareSendMessagesRequest` transport).
 */
import type { BUILD_PROGRESS_FRAME_TYPE, BuildProgressPhase } from '@objectstack/spec/ai';
import type { ChatbotEnhancedMessage as ChatMessage, ChatbotEnhancedToolInvocation as ChatToolInvocation, ChatSource, ChatBuildProgress, ChatBlueprintProgress, ChatChart } from './ChatbotEnhanced';

interface AnyPart {
  type?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  id?: string;
  input?: unknown;
  output?: unknown;
  args?: unknown;
  result?: unknown;
  errorText?: string;
  /**
   * Free-form on purpose. `AnyPart` absorbs whatever a producer hands the
   * mapper, and `state` is NOT one namespace: a tool part carries the
   * tool-invocation lifecycle, while `@ai-sdk/react`'s text and reasoning
   * parts carry `'streaming' | 'done'`. Typing this member against the
   * OUTPUT contract made the deliberately-permissive input interface
   * stricter than the union it exists to absorb, so the SDK's own
   * `UIMessage[]` — the documented input of the exported mappers — was
   * refused outright (objectui#8214). `isToolState` below is what keeps the
   * output checked; this stays open.
   */
  state?: string;
  /**
   * The chat runtime's approval envelope, as it arrives on a tool part.
   *
   * `unknown`, like every other absorbing member here, and deliberately NOT
   * the envelope's declared shape: this interface exists to take whatever a
   * producer hands the mapper, and the one time a member was typed against the
   * OUTPUT contract it made the permissive input interface stricter than the
   * union it absorbs (objectui#8214, the `state` member). {@link liftApproval}
   * is what keeps the OUTPUT checked; this stays open.
   */
  approval?: unknown;
  url?: string;
  href?: string;
  title?: string;
  /** Payload of a Vercel custom data part (`data-*`), e.g. build progress. */
  data?: unknown;
}

interface AnyUIMessage {
  id?: string;
  role?: 'user' | 'assistant' | 'system';
  parts?: AnyPart[];
  content?: unknown;
  toolInvocations?: ChatToolInvocation[];
  metadata?: unknown;
}

/**
 * The tool-invocation lifecycle states as a runtime value. Declared as a
 * `Record` over the union so the compiler rejects a typo here AND requires a
 * row when `ChatToolInvocation['state']` grows: the table cannot drift from
 * the type it guards.
 */
const TOOL_STATES: Record<NonNullable<ChatToolInvocation['state']>, true> = {
  'input-streaming': true,
  'input-available': true,
  'approval-requested': true,
  'approval-responded': true,
  'output-available': true,
  'output-error': true,
  'output-denied': true,
};

/**
 * Narrows a part's free-form `state` to the tool-invocation lifecycle. Any
 * other spelling (a text/reasoning part's `'streaming' | 'done'`, an AI SDK v4
 * snapshot's `'result'`) is not a tool state and maps to `undefined` — which is
 * the documented "infer from `errorText` / `result`" case in
 * `ChatbotEnhanced.getToolState`, not a loss: an unrecognized string used to
 * pass through verbatim and fall past every branch there, rendering a finished
 * call as "Running" forever.
 */
function isToolState(state: string | undefined): state is NonNullable<ChatToolInvocation['state']> {
  return state !== undefined && state in TOOL_STATES;
}

function extractText(msg: AnyUIMessage, parts: AnyPart[]): string {
  if (typeof msg.content === 'string') return msg.content;
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

function extractReasoning(parts: AnyPart[]): string | undefined {
  const joined = parts
    .filter((p) => p.type === 'reasoning' || p.type === 'reasoning-delta')
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
  return joined.length > 0 ? joined : undefined;
}

/**
 * Best-effort detector for the framework's HITL pending envelope. Server-side
 * `action-tools.ts` returns a JSON string of shape
 *   `{ "status": "pending_approval", "pendingActionId": "pa_…", … }`
 * inside the tool's `output.value` when the action is dangerous and approval
 * is enabled. We surface this on the invocation so chat UIs can render an
 * inline approve/reject affordance without round-tripping back to the server.
 */
/**
 * Parse a tool result into the framework's JSON envelope object, if it is one.
 * The Vercel SDK wraps tool outputs as `{ type: 'text', value: string }`, so we
 * peel one layer if present, then fall back to the raw value. Returns the first
 * candidate that parses to a plain object.
 *
 * Exported so `isProposalResult` (ChatbotEnhanced) shares the exact same
 * envelope-peeling logic — otherwise a wrapped `{type:'text', value:'…'}`
 * result slips past its `.status` check and the activity chip mis-reads a
 * still-pending proposal as "Completed" (#787 finding B / #2362).
 */
export function parseResultEnvelope(result: unknown): Record<string, unknown> | undefined {
  const tryParse = (value: unknown): Record<string, unknown> | undefined => {
    if (value && typeof value === 'object') return value as Record<string, unknown>;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const candidates: unknown[] = [result];
  if (result && typeof result === 'object' && 'value' in (result as Record<string, unknown>)) {
    candidates.push((result as Record<string, unknown>).value);
  }
  // Prefer a candidate that carries the framework's `status` discriminator —
  // this peels the Vercel `{ type:'text', value:'…json…' }` wrapper, whose
  // outer object has no `status`, to the inner envelope that does. The
  // wrapper itself is only ever a LAST-resort fallback: a status-less inner
  // envelope (e.g. a bare `{error: …}` replay dispatch failure, #5695) must
  // still win over the wrapper it rode in on, or the error is invisible to
  // every detector on the rehydration path.
  let fallback: Record<string, unknown> | undefined;
  let wrapperFallback: Record<string, unknown> | undefined;
  for (const candidate of candidates) {
    const obj = tryParse(candidate);
    if (!obj) continue;
    if (typeof obj.status === 'string') return obj;
    const isTextWrapper = obj.type === 'text' && 'value' in obj;
    if (isTextWrapper) wrapperFallback ??= obj;
    else fallback ??= obj;
  }
  return fallback ?? wrapperFallback;
}

/**
 * The ObjectStack HITL envelope a tool result carries when the framework's
 * `action-tools.ts` proposes a destructive action:
 * `{ status: 'pending_approval', pendingActionId: 'pa_…', … }`.
 *
 * Exported (objectui#8442) so the app-shell's HYDRATION mapper derives the id
 * from the same parse the live mapper uses. The id is never persisted as a part
 * key — it exists in rehydrated history only inside this envelope — so a second
 * hand-rolled reader there would be a second dialect of one contract, which is
 * exactly what AGENTS.md Commandment #0.1 refuses.
 */
export function detectPendingApproval(
  result: unknown,
): { pendingActionId: string; raw: Record<string, unknown> } | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj) return undefined;
  const id = obj.pendingActionId;
  if (obj.status === 'pending_approval' && typeof id === 'string' && id.length > 0) {
    return { pendingActionId: id, raw: obj };
  }
  return undefined;
}

/**
 * Best-effort detector for the framework's ADR-0033 draft envelopes. Metadata
 * authoring tools stage changes as DRAFTS and return one of:
 *   • single — `{ status:'drafted', type, name, summary, changedKeys }`
 *     (create_object / add_field / create_metadata / update_metadata / …)
 *   • batch  — `{ status:'drafted', drafted:[{type,name}], failed, summary }`
 *     (apply_blueprint), or the same batch with `kind:'edit'` (apply_edit,
 *     an INCREMENTAL edit — objectui#10109)
 * We lift the reviewable `{ type, name }` targets so the chat can render a
 * "Review N change(s)" affordance that opens the designer's review/diff.
 * `blueprint_proposed` (propose_blueprint) has no draft yet → not surfaced here.
 */
export interface DraftReview {
  items: Array<{ type: string; name: string }>;
  summary?: string;
  packageId?: string;
  /**
   * Backend lifecycle intent (from the tool result). `true` for whole-app
   * builds (apply_blueprint) — eligible for the auto-publish "magic moment".
   * Omitted for incremental edits, which stay drafts for explicit review.
   */
  autoPublishable?: boolean;
  /** Count of artifacts that failed in a partial build, surfaced not hidden. */
  failedCount?: number;
  /**
   * ADR-0045: the build was MATERIALIZED in-turn — real tables and seed
   * rows exist; the app is live but `hidden` (unlisted). Preview should
   * open the REAL app URL, not the draft overlay.
   */
  materialized?: boolean;
  /**
   * ADR-0038 L1 graph-lint verdict for the staged build. Rendered as a
   * verified/issues chip so "drafted" and "verified" read as the two
   * separate statements they are. Absent on older tool output.
   */
  verification?: { errors: number; warnings: number };
  /**
   * ADR-0038 L1 — the individual lint findings behind the `verification`
   * counts, so the chat can show WHAT is wrong (not just "N issues"). Each
   * carries an agent-actionable `message`; `fix` is the mechanical hint.
   */
  issues?: Array<{ severity: 'error' | 'warning'; code: string; message: string; fix?: string }>;
  /**
   * Concrete post-build "what's next" steps the assistant returns on a whole-app
   * build (apply_blueprint `nextSteps`), e.g. "replace the sample data",
   * "publish from the status panel". Rendered as a short getting-started
   * checklist under the build summary so the user has an obvious next action
   * instead of a dead end. Lifecycle-neutral (publishing is described via the
   * status panel, never asserted as done).
   */
  nextSteps?: string[];
  /**
   * objectui#10109 — the producer's marker for an INCREMENTAL edit, lifted
   * from the envelope's own `kind`: `apply_edit` answers `kind: 'edit'`, and a
   * whole-app `apply_blueprint` build carries no `kind`. An edit's `items` may
   * honestly include the `app` artifact it re-staged (an `add_object` op
   * merges the nav), so the readers that infer a whole-app build from a draft
   * review's staged artifact types check this first: `buildProgressFromDraftReview`
   * here, and app-shell's built-moment transition (`detectBuiltAppPackage` reads
   * the envelope's own `kind` instead). Only the value those readers act on is
   * declared: an envelope that does not say `'edit'` lifts nothing here.
   */
  kind?: 'edit';
}

/**
 * The lifecycle stage BEFORE a draft. `propose_blueprint` returns
 * `{ status:'blueprint_proposed', blueprint, counts, questions, assumptions }`
 * — a PLAN the user reviews (and can adjust) before `apply_blueprint` stages
 * it. Nothing is created yet; this is the confirm gate. We lift the reviewable
 * shape so the chat can render a "Proposed plan" card — the objects it will
 * create, the agent's assumptions, and any structure-deciding questions —
 * instead of burying the proposal in a "Propose blueprint — Completed" step.
 */
export interface ProposedPlan {
  summary?: string;
  /**
   * objectui#12724 — the app's display label (`blueprint.app.label`, the
   * spec's `BlueprintAppSchema`), for the card's 「方案 · APP」 header. Absent
   * when the blueprint names no app label.
   */
  appLabel?: string;
  /**
   * Objects (tables) the build will create — machine name, label, field count.
   * objectui#12724 — `fields` lifts the name and label of each declared field
   * (`blueprint.objects[].fields`, the spec's `BlueprintFieldSchema`) so the
   * card can draw one chip per field. Absent when no entry carries a name (a
   * cache-fallback reload keeps only the count), and the card then draws the
   * object chip with its count, as before.
   */
  objects: Array<{
    name: string;
    label?: string;
    fieldCount: number;
    fields?: Array<{ name: string; label?: string }>;
  }>;
  /**
   * objectui#12724 — the views the build will create (`blueprint.views`, the
   * spec's `BlueprintViewSchema`), by name and label. Absent when the
   * blueprint declares none.
   */
  views?: Array<{ name: string; label?: string }>;
  /** Totals for a compact "N objects · N views · …" line. */
  counts: { objects: number; views: number; dashboards: number; seedData: number };
  /** ≤2 structure-deciding questions to confirm before building (may be empty). */
  questions: string[];
  /**
   * One-click answer options for the structure-deciding questions, when the
   * backend (propose_blueprint `questionChoices`) could derive them. Matched to
   * a `questions` entry by `text`; a question with no entry here renders as
   * plain text (type-to-answer). Each set has ≥2 options, recommended first.
   */
  questionChoices?: Array<{ text: string; options: string[] }>;
  /**
   * Assumptions the agent made from an underspecified goal (may be empty).
   * objectui#12724 — read from `planCard.assumptions` when the envelope
   * carries a plan card, else from `blueprint.assumptions` as before.
   */
  assumptions: string[];
  /** Extend mode: the existing app the new objects would be added into. */
  targetApp?: string;
  /**
   * objectui#12724 — the plan card's v2 rows, from the envelope's `planCard`.
   * Absent on a producer that predates it, and the card then draws the rows
   * above as before.
   */
  planCard?: ProposedPlanCard;
  /**
   * objectui#12724 — one line per view (the envelope's `viewIntents`). The card
   * reads it only when there is no `planCard`, whose views carry the same line.
   */
  viewIntents?: ProposedPlanViewLine[];
}

/** One view's intent line: `viewIntents[]` and `planCard.views[]` both carry it. */
export interface ProposedPlanViewLine {
  view: string;
  object: string;
  label?: string;
  line: string;
}

/**
 * objectui#12724 — the keys of `propose_blueprint`'s `planCard` that the plan
 * card draws. The producer's contract is objectstack-ai/cloud's
 * `ProposeBlueprintCardPayload` (`packages/service-ai-studio/schema/build-cards.schema.json`,
 * vendored beside this package's tests); keys this card does not draw are not
 * lifted.
 */
export interface ProposedPlanCard {
  objects: Array<{
    name: string;
    label: string;
    fields: Array<{
      name: string;
      label: string;
      /** The format the sample data is held to, as the chip's words (`format.label`). */
      format?: { label: string };
      /**
       * objectui#12994 — the stage field's lifecycle, as the chip's words
       * (`lifecycle.label`, e.g. 「借出 · 已还 ✓完成 · 逾期 ⚠」). The producer's
       * `options` are not drawn, so they are not lifted.
       */
      lifecycle?: { label: string };
      /** The model added this field; the user's words did not name it. */
      suggested?: true;
    }>;
    /**
     * The record's name field, when the plan declares one. `generated`
     * (objectui#13004) is present when the title is composed for the user, not
     * typed: the card draws its `line` (e.g. 「名称：自动生成「{图书} · {读者} ·
     * {借出日期}」，表单里不出现」) in place of 「名称：LABEL」. The producer's
     * `template` is not drawn, so it is not lifted.
     */
    nameField?: { name: string; label: string; generated?: { line: string } };
  }>;
  views: ProposedPlanViewLine[];
  assumptions: string[];
  /** The sample data the build stages, as one line. Absent when it stages none. */
  sampleData?: { line: string };
  /**
   * cloud#2924 ruling A — how the build will land once approved: `publish` (a
   * new app's first build, or an app with no records yet) or `draft` (an app
   * live with records), and the card's `line` (e.g. 「首次搭建直接上线；之后的修改
   * 先存草稿，由你发布」). Absent where the build does not publish in the turn,
   * and the card then says nothing about it. The producer's `liveRecords` is
   * already in the line, so it is not lifted.
   */
  posture?: { mode: 'publish' | 'draft'; line: string };
}

/**
 * objectui#12724 — the keys of the result card's `checklist` that the card
 * draws, from `apply_blueprint`'s and `verify_build`'s envelopes
 * (objectstack-ai/cloud's `BuildResultCardPayload`).
 */
export interface BuildResultChecklist {
  status: 'passed' | 'failed';
  passed: number;
  total: number;
  /** Objects, then views, then the sample data, each measured on the build. */
  lines: Array<{ kind: 'object' | 'view' | 'sampleData'; status: 'passed' | 'failed'; line: string }>;
  /** The app 打开应用 opens. */
  app?: { name: string; label?: string };
  /** The package 在 Studio 中查看 opens. */
  packageId?: string;
}

/** Defensive: keep only non-empty strings from an unknown array. */
function nonEmptyStrings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
}

/**
 * The `{ name, label? }` of each entry of a blueprint array that carries a
 * name (the spec's field and view rows both declare these two keys). Entries
 * without a string name are dropped, so a count-only cache copy yields none.
 */
function namedEntries(v: unknown): Array<{ name: string; label?: string }> {
  return (Array.isArray(v) ? v : []).flatMap((e) => {
    const r = e as { name?: unknown; label?: unknown } | null;
    if (typeof r?.name !== 'string' || !r.name) return [];
    return [{ name: r.name, ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}) }];
  });
}

export function detectProposedPlan(result: unknown): ProposedPlan | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj || obj.status !== 'blueprint_proposed') return undefined;
  const rawBlueprint = (obj as { blueprint?: unknown }).blueprint;
  const bp =
    rawBlueprint && typeof rawBlueprint === 'object'
      ? (rawBlueprint as Record<string, unknown>)
      : {};

  const objects = (Array.isArray(bp.objects) ? bp.objects : []).flatMap((o) => {
    const r = o as { name?: unknown; label?: unknown; fields?: unknown };
    if (typeof r?.name !== 'string' || !r.name) return [];
    const fields = namedEntries(r.fields);
    return [
      {
        name: r.name,
        ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}),
        fieldCount: Array.isArray(r.fields) ? r.fields.length : 0,
        ...(fields.length ? { fields } : {}),
      },
    ];
  });
  // No nameable objects → nothing reviewable; don't render an empty card.
  if (objects.length === 0) return undefined;

  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const rawCounts = ((obj as { counts?: unknown }).counts ?? {}) as Record<string, unknown>;
  const counts = {
    objects: num(rawCounts.objects, objects.length),
    views: num(rawCounts.views, Array.isArray(bp.views) ? bp.views.length : 0),
    dashboards: num(rawCounts.dashboards, Array.isArray(bp.dashboards) ? bp.dashboards.length : 0),
    seedData: num(rawCounts.seedData, Array.isArray(bp.seedData) ? bp.seedData.length : 0),
  };

  // `questions` ride on the envelope; older shapes carried them on the
  // blueprint — accept either.
  const questions = nonEmptyStrings((obj as { questions?: unknown }).questions);
  // One-click options for the questions (propose_blueprint `questionChoices`).
  // Defensive: keep only entries with a text and ≥2 non-empty string options.
  const rawChoices = (obj as { questionChoices?: unknown }).questionChoices;
  const questionChoices = Array.isArray(rawChoices)
    ? rawChoices.flatMap((c) => {
        const r = c as { text?: unknown; options?: unknown };
        if (typeof r?.text !== 'string' || !r.text) return [];
        const options = Array.isArray(r.options)
          ? r.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
          : [];
        return options.length >= 2 ? [{ text: r.text, options }] : [];
      })
    : [];
  const summary =
    typeof obj.summary === 'string' && obj.summary
      ? obj.summary
      : typeof bp.summary === 'string' && bp.summary
        ? bp.summary
        : undefined;
  const targetApp = (obj as { targetApp?: unknown }).targetApp;
  const rawApp = bp.app && typeof bp.app === 'object' ? (bp.app as { label?: unknown }) : undefined;
  const appLabel = typeof rawApp?.label === 'string' && rawApp.label ? rawApp.label : undefined;
  const views = namedEntries(bp.views);
  const planCard = liftPlanCard((obj as { planCard?: unknown }).planCard);
  const rawIntents = (obj as { viewIntents?: unknown }).viewIntents;
  const viewIntents = Array.isArray(rawIntents) ? viewLines(rawIntents) : [];

  return {
    ...(summary ? { summary } : {}),
    ...(appLabel ? { appLabel } : {}),
    objects,
    ...(views.length ? { views } : {}),
    counts,
    questions: questions.length ? questions : nonEmptyStrings(bp.questions),
    ...(questionChoices.length ? { questionChoices } : {}),
    assumptions: planCard ? planCard.assumptions : nonEmptyStrings(bp.assumptions),
    ...(typeof targetApp === 'string' && targetApp ? { targetApp } : {}),
    ...(planCard ? { planCard } : {}),
    ...(viewIntents.length ? { viewIntents } : {}),
  };
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** `{ view, object, label?, line }` rows, as `viewIntents[]` and `planCard.views[]` spell them. */
function viewLines(v: unknown[]): ProposedPlanViewLine[] {
  return v.flatMap((e) => {
    const r = recordOf(e);
    if (!r || !isText(r.view) || !isText(r.object) || !isText(r.line)) return [];
    return [{ view: r.view, object: r.object, ...(isText(r.label) ? { label: r.label } : {}), line: r.line }];
  });
}

/**
 * objectui#12724 — lift the plan card's drawn keys off `planCard`. The schema
 * requires `objects`, `views` and `assumptions`; a value without all three is
 * not a plan card, and the card keeps its earlier rows.
 */
function liftPlanCard(raw: unknown): ProposedPlanCard | undefined {
  const card = recordOf(raw);
  if (!card || !Array.isArray(card.objects) || !Array.isArray(card.views) || !Array.isArray(card.assumptions)) {
    return undefined;
  }
  const objects = card.objects.flatMap((o) => {
    const r = recordOf(o);
    if (!r || !isText(r.name) || !isText(r.label) || !Array.isArray(r.fields)) return [];
    const fields = r.fields.flatMap((f) => {
      const fr = recordOf(f);
      if (!fr || !isText(fr.name) || !isText(fr.label)) return [];
      const format = recordOf(fr.format);
      const lifecycle = recordOf(fr.lifecycle);
      return [
        {
          name: fr.name,
          label: fr.label,
          ...(format && isText(format.label) ? { format: { label: format.label } } : {}),
          ...(lifecycle && isText(lifecycle.label) ? { lifecycle: { label: lifecycle.label } } : {}),
          ...(fr.suggested === true ? { suggested: true as const } : {}),
        },
      ];
    });
    const nameField = recordOf(r.nameField);
    const generated = recordOf(nameField?.generated);
    return [
      {
        name: r.name,
        label: r.label,
        fields,
        ...(nameField && isText(nameField.name) && isText(nameField.label)
          ? {
              nameField: {
                name: nameField.name,
                label: nameField.label,
                ...(generated && isText(generated.line) ? { generated: { line: generated.line } } : {}),
              },
            }
          : {}),
      },
    ];
  });
  const sampleData = recordOf(card.sampleData);
  const posture = recordOf(card.posture);
  return {
    objects,
    views: viewLines(card.views),
    assumptions: nonEmptyStrings(card.assumptions),
    ...(sampleData && isText(sampleData.line) ? { sampleData: { line: sampleData.line } } : {}),
    ...(posture && (posture.mode === 'publish' || posture.mode === 'draft') && isText(posture.line)
      ? { posture: { mode: posture.mode, line: posture.line } }
      : {}),
  };
}

const isLineStatus = (v: unknown): v is 'passed' | 'failed' => v === 'passed' || v === 'failed';
const isLineKind = (v: unknown): v is BuildResultChecklist['lines'][number]['kind'] =>
  v === 'object' || v === 'view' || v === 'sampleData';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * objectui#12724 — the result card's `checklist`, on `apply_blueprint`'s
 * envelope (drafted, or published in-turn) and on `verify_build`'s, which
 * re-measures it after a repair. The schema requires `status`, `passed`,
 * `total` and `lines`; without all four there is no checklist, and the card
 * keeps its earlier rows.
 */
export function detectBuildChecklist(result: unknown): BuildResultChecklist | undefined {
  const raw = recordOf(parseResultEnvelope(result)?.checklist);
  if (!raw || !isLineStatus(raw.status) || !isCount(raw.passed) || !isCount(raw.total) || !Array.isArray(raw.lines)) {
    return undefined;
  }
  const lines = raw.lines.flatMap((l) => {
    const r = recordOf(l);
    if (!r || !isLineKind(r.kind) || !isLineStatus(r.status) || !isText(r.line)) return [];
    return [{ kind: r.kind, status: r.status, line: r.line }];
  });
  const app = recordOf(raw.app);
  return {
    status: raw.status,
    passed: raw.passed,
    total: raw.total,
    lines,
    ...(app && isText(app.name) ? { app: { name: app.name, ...(isText(app.label) ? { label: app.label } : {}) } } : {}),
    ...(isText(raw.packageId) ? { packageId: raw.packageId } : {}),
  };
}

/**
 * cloud#2924 — how a copilot change to a package lands, as the change envelopes
 * carry it (cloud `postureEnvelope`): `draft` when the app is live and its
 * tables hold `liveRecords` records, so the change is saved as a Studio draft;
 * `publish` when it goes live in the turn (a first build, an app holding no
 * records, a platform package).
 */
export interface ChangePosture {
  mode: 'draft' | 'publish';
  /** Records the package's live tables hold. */
  liveRecords: number;
  /** The package is a platform package; the posture by state is not read there. */
  platformPackage?: true;
  /** In the turn that applied a blueprint: the rows that build seeded, left out of `liveRecords`. */
  buildTurnRows?: number;
}

/**
 * A granular metadata-change preview (confirm-before-change). A mutating tool
 * that has NOT been approved this turn returns
 * { status: 'changes_proposed', changes: [...], summary? } instead of
 * committing, so the chat renders a "确认修改" card. Mirrors detectProposedPlan.
 *
 * objectui#12894 — cloud#2924 adds `posture` and `primaryAction`, read before
 * the card is shown. Both are absent from an older cloud, and from an
 * environment that does not publish AI changes in the turn; the card then
 * draws as it did before.
 */
export interface ProposedChanges {
  summary?: string;
  changes: Array<{
    verb: string;
    object?: string;
    field?: string;
    type?: string;
    name?: string;
    /** cloud#2924 — the row's parameters in small type (label · default · required), in the user's language. */
    details?: string;
  }>;
  /** cloud#2924 — how the change will land once confirmed. */
  posture?: ChangePosture;
  /** cloud#2924 — the card's primary action: `save_draft` reads 存为草稿, `confirm` keeps the host's label. */
  primaryAction?: 'save_draft' | 'confirm';
}

/** One pending draft, as Studio's 变更 list names it (cloud `PendingDraft`). */
export interface PendingDraftItem {
  type: string;
  name: string;
}

/**
 * cloud#2924 — the package's pending drafts, read after the change landed
 * through `listDrafts`, the read Studio's 变更 badge makes (cloud `DraftState`).
 */
export interface ChangeDraftState {
  /** Pending drafts in the package — the number Studio's 变更 badge shows. */
  pending: number;
  items: PendingDraftItem[];
  /** Pending drafts this change did not stage (an earlier edit, the user's own). */
  others: number;
}

/**
 * cloud#2924 — a field the change added to a table that already holds records:
 * every one of those `rows` has no value for it (cloud `ExistingRowsLine`).
 */
export interface ExistingRowsLine {
  object: string;
  field: string;
  label: string;
  rows: number;
}

/**
 * cloud#2924 — the applied card of a change saved as a draft, in the user's
 * language: its title (「已存为草稿 · 2 项未发布」) and its lines
 * (「已有 12 条记录的续借次数为空」, 「核对：结构 ✓」).
 */
export interface AppliedCard {
  title: string;
  lines: string[];
}

/**
 * ADR-0057 P4 — the `ask` agent's `suggest_builder` structured decline. Result
 * envelope `{ status:'build_handoff', handoff:'build', prompt, packageId? }`.
 * Lifted so the chat renders an explicit "Open in Builder →" action that opens
 * the build surface seeded with `prompt` (never a silent re-route; ADR-0063).
 */
export interface BuilderHandoff {
  prompt: string;
  packageId?: string;
}

export function detectBuilderHandoff(result: unknown): BuilderHandoff | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj || obj.status !== 'build_handoff') return undefined;
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
  if (!prompt) return undefined;
  const rawPkg = (obj as { packageId?: unknown }).packageId;
  const packageId = typeof rawPkg === 'string' && rawPkg.trim().length > 0 ? rawPkg.trim() : undefined;
  return { prompt, ...(packageId ? { packageId } : {}) };
}

/**
 * cloud#1658 — the ask agent's `open_record` structured hand-off: the OTHER
 * ending of a write request. Envelope
 * `{ status:'record_handoff', handoff:'record', objectName, recordId, label?, reason? }`.
 * Lifted so the chat renders an explicit "打开这条记录 →" action landing on the
 * record the agent already resolved — the whole point is that the user never
 * re-finds a record the agent has in hand. Both ids are REQUIRED: a hand-off
 * with either missing is dropped here exactly as the server refuses to emit
 * one, because a card pointing nowhere is worse than the prose it replaces.
 */
export interface RecordHandoff {
  objectName: string;
  recordId: string;
  label?: string;
  reason?: string;
}

export function detectRecordHandoff(result: unknown): RecordHandoff | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj || obj.status !== 'record_handoff') return undefined;
  const str = (v: unknown): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t.length > 0 ? t : undefined;
  };
  const o = obj as { objectName?: unknown; recordId?: unknown; label?: unknown; reason?: unknown };
  const objectName = str(o.objectName);
  const recordId = str(o.recordId);
  if (!objectName || !recordId) return undefined;
  return {
    objectName,
    recordId,
    ...(str(o.label) ? { label: str(o.label) } : {}),
    ...(str(o.reason) ? { reason: str(o.reason) } : {}),
  };
}

export function detectProposedChanges(result: unknown): ProposedChanges | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj || obj.status !== 'changes_proposed') return undefined;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const rawChanges = (obj as { changes?: unknown }).changes;
  const changes = (Array.isArray(rawChanges) ? rawChanges : []).flatMap((c) => {
    const r = c as Record<string, unknown>;
    if (typeof r?.verb !== 'string' || !r.verb) return [];
    return [
      {
        verb: r.verb,
        ...(str(r.object) ? { object: str(r.object) } : {}),
        ...(str(r.field) ? { field: str(r.field) } : {}),
        ...(str(r.type) ? { type: str(r.type) } : {}),
        ...(str(r.name) ? { name: str(r.name) } : {}),
        ...(str(r.details) ? { details: str(r.details) } : {}),
      },
    ];
  });
  if (changes.length === 0) return undefined;
  const posture = changePostureOf(obj.posture);
  const primaryAction =
    obj.primaryAction === 'save_draft' || obj.primaryAction === 'confirm' ? obj.primaryAction : undefined;
  return {
    ...(str(obj.summary) ? { summary: str(obj.summary) } : {}),
    changes,
    ...(posture ? { posture } : {}),
    ...(primaryAction ? { primaryAction } : {}),
  };
}

/**
 * cloud#2924 — the posture as `postureEnvelope` writes it. `mode` and
 * `liveRecords` are the declared required pair: a value missing either is not
 * a posture, and nothing of it is kept.
 */
function changePostureOf(raw: unknown): ChangePosture | undefined {
  const r = recordOf(raw);
  if (!r || (r.mode !== 'draft' && r.mode !== 'publish') || !isCount(r.liveRecords)) return undefined;
  return {
    mode: r.mode,
    liveRecords: r.liveRecords,
    ...(r.platformPackage === true ? { platformPackage: true as const } : {}),
    ...(isCount(r.buildTurnRows) ? { buildTurnRows: r.buildTurnRows } : {}),
  };
}

/**
 * cloud#2924 — `draftState` as `readDraftState` writes it. A state without its
 * two counts is not one: the card's 撤销 warning reads `others`, and a guessed
 * count would be worse than none.
 */
function draftStateOf(raw: unknown): ChangeDraftState | undefined {
  const r = recordOf(raw);
  if (!r || !isCount(r.pending) || !isCount(r.others)) return undefined;
  const items = (Array.isArray(r.items) ? r.items : []).flatMap((i) => {
    const it = recordOf(i);
    return it && isText(it.type) && isText(it.name) ? [{ type: it.type, name: it.name }] : [];
  });
  return { pending: r.pending, items, others: r.others };
}

/** cloud#2924 — `existingRows`: the well-formed lines only; none left is no key. */
function existingRowsOf(raw: unknown): ExistingRowsLine[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw.flatMap((l) => {
    const r = recordOf(l);
    return r && isText(r.object) && isText(r.field) && isText(r.label) && isCount(r.rows)
      ? [{ object: r.object, field: r.field, label: r.label, rows: r.rows }]
      : [];
  });
  return rows.length > 0 ? rows : undefined;
}

/** cloud#2924 — `appliedCard`: a title is required; its lines are the non-empty strings. */
function appliedCardOf(raw: unknown): AppliedCard | undefined {
  const r = recordOf(raw);
  if (!r || !isText(r.title)) return undefined;
  const lines = Array.isArray(r.lines) ? r.lines.filter(isText) : [];
  return { title: r.title, lines };
}

/**
 * objectui#5695 — the terminal verdict of a confirm-replay.
 *
 * When the user approves a 确认修改 card, the runtime re-dispatches the
 * proposal deterministically and appends the result under a synthetic
 * `replay_<turn>_<i>` tool-call id (cloud `runApprovedProposalReplay`). The
 * envelope is the ordinary authoring envelope — `status:'published'`,
 * or `status:'drafted'` optionally stamped `publishFailed:true` +
 * `publishOutcome`/`publishError` when the in-turn publish rolled back
 * (cloud#1467). Lifted into a dedicated shape so the confirm card can render
 * a UI-owned terminal state — the layer a model cannot narrate over.
 */
export interface ReplayOutcome {
  kind: 'published' | 'drafted' | 'failed';
  /** Machine verdict of a failed publish (`rejected` / `rolled_back` / `nothing_published`). */
  outcome?: string;
  /** First line of `publishError`, for the 未生效 headline. */
  error?: string;
  /** Owning package of a drafted outcome, for the inline publish affordance. */
  packageId?: string;
  /**
   * The replay DISPATCH itself errored (bare `{error: …}` envelope) rather
   * than the publish being refused — measured live 2026-08-24: an apply_edit
   * replay carrying a blueprint-local object name errored `object "task" not
   * found`, after which the MODEL self-repaired with different tool calls
   * that succeeded. A dispatch error is therefore only provisionally
   * `failed`: the card walk may supersede it with a later successful
   * authoring verdict from the same turn (see `detectAuthoringVerdict`),
   * so the card never says 未生效 over a change that actually landed.
   */
  dispatchError?: boolean;
  /**
   * objectui#12894 — on a `drafted` outcome only, what cloud#2924's
   * `describeLandedChange` stamps after the change landed: the package's
   * pending drafts, the existing rows a new field leaves empty, and the
   * applied card's title and lines. Each is absent from an older cloud, and
   * the card then draws the drafted badge as before.
   */
  draftState?: ChangeDraftState;
  existingRows?: ExistingRowsLine[];
  appliedCard?: AppliedCard;
  /**
   * objectui#12968 — on a `drafted` outcome only, the items THIS replay
   * drafted (the envelope's `drafted[]`, lifted as {@link detectDraftResult}
   * lifts it), so the applied card can preview them. Not `draftState.items`,
   * which lists every pending draft of the package. Absent when the envelope
   * names none.
   */
  items?: Array<{ type: string; name: string }>;
}

/**
 * The drafted `{ type, name }` items of an authoring envelope: its `drafted[]`,
 * or the single `type` / `name` pair a one-item stage reports.
 */
function draftedItemsOf(obj: Record<string, unknown>): Array<{ type: string; name: string }> {
  const items: Array<{ type: string; name: string }> = [];
  if (Array.isArray(obj.drafted)) {
    for (const d of obj.drafted) {
      if (d && typeof d === 'object') {
        const { type, name } = d as Record<string, unknown>;
        if (typeof type === 'string' && typeof name === 'string') items.push({ type, name });
      }
    }
  } else if (typeof obj.type === 'string' && typeof obj.name === 'string') {
    items.push({ type: obj.type, name: obj.name });
  }
  return items;
}

export function detectReplayOutcome(
  toolCallId: string | undefined,
  result: unknown,
): ReplayOutcome | undefined {
  if (!toolCallId || !toolCallId.startsWith('replay_')) return undefined;
  const obj = parseResultEnvelope(result);
  if (!obj) return undefined;
  if (obj.status === 'published') return { kind: 'published' };
  const rawDispatchErr = (obj as { error?: unknown }).error;
  if (typeof rawDispatchErr === 'string' && rawDispatchErr.trim() && obj.status === undefined) {
    return {
      kind: 'failed',
      dispatchError: true,
      error: rawDispatchErr.trim().split('\n')[0],
    };
  }
  if (obj.status !== 'drafted') return undefined;
  const rawPkg = (obj as { packageId?: unknown }).packageId;
  const packageId =
    typeof rawPkg === 'string' && rawPkg ? { packageId: rawPkg } : {};
  if ((obj as { publishFailed?: unknown }).publishFailed === true) {
    const rawErr = (obj as { publishError?: unknown }).publishError;
    const error =
      typeof rawErr === 'string' && rawErr.trim() ? rawErr.trim().split('\n')[0] : undefined;
    const rawOutcome = (obj as { publishOutcome?: unknown }).publishOutcome;
    return {
      kind: 'failed',
      ...(typeof rawOutcome === 'string' && rawOutcome ? { outcome: rawOutcome } : {}),
      ...(error ? { error } : {}),
      ...packageId,
    };
  }
  const draftState = draftStateOf(obj.draftState);
  const existingRows = existingRowsOf(obj.existingRows);
  const appliedCard = appliedCardOf(obj.appliedCard);
  const items = draftedItemsOf(obj);
  return {
    kind: 'drafted',
    ...packageId,
    ...(items.length > 0 ? { items } : {}),
    ...(draftState ? { draftState } : {}),
    ...(existingRows ? { existingRows } : {}),
    ...(appliedCard ? { appliedCard } : {}),
  };
}

/**
 * objectui#5695 — classify ANY tool result as an authoring verdict, for the
 * confirm card's self-repair supersede: after a replay DISPATCH error, the
 * model may land the same change through different tool calls; those results
 * carry the ordinary authoring envelope, and the latest one in the turn is
 * the truthful terminal state for the card.
 */
export function detectAuthoringVerdict(
  result: unknown,
): { kind: 'published' | 'drafted' | 'failed'; packageId?: string } | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj) return undefined;
  if (obj.status === 'published') return { kind: 'published' };
  if (obj.status !== 'drafted') return undefined;
  const rawPkg = (obj as { packageId?: unknown }).packageId;
  const packageId = typeof rawPkg === 'string' && rawPkg ? { packageId: rawPkg } : {};
  if ((obj as { publishFailed?: unknown }).publishFailed === true) return { kind: 'failed', ...packageId };
  return { kind: 'drafted', ...packageId };
}

/**
 * objectui#5799 — did this tool result finish a WHOLE-APP build, and for which
 * package? Posture-independent on purpose: an auto-publish environment
 * rewrites the apply_blueprint envelope to `status:'published'` (keeping
 * `drafted[]` + `packageId`), so keying the built-moment transition on
 * `draftReview` (drafted-only) missed every staging/cloud build — measured
 * live: reopening a built conversation stayed on the full page.
 *
 * objectui#10109 — an envelope that says `kind: 'edit'` is an INCREMENTAL
 * edit (`apply_edit`), never a whole-app build, even when its `drafted[]`
 * honestly lists the `app` artifact it re-staged (an `add_object` op merges
 * the nav). The producer declares the difference on the envelope, so it is
 * read here rather than inferred from which artifact types were staged.
 */
export function detectBuiltAppPackage(result: unknown): string | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj) return undefined;
  if (obj.kind === 'edit') return undefined;
  if (obj.status !== 'drafted' && obj.status !== 'published') return undefined;
  const pkg = (obj as { packageId?: unknown }).packageId;
  if (typeof pkg !== 'string' || !pkg) return undefined;
  const drafted = (obj as { drafted?: unknown }).drafted;
  const hasApp =
    Array.isArray(drafted) &&
    drafted.some(
      (d) => d && typeof d === 'object' && (d as { type?: unknown }).type === 'app',
    );
  return hasApp ? pkg : undefined;
}

export function detectDraftResult(result: unknown): DraftReview | undefined {
  const obj = parseResultEnvelope(result);
  if (!obj || obj.status !== 'drafted') return undefined;
  const items = draftedItemsOf(obj);
  if (items.length === 0) return undefined;
  // The owning package (when the staging tool reported it) lets the chat offer
  // a one-click "publish" — POST /packages/:packageId/publish-drafts — so the
  // approval gate is reachable from the conversation, not just a deep link into
  // the designer.
  //
  // `autoPublishable` is the backend's lifecycle intent: whole-app builds
  // (apply_blueprint) set it so the chat can auto-publish the magic moment;
  // incremental edits omit it and stay drafts for explicit review. `failedCount`
  // surfaces partial build failures so the UI never hides them.
  const failedCount = Array.isArray(obj.failed) ? obj.failed.length : 0;
  // ADR-0038 L1 — the build's graph-lint verdict (`verification: {errors,
  // warnings}` on apply_blueprint results). Lifted so the chat can render a
  // verified/issues chip; absent on older tool output → no chip.
  const rawVerification = (obj as { verification?: unknown }).verification;
  const verification =
    rawVerification && typeof rawVerification === 'object' &&
    typeof (rawVerification as { errors?: unknown }).errors === 'number' &&
    typeof (rawVerification as { warnings?: unknown }).warnings === 'number'
      ? {
          errors: (rawVerification as { errors: number }).errors,
          warnings: (rawVerification as { warnings: number }).warnings,
        }
      : undefined;
  // The lint findings themselves (`issues: BuildIssue[]`) ride alongside the
  // counts on the same envelope. Lift the user-facing fields so the chip can
  // expand into "WHAT is wrong" instead of a bare "N issues". Defensive: only
  // well-formed entries with a string message survive.
  const rawIssues = (obj as { issues?: unknown }).issues;
  const issues = Array.isArray(rawIssues)
    ? rawIssues.flatMap((i) => {
        const r = i as { severity?: unknown; code?: unknown; message?: unknown; fix?: unknown };
        if (typeof r?.message !== 'string' || !r.message) return [];
        return [
          {
            severity: r.severity === 'error' ? ('error' as const) : ('warning' as const),
            code: typeof r.code === 'string' ? r.code : 'issue',
            message: r.message,
            ...(typeof r.fix === 'string' && r.fix ? { fix: r.fix } : {}),
          },
        ];
      })
    : [];
  // Post-build "what's next" steps (apply_blueprint `nextSteps: string[]`).
  // Surfaced as a getting-started checklist; only well-formed non-empty strings.
  const rawNextSteps = (obj as { nextSteps?: unknown }).nextSteps;
  const nextSteps = Array.isArray(rawNextSteps)
    ? rawNextSteps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  return {
    items,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    ...(typeof obj.packageId === 'string' && obj.packageId ? { packageId: obj.packageId } : {}),
    ...(obj.autoPublishable === true ? { autoPublishable: true } : {}),
    ...(failedCount > 0 ? { failedCount } : {}),
    ...(nextSteps.length ? { nextSteps } : {}),
    // ADR-0045: the build was materialized in-turn (real tables + data, app
    // hidden). The canvas then previews the REAL app URL, not the draft overlay.
    ...(obj.materialized === true ? { materialized: true } : {}),
    ...(verification ? { verification } : {}),
    ...(issues.length ? { issues } : {}),
    // objectui#10109 — the producer's incremental-edit marker rides the draft
    // review, so a reader that only sees the review can still tell an edit
    // from a whole-app build.
    ...(obj.kind === 'edit' ? { kind: 'edit' as const } : {}),
  };
}

/** snake/kebab artifact name → human title, e.g. `expense_tracker` → `Expense Tracker`. */
function humanizeArtifactName(name: string): string {
  return name
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Synthesize a COMPLETED build-progress summary from a persisted apply_blueprint
 * draft envelope. The live "build tree" (`buildProgress`) is driven by transient
 * `data-build-progress` stream parts that are never persisted — so a reloaded
 * conversation loses the "Built X" panel (ADR-0037/0045). On hydration we
 * reconstruct the done-state from the draft result, which IS persisted, so the
 * summary + its preview/open affordances survive a refresh. Only whole-app
 * builds (a draft set that includes an `app`) get a panel — incremental edits
 * keep their draft card but no build tree, matching the live behaviour. An
 * edit is known by the producer's `kind: 'edit'`, not by its staged types: it
 * can re-stage the `app` artifact too (objectui#10109).
 */
export function buildProgressFromDraftReview(
  draft: DraftReview | undefined,
): ChatBuildProgress | undefined {
  if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) return undefined;
  if (draft.kind === 'edit') return undefined;
  const app = draft.items.find((it) => it.type === 'app');
  if (!app) return undefined;
  return {
    phase: 'done',
    appLabel: humanizeArtifactName(app.name),
    items: draft.items,
    done: draft.items.length,
    total: draft.items.length,
  };
}

/**
 * Lift the chat runtime's approval envelope off a tool part.
 *
 * The envelope is what makes the three approval states ACTIONABLE rather than
 * merely displayable: the runtime's own tool-part union makes it required
 * alongside `approval-requested`, `approval-responded` and `output-denied`, so
 * a producer that rebuilds a part from an invocation without it cannot
 * reconstruct those states at all. This is the live half of objectui#8426 —
 * `hydratedMessagesToChatMessages` already lifts it on the HYDRATED half
 * (objectui#8442), and until this landed the two paths disagreed about the
 * same conversation.
 *
 * ⚠️ NOT a replacement for `pendingActionId`, which rides alongside it: that is
 * the ObjectStack `pending_actions` row the approve/reject endpoints take,
 * while this is the runtime's own request id.
 *
 * A missing or empty `id` means there is no envelope to lift — an envelope
 * whose id cannot be replied on is not one.
 */
function liftApproval(part: AnyPart): ChatToolInvocation['approval'] {
  const { approval } = part;
  if (typeof approval !== 'object' || approval === null) return undefined;
  const envelope = approval as {
    id?: unknown;
    approved?: unknown;
    reason?: unknown;
    isAutomatic?: unknown;
    signature?: unknown;
  };
  const { id } = envelope;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  // Each member is checked on its own: a producer that gets one of them wrong
  // should lose that member, not the whole envelope — the `id` is what makes
  // the approval answerable, and it has already been established.
  return {
    id,
    approved: typeof envelope.approved === 'boolean' ? envelope.approved : undefined,
    reason: typeof envelope.reason === 'string' ? envelope.reason : undefined,
    isAutomatic: typeof envelope.isAutomatic === 'boolean' ? envelope.isAutomatic : undefined,
    signature: typeof envelope.signature === 'string' ? envelope.signature : undefined,
  };
}

function extractToolInvocations(
  parts: AnyPart[],
  opts: { liveTail?: boolean } = {},
): ChatToolInvocation[] {
  return parts
    .filter((p) => {
      if (p.type === 'dynamic-tool') return true;
      return typeof p.type === 'string' && p.type.startsWith('tool-');
    })
    .map((p) => {
      const toolName =
        p.type === 'dynamic-tool'
          ? (p.toolName ?? 'tool')
          : typeof p.type === 'string'
            ? p.type.replace(/^tool-/, '')
            : 'tool';
      const toolCallId =
        p.toolCallId ?? p.id ?? `${p.type ?? 'tool'}-${Math.random().toString(36).slice(2, 8)}`;
      const result = p.output ?? p.result;
      const pending = detectPendingApproval(result);
      // A confirm-replay result renders as a terminal state on the ORIGINAL
      // confirm card, never as its own card — in particular a failed in-turn
      // publish must NOT surface as an ordinary draft card with a live Publish
      // button (that is exactly the "narrated success over a rollback" the
      // card exists to prevent, #5695). So a matched replay suppresses the
      // draft-review lift for this invocation.
      const replayOutcome = detectReplayOutcome(toolCallId, result);
      const draftReview = replayOutcome ? undefined : detectDraftResult(result);
      const proposedPlan = detectProposedPlan(result);
      const proposedChanges = detectProposedChanges(result);
      const builderHandoff = detectBuilderHandoff(result);
      const recordHandoff = detectRecordHandoff(result);
      // Promote a dangling `input-*` state to a terminal one so a reloaded
      // conversation never shows "Running" forever (the server doesn't always
      // snapshot the terminal tool state). Two cases:
      //   1. output present → the call finished → Completed.
      //   2. NOT the live streaming tail → the turn that drove this tool has
      //      ENDED, so it cannot still be running, output-snapshot or not.
      // Only the actively-streaming trailing assistant message (`liveTail`)
      // may legitimately keep a tool spinning; everything else is history.
      const persistedState = isToolState(p.state) ? p.state : undefined;
      const isDanglingInput =
        persistedState === 'input-available' || persistedState === 'input-streaming';
      const baseState: ChatToolInvocation['state'] =
        isDanglingInput && (result !== undefined || !opts.liveTail)
          ? 'output-available'
          : persistedState;
      // Promote pending HITL results to `approval-requested` so the UI
      // unlocks the inline approve/reject buttons. Once the operator
      // decides, `useHitlInChat` flips `state` back via the per-call
      // override map and we render the normal output instead.
      const state: ChatToolInvocation['state'] =
        pending && baseState !== 'output-error' ? 'approval-requested' : baseState;
      return {
        toolCallId,
        toolName,
        args: p.input ?? p.args,
        result,
        errorText: p.errorText,
        state,
        approval: liftApproval(p),
        pendingActionId: pending?.pendingActionId,
        draftReview,
        proposedPlan,
        proposedChanges,
        builderHandoff,
        recordHandoff,
        replayOutcome,
      } satisfies ChatToolInvocation;
    });
}

function extractSources(parts: AnyPart[]): ChatSource[] | undefined {
  const sources = parts
    .filter((p) => p.type === 'source-url' || p.type === 'source')
    .map<ChatSource>((p) => ({
      id: p.id,
      title: p.title,
      url: (p.url ?? p.href) as string,
    }))
    .filter((s) => Boolean(s.url));
  return sources.length > 0 ? sources : undefined;
}

/**
 * The build-progress frame vocabulary of `@objectstack/spec/ai`, read through
 * its TYPES (objectui#11988). Both constants are typed by the spec's own
 * declarations, so the compiler refuses a value the spec does not declare and,
 * for the phases, requires a row for every phase it does: neither can drift
 * from the vocabulary. The spec's runtime `BUILD_PROGRESS_PHASES` is not
 * imported: its module does not tree-shake, and a value import of it moved the
 * console's eager closure about 27 KB gzipped over budget (a one-time reading
 * of `pnpm check:eager-closure` against `fff07fbba`, objectui#11988). The
 * type-only import is erased from the published typings, so it asks nothing of
 * the package's spec floor. `buildVerify-11988.test.tsx` reads the runtime
 * array and pins every member.
 */
const BUILD_FRAME_TYPE: typeof BUILD_PROGRESS_FRAME_TYPE = 'data-build-progress';
const BUILD_PHASES: Record<BuildProgressPhase, true> = { structure: true, data: true, verify: true, done: true };

/**
 * The part id cloud's post-apply verification loop reports on (cloud PR #2721's
 * wire shape, cloud#2172 ruling A). It rides the same `data-build-progress`
 * type as the apply_blueprint tree but under its own stable id, so the two
 * reconcile side by side on one message (objectui#11988).
 */
const BUILD_VERIFY_PART_ID = 'build-verify';

/**
 * A frame's phase, read against the spec's closed vocabulary. A value outside
 * it is `unknown` — never coerced to a neighbouring phase, which is how a
 * finished build used to read as "Building" (objectui#7388).
 */
function readBuildPhase(phase: unknown): ChatBuildProgress['phase'] {
  return typeof phase === 'string' && Object.prototype.hasOwnProperty.call(BUILD_PHASES, phase)
    ? (phase as BuildProgressPhase)
    : 'unknown';
}

/** The `data` of the LAST `data-build-progress` part on the message that `pick` keeps. */
function buildFrame(parts: AnyPart[], pick: (id?: string) => boolean): Record<string, unknown> | undefined {
  const data = parts.filter((p) => p.type === BUILD_FRAME_TYPE && pick(p.id)).pop()?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
}

/**
 * The post-apply verification state, from the `build-verify` part: the hop
 * the loop is on and the tool it runs, until a `done` frame closes it.
 */
function extractBuildVerify(parts: AnyPart[]): ChatBuildProgress['verify'] {
  const d = buildFrame(parts, (id) => id === BUILD_VERIFY_PART_ID);
  if (!d) return undefined;
  return {
    phase: readBuildPhase(d.phase),
    ...(typeof d.hop === 'number' ? { hop: d.hop } : {}),
    ...(typeof d.tool === 'string' ? { tool: d.tool } : {}),
  };
}

/**
 * Lift the live build TREE from the stream's reconciled `data-build-progress`
 * part (emitted by apply_blueprint via `ctx.onProgress`). With a stable id the
 * SDK keeps a single, in-place-updated part, so we just read the latest one —
 * of the parts that are not the `build-verify` part, which never displaces the
 * tree (objectui#11988).
 */
function extractBuildProgress(parts: AnyPart[]): ChatBuildProgress | undefined {
  const d = buildFrame(parts, (id) => id !== BUILD_VERIFY_PART_ID);
  if (!d) return undefined;
  const items = Array.isArray(d.items)
    ? (d.items as Array<Record<string, unknown>>)
        .filter((i) => typeof i?.type === 'string' && typeof i?.name === 'string')
        .map((i) => ({ type: i.type as string, name: i.name as string }))
    : [];
  const phase = readBuildPhase(d.phase);
  return {
    phase,
    ...(typeof d.appLabel === 'string' ? { appLabel: d.appLabel } : {}),
    items,
    done: typeof d.done === 'number' ? d.done : items.length,
    total: typeof d.total === 'number' ? d.total : items.length,
    // Monotonic emit counter — advances even on keep-alive heartbeats (identical
    // content), so the build panel can keep its liveness "live" during long
    // quiet seed-generation awaits. Absent on older runtimes.
    ...(typeof d.seq === 'number' ? { seq: d.seq } : {}),
  };
}

/**
 * Lift the live blueprint-DESIGN progress from the stream's reconciled
 * `data-blueprint-progress` part (emitted by `propose_blueprint` via
 * `ctx.onProgress` while it drafts the plan). Same single-reconciled-part
 * mechanism as `data-build-progress` — a stable id keeps one in-place-updated
 * part, so we read the latest frame (objects accrue across frames). Transient:
 * never persisted, so on reload the authoritative `proposedPlan` card (lifted
 * from the persisted tool result) is the record instead of this panel.
 */
function extractBlueprintProgress(parts: AnyPart[]): ChatBlueprintProgress | undefined {
  const part = parts.filter((p) => p.type === 'data-blueprint-progress').pop();
  const data = part?.data;
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  const objects = Array.isArray(d.objects)
    ? (d.objects as Array<Record<string, unknown>>)
        .filter((o) => typeof o?.name === 'string')
        .map((o) => ({
          name: o.name as string,
          ...(typeof o.label === 'string' ? { label: o.label } : {}),
          ...(typeof o.fields === 'number' ? { fields: o.fields } : {}),
        }))
    : [];
  // Only `done` is authoritative; anything else (incl. absent) is still designing.
  const phase: ChatBlueprintProgress['phase'] = d.phase === 'done' ? 'done' : 'designing';
  let counts: ChatBlueprintProgress['counts'];
  if (d.counts && typeof d.counts === 'object') {
    const c = d.counts as Record<string, unknown>;
    const out: { objects?: number; views?: number; dashboards?: number } = {};
    if (typeof c.objects === 'number') out.objects = c.objects;
    if (typeof c.views === 'number') out.views = c.views;
    if (typeof c.dashboards === 'number') out.dashboards = c.dashboards;
    if (Object.keys(out).length > 0) counts = out;
  }
  return {
    phase,
    ...(typeof d.summary === 'string' ? { summary: d.summary } : {}),
    ...(typeof d.appLabel === 'string' ? { appLabel: d.appLabel } : {}),
    ...(typeof d.targetApp === 'string' ? { targetApp: d.targetApp } : {}),
    objects,
    ...(counts ? { counts } : {}),
    // Monotonic emit counter — advances even on keep-alive heartbeats (identical
    // content), so the design panel keeps its liveness "live" during the long,
    // quiet plan-design await. Absent on older runtimes.
    ...(typeof d.seq === 'number' ? { seq: d.seq } : {}),
  };
}

/**
 * Lift charts from the stream's `data-chart` parts (emitted by the
 * `visualize_data` tool via `ctx.onProgress`). Unlike `data-build-progress`
 * (one reconciled part), each chart is emitted with its OWN id, so a single
 * answer may carry several — we keep them all, in arrival order. Each part's
 * `data` already matches the SDUI `<chart>` schema; we defensively narrow it
 * so a malformed payload is dropped rather than rendered broken.
 *
 * objectui#13492 — each chart also records where it arrived among the text
 * parts (`textOffset`: the length of the text {@link extractText} joined
 * before it), so the bubble can render a chart the model drew first above the
 * analysis it wrote after, instead of below all of it. Only when the content
 * IS that join (`anchored`): a legacy string `content` is not built from the
 * parts, so an offset into it would point nowhere and the charts trail it.
 */
function extractCharts(parts: AnyPart[], opts: { anchored: boolean }): ChatChart[] | undefined {
  const charts: ChatChart[] = [];
  let textOffset = 0;
  for (const p of parts) {
    if (p.type === 'text') {
      textOffset += (p.text ?? '').length;
      continue;
    }
    if (p.type !== 'data-chart') continue;
    const d = p.data;
    if (!d || typeof d !== 'object') continue;
    const c = d as Record<string, unknown>;
    const data = Array.isArray(c.data) ? (c.data as Array<Record<string, unknown>>) : [];
    const series = Array.isArray(c.series)
      ? (c.series as Array<Record<string, unknown>>)
          .filter((s) => s && typeof s.dataKey === 'string')
          .map((s) => ({
            dataKey: s.dataKey as string,
            ...(typeof s.label === 'string' ? { label: s.label } : {}),
          }))
      : [];
    // A chart with no series is unrenderable — skip it.
    if (series.length === 0) continue;
    charts.push({
      ...(typeof c.chartType === 'string' ? { chartType: c.chartType as ChatChart['chartType'] } : {}),
      ...(typeof c.title === 'string' ? { title: c.title } : {}),
      data,
      ...(typeof c.xAxisKey === 'string' ? { xAxisKey: c.xAxisKey } : {}),
      series,
      ...(opts.anchored ? { textOffset } : {}),
    });
  }
  return charts.length > 0 ? charts : undefined;
}

/**
 * Map a single Vercel AI SDK v6 `UIMessage` to the `ChatMessage` shape that
 * `<ChatbotEnhanced>` renders.
 *
 * @param msg - AI SDK `UIMessage` (or compatible shape with `parts`).
 * @param opts - Optional flags. `streaming` flags the latest assistant
 *   message during an in-flight stream so the cursor pulse renders.
 */
export function uiMessageToChatMessage(
  msg: AnyUIMessage,
  opts: { streaming?: boolean } = {},
): ChatMessage {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  // Only the live streaming tail may keep tools in a "Running" state; for any
  // other (historical) message a dangling tool state is stale by definition.
  const tools = extractToolInvocations(parts, { liveTail: opts.streaming });
  const legacyTools = Array.isArray(msg.toolInvocations) ? msg.toolInvocations : [];
  const resolvedTools = tools.length > 0 ? tools : legacyTools;
  // The live `data-build-progress` parts are transient (never persisted), so a
  // reloaded whole-app build loses its "Built X" panel. Fall back to a summary
  // synthesized from the apply_blueprint draft envelope — which IS persisted on
  // the tool result — so the panel + its open/preview affordances survive a
  // refresh. Re-derived on every map (incl. useObjectChat's round-trip), so it
  // cannot be lost the way a one-shot hydration value would.
  const tree =
    extractBuildProgress(parts) ??
    resolvedTools
      .map((tool) => buildProgressFromDraftReview(tool.draftReview))
      .find((bp): bp is ChatBuildProgress => Boolean(bp));
  // The verification line rides on the tree it verifies (objectui#11988).
  const verify = extractBuildVerify(parts);
  const buildProgress = tree && verify ? { ...tree, verify } : tree;
  return {
    id: (msg.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`) as string,
    role: (msg.role ?? 'assistant') as ChatMessage['role'],
    content: extractText(msg, parts),
    reasoning: extractReasoning(parts),
    toolInvocations: resolvedTools,
    sources: extractSources(parts),
    buildProgress,
    // Live blueprint-DESIGN progress (propose_blueprint) — a transient stream
    // part like buildProgress. No persisted fallback needed: the `proposedPlan`
    // card (from the persisted tool result) is the post-reload record.
    blueprintProgress: extractBlueprintProgress(parts),
    charts: extractCharts(parts, { anchored: typeof msg.content !== 'string' }),
    streaming: opts.streaming,
  };
}

/**
 * Map an array of `UIMessage`s. The trailing assistant message gets the
 * `streaming` flag when `isStreaming` is true (mirrors `useObjectChat`).
 */
export function uiMessagesToChatMessages(
  messages: AnyUIMessage[],
  opts: { isStreaming?: boolean } = {},
): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const lastIdx = messages.length - 1;
  return messages.map((m, idx) =>
    uiMessageToChatMessage(m, {
      streaming:
        Boolean(opts.isStreaming) && idx === lastIdx && m.role === 'assistant',
    }),
  );
}
