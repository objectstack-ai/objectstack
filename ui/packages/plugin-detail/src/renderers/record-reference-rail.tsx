/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `record:reference_rail` — Compact reference panel for the record's
 * related collections. Lives in the page schema's `aside` region and
 * gives users a HubSpot/Dynamics-style "Reference Panel" snapshot of
 * related data without leaving the Details tab.
 *
 * Each entry renders a tight card with:
 *   - localized object PLURAL label (the card lists records; objectui#11733)
 *   - total related count (badge)
 *   - the top N related records (name only, truncated)
 *
 * Data is fetched per entry via the host `DataSource` exposed through
 * `RecordContext`. We deliberately query with `$top` only — this rail is
 * a snapshot, not a paginated list — and silently degrade to "—" on
 * failure so a misconfigured entry never blanks the whole rail.
 *
 * ## The parent scope is compiled by the relationship field's ARITY
 *
 * An entry names a `relationshipField` on the child object and nothing about
 * how that field STORES the link. A `multiple: true` relationship
 * (`Field.user({ multiple: true })` is the platform's own shape) persists an
 * ARRAY of parent ids, so the question is MEMBERSHIP and not equality —
 * equality asks whether that whole stored array IS one id, which `driver-sql`
 * refuses with `400 INVALID_FILTER` while prescribing `$contains`.
 *
 * The condition is therefore composed by `@object-ui/core`'s
 * `composeParentScopeFilter` (objectui#8883), the ONE compiler the related
 * list's rows and the tab badge already share (objectui#7299, objectui#8882).
 * ⛔ Do not add a local arity rule here, however small. The seam's verdict is
 * `@objectstack/spec/data`'s own `isMultiValueField`, and a local
 * approximation is wrong against it in BOTH directions, not merely incomplete:
 * `multiselect` / `checkboxes` / `tags` persist an array with no flag at all,
 * and `multiple: true` is INERT on a type outside the spec's multi-capable
 * set. Two readers of one question, drifted, is the entire defect class.
 *
 * ⚠️ The QUERY rule and the STORAGE rule are two rules, and ⛔ this file does
 * not claim they are one predicate. Measured at source: the spec asks
 * `MULTI_OPTION_TYPES.has(type) || (MULTI_CAPABLE_TYPES.has(type) && multiple
 * === true)`, while the SQL driver's own `isJsonField` asks
 * `JSON_COLUMN_TYPES.has(type) || !!field.multiple` — the flag on ANY type. So
 * `{ type: 'master_detail', multiple: true }` answers `false` to the spec and
 * `true` to the driver, and the two part company for exactly the
 * flag-on-a-non-multi-capable-type case. ⛔ Nothing here decides which is
 * right: that divergence is owned upstream by objectstack#17469. This renderer
 * follows the SPEC, because the spec is what the authoring surface is
 * validated against and what the seam already compiles on — and a second
 * opinion at this call site would be the defect above, one layer up.
 *
 * ## The "View All" link cannot follow the rows there
 *
 * The link builds a `filter[<field>]=<value>` URL into the console's object
 * list. That grammar has no membership operator and no third spelling: the
 * ADR-0055 data surface recognises `gte`/`lte`/`gt`/`lt` and DROPS any other
 * suffix, and the route this link actually targets parses equality only. A
 * hopeful `[contains]` suffix therefore does not narrow the destination at
 * all. Rather than send the user to an unscoped child table dressed as this
 * parent's related records, the link is SUPPRESSED on a multi-value
 * relationship and the reason is logged once — the same "empty and loud beats
 * wider and quiet" posture `RelatedList`'s raw-URL fallback takes for the same
 * grammar. Losing the affordance there is the COST of the repair.
 */

import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRecordContext, useSafeFieldLabel, subscribeDataChanges, dataChangeMatches } from '@object-ui/react';
import { cn, Card, CardHeader, CardTitle, CardContent, Badge, Skeleton, RelatedCountStore } from '@object-ui/components';
import {
  composeParentScopeFilter,
  declaredNameField,
  isMultiValueRelationship,
  recordDisplayValueAt,
  type FieldContainerLike,
} from '@object-ui/core';
import { ChevronRight } from 'lucide-react';
import type { ReferenceRailEntry } from '@objectstack/spec/ui';
import { useDetailTranslation } from '../useDetailTranslation';

// `ReferenceRailEntry` is owned by `@objectstack/spec` as of 17.1.0 — re-exported
// here, never re-declared (objectui#5494; `check:spec-symbols` enforces this).
// The spec's `ReferenceRailEntrySchema` is `$strict` over
// {objectName, relationshipField, title?, limit?, displayField?}. The local
// interface this replaced also declared an `icon` key: no render path ever read
// it, and the strict schema refuses it at save, so it retired with the
// derivation rather than surviving either side of the contract.
export type { ReferenceRailEntry } from '@objectstack/spec/ui';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

export interface RecordReferenceRailRendererProps {
  schema?: {
    entries?: ReferenceRailEntry[];
    className?: string;
    /**
     * When true (default), entries with `total === 0` are folded into a
     * single "+ N more (empty)" footer chip instead of rendering full empty
     * cards. Users can click the chip to expand them inline. Setting
     * `hideEmpty: false` restores the legacy "always render every entry"
     * behavior.
     */
    hideEmpty?: boolean;
    /**
     * The contract's NODE-level props envelope
     * (`@objectstack/spec` `PageComponentSchema.properties` — "Component props
     * passed to the widget"), declared here by objectui#8649 for the ONE member
     * this renderer reads off it.
     *
     * The rail accepts a node either flattened (`schema.entries`) or enveloped
     * (`schema.properties.entries`). The enveloped read went through an explicit
     * `(schema as any)` cast — ⛔ NOT through the `[k: string]: any` below,
     * which had nothing to do with it — so `entries` arrived as `any` on that
     * path while the flattened path had the contract's own entry type.
     *
     * ⚠️ An earlier revision of this card declared the member and left that cast
     * in place, which made the declaration INERT at the only site this comment
     * names: a cast at the read site defeats a declaration that a membership
     * instrument still reports as present. The cast is now gone (see the read
     * itself), and `__tests__/detailRendererUndeclaredKeys-8649.test.ts` fails
     * if it returns. Declaring the member NARROWS an accept this face already
     * granted through its index signature; it widens nothing, and `properties`
     * itself stays open because the contract declares it as a record.
     *
     * ⚠️ This is the node's envelope, NOT a `record:reference_rail` prop:
     * `RecordReferenceRailProps` declares `entries` and `hideEmpty` and nothing
     * else. `properties` has the standing `dataSource` and `className` have —
     * accepted on every page component, as
     * `recordRelatedListInputs.spec-parity.test.ts` derives for the sibling
     * block.
     */
    properties?: { entries?: ReferenceRailEntry[] } & Record<string, any>;
    [k: string]: any;
  };
  className?: string;
  [k: string]: any;
}

interface EntryState {
  loading: boolean;
  total: number;
  items: any[];
  error?: string;
}

/**
 * Preview rows fetched for one entry when the author declared no `limit`.
 *
 * Named rather than spelled inline because it was spelled TWICE — once in the
 * `$top` the entry's query carries and once in the fetch signature that decides
 * whether to re-issue it — and objectui#9925 gave both a resolver, which needs
 * one fallback to agree on.
 */
export const DEFAULT_REFERENCE_RAIL_LIMIT = 3;

/**
 * What the contract admits as a preview-row cap for a rail entry.
 *
 * `@objectstack/spec` has already answered what `limit: 0` means: this entry's
 * own member is declared a POSITIVE INTEGER on `ReferenceRailEntrySchema`
 * (`z.number().int().positive().optional()`, described there as "Preview rows
 * per card, and the `$top` of the one query this entry issues"). So `0` is not
 * a spelling whose meaning this renderer may choose; it is a value the contract
 * refuses.
 */
function isUsableRowLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The ONE resolver for a rail entry's row cap, for the reason objectui#9853
 * gave when it landed the same shape on `ObjectGrid` and objectui#9897 repeated
 * on `ListView`: one resolver at every entry is what keeps the answer single.
 *
 * Before objectui#9925 both read points were a bare `entry.limit ?? 3`, and
 * `??` rejects only `null` and `undefined` — so an authored `limit: 0` was not
 * nullish and survived as a real window, reaching the wire as `$top: 0`. This
 * rail degrades silently by design (a failed entry renders "—"), so an entry
 * asked for nothing rendered an empty card with a zero badge and named no
 * cause. A negative goes out the same way.
 *
 * ⚠️ The refusal is FAIL-SOFT on purpose, as it is at the two sibling sites
 * this card repairs: throwing would take out the whole rail over one entry's
 * declaration, which is a worse outcome than the defect. The value is dropped,
 * this rail's own default is used, and `describeRefusedRowLimit` states it
 * through the developer channel — the only channel available, because the
 * suppression this rail already does is silent on screen by construction.
 * ⛔ Not a silent clamp, and ⛔ not a clamp to 1.
 */
function resolveRowLimit(authored: unknown, fallback: number): number {
  return isUsableRowLimit(authored) ? authored : fallback;
}

/**
 * The diagnostic half. `null` means "nothing to say" — an absent `limit` is not
 * a mistake, and a usable one is not either, so the message is CONDITIONAL and
 * the silence controls in the pin are what keep it from being an always-on
 * marker that states nothing.
 *
 * ⛔ NOT a second guard: the predicate lives once, in `isUsableRowLimit`, and
 * this reads it. Two predicates would be free to drift, and the drift would be
 * invisible — a value refused by one and admitted by the other.
 */
function describeRefusedRowLimit(authored: unknown, objectName: unknown): string | null {
  if (authored === undefined || authored === null) return null;
  if (isUsableRowLimit(authored)) return null;
  const where =
    typeof objectName === 'string' && objectName
      ? `record:reference_rail entry for ${objectName}`
      : 'record:reference_rail entry';
  return (
    `[ObjectUI] RecordReferenceRail row cap: ${where} declared limit: ${String(authored)}, `
    + 'which is not a positive integer. A row cap must be a positive integer '
    + '(the spec refuses zero and negative values), so it was ignored and this '
    + `entry fell back to its default preview-row cap (${DEFAULT_REFERENCE_RAIL_LIMIT}).`
  );
}

/**
 * [objectui#13010] Claim, in the related-count store, the rows each entry of a
 * claim signature will list — `[objectName, relationshipField, rowCap]`
 * triples, keyed by CONTENT so a re-render with the same entries claims the
 * same thing. Released by `releaseRailRows` with the same signature.
 */
function claimRailRows(sig: string, parentId: string): void {
  for (const [objectName, relationshipField, limit] of JSON.parse(sig) as Array<[string, string, number]>) {
    RelatedCountStore.claimRows(objectName, relationshipField, parentId, limit);
  }
}

function releaseRailRows(sig: string, parentId: string): void {
  for (const [objectName, relationshipField] of JSON.parse(sig) as Array<[string, string, number]>) {
    RelatedCountStore.releaseRows(objectName, relationshipField, parentId);
  }
}

const humanize = (s: string) =>
  s
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

/**
 * A related row's name: the entry's own `displayField`, then the target
 * object's DECLARED name field, then the fixed ladder below.
 *
 * The middle rung is objectui#12110 item 3 (finding B-13 of the HotCRM browser
 * pass). The ladder alone named a row by whichever of its keys the row
 * happened to carry, so an object that declares its record name (ADR-0079's
 * `nameField`) was named by its `subject` or its `code` instead. The pointer is
 * read through `@object-ui/core`'s `declaredNameField` and the value through
 * `recordDisplayValueAt`, the two halves `getRecordDisplayName` reads its own
 * declared rung with, so the rail and every other title surface agree on what
 * a declared name field is and when its value is empty.
 */
const pickDisplayName = (row: any, displayField?: string, nameField?: string): string => {
  if (displayField && row?.[displayField] != null && row[displayField] !== '') {
    return String(row[displayField]);
  }
  const declared = recordDisplayValueAt(row, nameField);
  if (declared) return declared;
  return (
    row?.name ||
    row?.title ||
    row?.subject ||
    row?.label ||
    row?.email ||
    row?.username ||
    row?.code ||
    row?.slug ||
    row?.provider_id ||
    row?.user_agent ||
    row?.ip_address ||
    row?.id ||
    '—'
  );
};

export const RecordReferenceRailRenderer: React.FC<RecordReferenceRailRendererProps> = ({
  schema = {},
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const i18n = useSafeFieldLabel() as any;
  const { t } = useDetailTranslation();
  const { designer } = splitDesigner(props);
  const routeParams = useParams<{ appName?: string }>();
  const appName = routeParams.appName;

  const entries: ReferenceRailEntry[] = Array.isArray(schema.entries)
    ? schema.entries
    : // ⛔ NOT `(schema as any).properties` (objectui#8649 contract review D1).
      // The cast predated the declaration below and defeated it: the checker
      // read `.properties : any` and `.entries : any`, so the declaration was
      // inert at the one site its own doc-comment named. Un-cast, this read now
      // carries `ReferenceRailEntry[]` from the declaration, which is also why
      // the trailing `as ReferenceRailEntry[]` assertion is gone — the declared
      // type supplies it. The two sibling renderers reading the same envelope
      // (`record-history.tsx`, `record-quick-actions.tsx`) already read it
      // un-cast; this file was the outlier.
      Array.isArray(schema.properties?.entries)
      ? schema.properties.entries
      : [];
  const parentId = ctx?.recordId;
  const dataSource = ctx?.dataSource;

  const [states, setStates] = React.useState<Record<string, EntryState>>({});

  // PERF: gate the rail's per-entry queries on visibility. The rail lives in
  // an aside region that is `hidden xl:flex` (see buildDefaultPageSchema), so
  // on sub-`xl` viewports (the common laptop width) it is `display:none` and
  // the IntersectionObserver never reports intersection → zero queries on
  // record open. On `xl`+ it fetches once the rail scrolls near the viewport.
  // Without this, every related collection was fetched eagerly on mount,
  // which (together with RecordDetailView's preload, now removed for this
  // layout) produced ~50 concurrent requests that head-of-line-blocked one
  // another on a single backend container.
  const railRef = React.useRef<HTMLDivElement>(null);
  const [railVisible, setRailVisible] = React.useState(false);
  // Mounted latch: results are applied while mounted regardless of which
  // effect run dispatched them, so a fetch that outlives a re-render isn't
  // dropped (and then never retried because of the sig guard below).
  // objectui#10684 — but only while their run's signature is still the one
  // dispatched: see `isCurrent` in the fetch effect.
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // Signature of the entry set already dispatched. The fetch effect re-runs
  // whenever the record context hands down a new `dataSource` identity during
  // the drawer's mount churn; without this guard each re-run re-drained the
  // whole queue (every related collection fetched 3–5×). We fetch once per
  // (parentId + entries) and skip identical re-runs.
  const fetchedSigRef = React.useRef<string>('');
  // The (parentId + entries) half of that signature, kept apart so a run can
  // tell a REFRESH of the scope already on screen from a new scope — see the
  // invalidation subscription below (objectui#12110 item 4).
  const fetchedScopeRef = React.useRef<string>('');
  React.useEffect(() => {
    if (railVisible) return; // latch: once visible, stop observing
    const el = railRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No element yet or unsupported environment (SSR/tests): fall back to
      // eager so behaviour never regresses to "never loads".
      setRailVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) setRailVisible(true);
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [railVisible]);

  // The CHILD objects' field defs, keyed by object name — the METADATA the
  // parent-scope seam draws its arity verdict from. Filled by the fetch effect
  // below BEFORE it reads any rows, and read a second time at render time by
  // the "View All" link, so both halves of an entry answer from one source.
  // Empty until a schema proves otherwise: the seam then compiles equality,
  // which is byte for byte the wire this rail has always sent.
  const [entryFields, setEntryFields] = React.useState<Record<string, FieldContainerLike>>({});
  // The CHILD objects' declared name fields (ADR-0079 `nameField`), keyed by
  // object name, from the same schema read — what names each related row
  // (objectui#12110 item 3). Absent for an object that declares none, and for
  // an adapter that cannot serve the schema: the row ladder applies then.
  const [entryNameFields, setEntryNameFields] = React.useState<Record<string, string>>({});
  // One warning per (object, field) per mounted rail — the link suppression
  // below is silent on screen by construction, so the developer channel is the
  // only place it can be said at all. Fired from the effect, never from render.
  const warnedSuppressedLinks = React.useRef<Set<string>>(new Set());

  // [objectui#9925] One warning per (object, refused value) per mounted rail —
  // the same dedupe shape as the link suppression above, and for the same
  // reason: an entry that asked for nothing is silent on screen by
  // construction, so the developer channel is the only place it can be said.
  // Fired from an effect, never from render, and keyed on the DECLARATION so a
  // re-render with the same authored value says nothing a second time.
  const warnedRefusedLimits = React.useRef<Set<string>>(new Set());

  // [objectui#9925] Through the resolver, so this signature names the window
  // that actually leaves — two entries whose refused `limit`s differ (`0` and
  // `-5`) issue the SAME query and must not read as two different fetches.
  const entriesSig = JSON.stringify(
    entries.map(
      (e) =>
        `${e.objectName}:${e.relationshipField}:${resolveRowLimit(e.limit, DEFAULT_REFERENCE_RAIL_LIMIT)}`,
    ),
  );
  // [objectui#9925] The DECLARATION, kept apart from the signature above: the
  // diagnostic has to re-fire when the authored value changes even though the
  // resolved window does not, which is exactly the pair the resolver collapses.
  const authoredLimitSig = JSON.stringify(entries.map((e) => [e.objectName, e.limit ?? null]));

  // [objectui#13010] Claim this rail's rows in the related-count store WHILE
  // RENDERING, before any effect on the page runs — so a `page:tabs` badge
  // that counts the same unfiltered list on this record asks for these rows
  // with its count, and the card below takes them instead of reading the same
  // question again (`RelatedCountStore`'s header). A claim reads nothing: the
  // visibility gate below still decides when this rail reads on its own.
  // Idempotent, so a render React repeats or discards changes nothing; the
  // effect re-claims after a StrictMode remount and releases on unmount or on
  // a new scope, so a claim lives as long as this record open.
  const claimable = !!dataSource?.find && !!parentId;
  const claimSig = claimable
    ? JSON.stringify(
        entries.map((e) => [
          e.objectName,
          e.relationshipField,
          resolveRowLimit(e.limit, DEFAULT_REFERENCE_RAIL_LIMIT),
        ]),
      )
    : '[]';
  if (claimable) claimRailRows(claimSig, String(parentId));
  React.useEffect(() => {
    if (!parentId) return;
    const owner = String(parentId);
    claimRailRows(claimSig, owner);
    return () => releaseRailRows(claimSig, owner);
  }, [claimSig, parentId]);
  React.useEffect(() => {
    for (const entry of entries) {
      const message = describeRefusedRowLimit(entry.limit, entry.objectName);
      if (!message) continue;
      const key = `${entry.objectName}:${String(entry.limit)}`;
      if (warnedRefusedLimits.current.has(key)) continue;
      warnedRefusedLimits.current.add(key);
      console.warn(message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entries` is tracked by CONTENT (`authoredLimitSig`), the way the fetch effect below tracks it by `entriesSig`; an inline array on a schema node is a new object every render.
  }, [authoredLimitSig]);

  // [objectui#12110 item 4] The rail's reader side of the data-invalidation
  // bus (`@object-ui/react`, objectui#2269). A record action with
  // `refreshAfter: true` posts `notifyDataChanged({ objectName: <parent>,
  // recordId })`; any dataSource write reaches the bus through the console's
  // mutation bridge; the header's manual refresh posts `'*'`. The rail
  // latched its fetch on (parentId + entries) and heard none of them, so its
  // counts and rows went stale beside a record and related lists that
  // refreshed. A change to the PARENT record (its action may have written
  // children), to any ENTRY's object, or to everything now bumps a nonce the
  // fetch effect's signature carries — a refetch in place, never a remount
  // (AGENTS.md #8). Keyed on primitives only: the entry objects by content.
  const parentObjectName = ctx?.objectName;
  const entryObjectsSig = JSON.stringify(entries.map((e) => e.objectName));
  const [invalidationNonce, setInvalidationNonce] = React.useState(0);
  React.useEffect(() => {
    const objects = JSON.parse(entryObjectsSig) as string[];
    return subscribeDataChanges((change) => {
      const parentStale =
        !!parentObjectName && !!parentId && dataChangeMatches(change, parentObjectName, String(parentId));
      if (parentStale || objects.some((objectName) => dataChangeMatches(change, objectName))) {
        setInvalidationNonce((n) => n + 1);
      }
    });
  }, [parentObjectName, parentId, entryObjectsSig]);

  React.useEffect(() => {
    if (!railVisible) return;
    if (!dataSource?.find || !parentId || entries.length === 0) return;
    // Fetch once per (parentId + entries) and once per bus invalidation.
    // Re-runs triggered purely by a new `dataSource` identity (drawer mount
    // churn) are no-ops; navigating to a different record changes the
    // signature and refetches.
    const scope = `${parentId}::${entriesSig}`;
    const sig = `${scope}::${invalidationNonce}`;
    if (fetchedSigRef.current === sig) return;
    // A bus-driven refetch of the scope already on screen keeps its rows and
    // counts up while it reads (objectui#12110 item 4): the skeleton is for a
    // scope with nothing to show yet, not for a refresh.
    const refreshing = fetchedScopeRef.current === scope;
    fetchedSigRef.current = sig;
    fetchedScopeRef.current = scope;
    // objectui#10684 — only the run whose signature is still the dispatched
    // one commits. Navigating to another record (or changing the entries)
    // while this run's reads are in flight dispatches a new signature, and an
    // answer for the old parent that lands late is dropped on arrival instead
    // of replacing the current parent's rows or clearing its skeleton. A
    // re-run with the SAME signature returns above without touching the ref,
    // so the mounted-latch promise stands: that run's answers still land.
    const isCurrent = () => mountedRef.current && fetchedSigRef.current === sig;
    // Mark every entry as loading up front so the skeletons render.
    if (!refreshing) setStates((prev) => {
      const next = { ...prev };
      for (const entry of entries) {
        next[entry.objectName] = {
          loading: true,
          total: 0,
          items: prev[entry.objectName]?.items || [],
        };
      }
      return next;
    });
    const fetchEntry = async (entry: ReferenceRailEntry, fields: FieldContainerLike) => {
      const key = entry.objectName;
      const limit = resolveRowLimit(entry.limit, DEFAULT_REFERENCE_RAIL_LIMIT);
      try {
        let total: number;
        let items: unknown[];
        // A refresh (objectui#12110 item 4) reads again, always: the rows a
        // badge's read holds for this card, or a read already in flight, may
        // predate the change that triggered it. So does a FIRST read after any
        // bus invalidation this rail heard (`invalidationNonce` above zero): a
        // change to the PARENT record (a `refreshAfter: true` action) marks the
        // rail stale without invalidating the store's child keys, so rows a
        // badge read before it, held for a rail that was not yet on screen,
        // would otherwise be handed over after the action.
        if (refreshing || invalidationNonce > 0) {
          const res: any = await dataSource.find(entry.objectName, {
            // The parent-relationship condition, compiled to match the field's
            // ARITY by the one seam the rows and the tab badge already use
            // (objectui#8883). With no `fields` it compiles equality — the
            // historical wire — so an adapter that cannot serve metadata is no
            // worse off than before this card.
            $filter: composeParentScopeFilter(entry.relationshipField, parentId, fields),
            $top: limit,
            $count: true,
          });
          items = Array.isArray(res) ? res : res?.data || [];
          // `total` is the ONE count member `QueryResult` (`@object-ui/types`)
          // declares — the reason `$count: true` is sent above. A `count` arm
          // used to sit between it and the row-length fallback; measured zero
          // producers emit `count` at this seam (objectui#6917), so it is gone
          // rather than left as somewhere a non-conforming producer keeps
          // working unrejected (AGENTS.md #0.1).
          total = typeof res?.total === 'number' ? res.total : items.length;
        } else {
          // objectui#13010 — the first read of this scope goes through the
          // related-count store, which sends the SAME query (same seam, same
          // `$top`, `$count: true`) and reads `total` the same way, but shares
          // it with a `page:tabs` badge counting the same unfiltered list:
          // whichever of the two asks first makes the one read.
          const res = await RelatedCountStore.fetchRows(
            (object, query) => dataSource.find(object, query),
            entry.objectName,
            entry.relationshipField,
            String(parentId),
            limit,
            fields,
          );
          items = res.rows;
          total = res.total;
        }
        if (!isCurrent()) return;
        setStates((prev) => ({ ...prev, [key]: { loading: false, total, items } }));
      } catch (err: any) {
        if (!isCurrent()) return;
        setStates((prev) => ({
          ...prev,
          [key]: { loading: false, total: 0, items: [], error: String(err?.message || err) },
        }));
      }
    };
    void (async () => {
      // ARITY FIRST, then the reads — and the rail's reason for that order is
      // its OWN, not the tab badge's.
      //
      // `RelatedList` deliberately attempts equality, is refused, and refetches
      // once the arity lands; it can, because its fetch effect re-runs on the
      // verdict. This rail cannot: `fetchedSigRef` above latches on
      // (parentId + entries), and the arity is in NEITHER — so a probe-then-
      // correct design would make the refused first attempt the ONLY attempt,
      // and the entry would sit on its error state until the user navigated to
      // another record. The link half compounds it: the destination href is
      // decided by the same verdict, so deferring it would ship exactly the
      // disagreement this card exists to prevent — right rows, wrong link.
      //
      // ⛔ NOT gated on "a schema loaded", which is a different thing: an
      // adapter without `getObjectSchema`, or one whose fetch rejects, still
      // reads rows, with the equality wire it has always sent. Gating would
      // trade this card's loud 400 on one relationship shape for a silently
      // empty rail on every entry in the app.
      const fieldsFor = new Map<string, FieldContainerLike>();
      const nameFieldFor = new Map<string, string>();
      if (typeof dataSource.getObjectSchema === 'function') {
        await Promise.all(
          Array.from(new Set(entries.map((e) => e.objectName))).map(async (name) => {
            try {
              const schema = await dataSource.getObjectSchema(name);
              fieldsFor.set(name, schema?.fields);
              // The same read names the rows (objectui#12110 item 3): the
              // schema's declared name field, which this rail used to drop
              // with everything else but `fields`.
              const nameField = declaredNameField(schema);
              if (typeof nameField === 'string' && nameField !== '') nameFieldFor.set(name, nameField);
            } catch {
              // Equality it is — the wire this rail has always sent.
            }
          }),
        );
      }
      if (!isCurrent()) return;
      setEntryFields(Object.fromEntries(fieldsFor));
      setEntryNameFields(Object.fromEntries(nameFieldFor));
      for (const entry of entries) {
        if (!isMultiValueRelationship(fieldsFor.get(entry.objectName), entry.relationshipField)) {
          continue;
        }
        const warnKey = `${entry.objectName}.${entry.relationshipField}`;
        if (warnedSuppressedLinks.current.has(warnKey)) continue;
        warnedSuppressedLinks.current.add(warnKey);
        console.warn(
          `[RecordReferenceRail] "${entry.objectName}" relates through the multi-value field ` +
            `"${entry.relationshipField}", so the "View All" link is suppressed for it. The ` +
            'console list URL\'s `filter[<field>]=<value>` grammar has no membership operator ' +
            'and no unrecognised suffix narrows it, so the link would open the entire child ' +
            "table dressed as this parent's related records. The rail's own rows are still " +
            'scoped correctly.',
        );
      }
      // Concurrency-capped pool: drain the entries a few at a time instead of
      // firing all N at once, so the rail never floods the backend in a burst.
      const MAX_CONCURRENCY = 3;
      const queue = [...entries];
      const runWorker = async () => {
        while (mountedRef.current) {
          const entry = queue.shift();
          if (!entry) return;
          await fetchEntry(entry, fieldsFor.get(entry.objectName));
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, () => runWorker()),
      );
    })();
  }, [railVisible, dataSource, parentId, entriesSig, invalidationNonce]);

  // useState must run unconditionally — declared above the empty-entries early
  // return so hook order stays stable across renders.
  const [showEmpty, setShowEmpty] = React.useState(false);

  if (entries.length === 0) return null;

  const hideEmpty = schema.hideEmpty !== false;

  // Stable partition: an entry is "empty" only once it has finished loading
  // with total === 0. While loading or on error, we render it so users
  // don't see flicker / disappearing cards.
  const emptyKeys = new Set(
    entries
      .filter((e) => {
        const s = states[e.objectName];
        return hideEmpty && s && !s.loading && !s.error && s.total === 0;
      })
      .map((e) => e.objectName),
  );

  const visibleEntries = entries.filter(
    (e) => showEmpty || !emptyKeys.has(e.objectName),
  );
  const emptyTitles = entries
    .filter((e) => emptyKeys.has(e.objectName))
    .map(
      (e) =>
        e.title ||
        (i18n?.objectPluralLabel
          ? i18n.objectPluralLabel({ name: e.objectName, label: humanize(e.objectName) })
          : humanize(e.objectName)),
    );

  return (
    <div ref={railRef} className={cn('flex flex-col gap-3', schema.className, className)} {...designer}>
      {visibleEntries.map((entry) => {
        const key = entry.objectName;
        const state = states[key] || { loading: true, total: 0, items: [] };
        // The link's URL grammar cannot express MEMBERSHIP (see the file
        // header), so on a multi-value relationship the only honest "View All"
        // is no "View All": the href below would drop the parent scope
        // entirely and open the whole child table. The verdict is the same
        // seam's, off the same metadata the rows were scoped with, and it is
        // `false` until a schema PROVES otherwise — a single-value entry and
        // an entry whose schema never resolved both keep today's link, href
        // byte for byte.
        const suppressViewAll = isMultiValueRelationship(
          entryFields[key],
          entry.relationshipField,
        );
        const title =
          entry.title ||
          (i18n?.objectPluralLabel
            ? i18n.objectPluralLabel({ name: entry.objectName, label: humanize(entry.objectName) })
            : humanize(entry.objectName));

        return (
          <Card key={key} className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-4 space-y-0 border-b">
              <CardTitle className="text-sm font-semibold tracking-tight truncate">
                {title}
              </CardTitle>
              <div className="flex items-center gap-2 shrink-0">
                {!state.loading && (
                  <Badge variant="secondary" className="tabular-nums">
                    {state.total}
                  </Badge>
                )}
                {appName && parentId && !suppressViewAll && (
                  <Link
                    to={`/apps/${appName}/${entry.objectName}?filter%5B${entry.relationshipField}%5D=${encodeURIComponent(String(parentId))}`}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    title={t('detail.viewAll', { defaultValue: 'View All' })}
                  >
                    {t('detail.viewAll', { defaultValue: 'View All' })}
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {state.loading ? (
                <div className="space-y-1.5 p-3">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              ) : state.items.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  {t('detail.noRecords')}
                </p>
              ) : (
                <ul className="divide-y">
                  {state.items.map((item) => {
                    const id = item.id || item._id;
                    const name = pickDisplayName(item, entry.displayField, entryNameFields[key]);
                    const href = id
                      ? `../${entry.objectName}/record/${encodeURIComponent(String(id))}`
                      : undefined;
                    return (
                      <li key={String(id || name)} className="px-4 py-2">
                        {href ? (
                          <Link
                            to={href}
                            className="group flex items-center justify-between gap-2 text-xs hover:text-foreground text-muted-foreground transition-colors"
                          >
                            <span className="truncate">{name}</span>
                            <ChevronRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </Link>
                        ) : (
                          <span className="block truncate text-xs text-muted-foreground">{name}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
      {!showEmpty && emptyTitles.length > 0 && (
        <button
          type="button"
          onClick={() => setShowEmpty(true)}
          className="self-start inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md border border-dashed border-border/60 hover:border-border bg-background"
          title={emptyTitles.join(' · ')}
        >
          <span>
            {t('detail.showEmptyRelated', {
              defaultValue: '+ {{count}} empty',
              count: emptyTitles.length,
            })}
          </span>
          <span className="truncate max-w-[180px] text-muted-foreground/70">
            ({emptyTitles.join(' · ')})
          </span>
        </button>
      )}
    </div>
  );
};

export default RecordReferenceRailRenderer;
