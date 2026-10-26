/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:path` — Salesforce Lightning Path-style stepper. Reads the value
 * of `schema.statusField` from the bound record and highlights the matching
 * stage in `schema.stages[]`. Stages preceding the current one render as
 * completed (with a check); the current renders as active; subsequent
 * stages render as upcoming.
 *
 * When `stages` is absent, the stages come from `statusField`'s picklist on
 * the record's object (objectui#11106) — see the `rawStages` read below.
 *
 * ── This surface is a READOUT, and it must look like one (objectui#5768) ──
 *
 * It used to draw each stage as a filled, shadowed, equal-width pill — the
 * exact shape of a segmented button group — while carrying no handler, no
 * cursor and no tab stop. Measured in a browser on a shipped build: the
 * segments were `role="listitem"` with `cursor: auto` and `tabindex` null,
 * and a full pointer sequence (pointerdown → mousedown → pointerup →
 * mouseup → click) left the record's status untouched. Users spent clicks
 * on it before concluding it was decoration.
 *
 * There is no write path to spend those clicks on: this renderer's only
 * channel is `useRecordContext()`, whose value (`RecordContextValue` in
 * `@object-ui/react`) exposes `data` / `refresh` / `headerSystemActions` /
 * `onToggleFavorite` and NO record-field mutation. Editing goes through
 * `record:details`' `<InlineEditProvider>` + `<InlineEditSaveBar>`
 * (`dataSource.update(..., { ifMatch })`) or an action via
 * `useActionEngine`; neither reaches here. Click-to-advance is a separate,
 * approved-on-its-own-appetite feature — until it exists, the pixels must
 * not promise it.
 *
 * So the presentation below is a PROGRESS RAIL: a thin decorative indicator
 * per stage with the label as plain text beneath it, which is the same
 * vocabulary app-shell's approval step readout already uses
 * (`RecordApprovalsPanel` — marker, rail, bare label, weight for "current",
 * never a filled surface). Deliberately absent: per-stage filled pills,
 * `shadow`, `ring`, bordered chips, and equal-width tap targets.
 *
 * The DOM attributes below carry state that used to live only in colour, so
 * the classification stays assertable without reading CSS (the test DOM
 * resolves no Tailwind):
 *   • `data-stage-state`     — `completed` | `current` | `upcoming`
 *   • `data-stage-terminal`  — `won` | `lost`, when a stage is classified
 *   • `data-stage-rail`      — marks the decorative indicator as an element
 *                              SEPARATE from the label. A rail has one; a
 *                              pill, which is its own label's surface, cannot.
 *
 * Those are TEST instruments, not accessibility: a `data-*` attribute is not in
 * the accessibility tree. The same state reaches a screen reader through each
 * stage's composed `aria-label` (objectui#5916) — see `stageAriaLabel` below.
 */

import React from 'react';
import { useRecordContext, useSafeFieldLabel } from '@object-ui/react';
import { useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import type { RecordPathComponentProps } from '@object-ui/types';
import { cn } from '@object-ui/components';
import { useDetailTranslation } from '../useDetailTranslation';
import { declaredStageKinds, deriveStages, stageTerminalOfKind } from '../synth/buildDefaultPageSchema';
import { useRecordAriaProps } from './recordComponentAria';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

type StageState = 'completed' | 'current' | 'upcoming';

type PathStage = { value: unknown; label: string; terminal?: 'won' | 'lost' };

/**
 * `stages[].label` is an `I18nLabel` in the spec row
 * (`ComponentPropsMap['record:path']`): a plain string or an inline per-locale
 * map, and the row accepts the map (objectui#10993). This block read the member
 * raw, as the stage's visible text node and as the `stage` value of its
 * composed accessible name, so a map threw "Objects are not valid as a React
 * child" and the node rendered `Component "record:path" failed to render`.
 *
 * Resolved HERE, before anything reads a stage, for the reason `object-form`'s
 * labels are resolved above its `formType` fork: every later read wants the
 * text. That is three reads, not two: the picklist translation below keeps the
 * authored label as its fallback, and `classify()` probes `value + label` for
 * its won/lost tokens, so a map left raw there would probe `[object Object]`
 * and a lost stage authored as a map would stop reading as lost.
 *
 * `pickLocalized` against `useObjectTranslation().language`, the UI language:
 * the source this package's other visible `record:*` labels resolve against
 * (`record:related_list.title`, `record:alert.title`), and the language the
 * composed accessible name's state words come from, so one name never mixes
 * two languages. Only the map arm is touched: a string, or any other value, is
 * handed on as authored, and the input is returned untouched when no stage
 * carries a map.
 */
function localizeStageLabels(stages: unknown, language: string): PathStage[] {
  if (!Array.isArray(stages)) return [];
  let out: PathStage[] | null = null;
  for (let idx = 0; idx < stages.length; idx++) {
    const stage = stages[idx];
    const label: unknown = stage?.label;
    if (label === null || typeof label !== 'object') continue;
    out ??= [...stages];
    out[idx] = { ...stage, label: pickLocalized(label, language) };
  }
  return out ?? (stages as PathStage[]);
}

export interface RecordPathRendererProps {
  schema?: RecordPathComponentProps & Record<string, any>;
  className?: string;
  [k: string]: any;
}

export const RecordPathRenderer: React.FC<RecordPathRendererProps> = ({
  schema = {} as any,
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const { translateOptions } = useSafeFieldLabel();
  const { t } = useDetailTranslation();
  const { designer } = splitDesigner(props);
  /**
   * The two rails' ARIA, through the family's ONE read point (objectui#9556).
   *
   * This site used to read `(schema.aria as any)?.label` and nothing else — the
   * ONE spelling the shared ARIA shape refuses, while `RecordPathProps.aria`
   * itself parses green. So a spec-valid `aria: { ariaLabel: 'Deal stages' }`
   * was accepted at publish and discarded here, and the spelling that did win
   * is one no author can write without the contract rejecting the document:
   * the same dead-read-point pair objectui#4663 repaired on
   * `record:quick_actions`, still open on this block. The cast is what hid it —
   * `schema.aria` is declared, `.label` is not, and `as any` silenced the
   * member check that would have said so.
   *
   * `defaultRole: 'list'` is the role both rails already carry, so the stages'
   * `listitem` children keep their owner; an author's `aria.role` overrides it,
   * which is the precedence `ListView` ships. `defaultLabel` is the localized
   * pack entry this block has fallen back to since objectui#5956.
   */
  const railAria = useRecordAriaProps(schema.aria, {
    defaultRole: 'list',
    defaultLabel: t('detail.pathLabel'),
    // Named so a served `aria.label` is REPORTED (objectui#9945): this block
    // read that spelling and nothing else before objectui#9556, so a stored
    // document may still carry it. It is no longer read; the rails announce
    // `defaultLabel` above instead, and the report says why.
    block: 'record:path',
  });

  // The UI language `stages[].label` resolves against — see
  // `localizeStageLabels` (objectui#10993).
  const { language } = useObjectTranslation();
  const statusField: string | undefined = schema.statusField;
  /**
   * WHERE the stages come from: the author, else the status field's picklist
   * (objectui#11106).
   *
   * `stages` is optional in the spec row (`ComponentPropsMap['record:path']`),
   * described as "Explicit stage definitions (if not using field metadata)",
   * and this package's registration repeats the promise. Only the synthesized
   * default page kept it: `buildDefaultHighlights` derives the stages and
   * writes them into the node it emits, so an AUTHORED node that set only
   * `statusField` rendered the "no stages configured" placeholder while its
   * object declared the picklist.
   *
   * The derivation is `deriveStages`, the ONE rule the default page uses, read
   * from the synth module the way `record:details` reads
   * `deriveFieldGroupDetailSections`. ⛔ Never a second copy here: two rules
   * that agree today are one edit from a default page and an authored page
   * showing different stages for the same field. Its object definition is the
   * record context's `objectSchema`, the metadata the host already bound and
   * that `record:details` and `record:highlights` read; no fetch is added.
   *
   * "Absent" is `undefined` — the spec row's `.optional()`. Authored stages
   * win, an empty list included: that author declared zero stages, and the
   * placeholder below says exactly that. Derived stages then take the same
   * road authored ones do: `localizeStageLabels`, then the picklist
   * translation below, then `classify()`.
   *
   * `RecordPathComponentProps` types `stages` as required, narrower than the
   * spec row; the read goes through `unknown` so this branch is not typed
   * unreachable.
   */
  const authoredStages: unknown = schema.stages;
  const derivesStages = authoredStages === undefined;
  const objectSchema = ctx?.objectSchema;
  const rawStages: PathStage[] = React.useMemo(
    () =>
      localizeStageLabels(
        derivesStages ? deriveStages(objectSchema, statusField ?? null) : authoredStages,
        language,
      ),
    [derivesStages, authoredStages, objectSchema, statusField, language],
  );
  // Localize picklist labels when an i18n provider is mounted and the
  // record context knows which object owns the field. Falls back to the
  // schema's own labels (already English in synth, possibly authored in
  // any language for full Lightning pages) when no translation is found.
  const stages: PathStage[] = React.useMemo(() => {
    if (rawStages.length === 0 || !statusField || !ctx?.objectName) return rawStages;
    const translated = translateOptions(ctx.objectName, statusField, rawStages as any);
    if (Array.isArray(translated) && translated.length === rawStages.length) {
      return rawStages.map((s, i) => ({ ...s, label: (translated as any)[i]?.label ?? s.label }));
    }
    return rawStages;
  }, [rawStages, statusField, ctx?.objectName, translateOptions]);
  const current = statusField && ctx?.data ? (ctx.data as any)[statusField] : undefined;

  // The lifecycle `kind` the status field's options declare (objectui#12907),
  // read off the same `objectSchema` the derivation above reads.
  const declaredKinds = React.useMemo(
    () => declaredStageKinds(objectSchema, statusField ?? null),
    [objectSchema, statusField],
  );

  // Classify each stage, in three steps:
  //   1. an explicit `terminal` on the stage;
  //   2. the `kind` its option declares on the status field (objectui#12907)
  //      — `open` included, which is how a declared open stage spelled like a
  //      terminal stays a middle step: the spec's strict `stages[]` row can
  //      carry `won` / `lost`, so step 1 cannot say "open";
  //   3. only for options that declare no kind, a spelling heuristic, so CRM
  //      examples / Salesforce-style picklists ("closed_won", "closed_lost",
  //      "失败", "流失") get the right treatment without a migration.
  const LOST_TOKENS = /(^|[_-\s])(closed_)?(lost|failed?|cancell?ed|失败|流失|丢单|败)([_-\s]|$)/i;
  const WON_TOKENS = /(^|[_-\s])(closed_)?(won|success|成交|赢|完成)([_-\s]|$)/i;
  const classify = (s: { value: any; label?: string; terminal?: 'won' | 'lost' }): 'won' | 'lost' | undefined => {
    if (s.terminal) return s.terminal;
    const declared = declaredKinds?.get(s.value);
    if (declared !== undefined) return stageTerminalOfKind(declared);
    const probe = `${String(s.value ?? '')} ${String(s.label ?? '')}`;
    if (LOST_TOKENS.test(probe)) return 'lost';
    if (WON_TOKENS.test(probe)) return 'won';
    return undefined;
  };
  const stageKinds = stages.map(classify);
  // Find the index of the FIRST lost-class stage so we can render it
  // (and any subsequent lost terminals) as a visually separated alt
  // group. Won-class stages stay inside the forward path — they're the
  // successful terminus.
  const firstLostIdx = stageKinds.findIndex((k) => k === 'lost');
  const forwardStages = firstLostIdx === -1 ? stages : stages.slice(0, firstLostIdx);
  const lostStages = firstLostIdx === -1 ? [] : stages.slice(firstLostIdx);
  // ── ONE classification, computed once, read by BOTH rows (objectui#5998) ──
  //
  // The desktop and the mobile row below render the same `stages[]`, and each
  // used to derive its own `terminal` from it independently — desktop from a
  // `forwardKinds` slice under an `idx === last` restriction, mobile from
  // `stageKinds` under none — so ONE stage of ONE record could paint (and,
  // since objectui#5957, announce) two different ways chosen by nothing but
  // viewport width. They diverged on TWO axes, not only the one the card named:
  //
  //   1. `idx === last`. `WON_TOKENS` matches `完成`, an ordinary mid-path word,
  //      so `草稿 → 完成 → 已归档` classified index 1 as `won`: desktop declined
  //      it (not the last forward stage), mobile marked it the goal.
  //   2. The lost slice. Desktop hardcoded `terminal: 'lost'` onto EVERY stage
  //      of the separated alt group — a group defined POSITIONALLY, as
  //      `stages.slice(firstLostIdx)` — while mobile classified each stage on
  //      its own. So in `草稿 → 失败 → 已归档`, desktop painted `已归档`
  //      destructive and announced it `closed lost`; mobile painted it plain.
  //
  // Both are settled here, in one array both rows index, so a future divergence
  // is IMPOSSIBLE rather than merely absent — two rows that happen to agree
  // would leave the defect one edit away. The rule: `lost` is a property of the
  // STAGE; `won` is the GOAL TERMINUS, so it is the last forward stage or it is
  // nothing. Positional grouping stays a LAYOUT concern and no longer overrides
  // what a stage is.
  //
  // Conservative on both axes: this can only ever STOP marking a stage as a
  // terminus, never start. No stage gains a `terminal` on either row that it
  // did not already carry on that row.
  const lastForwardIdx = forwardStages.length - 1;
  const stageTerminals: Array<'won' | 'lost' | undefined> = stageKinds.map((kind, idx) =>
    kind === 'won' ? (idx === lastForwardIdx ? 'won' : undefined) : kind,
  );

  let currentIdx = stages.findIndex((s) => s.value === current);
  if (currentIdx < 0) currentIdx = -1;
  const currentInLost = firstLostIdx !== -1 && currentIdx >= firstLostIdx;

  if (stages.length === 0) {
    // Names the field when the derivation had an object definition to read
    // and found no picklist options on `statusField` (objectui#11106): the
    // author learns which field to fix, or that `stages` must be authored.
    // With no definition bound (a designer palette, a host still loading),
    // nothing is known about the field, so the plain wording stays.
    const underivable = derivesStages && !!statusField && objectSchema != null;
    return (
      <div className={className} {...designer}>
        <div className="text-xs text-muted-foreground italic px-3 py-2 border border-dashed rounded">
          {underivable
            ? `record:path — no stages configured, and field "${statusField}" has no picklist options to derive them from`
            : 'record:path — no stages configured'}
        </div>
      </div>
    );
  }

  // The rail: a 6px track segment. Completed reads as travelled (emerald,
  // matching the approvals readout's `done`), current as where the record
  // sits (accent), upcoming as untravelled track. A `lost` terminal tints
  // destructive; an unreached `won` terminus stays a faint emerald so the
  // goal is legible without being a surface you could press.
  const railClass = (state: StageState, terminal?: 'won' | 'lost') =>
    cn(
      'h-1.5 w-full rounded-full',
      terminal === 'lost' && (state === 'current' ? 'bg-destructive' : 'bg-destructive/25'),
      terminal !== 'lost' && state === 'current' && 'bg-primary',
      terminal !== 'lost' && state === 'completed' && 'bg-emerald-500',
      terminal !== 'lost' && state === 'upcoming' && (terminal === 'won' ? 'bg-emerald-500/30' : 'bg-muted'),
    );

  // Emphasis by TYPE WEIGHT, not by a filled box — the one cue a readout can
  // spend without implying it can be pressed.
  const labelClass = (state: StageState, terminal?: 'won' | 'lost') =>
    cn(
      'block min-w-0 text-xs',
      state === 'current' && (terminal === 'lost' ? 'font-semibold text-destructive' : 'font-semibold text-foreground'),
      state === 'completed' && 'font-normal text-muted-foreground',
      state === 'upcoming' && 'font-normal text-muted-foreground',
    );

  // ── The stage's STATE, in its ACCESSIBLE NAME (objectui#5916) ──────────────
  //
  // Travelled / upcoming / lost used to reach a screen reader through colour and
  // a glyph, and the glyph is `aria-hidden` decoration, so a rejected stage
  // announced exactly like an unreached one — WCAG 2.2 SC 1.4.1. `aria-current`
  // marked the current stage and nothing else.
  //
  // Shape: an `aria-label` on the listitem, NOT visually-hidden text inside it.
  // That is a measurement, not a preference — `listitem` takes its name from the
  // AUTHOR only (it is not a name-from-contents role), so `sr-only` text placed
  // in the item computes to an EMPTY accessible name and would satisfy a DOM
  // assertion while delivering nothing to the accessibility tree. The composed
  // label re-states `stage.label` — the same already-picklist-localized variable
  // the visible text renders — so the name can never drift from what is on
  // screen, and the ✓/✗ stay decorative.
  const stageAriaLabel = (label: string, state: StageState, terminal?: 'won' | 'lost'): string => {
    if (terminal === 'lost') {
      return state === 'current'
        ? t('detail.pathStageLostCurrent', { stage: label })
        : t('detail.pathStageLostUpcoming', { stage: label });
    }
    // ── The GOAL terminus, when it has NOT been reached (objectui#5957) ────
    //
    // `railClass` above paints an unreached `won` terminus `bg-emerald-500/30`
    // where an ordinary unreached stage gets `bg-muted` — its own note calls
    // this "a faint emerald so the goal is legible". That legibility was carried
    // by HUE ALONE: two stages ahead of the record painted differently and
    // announced identically as `{{stage}}, upcoming`. Same WCAG 2.2 SC 1.4.1
    // class objectui#5916 closed, on the one distinction it left behind, and
    // reachable without authors opting in — `classify()` reaches `won` from an
    // explicit `terminal: 'won'` AND from the `WON_TOKENS` heuristic.
    //
    // Scoped to `upcoming` deliberately, and that scope is a MEASUREMENT of the
    // stylesheet above rather than a preference. The defect is information
    // carried by colour alone, so the name may only restate a distinction the
    // colour actually makes:
    //
    //   • upcoming  + won → `bg-emerald-500/30`, against `bg-muted` for a plain
    //                       upcoming stage. A real distinction: it gets a name.
    //   • current   + won → `bg-primary`, identical to every other current
    //                       stage. No visual distinction exists, so announcing
    //                       one would GIVE a screen-reader user information a
    //                       sighted user does not get — the mirror image of the
    //                       defect, and dead copy in ten packs besides.
    //   • completed + won → `bg-emerald-500`, again identical to every other
    //                       completed stage. Same answer.
    //
    // So a REACHED goal terminus keeps announcing as an ordinary current /
    // completed stage. One new key, not a pair.
    //
    // `terminal` here is the SAME value `renderStage` hands `railClass`, so the
    // name tracks the paint on each row by construction, not by a second and
    // drift-prone classification.
    if (terminal === 'won' && state === 'upcoming') return t('detail.pathStageWonUpcoming', { stage: label });
    if (state === 'current') return t('detail.pathStageCurrent', { stage: label });
    if (state === 'completed') return t('detail.pathStageCompleted', { stage: label });
    return t('detail.pathStageUpcoming', { stage: label });
  };

  const renderStage = (o: {
    key: string;
    stage: { label: string };
    state: StageState;
    terminal?: 'won' | 'lost';
    className?: string;
    labelClassName?: string;
  }) => (
    <div
      key={o.key}
      role="listitem"
      data-stage-state={o.state}
      data-stage-terminal={o.terminal}
      aria-current={o.state === 'current' ? 'step' : undefined}
      aria-label={stageAriaLabel(o.stage.label, o.state, o.terminal)}
      className={cn('flex flex-col gap-1.5', o.className)}
    >
      <span aria-hidden="true" data-stage-rail="" className={railClass(o.state, o.terminal)} />
      <span className={cn(labelClass(o.state, o.terminal), o.labelClassName)}>
        {o.terminal === 'lost' && <span aria-hidden="true" className="mr-1 opacity-70">✗</span>}
        {o.terminal !== 'lost' && o.state === 'completed' && (
          <span aria-hidden="true" className="mr-1 text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>
        )}
        {o.stage.label}
      </span>
    </div>
  );

  return (
    <div className={cn('w-full', className)} {...designer}>
      {/* Desktop: forward rail → optional lost-alt group */}
      <div
        className="hidden sm:flex w-full items-start gap-2"
        {...railAria}
      >
        <div className="flex flex-1 items-start gap-1.5">
          {forwardStages.map((stage, idx) => {
            const isCompleted = !currentInLost && currentIdx >= 0 && idx < currentIdx;
            const isCurrent = !currentInLost && idx === currentIdx;
            return renderStage({
              key: `${stage.value}-${idx}`,
              stage,
              state: isCurrent ? 'current' : isCompleted ? 'completed' : 'upcoming',
              terminal: stageTerminals[idx],
              className: 'flex-1 min-w-0',
              labelClassName: 'text-center truncate',
            });
          })}
        </div>
        {lostStages.length > 0 && (
          // Separated alt-terminus group — a gap and a divider, so it does not
          // read as "step N+1" in the forward path. That separation is PURELY
          // VISUAL, and deliberately carries no accessible name (objectui#5956).
          //
          // It used to label this bare `div` "Alternative terminal stages"
          // through ARIA. A `div` has the `generic` role, which browsers do not
          // expose an accessible name on, so that string reached nobody: it was
          // INERT, not merely untranslated, and translating it would have shipped
          // copy to ten packs that no user can hear. The two live options were to
          // give this wrapper a role that takes a name (`group`) or to drop the
          // label. Dropping it wins on three measurements:
          //
          //   1. Nothing is lost. The label was never announced, so no user's
          //      experience changes by removing it — whereas NAMING the group is
          //      new verbosity on every traversal of this row.
          //   2. It would be redundant. Every stage inside already announces
          //      `closed lost` in the session locale (objectui#5916,
          //      `detail.pathStageLost*`), so "these are alternative terminal
          //      stages" is already carried item by item, in the one place
          //      `role="list"` can carry it. The forward/alt distinction is
          //      ALREADY in the accessible name.
          //   3. It would fork the two rows. The mobile row below renders every
          //      stage in ONE flat list with no alt group at all, so a named
          //      group here would make one control expose two different
          //      structures by viewport — against the invariant
          //      `record-path.stageStateAccessibleName.i18n.test.tsx` states
          //      ("both rows carry identical names").
          //
          // So the wrapper stays a presentational box.
          <div className="flex items-start gap-1.5 pl-2 border-l border-border/40">
            {lostStages.map((stage, lIdx) => {
              const absIdx = firstLostIdx + lIdx;
              return renderStage({
                key: `${stage.value}-lost-${lIdx}`,
                stage,
                state: absIdx === currentIdx ? 'current' : 'upcoming',
                terminal: stageTerminals[absIdx],
                className: 'shrink-0',
                labelClassName: 'text-center whitespace-nowrap',
              });
            })}
          </div>
        )}
      </div>

      {/* Mobile: horizontally scrollable rail row — same treatment, no chips */}
      <div
        className="flex sm:hidden w-full items-start gap-2 overflow-x-auto pb-1 -mx-1 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        {...railAria}
      >
        {stages.map((stage, idx) => {
          const terminal = stageTerminals[idx];
          const isLost = terminal === 'lost';
          const isCompleted = !isLost && !currentInLost && currentIdx >= 0 && idx < currentIdx;
          const isCurrent = idx === currentIdx;
          return renderStage({
            key: `${stage.value}-${idx}-m`,
            stage,
            state: isCurrent ? 'current' : isCompleted ? 'completed' : 'upcoming',
            terminal,
            className: 'shrink-0',
            labelClassName: 'whitespace-nowrap',
          });
        })}
      </div>
    </div>
  );
};

export default RecordPathRenderer;
