/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * May this user write THESE rows? (objectui#4296)
 *
 * The object-level grant is not the write verdict on a record. `writeScope`,
 * the sharing model and RLS narrow it per row, so a list that ANDs only the
 * object-level answer offers Edit/Delete on every row the user can READ —
 * including the rows the server answers `403 "You do not have access to this
 * record"` for. The record detail header has folded the record-grained verdict
 * since objectstack#3821 (`plugin-detail`'s `useRecordEditable`), which is why
 * one screen carried two opposite answers for one record and one user.
 *
 * This hook is the list-shaped half of the same question. It asks the SAME
 * authority the detail header asks — the explain engine's record-grained
 * verdict (`POST /api/v1/security/explain`, ADR-0090 D6 / ADR-0095 C2), the
 * same pipeline the enforcement middleware runs — so the kebab and the server
 * cannot disagree, and neither can the kebab and the detail header.
 *
 * ## One call per (object, operation) per page, not two per row
 *
 * The singular probe the detail header uses answers ONE record. Folding it into
 * a list row-by-row would cost 2N round trips (a 50-row page = 100 POSTs), and
 * that cost is why this card sat blocked: the batch form
 * (`recordIds: string[]`, objectstack#8326, shipped in objectstack `27358d517`) is
 * what makes a page-level fold affordable. `records[i]` answers `recordIds[i]`;
 * each entry is the verdict the singular form returns for that id, so the list
 * and the detail header read the same number by construction rather than by
 * two implementations agreeing.
 *
 * ## Fail OPEN on every uncertainty — degrade to today, never over-hide
 *
 * No answer yet, a non-OK response, a deployment without
 * `@objectstack/plugin-security`, a row missing from the verdict map, a split
 * SPA origin where the cookie doesn't reach the API: the row's verdict is
 * `undefined` and the caller keeps the OBJECT-level answer, i.e. exactly what
 * this list rendered before this hook existed. The server is the authority
 * (the framework's ADR-0124 D1 — server enforces, client is courtesy) and
 * stays so; hiding a capability on missing data would be a worse defect than
 * the wasted click this fixes, and it is the same posture `useRecordEditable`
 * takes for the detail header.
 *
 * The probe rides the host's AUTHENTICATED fetch (`SchemaRendererProvider`'s
 * `apiFetch`) rather than the bare global one: a bearer-token session carries
 * its credential in a header, not a cookie, so `credentials: 'include'` alone
 * would 401 on a perfectly valid session and the verdict would always fail open
 * (framework#3923 ②, measured on the singular probe). Cookies stay on for
 * cookie-session hosts.
 */
import * as React from 'react';
/**
 * Hard cap on `recordIds` per batch explain request — the SERVER's contract
 * (`EXPLAIN_BATCH_MAX_RECORD_IDS`, objectstack#8326): over-cap requests are
 * refused with `400 VALIDATION_FAILED`, never truncated, and the spec's own
 * TSDoc directs a consumer with more records to paginate under it. A page
 * larger than the cap is therefore split into ceil(N / cap) requests per
 * operation — still amortized, never one per row.
 *
 * Imported from the package that OWNS the contract, never re-declared: a hand
 * copy passes every value comparison on the day it is written and drifts
 * silently on the day the server moves the cap.
 */
import {
  EXPLAIN_BATCH_MAX_RECORD_IDS,
  type ExplainOperation,
  type ExplainRequest,
} from '@objectstack/spec/security';
import {
  SchemaRendererContext,
  dataChangeMatches,
  subscribeDataChanges,
  useDataInvalidation,
  type DataChange,
} from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';

/**
 * Compile-time proof that `Verbs` is a SUBSET of the spec's `ExplainOperation`,
 * resolving to `Verbs` unchanged. Widening past the spec's vocabulary is TS2344
 * on the declaration below rather than a `400 VALIDATION_FAILED` in a browser.
 */
type SpecVerbSubset<Verbs extends ExplainOperation> = Verbs;

/**
 * The two write verbs a list row's kebab can offer.
 *
 * DELIBERATELY NARROWER than the spec (objectui#6332). `ExplainOperation` has
 * eight verbs — `read`, `create`, `restore`, `purge`, `export`, `transfer` as
 * well as these two — and this hook is contractually limited to the two a row
 * kebab can act on. Every other verb has a different affordance, a different
 * caller and a different fail-open story; answering one here would put a
 * verdict on screen that nothing on this row can use.
 *
 * The `SpecVerbSubset` wrapper is what makes that a DECLARED subset rather than
 * a coincidence: the two members stay written out here (nothing is inherited
 * from the spec, so the narrowing cannot be widened by an upstream release),
 * while the constraint fails compilation the moment they stop being verbs the
 * explain API accepts. It is erased at runtime — the emitted type is exactly
 * `'update' | 'delete'`.
 *
 * ⛔ Do not "simplify" this to `ExplainOperation`, and do not derive it with
 * `Extract<ExplainOperation, ...>` — `Extract` answers `never` for a member the
 * spec renames, which is silent narrowing, the failure this wrapper exists to
 * make loud.
 */
export type RecordCrudOperation = SpecVerbSubset<'update' | 'delete'>;

/**
 * One entry of the batch response's `records` array, narrowed to what this hook
 * reads. Wire payloads are `unknown` until proven otherwise — a malformed entry
 * must land on "no verdict for this row" (fail open), never on a coerced
 * boolean.
 *
 * ⛔ This is NOT an oversight to tidy up into the spec's response entry type,
 * and objectui#6332 rejected doing so deliberately. The spec's entry types
 * `visible` as `boolean`, so asserting it here would make the runtime guards
 * below (`typeof entry.visible !== 'boolean'`) unreachable in the compiler's
 * eyes — dead code a future reader or lint rule then deletes, taking the
 * fail-open path with it. A change that makes runtime safety code look
 * redundant is not a tightening; it is a silent removal of the safety.
 *
 * The response-side contract-first move is not a type at all — it is
 * `ExplainDecisionSchema.safeParse(...)`, which is a BEHAVIOUR change (the
 * schema requires `allowed`/`object`/`operation`/`principal`, so a
 * reduced-but-usable response this hook answers today would start failing
 * open). That needs its own card and its own fail-open regression coverage.
 * The request side above is adoptable precisely because it is type-only.
 */
interface WireRecordVerdict {
  recordId?: unknown;
  visible?: unknown;
}

/**
 * A settled verdict lookup for the rows on screen.
 *
 * `undefined` means UNKNOWN — not "denied". Every caller must treat it as the
 * instruction to keep the object-level answer.
 */
export type RecordCrudVerdictLookup = (
  recordId: string | number | null | undefined,
  operation: RecordCrudOperation,
) => boolean | undefined;

/**
 * Verdicts memoised across pages and renders, keyed
 * `[principal, object, recordId, operation]` — the same key and the same
 * "revisiting is free" posture as `useRecordEditable`'s cache in
 * `@object-ui/plugin-detail`, so paging back and forth costs nothing and the
 * two surfaces answer a record identically.
 *
 * The two caches are kept in step BY HAND: sharing one implementation would
 * need a new cross-package export, and the shape is small enough to state
 * twice. A change to one is a change to both (objectui#10184).
 *
 * The principal is in the key because this map lives at module scope and
 * outlives every unmount for the life of the tab — and signing out does not
 * end that life (`AuthProvider.signOut` never reloads the page; it purges the
 * per-tab storage caches by hand, and this map was not among them). Keyed on
 * `object:recordId:operation` alone, the next principal to sign in was
 * answered from the previous one's verdicts: a `false` hid the kebab's Edit
 * from a user the server lets write the row, and — the worse direction — a
 * `true` offered it to a user the server refuses (objectui#10107, repaired for
 * the detail header first). The key is an array rather than a delimited string
 * so no user id can spell another key by containing the delimiter, and so
 * "principal unknown" (`null`) is a value of its own.
 *
 * A verdict is also only reused until its record CHANGES — see
 * {@link forgetChangedRecords}.
 */
const verdictCache = new Map<string, boolean>();

/** What a {@link verdictCache} key spells, in order. */
type VerdictKey = [principal: string | null, object: string, recordId: string, operation: RecordCrudOperation];

const cacheKey = (
  principal: string | null,
  object: string,
  recordId: string,
  operation: RecordCrudOperation,
): string => JSON.stringify([principal, object, recordId, operation] satisfies VerdictKey);

/**
 * The principal every live entry in {@link verdictCache} was computed for.
 *
 * The key alone already makes another principal's entry unreachable. This adds
 * the half a key cannot express: entries written while the client did not yet
 * know who it was (a provider mounted but `/me/permissions` still in flight
 * publishes `userId: null`) are keyed `null`, and a LATER unknown window — the
 * one between a sign-out and the next sign-in in the same tab — would key to
 * that same `null`. Dropping the map whenever the client's notion of the
 * principal changes means no entry can ever span such a change.
 *
 * `undefined` is "nothing observed yet" and is distinct from a `null`
 * principal, so the first observation does not count as a change.
 */
let cachedPrincipal: string | null | undefined;

/** Drop everything if the acting principal is not the one the map was built for. */
function retainForPrincipal(principal: string | null): void {
  if (cachedPrincipal !== undefined && cachedPrincipal !== principal) {
    verdictCache.clear();
    // Nor may an unanswered question span the change (objectui#13341).
    pendingVerdicts.clear();
    recheckDue.clear();
  }
  cachedPrincipal = principal;
}

/**
 * A batch probe on its way to the explain engine, and the rows a data change
 * has staled since it left. An answer computed before the change answers a
 * question this hook is no longer asking, so it is not cached — without this,
 * a probe in flight when its row changed would write the pre-change verdict
 * back into the map right after the change cleared it.
 */
interface InFlightProbe {
  readonly principal: string | null;
  readonly object: string;
  readonly operation: RecordCrudOperation;
  readonly recordIds: readonly string[];
  readonly staled: Set<string>;
  /**
   * The rows this probe RE-CHECKS: each was asked for a key {@link recheckDue}
   * held, so it left after the change that dropped its answer was announced
   * (objectui#13341). See {@link forgetChangedRecords}.
   */
  readonly recheck: ReadonlySet<string>;
}

const inFlight = new Set<InFlightProbe>();

/**
 * A row's question still on its way to the explain engine, by the same key as
 * {@link verdictCache}, and the batch request carrying it (objectui#13341).
 *
 * The cache only holds FINISHED answers, so an effect run while a batch was on
 * the wire — the list's own re-read landing after a write changes the id list
 * — asked again about every row with no finished answer, the rows already on
 * the wire among them. Now a row on the wire is joined, not asked again, and
 * only the rows nobody has asked about go out. The entry is dropped when its
 * batch settles, when a data change stales the row, and when the principal
 * changes (see {@link retainForPrincipal}), so a row asked after either is
 * asked again rather than joined to an answer about the world before it — the
 * rule `useRecordEditable` keeps for the detail header (objectui#11699).
 */
const pendingVerdicts = new Map<string, Promise<void>>();

/**
 * Keys whose answer a data change dropped — a finished verdict forgotten, or a
 * row staled on the wire — and that nobody has asked since (objectui#13341).
 * The next ask of such a key is that row's RE-CHECK, and a re-check is what a
 * further announcement of the change joins instead of staling.
 */
const recheckDue = new Set<string>();

/**
 * Drop every verdict a data change has made stale (objectui#10184).
 *
 * The verdict is a fact about the row as well as about the principal: moving
 * `owner_id`, or any write the server's sharing rules read, can turn a `false`
 * into a `true` or the reverse for the SAME principal, and a map keyed on the
 * principal alone kept answering from before the change.
 *
 * So the map listens to the data-invalidation bus the writers already announce
 * on, and forgets exactly what a change stales, by the bus's OWN matching rule
 * (`dataChangeMatches`): a record-scoped change drops that row's entries, both
 * operations; an object-scoped change drops the object's; `'*'` drops
 * everything. A mounted list then asks again, through
 * {@link useDataInvalidation}, for the rows that lost their answer and for no
 * other — every row still cached is not re-asked. The map only ever holds the
 * current principal's entries (see {@link retainForPrincipal}), so this clears
 * the affected row for that principal and for no one else.
 *
 * **One re-check per change, however often it is announced (objectui#13341).**
 * One write commonly reaches the bus more than once: the console's
 * `useMutationInvalidationBridge` announces every `DataSource` write, and the
 * list host announces its own write again. When the second announcement landed
 * after the re-check had gone out, it staled that re-check and every row went
 * out a second time. Every announcement is made AFTER its write completed (the
 * bridge on the write's response, a host after awaiting it), so a re-check
 * sent after the first one already answers about the row after that write. An
 * announcement that arrives while a row's re-check is on the wire therefore
 * joins it ({@link InFlightProbe.recheck}); a row that was already on the wire
 * BEFORE the first announcement is still staled and asked again, so a write
 * is followed by exactly one fresh question per row and operation. The same
 * rule, kept by hand, is `useRecordEditable`'s.
 *
 * ⚠️ What this does NOT make fresh. Each is a limit of the channel, not an
 * oversight, and none is papered over with a lifetime constant:
 *
 *  - The bus carries writes THIS tab announces: every write through the
 *    host's `DataSource` (via `useMutationInvalidationBridge`), plus the
 *    manual `notifyDataChanged` calls of writes that bypass it. A grant or a
 *    revocation made in another tab, by another user, or by the server on its
 *    own is never announced here, so it lands on the next page load. (Accepted
 *    when this route was ruled, objectui#10107 ACCEPT.)
 *  - A change is named by the object that was WRITTEN. A grant stored as a
 *    row of a different object — a record-share row, a permission-set
 *    assignment — is announced, when it is announced at all, against THAT
 *    object and not against the row it grants, so it does not match this
 *    row's entries either, and it too lands on the next page load.
 *  - An announcement names no write, so a SECOND, distinct write to a row that
 *    this tab completes while the row's re-check is on the wire cannot be told
 *    from the first write announced again, and joins the re-check too. Its
 *    effect on the verdict lands on the row's next change or the next page
 *    load. An announcement that arrives after the re-check has answered drops
 *    that answer and asks again, as before.
 *
 * Module scope on purpose, like the map it guards: an entry must be dropped
 * even while no list is mounted to hear the change, or the next page visit
 * would publish it as the answer.
 */
function forgetChangedRecords(change: DataChange): void {
  for (const key of Array.from(verdictCache.keys())) {
    const [, object, recordId] = JSON.parse(key) as VerdictKey;
    if (dataChangeMatches(change, object, recordId)) {
      verdictCache.delete(key);
      recheckDue.add(key);
    }
  }
  for (const probe of inFlight) {
    for (const id of probe.recordIds) {
      // [objectui#13341] A row's re-check on the wire left AFTER the change
      // that asked for it was announced; a further announcement joins it.
      if (probe.recheck.has(id) || !dataChangeMatches(change, probe.object, id)) continue;
      probe.staled.add(id);
      // A staled row answers nobody, so nobody may join it: the list re-running
      // on this change sends a fresh question, the row's re-check.
      const key = cacheKey(probe.principal, probe.object, id, probe.operation);
      pendingVerdicts.delete(key);
      recheckDue.add(key);
    }
  }
}

subscribeDataChanges(forgetChangedRecords);

/**
 * Test seam — drops the memoised verdicts, the rows waiting on the wire, AND
 * the principal they were for.
 */
export function __clearRecordCrudVerdictCache(): void {
  verdictCache.clear();
  pendingVerdicts.clear();
  recheckDue.clear();
  cachedPrincipal = undefined;
}

/**
 * Ask the explain engine about one batch of rows, and register each row as on
 * the wire until the batch settles (objectui#13341), so an effect run in the
 * meantime joins it. A boolean verdict is written to {@link verdictCache} once,
 * by the ask itself, for every list sharing it.
 */
function askBatch(
  principal: string | null,
  objectName: string,
  operation: RecordCrudOperation,
  chunk: readonly string[],
  doFetch: typeof fetch,
): Promise<void> {
  // The body IS the spec's request contract, not a lookalike shaped to
  // match it (objectui#6332). `satisfies` keeps the literal's own type
  // while making every key and the verb answer to `ExplainRequestSchema`
  // — a renamed or mis-cased key (`recordIDs`, `objectName`) is a
  // compile error here instead of a request the server rejects, or
  // worse, silently reads as "no ids".
  //
  // Type-only: erased at runtime, so nothing about the request that
  // goes out over the wire changes. This deliberately stops at the
  // REQUEST — the response below stays `unknown` on purpose (see the
  // fail-open note in the file header and `WireRecordVerdict`).
  const body = {
    object: objectName,
    operation,
    recordIds: [...chunk],
  } satisfies ExplainRequest;
  const keys = chunk.map((id) => cacheKey(principal, objectName, id, operation));
  const probe: InFlightProbe = {
    principal,
    object: objectName,
    operation,
    recordIds: chunk,
    staled: new Set(),
    // `delete` answers whether the key was due, and clears it either way.
    recheck: new Set(chunk.filter((_, index) => recheckDue.delete(keys[index]))),
  };
  inFlight.add(probe);
  const answer = (async (): Promise<void> => {
    try {
      const res = await doFetch('/api/v1/security/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) return; // 401 / 403 / 501 → fail open
      const decision: unknown = await res.json();
      const records = (decision as { records?: unknown } | null)?.records;
      if (!Array.isArray(records)) return; // no batch verdict → fail open
      // Ordering IS the contract: `records[i]` answers `recordIds[i]`.
      // The echoed `recordId` is checked, not trusted as the key — a
      // response that disagrees with its own ordering contract is not a
      // response this hook can safely re-key, so the entry is dropped and
      // that row falls back to the object-level answer.
      chunk.forEach((id, index) => {
        const entry = records[index] as WireRecordVerdict | undefined;
        if (!entry || typeof entry.visible !== 'boolean') return;
        if (typeof entry.recordId === 'string' && entry.recordId !== id) return;
        // Asked before this row changed → not an answer. A mounted list
        // re-asks it; an unmounted one asks on its next visit (see
        // `forgetChangedRecords`).
        if (probe.staled.has(id)) return;
        verdictCache.set(keys[index], entry.visible);
      });
    } catch {
      /* network / parse failure → fail open */
    } finally {
      inFlight.delete(probe);
    }
  })();
  for (const key of keys) pendingVerdicts.set(key, answer);
  const settle = () => {
    for (const key of keys) if (pendingVerdicts.get(key) === answer) pendingVerdicts.delete(key);
  };
  answer.then(settle, settle);
  return answer;
}

const NO_VERDICTS: RecordCrudVerdictLookup = () => undefined;

export function useRecordCrudVerdicts(opts: {
  /** The object the rows belong to; absent (element data source) = no question to ask. */
  objectName?: string;
  /** The record ids on screen. Order is irrelevant; duplicates are harmless. */
  recordIds: readonly string[];
  /**
   * Ask about `update` at all. Pass the OBJECT-level verdict: when the object
   * answer already hides the entry, the record answer cannot change anything,
   * so the request is not worth sending.
   */
  update?: boolean;
  /** Ask about `delete` at all. Same gate as {@link update}. */
  delete?: boolean;
}): RecordCrudVerdictLookup {
  const { objectName, recordIds, update: wantUpdate, delete: wantDelete } = opts;
  // Read the context directly (not `useSchemaContext`, which throws when no
  // provider is mounted): a standalone grid embed has no host fetch and must
  // still degrade to the global one rather than crash the render.
  const apiFetch = React.useContext(SchemaRendererContext)?.apiFetch;
  // [objectui#10184] The acting user, or `null` when the client has no answer
  // (no provider, an anonymous session, a load still in flight) — exactly what
  // `useRecordEditable` keys its cache by. NOT a second permission source: the
  // verdict still comes from the explain engine alone; this is the identity it
  // belongs to.
  const principal = usePermissions().userId;
  // [objectui#10184] Bumps when a change announced on the bus touches this
  // object, so a mounted list re-asks — for the rows `forgetChangedRecords`
  // dropped, and only those.
  const invalidationNonce = useDataInvalidation(objectName);

  // The id LIST is re-derived from a stable key so this hook cannot loop on a
  // caller that rebuilds the array each render — and so the effect's dependency
  // array stays exhaustive rather than suppressed.
  const idsKey = JSON.stringify(recordIds);
  const ids = React.useMemo<readonly string[]>(() => JSON.parse(idsKey) as string[], [idsKey]);

  const [verdicts, setVerdicts] = React.useState<ReadonlyMap<string, boolean>>(() => new Map());

  React.useEffect(() => {
    retainForPrincipal(principal);
    const operations: RecordCrudOperation[] = [];
    if (wantUpdate) operations.push('update');
    if (wantDelete) operations.push('delete');
    if (!objectName || ids.length === 0 || operations.length === 0) {
      setVerdicts(new Map());
      return;
    }
    let cancelled = false;
    const doFetch = apiFetch ?? fetch;

    /** Publish what the cache holds for the rows on screen — nothing else. */
    const publish = () => {
      const next = new Map<string, boolean>();
      for (const operation of operations) {
        for (const id of ids) {
          const verdict = verdictCache.get(cacheKey(principal, objectName, id, operation));
          if (typeof verdict === 'boolean') next.set(`${operation}:${id}`, verdict);
        }
      }
      setVerdicts(next);
    };

    void (async () => {
      const settled: Promise<void>[] = [];
      for (const operation of operations) {
        // A row on the wire is joined, not asked again (objectui#13341); only
        // the rows nobody has asked about go out, still batched under the cap.
        const toAsk = new Set<string>();
        for (const id of ids) {
          const key = cacheKey(principal, objectName, id, operation);
          if (verdictCache.has(key)) continue;
          const pending = pendingVerdicts.get(key);
          if (pending) settled.push(pending);
          else toAsk.add(id);
        }
        const missing = Array.from(toAsk);
        for (let i = 0; i < missing.length; i += EXPLAIN_BATCH_MAX_RECORD_IDS) {
          const chunk = missing.slice(i, i + EXPLAIN_BATCH_MAX_RECORD_IDS);
          settled.push(askBatch(principal, objectName, operation, chunk, doFetch));
        }
      }
      await Promise.all(settled);
      if (!cancelled) publish();
    })();

    // Rows already in the cache answer on this render rather than after the
    // round trip — paging back to a visited page never blinks through the
    // fail-open state.
    publish();

    return () => {
      cancelled = true;
    };
  }, [objectName, ids, wantUpdate, wantDelete, apiFetch, principal, invalidationNonce]);

  return React.useMemo<RecordCrudVerdictLookup>(() => {
    if (verdicts.size === 0) return NO_VERDICTS;
    return (recordId, operation) =>
      recordId == null ? undefined : verdicts.get(`${operation}:${String(recordId)}`);
  }, [verdicts]);
}
