// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HookDefaultInspector — curated authoring panel for a database Hook.
 *
 * Replaces the flat, everything-at-once SchemaForm for `hook` with a panel
 * organised around how a hook is actually designed:
 *
 *   1. Basics    — label / name / which object(s) it fires on (a PICKER, not a
 *                  free-text box — the reason this exists)
 *   2. Events    — the lifecycle events it subscribes to (write + query)
 *   3. Function  — language (expression / sandboxed JS) + the handler body in a
 *                  DEDICATED code editor (the second reason this exists)
 *   4. Options   — priority / async / a CEL run condition
 *
 * Rare/advanced props (handler ref, js capabilities/timeout/memory, …) fall
 * through to a collapsed "More fields" SchemaForm fed the live server schema,
 * with the curated keys hidden so nothing is double-edited or lost.
 *
 * `object` is spec `string | string[]` (or `'*'` for every object). The picker
 * normalises to/from that: `'*'` ⇒ all, one selection ⇒ a string, many ⇒ an
 * array. Any already-selected object not in the live catalog is preserved as a
 * synthesized option so a value is never silently dropped; it is flagged as not
 * published only once the catalog has answered (objectui#10585).
 *
 * Reach (objectui#11820). A hook on an object runs on that object's events
 * wherever they happen, so the picker says so where the reach widens: when a
 * host tells it which objects belong to the package the hook is authored in
 * ({@link HookTargetScopeContext} — Studio's hooks panel does), the list splits
 * into this package's objects and the rest, and the rest (other packages'
 * objects and the platform's own) sit under their own heading with a one-line
 * warning. "All objects" carries the same warning. A host that knows no package
 * (the metadata admin's editor) gets the flat list, as before.
 */

import * as React from 'react';
import { Label, Textarea } from '@object-ui/components';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { SchemaForm } from '../SchemaForm.js';
import { t } from '../i18n.js';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  InspectorNumberField,
  InspectorCheckboxField,
  flagUnknownValue,
  rosterFrom,
} from './_shared.js';
import { useObjectOptions } from '../previews/useObjectOptions.js';
import { ConditionBuilder, RECORD_CONDITION_SUBJECTS } from './ConditionBuilder.js';
import { expressionSource, writeExpressionSource } from './expression-envelope.js';

/* ─────────────── constants ─────────────── */

/** Body languages: the stored value, and the catalogue key its label reads in
 *  the designer locale (objectui#10586). */
const BODY_LANG_OPTS = [
  { value: 'expression', labelKey: 'engine.inspector.hook.bodyLang.expression' },
  { value: 'js', labelKey: 'engine.inspector.hook.bodyLang.js' },
];

/** Lifecycle events, grouped by the operation they hang off. */
const WRITE_EVENTS = [
  'beforeInsert', 'afterInsert',
  'beforeUpdate', 'afterUpdate',
  'beforeDelete', 'afterDelete',
  'beforeUpdateMany', 'afterUpdateMany',
  'beforeDeleteMany', 'afterDeleteMany',
];
const QUERY_EVENTS = [
  'beforeFind', 'afterFind',
  'beforeFindOne', 'afterFindOne',
  'beforeCount', 'afterCount',
  'beforeAggregate', 'afterAggregate',
];

const ALL_OBJECTS = '*';

/**
 * objectui#11820 — what the host knows about where the hook is authored: the
 * names of the objects of that package, published and draft. Membership is
 * the package's own list (the server's package filter on `_packageId`, plus
 * the package's pending drafts), never a name prefix; an object outside it
 * belongs to another package, to the platform, or to no package, and each of
 * those widens the hook's reach beyond the package.
 */
export interface HookTargetScope {
  packageObjects: ReadonlySet<string>;
}

/**
 * Provided by a host that knows the hook's package (Studio's hooks panel).
 * `null` — no package known — keeps the picker one flat list.
 *
 * A context rather than a prop because the host renders this inspector through
 * the default-inspector registry, whose props are every type's. Module-private:
 * imported by that host, exported from no barrel.
 */
export const HookTargetScopeContext = React.createContext<HookTargetScope | null>(null);

/** Keys this inspector edits with its own controls — hidden from the fallback. */
const CURATED_FIELDS = [
  'name', 'label', 'object', 'events', 'body', 'priority', 'async', 'condition',
];

/* ─────────────── helpers ─────────────── */

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

function localize(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, string>;
    return o.en ?? o['en-US'] ?? Object.values(o)[0] ?? '';
  }
  return String(v);
}

/** Read the spec `object` (string | string[] | '*') into a selection set. */
function readObjects(value: unknown): { all: boolean; names: string[] } {
  if (value === ALL_OBJECTS) return { all: true, names: [] };
  if (typeof value === 'string') return { all: false, names: value ? [value] : [] };
  if (Array.isArray(value)) {
    const names = value.filter((v): v is string => typeof v === 'string' && v !== ALL_OBJECTS);
    return { all: value.includes(ALL_OBJECTS), names };
  }
  return { all: false, names: [] };
}

/** Write a selection set back to the narrowest valid spec shape. */
function writeObjects(all: boolean, names: string[]): string | string[] {
  if (all) return ALL_OBJECTS;
  if (names.length === 1) return names[0];
  return names;
}

/* ─────────────── inspector ─────────────── */

export function HookDefaultInspector({
  draft,
  onPatch,
  readOnly,
  locale,
  serverSchema,
  onBlockingIssuesChange,
}: MetadataDefaultInspectorProps) {
  const tr = React.useCallback((key: string) => t(key, locale), [locale]);

  const str = (k: string): string => (typeof draft[k] === 'string' ? (draft[k] as string) : '');
  const body = (draft.body && typeof draft.body === 'object' ? draft.body : {}) as Record<string, unknown>;
  const events: string[] = Array.isArray(draft.events) ? (draft.events as string[]) : [];
  const { all: allObjects, names: objectNames } = readObjects(draft.object);

  const {
    options: objectOptions,
    loading: objectsLoading,
    error: objectsError,
  } = useObjectOptions();
  // objectui#10585 — the roster's ONE state, read the way the objectui#8862 /
  // objectui#9651 family reads it: only an ANSWERED roster may say an object is
  // missing. While the fetch is in flight, or after it failed, `objectOptions`
  // is `[]` exactly as it is for a catalog with no objects, so a claim made
  // from the list alone told the author that every selected object was
  // unpublished and that they should publish one.
  const roster = rosterFrom({ loading: objectsLoading, error: objectsError });
  const rosterAnswered = roster.status === 'loaded';
  // Preserve any selected object missing from the live catalog (draft-only /
  // cross-package) so it is never dropped from the picker. Its flag reads in
  // the designer's locale (objectui#10448), and it is drawn only once the
  // roster answered — until then the name is shown bare, which asserts nothing.
  const pickerOptions = React.useMemo(() => {
    const known = new Set(objectOptions.map((o) => o.value));
    const notPublished = t('engine.form.notPublished', locale);
    const extra = objectNames
      .filter((n) => !known.has(n))
      .map((n) => ({ value: n, label: rosterAnswered ? flagUnknownValue(n, notPublished, locale) : n }));
    return [...extra, ...objectOptions];
  }, [objectOptions, objectNames, locale, rosterAnswered]);
  const rosterFailure = roster.status === 'error' ? roster.message : undefined;

  // objectui#11820 — with a known package, this package's objects first and
  // every other object under its own heading and reach warning. A cheap
  // partition, recomputed each render: nothing keys on its identity.
  const scope = React.useContext(HookTargetScopeContext);
  const groups = scope
    ? {
        own: pickerOptions.filter((o) => scope.packageObjects.has(o.value)),
        outside: pickerOptions.filter((o) => !scope.packageObjects.has(o.value)),
      }
    : null;
  const renderObjectOption = (o: { value: string; label: string }) => (
    <InspectorCheckboxField
      key={o.value}
      label={o.label}
      value={objectNames.includes(o.value)}
      onCommit={(on) => toggleObject(o.value, on)}
      disabled={readOnly}
    />
  );

  const patchBody = (p: Record<string, unknown>) => onPatch({ body: { ...body, ...p } });

  const toggleObject = (name: string, on: boolean) => {
    const next = on ? [...new Set([...objectNames, name])] : objectNames.filter((n) => n !== name);
    onPatch({ object: writeObjects(false, next) });
  };
  const toggleEvent = (ev: string, on: boolean) => {
    const next = on ? [...new Set([...events, ev])] : events.filter((e) => e !== ev);
    onPatch({ events: next });
  };

  /* ─── Blocking CEL verdicts → the host's Save gate (objectui#4527) ─────
   *
   * The "Run only when" guard is this inspector's only CEL site. The count is
   * STAMPED with the hook it describes and mismatch is read as 0 at
   * aggregation time, so a verdict that lands after the host switched hooks
   * cannot gate the one now on screen — derivation, not a reset effect. */
  const hookKey = str('name');
  const [celErrors, setCelErrors] = React.useState<{ hook: string; count: number }>({
    hook: hookKey,
    count: 0,
  });
  const reportCel = React.useCallback(
    (count: number) => {
      setCelErrors((prev) => {
        if (prev.hook !== hookKey) return { hook: hookKey, count };
        if (prev.count === count) return prev;
        return { hook: hookKey, count };
      });
    },
    [hookKey],
  );
  const blockingIssues = celErrors.hook === hookKey ? celErrors.count : 0;
  // Held in a ref so an unmemoized host callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  // A single object → give ConditionBuilder its fields; '*' / multi → raw mode.
  const conditionObject = !allObjects && objectNames.length === 1 ? objectNames[0] : undefined;
  const language = typeof body.language === 'string' ? (body.language as string) : 'expression';
  const fallbackSchema = serverSchema as Record<string, unknown> | undefined;

  return (
    <InspectorShell
      kindLabel={tr('engine.inspector.hook.kind')}
      title={String(localize(draft.label) || draft.name || tr('engine.inspector.hook.kind'))}
      onClose={() => {}}
      closeLabel={tr('engine.inspector.action.close')}
      hideClose
    >
      {/* 1 ─ Basics */}
      <SectionHeader title={tr('engine.inspector.hook.basics')} />
      <InspectorTextField label={tr('engine.inspector.hook.label')} value={localize(draft.label)} onCommit={(v) => onPatch({ label: v || undefined })} placeholder={tr('engine.inspector.hook.labelPlaceholder')} disabled={readOnly} />
      <InspectorTextField label={tr('engine.inspector.hook.name')} value={str('name')} onCommit={(v) => onPatch({ name: v })} placeholder={tr('engine.inspector.hook.namePlaceholder')} disabled={readOnly} mono testId="hook-name" />

      <div className="space-y-1.5" data-testid="hook-object-picker">
        <Label className="text-xs text-muted-foreground">{tr('engine.inspector.hook.objects')}</Label>
        <InspectorCheckboxField
          label={tr('engine.inspector.hook.allObjects')}
          value={allObjects}
          onCommit={(on) => onPatch({ object: on ? ALL_OBJECTS : writeObjects(false, objectNames) })}
          disabled={readOnly}
        />
        {allObjects && (
          <p data-testid="hook-all-objects-reach" className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            {tr('engine.inspector.hook.allObjectsReach')}
          </p>
        )}
        {/* The empty-list copy is a MEASUREMENT ("no objects found"), so only
            an answered roster may print it; in flight it says it is loading.
            A failed roster with nothing selected draws no list at all — the
            notice below is the whole answer there. */}
        {!allObjects && (pickerOptions.length > 0 || rosterFailure === undefined) && (
          <div className="max-h-40 space-y-1 overflow-auto rounded-md border p-2">
            {pickerOptions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {rosterAnswered
                  ? tr('engine.inspector.hook.noObjects')
                  : tr('engine.form.loadingOptions')}
              </p>
            ) : groups ? (
              <>
                {groups.own.length > 0 && (
                  <div
                    role="group"
                    aria-label={tr('engine.inspector.objectPicker.groupPackage')}
                    data-testid="hook-object-group-package"
                    className="space-y-1"
                  >
                    <div aria-hidden className="text-[11px] font-medium text-muted-foreground">
                      {tr('engine.inspector.objectPicker.groupPackage')}
                    </div>
                    {groups.own.map(renderObjectOption)}
                  </div>
                )}
                {groups.outside.length > 0 && (
                  <div
                    role="group"
                    aria-label={tr('engine.inspector.objectPicker.groupOther')}
                    data-testid="hook-object-group-outside"
                    className="space-y-1 pt-1"
                  >
                    <div aria-hidden className="text-[11px] font-medium text-muted-foreground">
                      {tr('engine.inspector.objectPicker.groupOther')}
                    </div>
                    <p
                      data-testid="hook-object-outside-reach"
                      className="text-[11px] leading-snug text-amber-600 dark:text-amber-400"
                    >
                      {tr('engine.inspector.hook.outsideReach')}
                    </p>
                    {groups.outside.map(renderObjectOption)}
                  </div>
                )}
              </>
            ) : (
              pickerOptions.map(renderObjectOption)
            )}
          </div>
        )}
        {/* objectui#10585 — a failed roster says so, with its cause. This is
            the notice `InspectorSelectField` renders for the same fact
            (objectui#9651): the same role, tone, localized title and cause
            span. That notice lives inside the primitive and is not exported,
            and this picker is a checkbox list rather than a select, so the
            markup is repeated here; the wording is the shared catalogue key. */}
        {!allObjects && rosterFailure !== undefined && (
          <p
            role="status"
            data-testid="hook-object-roster-failure"
            className="text-[11px] leading-snug text-amber-600 dark:text-amber-300"
          >
            {tr('engine.form.optionsLoadFailedTitle')}
            {rosterFailure ? (
              <>
                {' '}
                <span className="break-words font-mono text-[10px] opacity-80">{rosterFailure}</span>
              </>
            ) : null}
          </p>
        )}
        {!allObjects && objectNames.length === 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">{tr('engine.inspector.hook.pickObject')}</p>
        )}
      </div>

      {/* 2 ─ Events */}
      <div className="border-t pt-3 space-y-2">
        <SectionHeader title={tr('engine.inspector.hook.events')} hint={tr('engine.inspector.hook.eventsHint')} />
        <div className="text-[11px] font-medium text-muted-foreground/80">{tr('engine.inspector.hook.eventsWrite')}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {WRITE_EVENTS.map((ev) => (
            <InspectorCheckboxField key={ev} label={ev} value={events.includes(ev)} onCommit={(on) => toggleEvent(ev, on)} disabled={readOnly} />
          ))}
        </div>
        <div className="pt-1 text-[11px] font-medium text-muted-foreground/80">{tr('engine.inspector.hook.eventsQuery')}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {QUERY_EVENTS.map((ev) => (
            <InspectorCheckboxField key={ev} label={ev} value={events.includes(ev)} onCommit={(on) => toggleEvent(ev, on)} disabled={readOnly} />
          ))}
        </div>
        {events.length === 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">{tr('engine.inspector.hook.pickEvent')}</p>
        )}
      </div>

      {/* 3 ─ Function */}
      <div className="border-t pt-3 space-y-3">
        <SectionHeader title={tr('engine.inspector.hook.function')} hint={tr('engine.inspector.hook.functionHint')} />
        <InspectorSelectField
          label={tr('engine.inspector.hook.language')}
          value={language}
          options={BODY_LANG_OPTS.map((o) => ({ value: o.value, label: tr(o.labelKey) }))}
          onCommit={(v) => patchBody({ language: v })}
          disabled={readOnly}
        />
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{tr('engine.inspector.hook.handlerBody')}</Label>
          <Textarea
            data-testid="hook-body-source"
            value={typeof body.source === 'string' ? (body.source as string) : ''}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => patchBody({ source: e.target.value })}
            disabled={readOnly}
            spellCheck={false}
            rows={8}
            placeholder={language === 'expression' ? 'record.amount >= 0' : '// (ctx) => { ... }\nreturn;'}
            className="text-xs font-mono"
          />
          <div className="text-[11px] text-muted-foreground/70">
            {language === 'expression'
              ? tr('engine.inspector.hook.bodyHint.expression')
              : tr('engine.inspector.hook.bodyHint.js')}
          </div>
        </div>
      </div>

      {/* 4 ─ Options */}
      <div className="border-t pt-3 space-y-3">
        <SectionHeader title={tr('engine.inspector.hook.options')} />
        <div className="grid grid-cols-2 gap-3">
          <InspectorNumberField label={tr('engine.inspector.hook.priority')} value={typeof draft.priority === 'number' ? (draft.priority as number) : undefined} onCommit={(v) => onPatch({ priority: v })} placeholder="100" disabled={readOnly} />
          <div className="flex items-end pb-1.5">
            <InspectorCheckboxField label={tr('engine.inspector.hook.async')} value={draft.async === true} onCommit={(v) => onPatch({ async: v })} disabled={readOnly} />
          </div>
        </div>
        {/* `HookSchema.condition` is `ExpressionInputSchema`: a persisted hook
            carries the ADR-0089 envelope, not the authored string. Read and
            write it through the shared pair so the guard is visible and an
            edit cannot rewrite its dialect or drop its `meta` (#3218). */}
        {/* `record`, because that is what the SERVER binds (objectui#8167).
            `@objectstack/objectql`'s `wrapDeclarativeHook` compiles the
            condition once and evaluates it as

                ExpressionEngine.evaluate<boolean>(
                  expr, { record: record ?? {}, previous })

            — `record` and `previous`, and nothing else. This editor linted
            `flattened`, so a bare `status == 'done'` typed here came back CLEAN
            and then met a scope that has no top-level `status`.

            ⚠️ And on this surface the consequence is worse than a gate that
            never fires. An unevaluable condition does not resolve false: it
            throws `HookConditionError`, deliberately (the objectstack#4775
            fail-LOUD ruling — "Fail LOUD. Not `false`"). The author's write is
            what pays for the editor's success receipt.

            `previous` stays reachable, and that needed checking rather than
            assuming: measured on the installed `@objectstack/formula`, a
            `previous.*` reference draws no finding at `scope: 'record'` and
            `introspectScope` already lists `previous` among the roots it
            advertises, so nothing had to be added for it. Pinned in
            `ConditionBuilder.mountScope.test.tsx` by the case named "accepts
            `previous.<field>` — the transition idiom the server binds beside
            `record`", so a later narrowing of the root list cannot take it away
            in silence. */}
        <ConditionBuilder
          label={tr('engine.inspector.hook.condition')}
          value={expressionSource(draft.condition)}
          onCommit={(v) => onPatch({ condition: writeExpressionSource(draft.condition, v) })}
          objectName={conditionObject}
          disabled={readOnly}
          scope="record"
          /* objectui#9855 — the SUBJECT dropdown's half of the same narrowing
             the `scope` above buys for the autocomplete. `wrapDeclarativeHook`
             evaluates this condition against `{ record, previous }` and
             nothing else, so a `user.*` subject compiles a row that can never
             match; offering it here was the row-builder door of the trap
             objectui#9645 closed in the raw editor. Declared at the mount
             rather than defaulted, because `scope="record"` does not imply a
             server host — see `RECORD_CONDITION_SUBJECTS`. */
          subjects={{ context: RECORD_CONDITION_SUBJECTS }}
          onBlockingIssuesChange={reportCel}
        />
      </div>

      {/* Advanced — everything not curated above, from the live schema */}
      {fallbackSchema && (
        <div className="border-t pt-3 space-y-1.5">
          <SectionHeader title={tr('engine.inspector.moreFields')} hint={tr('engine.inspector.hook.moreFieldsHint')} />
          <SchemaForm
            schema={fallbackSchema}
            value={draft}
            hiddenFields={CURATED_FIELDS}
            readOnly={readOnly}
            onChange={(next) => onPatch(next)}
          />
        </div>
      )}
    </InspectorShell>
  );
}
