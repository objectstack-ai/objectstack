/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Data pillar — Actions view.
 *
 * Actions carry an `objectName` and defineStack() folds them into the object's
 * inline `actions[]` array — so, like validations, they live ON the object
 * draft and are edited via `onPatch({ actions })` + the object's Save draft.
 * This is the object-scoped slice of Salesforce's "Buttons, Links & Actions".
 *
 * Master-detail: a left list of the object's actions, and on the right the
 * REAL `action` metadata form — the registered type-aware ActionDefaultInspector
 * (getMetadataDefaultInspector('action')), the same editor the metadata admin
 * uses — rather than a hand-rolled panel. Selecting an action feeds that one
 * array element to the inspector; its onPatch writes the element back into the
 * array. Global actions (no objectName) are not object-scoped and live elsewhere.
 *
 * ## Starting points (objectui#11861)
 *
 * "New" opens on the presets of `actionPresets.ts` — each an action of a shape
 * the spec already has, labelled by what it does — and the blank action, the
 * starting point every type and operation is reached from, under "Advanced".
 * A preset whose object lacks what it needs is listed disabled, saying what.
 *
 * ## A new action waits for its target
 *
 * A preset that opens a flow, a page or a web address cannot know which one:
 * the spec refuses such an action without a `target`, so it is held HERE, in
 * the panel, until it has one — listed and edited like any action, marked as
 * not saved, with the line the Data pillar uses for an edit it holds
 * (objectui#11786, `engine.studio.held.line`) naming the input. The first edit
 * that gives it a target writes it to the draft; from then on it is an ordinary
 * action. Same hold, and same known cost, as a new validation rule waiting for
 * its condition (objectui#11820, `ObjectValidationsPanel.tsx`): leaving the
 * view or the object first drops it, and Publish does not wait for it.
 */

import React from 'react';
import { Ban, Zap, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@object-ui/components';
import { getIcon } from '../../utils/getIcon.js';
import { useRegisteredMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry.js';
import type { I18nLabel } from '@objectstack/spec/ui';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { readFields } from '../metadata-admin/previews/object-fields-io.js';
import { navItemLabelText } from '../metadata-admin/previews/navItemLabel.js';
import {
  ACTION_PRESETS,
  heldInputKey,
  type ActionPreset,
  type ActionPresetPlan,
  type ActionPresetFieldOpt,
} from './actionPresets.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';

interface ActionItem {
  name?: string;
  /** `ActionSchema.label`: an `I18nLabel`, a plain string or an inline locale map. */
  label?: I18nLabel;
  icon?: unknown;
  type?: unknown;
  [key: string]: unknown;
}

function readActions(input: unknown): ActionItem[] {
  if (!Array.isArray(input)) return [];
  return input.filter((a): a is ActionItem => !!a && typeof a === 'object');
}

/** A fresh, unique, snake_case action name scoped to the object. */
function nextActionName(objectName: string, existing: string[]): string {
  const base = (objectName || 'action').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const taken = new Set(existing);
  let i = existing.length + 1;
  let name = `${base}_action_${i}`;
  while (taken.has(name)) name = `${base}_action_${++i}`;
  return name;
}

/**
 * An action's `label` in the designer `locale`, or `fallback` (the action's
 * name) when it has none. A plain string is shown as authored. A locale map is
 * read through `navItemLabelText`, the helper the Studio's other `I18nLabel`
 * readers share, so the entry chosen is the spec's `resolveI18nLabel` choice
 * for this locale (objectui#11181). ⛔ Never keep a second copy of that key
 * order here, and never render a map raw.
 */
function labelText(label: I18nLabel | undefined, fallback: string, locale: string): string {
  return label == null ? fallback : navItemLabelText(label, locale);
}

export function ObjectActionsPanel({
  draft,
  onPatch,
  disabled,
  actionSchema,
  onBlockingIssuesChange,
}: {
  draft: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  /**
   * Report how many BLOCKING author-time issues the selected action's editor is
   * showing — `visible` / `disabled` predicates whose CEL does not parse
   * (objectui#4527). This panel owns no Save; the object draft's "Save draft"
   * writes the actions, so the Data pillar holds this count and refuses.
   */
  onBlockingIssuesChange?: (count: number) => void;
  /**
   * The live server JSONSchema for the `action` type (`/meta/types`). Handed to
   * ActionDefaultInspector as `serverSchema` so its "More fields" section can
   * edit any spec property not curated above — keeping this a faithful,
   * forward-compatible config panel for the action metadata.
   */
  actionSchema?: Record<string, unknown>;
}) {
  const locale = useMetadataLocale();
  const actions = React.useMemo(() => readActions(draft.actions), [draft.actions]);
  const objectName = typeof draft.name === 'string' ? draft.name : '';
  // objectui#11861 — new actions still waiting for their target: listed and
  // edited here, and NOT in the draft (see "A new action waits for its target"
  // above). Each is kept with the object it was started on (`on`, not the
  // action's own `objectName`, which the editor can change), so it never shows
  // on another object's list.
  const [held, setHeld] = React.useState<Array<{ on: string; action: ActionItem }>>([]);
  const heldHere = React.useMemo(
    () => held.filter((h) => h.on === objectName).map((h) => h.action),
    [held, objectName],
  );
  const listed = React.useMemo(() => [...actions, ...heldHere], [actions, heldHere]);
  // What each held action still needs, by name: the catalogue key of the input.
  const heldNeeds = React.useMemo(
    () => new Map(heldHere.map((a) => [String(a.name ?? ''), heldInputKey(a)])),
    [heldHere],
  );
  const [selected, setSelected] = React.useState<string | null>(null);
  // Default-select the first action so the detail pane isn't a dead end when
  // actions exist; fall back when the selection no longer matches.
  const effectiveSelected = listed.some((a) => a.name === selected) ? selected : (listed[0]?.name ?? null);
  const sel = listed.find((a) => a.name === effectiveSelected) ?? null;
  const selHeldInput = heldNeeds.get(String(effectiveSelected ?? '')) ?? null;

  // Observed (objectui#11939): an action inspector registered after this panel
  // mounted replaces the "no editor" pane below without a remount.
  const Inspector = useRegisteredMetadataDefaultInspector('action');

  // Apply a shallow patch to the SELECTED action within the object's inline
  // actions array, then hand the whole array back up so the object draft (and
  // its Save draft) owns persistence — exactly like ObjectValidationsPanel.
  // A held action (objectui#11861) is patched here instead, and written to the
  // draft by the first patch that leaves it needing no input.
  const patchSelected = React.useCallback(
    (patch: Record<string, unknown>) => {
      if (!sel) return;
      if (heldNeeds.has(String(sel.name ?? ''))) {
        const next = { ...sel, ...patch };
        const mine = (h: { on: string; action: ActionItem }) => h.on === objectName && h.action.name === sel.name;
        if (heldInputKey(next) === null) {
          onPatch({ actions: [...actions, next] });
          setHeld((prev) => prev.filter((h) => !mine(h)));
        } else {
          setHeld((prev) => prev.map((h) => (mine(h) ? { on: h.on, action: next } : h)));
        }
      } else {
        onPatch({ actions: actions.map((a) => (a.name === sel.name ? { ...a, ...patch } : a)) });
      }
      if (typeof patch.name === 'string' && patch.name !== sel.name) setSelected(patch.name);
    },
    [actions, heldNeeds, objectName, sel, onPatch],
  );

  /* ─── Blocking CEL verdicts → the Data pillar's Save gate (objectui#4527) ──
   *
   * Master-detail: only the SELECTED action's inspector is mounted, so the map
   * is keyed by action NAME and a verdict deliberately survives deselection —
   * an action whose predicate does not parse is still in the document and
   * saving would still publish it, and it stays reachable by selecting it
   * again. A DELETED action's inspector can never report `0`, so the total is
   * DERIVED against the live action-name set rather than repaired by an effect.
   */
  const [celErrors, setCelErrors] = React.useState<Record<string, number>>({});
  const reportCel = React.useCallback((actionName: string, count: number) => {
    setCelErrors((prev) => (prev[actionName] === count ? prev : { ...prev, [actionName]: count }));
  }, []);
  const liveActionNames = React.useMemo(
    () => new Set(actions.map((a) => String(a.name ?? ''))),
    [actions],
  );
  const blockingIssues = React.useMemo(() => {
    let total = 0;
    for (const [name, count] of Object.entries(celErrors)) {
      if (!liveActionNames.has(name)) continue; // pruned: the action is gone
      total += count;
    }
    return total;
  }, [celErrors, liveActionNames]);
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  // objectui#11861 — the blank action, under New's "Advanced": what New wrote
  // before the presets, unchanged. Its name is unique among the held actions
  // too.
  const addAction = React.useCallback(() => {
    const name = nextActionName(objectName, listed.map((a) => String(a.name ?? '')));
    // Minimal *valid* skeleton, and a DECLARATIVE one (objectui#11820): an
    // "Update fields on this record" action — `operation: 'update'` with an
    // empty `patch` — bound to this object. It used to start as a script with a
    // sandboxed-JS body, so the first thing every new action offered was code.
    //
    // Why this declarative shape and no other: it is the only one the spec
    // accepts with nothing filled in. `update_field` is not an `ActionType`;
    // the field write is `operation: 'update'` beside the default `script`
    // route (spec #14092), and every other declarative type (`url`, `flow`,
    // `modal`, `api`, `form`) is refused without a `target`, so its skeleton
    // would 422 the object draft on the first autosave. An empty `patch` is
    // accepted at authoring; the author adds field values in the "What it
    // does" editor (until then the spec's executor contract answers a click
    // with a refusal for an empty write, not a success — the `patch` row of
    // `@objectstack/spec`'s action liveness ledger). `type` is left off, as the
    // spec asks of an update action: it defaults to `script`, the route the
    // write is performed on. `newActionPin` parses this skeleton through the
    // spec's `ActionSchema` and `ObjectSchema`.
    //
    // `locations` is seeded for the same reason as before (objectui#3142): an
    // action that declares no location renders in no located surface, so an
    // unseeded skeleton would save clean and then be invisible everywhere — the
    // author would have no button to click and nothing to tell them why.
    // Placement stays fully editable in the Placement checkboxes;
    // `record_header` is just the starting point (an update action may not sit
    // in `list_toolbar`, which has no current record).
    const fresh: ActionItem = {
      name,
      label: t('engine.studio.actions.newLabel', locale),
      objectName,
      locations: ['record_header'],
      operation: 'update',
      patch: {},
    };
    onPatch({ actions: [...actions, fresh] });
    setSelected(name);
  }, [actions, listed, objectName, onPatch, locale]);

  // objectui#11861 — what each preset would do on THIS object, read before the
  // author picks one so its menu row can say which field it asks about, or
  // what the object lacks.
  const presetFields = React.useMemo<ActionPresetFieldOpt[]>(
    () =>
      readFields(draft.fields).entries.map((e) => ({
        name: e.name,
        label: typeof e.def.label === 'string' ? (e.def.label as string) : undefined,
        type: typeof e.def.type === 'string' ? (e.def.type as string) : undefined,
        hidden: e.def.hidden === true,
        system: e.def.system === true,
        readonly: e.def.readonly === true,
      })),
    [draft.fields],
  );
  const presetPlans = React.useMemo(
    () => ACTION_PRESETS.map((preset: ActionPreset) => ({ preset, plan: preset.plan(presetFields, locale) })),
    [presetFields, locale],
  );
  const [addOpen, setAddOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const presetIds = React.useId();
  // objectui#12514 — the header's "New": where the menu hands focus back once
  // the empty block that opened it has given way to the list.
  const headerNewRef = React.useRef<HTMLButtonElement>(null);

  /**
   * objectui#11861 — the seed the blank action starts from (name, label,
   * object, placement), then the keys the preset fills. Its target decides the
   * rest: none needed ⇒ written now; one the spec needs ⇒ held until given.
   */
  const addPreset = (plan: Extract<ActionPresetPlan, { ready: true }>) => {
    const name = nextActionName(objectName, listed.map((a) => String(a.name ?? '')));
    const fresh: ActionItem = {
      name,
      label: t('engine.studio.actions.newLabel', locale),
      objectName,
      locations: ['record_header'],
      ...plan.keys,
    };
    if (heldInputKey(fresh) === null) onPatch({ actions: [...actions, fresh] });
    else setHeld((prev) => [...prev, { on: objectName, action: fresh }]);
    setSelected(name);
  };

  const removeAction = React.useCallback(
    (name: string) => {
      if (heldNeeds.has(name)) {
        setHeld((prev) => prev.filter((h) => !(h.on === objectName && h.action.name === name)));
      } else {
        onPatch({ actions: actions.filter((a) => a.name !== name) });
      }
      setSelected(null);
    },
    [actions, heldNeeds, objectName, onPatch],
  );

  const headerTrigger = (
    <button
      ref={headerNewRef}
      type="button"
      className="ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
    >
      <Plus className="h-3 w-3" /> {t('engine.studio.new', locale)}
      <ChevronDown className="h-3 w-3 text-muted-foreground" />
    </button>
  );
  // objectui#12514 — the one "New" menu. While the object holds no action it
  // opens from the empty block's button, and once the first one lists it hands
  // focus to the header's "New", the trigger that is then on the page.
  const menuFromEmpty = listed.length === 0;
  const addMenu = (
    <Popover
      open={addOpen}
      onOpenChange={(open) => {
        setAddOpen(open);
        // Every opening starts on the presets, Advanced folded.
        if (open) setAdvancedOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        {menuFromEmpty ? (
          <StudioEmptyStateAction data-testid="actions-empty-new" label={t('engine.studio.actions.newButton', locale)} />
        ) : (
          headerTrigger
        )}
      </PopoverTrigger>
      <PopoverContent
        align={menuFromEmpty ? 'center' : 'end'}
        sideOffset={4}
        className="w-64 p-1"
        onCloseAutoFocus={(e) => {
          if (menuFromEmpty && headerNewRef.current) {
            e.preventDefault();
            headerNewRef.current.focus();
          }
        }}
      >
        <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('engine.studio.actions.presets', locale)}
        </p>
        {presetPlans.map(({ preset, plan }) => (
          <button
            key={preset.id}
            type="button"
            data-testid={`action-preset-${preset.id}`}
            disabled={!plan.ready}
            aria-labelledby={`${presetIds}-${preset.id}-label`}
            aria-describedby={plan.hint ? `${presetIds}-${preset.id}-hint` : undefined}
            onClick={() => {
              if (!plan.ready) return;
              addPreset(plan);
              setAddOpen(false);
            }}
            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <span id={`${presetIds}-${preset.id}-label`} className="text-[12px]">
              {t(preset.labelKey, locale)}
            </span>
            {plan.hint && (
              <span id={`${presetIds}-${preset.id}-hint`} className="text-[11px] text-muted-foreground">
                {plan.hint}
              </span>
            )}
          </button>
        ))}
        <div className="my-1 border-t" />
        <button
          type="button"
          aria-expanded={advancedOpen}
          // Names the list only while it is on the page.
          aria-controls={advancedOpen ? `${presetIds}-advanced` : undefined}
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-muted"
        >
          {advancedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {/* The Validations menu's own word for the same fold. */}
          {t('engine.studio.rules.advanced', locale)}
        </button>
        {/* The blank action, unchanged and named as before, folded under Advanced. */}
        {advancedOpen && (
          <div id={`${presetIds}-advanced`}>
            <button
              type="button"
              onClick={() => {
                addAction();
                setAddOpen(false);
              }}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-muted"
            >
              {t('engine.studio.actions.newLabel', locale)}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  if (listed.length === 0) {
    return (
      <StudioEmptyState
        testId="actions-empty"
        icon={Zap}
        sentence={t('engine.studio.actions.none', locale)}
        action={disabled ? undefined : addMenu}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* action list */}
      <div className="flex w-72 shrink-0 flex-col rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{t('engine.studio.data.tab.actions', locale)}</span>
          <span className="text-[11px] text-muted-foreground">({listed.length})</span>
          {!disabled && addMenu}
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {listed.map((a) => {
            const Icon = getIcon(typeof a.icon === 'string' ? a.icon : undefined);
            const type = typeof a.type === 'string' ? a.type : '';
            const needs = heldNeeds.get(String(a.name ?? '')) ?? null;
            return (
              <button
                key={String(a.name)}
                type="button"
                onClick={() => setSelected(a.name ?? null)}
                className={
                  'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-[12px] ' +
                  (effectiveSelected === a.name ? 'bg-muted' : 'hover:bg-muted/50')
                }
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{labelText(a.label, String(a.name ?? ''), locale)}</span>
                  {needs && (
                    <span data-testid="action-not-saved" className="block truncate text-[11px] italic text-muted-foreground">
                      {tFormat('engine.studio.actions.notSaved', locale, { input: t(needs, locale) })}
                    </span>
                  )}
                </span>
                {type && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {type}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* properties — the real Action metadata form */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto rounded-lg border">
        {/* objectui#11861 — the line the Data pillar shows for an edit it
            holds (objectui#11786), for a new action this panel holds. */}
        {sel && selHeldInput && (
          <p
            data-testid="action-held"
            role="status"
            className="m-2 shrink-0 rounded-md border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"
          >
            {tFormat('engine.studio.held.line', locale, {
              clause: tFormat('engine.studio.actions.heldNeeds', locale, {
                action: labelText(sel.label, String(sel.name ?? ''), locale),
                input: t(selHeldInput, locale),
              }),
            })}
          </p>
        )}
        {/* The list always selects an action, so this pane is never blank for
            want of a pick (objectui#12514 retired that sentence). */}
        {!sel ? null : Inspector ? (
          <>
            {!disabled && (
              <div className="flex shrink-0 items-center justify-end border-b px-2 py-1">
                <button
                  type="button"
                  onClick={() => removeAction(sel.name!)}
                  className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" /> {t('engine.studio.actions.delete', locale)}
                </button>
              </div>
            )}
            {/* eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataDefaultInspector returns a registered component (stable), not one created during render */}
            <Inspector
              type="action"
              name={String(sel.name ?? '')}
              draft={sel as Record<string, unknown>}
              onPatch={patchSelected}
              readOnly={!!disabled}
              locale={locale}
              serverSchema={actionSchema}
              onBlockingIssuesChange={(count) => reportCel(String(sel.name ?? ''), count)}
            />
          </>
        ) : (
          /* objectui#6795 part C — this branch used to render the action's own
           * label and nothing else, which reads as "this action has no
           * properties": the pane looked like a finished answer rather than a
           * missing editor. Keep the label (it says WHICH action is selected)
           * and add the reason there is no form under it.
           *
           * ⛔ Not "loading…" / "try again". The read above is observed since
           * objectui#11939, so a registration that lands later does replace
           * this pane with the editor; but nothing here knows that one is on
           * its way, so the note says what is true now and promises nothing. */
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[12px] text-muted-foreground">
            <Ban className="h-5 w-5" />
            <span className="font-medium text-foreground">
              {labelText(sel.label, String(sel.name ?? ''), locale)}
            </span>
            <span>{t('engine.studio.actions.editorMissing', locale)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
