/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDisplayDate } from '@object-ui/core';
import type { CalendarViewSchema } from '@object-ui/types';
import { CalendarView, type CalendarViewEvent, type CalendarViewProps } from './CalendarView';
import React from 'react';

/* ════════════════════════════════════════════════════════════════════════════
 * The renderer boundary: consume or declare, never spread (objectui#4453)
 *
 * This renderer used to end in `<CalendarView … {...props} />`, where `props`
 * was everything `SchemaRenderer` hands a registered widget: the node's own
 * authored keys, the contents of its `props` container, the injected runtime
 * props (`schema`, `bind`, `events`, `ariaLabel`/`ariaDescribedBy`/`role`,
 * `data-obj-*`), and a host's trailing props — an UNBOUNDED set, spread onto a
 * component whose props are a CLOSED list. Two of those collisions were
 * user-reachable crashes on their own cards (objectui#4433 `events`,
 * objectui#4452 `currentDate`), and this card is the third and worst: an
 * authored `onEventClick: 'NOT-A-FUNCTION'` renders a perfectly normal calendar
 * and then throws `onEventClick is not a function` on the first click — as an
 * UNCAUGHT window error, because React does not route event-handler errors to
 * `SchemaErrorBoundary`. The calendar keeps looking fine while its click
 * handling is dead.
 *
 * The objectui#4425 phase-2 ruling (option 1, whitelist bounded by declaration)
 * applied to this widget: **the forward set is exactly {@link CalendarViewProps},
 * every key resolved to the type that prop declares; everything else is
 * dropped.** No raw spread reaches `CalendarView`. `rest` below is READ for the
 * declared keys and is never spread — that is the whole of this fix.
 *
 * A deny-list could not close this: the leak is the open tail of author-supplied
 * keys, which no enumeration can finish. This list is finishable because
 * `CalendarViewProps` declares it.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The DECLARED host escape hatch: `CalendarView`'s callback surface, forwarded
 * only when the value really is a function.
 *
 * One key, two very different producers, arriving through the SAME channel
 * (objectui#4453):
 *
 *   1. an SDUI author writing JSON, whose value can never be a function — so it
 *      is always the crash above; and
 *   2. a React host rendering `<SchemaRenderer schema={…} onEventClick={fn} />`,
 *      which the trailing-props spread makes work today and which this card
 *      forbids breaking. It is the component's genuine escape hatch, the same
 *      passthrough `MetricWidget` deliberately keeps.
 *
 * The key name cannot separate them; only the value's TYPE can. So the hatch is
 * DECLARED here, with its declared type, and off-type input gets the one answer
 * every other resolver in this file gives: dropped — the same answer as absent.
 * That is the objectui#4435 declared-passthrough pattern, not a lenient
 * consumer coercion (AGENTS.md #0.1): the discrimination lives in a declared
 * contract at the renderer boundary, one key, one declared type, one answer.
 *
 * The whole family is listed rather than `onEventClick` alone because the defect
 * is the family's, not the key's: an authored `onDateClick` / `onNavigate` /
 * `onViewChange` / `onEventDrop` / `onTimeRangeSelect` / `onAddClick` string
 * kills its own gesture in exactly the same way. Every one of them is a prop
 * `CalendarView` declares, so nothing here widens the widget's surface — it
 * narrows what may reach it — and `onEventClick` / `onDateClick` / `onViewChange`
 * / `onNavigate` are additionally the four handlers this package's own docs
 * publish as `calendar-view`'s API (`content/docs/plugins/plugin-calendar.mdx`,
 * "CalendarView Schema API"). Dropping them would have removed a documented,
 * working host path — which is exactly what objectui#4433's ruling refused to do
 * silently.
 */
const HOST_CALLBACKS = [
  'onEventClick',
  'onDateClick',
  'onViewChange',
  'onNavigate',
  'onAddClick',
  'onEventDrop',
  'onTimeRangeSelect',
] as const;

type HostCallbacks = Pick<CalendarViewProps, (typeof HOST_CALLBACKS)[number]>;

/**
 * Read the declared callbacks out of the incoming props, keeping only the values
 * whose type the hatch declares. Never a spread of the raw props: an authored
 * key that is not on {@link HOST_CALLBACKS} cannot appear in the result at all.
 */
function pickHostCallbacks(incoming: Record<string, unknown>): HostCallbacks {
  const declared: Record<string, unknown> = {};
  for (const key of HOST_CALLBACKS) {
    const raw = incoming[key];
    if (typeof raw === 'function') declared[key] = raw;
  }
  return declared as HostCallbacks;
}

/** The view modes the registry input declares, and the only ones `CalendarView` renders. */
const CALENDAR_VIEW_MODES = ['month', 'week', 'day'] as const;

/**
 * Resolve the declared `view` input against its declared enum.
 *
 * `view` is a registry input (`type: 'enum', enum: ['month','week','day']`) and
 * a `CalendarView` prop of the same union, so it is CONSUMED here rather than
 * carried by a spread. Off-enum input gets the resolver's one answer — dropped,
 * i.e. the component's own `month` default — instead of today's silent breakage:
 * `CalendarView` renders its body under `selectedView === "month" | "week" |
 * "day"`, so a value outside the union rendered the header and NO calendar at
 * all.
 */
function resolveAuthoredView(raw: unknown): CalendarViewProps['view'] {
  return (CALENDAR_VIEW_MODES as readonly unknown[]).includes(raw)
    ? (raw as CalendarViewProps['view'])
    : undefined;
}

/**
 * Resolve the `locale` hatch: a string, and one `Intl` will actually accept.
 *
 * Not a registry input — this is a host-only passthrough (`CalendarView` falls
 * back to the ambient i18n language) — but it is a declared `CalendarViewProps`
 * key, so it is forwarded, typed, rather than dropped. The type check is not
 * `typeof raw === 'string'`: MEASURED on this tree, a structurally invalid tag
 * throws out of the render, which is a second crash channel on the same widget —
 * `new Date().toLocaleDateString('en_US')` (the underscore spelling a producer
 * writes by accident) throws `RangeError: Incorrect locale information
 * provided`, and so do `''`, `'123'` and `'a'`. `Intl.getCanonicalLocales`
 * asks the one question that matters — will `Intl` take this tag — instead of a
 * hand-rolled BCP-47 dialect. A well-formed tag nobody has data for (`zz-ZZ`)
 * is NOT rejected here: `Intl` resolves it to its own default, which is the
 * component's business, not this boundary's.
 */
function resolveAuthoredLocale(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    Intl.getCanonicalLocales(raw);
  } catch {
    return undefined;
  }
  return raw;
}

/**
 * Resolve the `slotMinutes` hatch: the week/day grid's snap granularity, the
 * knob the drag callbacks above are useless without (README, "Drag-and-Drop").
 * A declared `CalendarViewProps` key, host-only like `locale`, forwarded only as
 * the positive finite number the component divides an hour by — `0`, `NaN`,
 * `-5` and `'30'` all get the absent-key answer, i.e. the component's default.
 */
function resolveAuthoredSlotMinutes(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * Resolve the authored `currentDate` into the type `CalendarView` declares.
 *
 * The registry input below declares `currentDate` as `type: 'string'` —
 * "ISO date string for initial calendar date" — while
 * `CalendarViewProps.currentDate` is a `Date`. Nothing converted between them,
 * so the authored string rode the `{...props}` spread into `useState`'s initial
 * `selectedDate` and the header's `selectedDate.toLocaleDateString(…)` threw:
 * the one spelling the input documents was the one spelling that could not work
 * (objectui#4452). Authored metadata is the contract, so the conversion is owed
 * HERE, at the renderer boundary — not by widening the component's prop type,
 * and not by asking authors for a value the declared type cannot express.
 *
 * One resolver, one answer for every off-spec input: the SAME answer as an
 * absent key — `undefined`, so `CalendarView`'s own default parameter applies.
 * An `Invalid Date` is deliberately never manufactured and passed on. It does
 * not throw; it renders the literal text "Invalid Date" into the header and the
 * date picker, i.e. a silent wrong answer where the absent-key path gives a
 * usable calendar.
 *
 * The string is read through `toDisplayDate` (objectui#10866): a date-only
 * `2026-11-01` names a calendar day, and the engine's own parse read it as UTC
 * midnight, which opened the calendar on October 31st west of UTC. A value
 * with a time keeps its instant, and a day its month does not have
 * (`2026-02-30`) is refused like any other unparseable string.
 *
 * A `Date` INSTANCE passes through untouched. That value is not authored
 * metadata — `type: 'string'` cannot express it — it is a React host handing
 * the widget its real declared prop type (`<SchemaRenderer … currentDate={d} />`
 * spreads a host's extra props onto the component). Its behaviour, invalid
 * instances included, is unchanged by this card: a host's own value is the
 * host's to own, and narrowing it here would be a second contract change
 * nobody asked for.
 */
function resolveAuthoredCurrentDate(raw: unknown): Date | undefined {
  if (raw instanceof Date) return raw;
  if (typeof raw !== 'string') return undefined;
  const parsed = toDisplayDate(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Resolve the declared `allowCreate` input: does this node get the add
 * affordance (objectui#4454)?
 *
 * The input was declared (`type: 'boolean'`, "Allow creating events by clicking
 * on dates") and read by nobody. The handler it would gate — `handleAddClick`
 * below, dispatching `{ type: 'create' }` on this widget's own `onAction`
 * channel — was already BUILT and never passed, so `CalendarView`, which renders
 * its "New event" button behind `{onAddClick && …}`, never saw a handler and the
 * button never existed. Both halves of one feature were present and never
 * introduced to each other: an authorable key with no read site, and a handler
 * with no caller. ADR-0049's enforce-or-remove framing, answered ENFORCE here
 * because the intent was already in the tree.
 *
 * The wiring goes THROUGH the declared `onAddClick` hatch rather than around it
 * via a second prop: that key is already one of {@link HOST_CALLBACKS}, so a
 * React host can supply the affordance today and that path is not disturbed.
 * `allowCreate` supplies the hatch's value for the SDUI path, where an author
 * writing JSON can never produce a function.
 *
 * Only the boolean `true` turns it on. Everything else — absent, `false`, and
 * the off-type spellings JSON invites (`'true'`, `1`) — gets `undefined`, which
 * is the absent-key answer every other resolver here gives and, on this prop,
 * literally the thing that makes the button not render. That is what keeps
 * today's behaviour byte-identical for every node that never authored the key.
 */
function resolveAuthoredAllowCreate(raw: unknown): boolean {
  return raw === true;
}

// Calendar View Renderer - Airtable-style calendar for displaying records as events
ComponentRegistry.register('calendar-view',
  ({
    schema,
    className,
    onAction,
    // The authored SDUI `events` key: DROPPED (objectui#4433). It is named here
    // rather than merely left out of the forward set below, because it is the
    // one key whose drop removes something an author could legitimately have
    // written: `events` is the ordinary action metadata of AGENTS.md section 4,
    // legal on ANY node, and `SchemaRenderer` forwards it as a plain prop — it
    // is not on that renderer's strip list. Both channels land here, the node's
    // own `events` key and a `props: { events }` container.
    //
    // Nothing is disabled by dropping it. No code in the renderer layer reads a
    // node's `events` key — `SchemaRenderer` forwards it and nothing consumes
    // it; this repo's action path is `properties.action` through `ActionRunner`.
    // On this node type the key has never done anything but overwrite the
    // computed calendar: an OBJECT threw `events is not iterable` (the reported
    // crash), and an ARRAY silently replaced the calendar with itself. This
    // component's real action channel is `onAction` below.
    events: _authoredEvents,
    // The declared `currentDate` input: CONSUMED and converted below into the
    // `Date` the component's prop type declares (objectui#4452). Both authoring
    // channels land here, the node's own `currentDate` key and a
    // `props: { currentDate }` container.
    currentDate: authoredCurrentDate,
    // The declared `view` input: CONSUMED and narrowed to its declared enum
    // below (objectui#4453).
    view: authoredView,
    // The declared `allowCreate` input: CONSUMED below and turned into the
    // `onAddClick` hatch's value (objectui#4454). Both authoring channels land
    // here, the node's own key and a `props: { allowCreate }` container.
    allowCreate: authoredAllowCreate,
    // Everything else. READ for declared keys, NEVER spread: this is the raw
    // channel the old `{...props}` handed straight to `CalendarView`, and the
    // reason an authored string could land on a function-typed prop.
    ...rest
  }: {
    schema: CalendarViewSchema;
    className?: string;
    // Deliberately `unknown`, not `(action) => void`: this prop arrives on the
    // same channel as everything else on this boundary, so the old signature
    // was a type ASSERTION about authored JSON, not a fact. It is narrowed
    // below.
    onAction?: unknown;
    [key: string]: unknown;
  }) => {
    // Transform schema data to CalendarViewEvent format
    const events = React.useMemo(() => {
      if (!schema.data || !Array.isArray(schema.data)) return [];
      
      return schema.data.map((record: any, index: number) => {
        /** Field name to use for event title display */
        const titleField = schema.titleField || 'title';
        /** Field name containing the event start date/time */
        const startField = schema.startDateField || 'start';
        /** Field name containing the event end date/time (optional) */
        const endField = schema.endDateField || 'end';
        /** Field name to determine event color or color category */
        const colorField = schema.colorField || 'color';
        /** Field name indicating if event is all-day */
        const allDayField = schema.allDayField || 'allDay';
        
        return {
          id: record.id || record._id || index,
          title: record[titleField] || 'Untitled Event',
          // A date-only value names a calendar day, read at LOCAL midnight
          // by `toDisplayDate`; the engine's own parse put it in the previous
          // day's cell west of UTC (objectui#10866).
          start: toDisplayDate(record[startField]),
          end: record[endField] ? toDisplayDate(record[endField]) : undefined,
          allDay: record[allDayField],
          color: record[colorField],
          data: record,
        };
      });
    }, [schema.data, schema.titleField, schema.startDateField, schema.endDateField, schema.colorField, schema.allDayField]);

    // Memoised on the AUTHORED value, so one authored string is one `Date`
    // identity for the life of the node. `CalendarView` re-seeds its
    // `selectedDate` state from this prop in an effect keyed on the prop
    // itself, and a fresh `Date` per render would re-seed on every render:
    // the user's own Previous/Next navigation would snap straight back, and
    // the effect would drive its own `setState` in a loop.
    const currentDate = React.useMemo(
      () => resolveAuthoredCurrentDate(authoredCurrentDate),
      [authoredCurrentDate],
    );

    // The declared `view` input, narrowed to the enum it declares.
    const view = resolveAuthoredView(authoredView);

    // The declared `allowCreate` input, narrowed to the boolean it declares
    // (objectui#4454).
    const allowCreate = resolveAuthoredAllowCreate(authoredAllowCreate);

    // The declared host hatches, each kept only at its declared type. Read out
    // of `rest`; `rest` itself never reaches `CalendarView`.
    const hostCallbacks = pickHostCallbacks(rest);
    const locale = resolveAuthoredLocale(rest.locale);
    const slotMinutes = resolveAuthoredSlotMinutes(rest.slotMinutes);

    // The action channel, under the same declared-type rule as the callbacks:
    // `onAction` reaches this renderer through the very same props channel, so
    // an authored `onAction: 'NOT-A-FUNCTION'` killed the very same click with
    // the very same uncaught `onAction is not a function` (objectui#4453). A
    // non-function is dropped — the same answer as absent, which is a calendar
    // whose clicks simply dispatch nowhere.
    const dispatchAction =
      typeof onAction === 'function'
        ? (onAction as (action: { type: string; payload: unknown }) => void)
        : undefined;

    const handleEventClick = (event: CalendarViewEvent) => {
      dispatchAction?.({
        type: 'event-click',
        payload: event
      });
    };

    // Standard "Create" action trigger, gated by the declared `allowCreate`
    // input below. It goes through `dispatchAction`, the narrowed `onAction`,
    // exactly like `handleEventClick` — so an authored
    // `onAction: 'NOT-A-FUNCTION'` cannot turn this newly-live affordance into
    // objectui#4453's uncaught handler crash.
    const handleAddClick = () => {
      dispatchAction?.({
        type: 'create',
        payload: {},
      });
    };

    // The forward set is exactly `CalendarViewProps` — nothing else can reach
    // the component, because nothing is spread from `rest` (objectui#4453).
    return (
      <CalendarView
        className={className}
        // Always the computed array: the authored `events` key never reaches
        // this prop (objectui#4433).
        events={events}
        // The parsed authored date (objectui#4452). `undefined` for an absent
        // or off-spec value, which is what lets `CalendarView`'s own default
        // parameter apply — the key having never been authored at all.
        currentDate={currentDate}
        view={view}
        locale={locale}
        slotMinutes={slotMinutes}
        // The declared host hatches. Not a raw spread: `hostCallbacks` holds
        // only keys from `HOST_CALLBACKS`, and only where the value is a
        // function.
        {...hostCallbacks}
        // Precedence, exactly as the trailing-props spread produced it before
        // this change: a host's own handler REPLACES the `onAction` dispatch
        // rather than running alongside it. Restating it here (instead of
        // letting a spread order decide) is the point — the same authored
        // string that used to land on this prop now lands nowhere, so the
        // fallback stands.
        onEventClick={hostCallbacks.onEventClick ?? handleEventClick}
        // The declared `allowCreate` input, finally wired (objectui#4454).
        // Same precedence rule as `onEventClick` directly above: a host's own
        // handler REPLACES the `onAction` dispatch, and it keeps working with
        // no `allowCreate` authored at all — that is the pre-existing hatch
        // path this card must not disturb. `undefined` when the flag is not
        // the boolean `true`, which is what makes `CalendarView` render no
        // "New event" button — today's behaviour, unchanged, for every node
        // that never authored the key.
        onAddClick={hostCallbacks.onAddClick ?? (allowCreate ? handleAddClick : undefined)}
      />
    );
  }
,
  {
    namespace: 'plugin-calendar',
    label: 'Calendar View',
    inputs: [
      { 
        name: 'data', 
        type: 'array', 
        description: 'Array of record objects to display as events'
      },
      { 
        name: 'titleField', 
        type: 'string', 
        description: 'Field name to use for event title'
      },
      { 
        name: 'startDateField', 
        type: 'string', 
        description: 'Field name for event start date'
      },
      { 
        name: 'endDateField', 
        type: 'string', 
        description: 'Field name for event end date (optional)'
      },
      { 
        name: 'allDayField', 
        type: 'string', 
        description: 'Field name for all-day flag'
      },
      { 
        name: 'colorField', 
        type: 'string', 
        description: 'Field name for event color'
      },
      // `colorMapping` used to be declared here and is RETIRED (objectui#4493,
      // ADR-0049 enforce-or-remove). It had no read site anywhere — not in this
      // renderer, whose event mapping takes the colour straight off the record
      // (`color: record[colorField]`), and not in `CalendarView`, which resolves
      // a colour from `event.color`. An author who wrote the documented
      // `colorMapping: { meeting: 'blue' }` got no mapping, no warning and no
      // error: the raw field value was used as the colour, which for a picklist
      // value like `meeting` is not a colour at all. Removed rather than
      // implemented because no measured app authors it — declared authorable
      // surface with nothing behind it is the one state that must not persist,
      // and a capability nobody pulls on is not worth building.
      {
        name: 'view', 
        type: 'enum', 
        enum: ['month', 'week', 'day'], 
        description: 'Calendar view mode (month, week, or day)'
      },
      {
        name: 'currentDate',
        type: 'string',
        description: 'ISO date string for initial calendar date'
      },
      { 
        name: 'allowCreate', 
        type: 'boolean', 
        description: 'Allow creating events by clicking on dates'
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      view: 'month',
      titleField: 'title',
      startDateField: 'start',
      endDateField: 'end',
      allDayField: 'allDay',
      colorField: 'color',
      allowCreate: false,
      data: [
        {
          id: 1,
          title: 'Team Meeting',
          start: new Date(new Date().setHours(10, 0, 0, 0)).toISOString(),
          end: new Date(new Date().setHours(11, 0, 0, 0)).toISOString(),
          color: '#3b82f6',
          allDay: false
        },
        {
          id: 2,
          title: 'Project Deadline',
          start: new Date(new Date().setDate(new Date().getDate() + 3)).toISOString(),
          color: '#ef4444',
          allDay: true
        },
        {
          id: 3,
          title: 'Conference',
          start: new Date(new Date().setDate(new Date().getDate() + 7)).toISOString(),
          end: new Date(new Date().setDate(new Date().getDate() + 9)).toISOString(),
          color: '#10b981',
          allDay: true
        }
      ],
      className: 'h-[600px] border rounded-lg'
    }
  }
);
