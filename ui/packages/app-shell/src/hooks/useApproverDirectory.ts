/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useApproverDirectory — resolve `<kind>:<value>` approver references against
 * the system directory objects, for the surfaces that must NAME an approver
 * (`77f846a8b`).
 *
 * ## Server-first, and inert by default
 *
 * The producer's own `pending_approver_names` is authoritative and this hook
 * never competes with it: callers pass only the references the server left
 * unresolved. On a backend that resolves everything the ref list is empty, the
 * effect returns before touching the adapter, and the record page issues not one
 * extra request. That gate is why a display fix can afford directory reads at
 * all.
 *
 * ## What it reads, and why the staffing leg is separate
 *
 *   - one `find` per distinct directory OBJECT a `data` binding names (a team,
 *     department or user row), batched with `$in` over that object's values —
 *     the label leg for a kind the spec binds to a DATA row;
 *   - one registry read per metadata TYPE, for a kind the spec binds to the
 *     registry instead (`{ source: 'registry', type }`, objectui#7611 Q3b):
 *     the console's metadata store, `ensureType(<type>)` — the
 *     `GET /api/v1/meta/<type>` read the Approval Center's position labels and
 *     the decision outputs already make — matched by the item's `name`. That is
 *     the label leg for a registry-bound kind; nothing is read from a mirror
 *     table for it;
 *   - for `position` refs only, `sys_user_position` -> `sys_user` — the staffing
 *     leg, which answers "who actually sits in this seat" and, when it comes
 *     back empty, the unstaffed state `77f846a8b` surfaces. The junction stores
 *     the position's machine NAME under either binding, so this leg does not
 *     depend on which one the spec declares.
 *
 * The two legs fail INDEPENDENTLY. A business-app reader may read the position
 * registry and hold no list access to `sys_user_position`; `find` rejects that
 * with `OBJECT_API_DISABLED` rather than an empty page. Folding the legs together
 * would let a permission error render as `销售经理(暂无在岗人员)` — a fabricated
 * fact on a governance surface. A failed staffing leg therefore leaves `holders`
 * `undefined` (unknown), which `approverDisplay` renders as silence, while the
 * label it did resolve still lands.
 *
 * ## The module-level cache
 *
 * `DeclaredActionsBar` mounts one component PER declared action, each asking
 * about the same slate; the panel asks again. Without dedupe an override on a
 * three-action request would fan one answer into a dozen requests. The cache is
 * keyed by the reference string and lives for the page session — a display
 * label, not a decision input, so a position renamed mid-session reading stale
 * until reload is the correct trade. `resetApproverDirectoryCache()` exists for
 * tests, which must not inherit each other's answers.
 */

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MetadataCtx, useAdapter } from '@object-ui/react';
import {
  APPROVER_DIRECTORY_BINDINGS,
  APPROVER_REGISTRY_TYPES,
  PERSON_DISPLAY_FIELDS,
  approverKindIsResolvable,
  parseApproverRef,
  rowLabel,
  type ResolvedApprover,
} from '../utils/approverIdentity.js';

/** The directory answers for a slate of references, keyed by the raw reference. */
export type ApproverDirectory = Record<string, ResolvedApprover>;

/** Junction carrying "user U holds position P" (ADR-0090 D3). */
const USER_POSITION_OBJECT = 'sys_user_position';
/** `sys_user_position.position` stores the position MACHINE NAME, not its id. */
const USER_POSITION_NAME_FIELD = 'position';
const USER_POSITION_USER_FIELD = 'user_id';
const PERSON_OBJECT = 'sys_user';

const CACHE = new Map<string, ResolvedApprover>();
const INFLIGHT = new Map<string, Promise<void>>();

/** Drop every memoized answer — tests only; see this module's docstring. */
export function resetApproverDirectoryCache(): void {
  CACHE.clear();
  INFLIGHT.clear();
}

/**
 * The rows of a `find()` answer, read as `QueryResult` declares them.
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * This reader used to try `records` and `items` FIRST and only then `data`
 * (objectui#5945) — two spellings the contract does not define, tried ahead of
 * the one it does. Measured across this repo, nothing produces either at this
 * seam: `ObjectStackAdapter.normalizeQueryResult` maps the server's `records`
 * envelope to `data` before returning, and `items` has no producer at all.
 * Accepting them anyway is AGENTS.md #0.1 — a tolerant reader that would let a
 * non-conforming producer (a raw SDK client handed in where a `DataSource`
 * belongs) keep working, so the wrong shape is never rejected anywhere and
 * becomes a second de-facto contract. Do not add spellings back: fix the
 * producer.
 *
 * The bare-array arm stays because it is LIVE — fakes at this seam answer with
 * a plain array (see `AssignedUsersSection.test.tsx`).
 */
const asArray = (res: any): any[] =>
  Array.isArray(res) ? res : res?.data ?? [];

/**
 * Resolve the label leg for every reference of one directory kind.
 * Rejects propagate to {@link loadSlate}, which isolates each kind.
 */
async function resolveLabels(
  adapter: any,
  kind: string,
  values: string[],
  into: Map<string, ResolvedApprover>,
): Promise<void> {
  const binding = APPROVER_DIRECTORY_BINDINGS[kind];
  if (!binding) return;
  const rows = asArray(
    await adapter.find(binding.object, {
      $filter: { [binding.valueField]: { $in: values } },
      $top: 200,
    }),
  );
  for (const row of rows) {
    const key = row?.[binding.valueField];
    if (key == null) continue;
    const label = rowLabel(row, binding.displayFields);
    if (!label) continue;
    const ref = `${kind}:${String(key)}`;
    into.set(ref, { ...into.get(ref), label });
  }
}

/** The one member of the console's metadata store the registry leg reads. */
export interface ApproverRegistryReader {
  ensureType: (type: string) => Promise<readonly unknown[]>;
}

/**
 * Resolve the label leg for every reference of one REGISTRY-bound kind
 * (objectui#7611 Q3b): list the kind's metadata type once and label each
 * reference by the item whose `name` it carries. An item with no string
 * `label` adds nothing, so the prettified machine name still reads.
 * Rejects propagate to {@link loadSlate}, which isolates each kind.
 */
async function resolveRegistryLabels(
  reader: ApproverRegistryReader,
  kind: string,
  type: string,
  values: string[],
  into: Map<string, ResolvedApprover>,
): Promise<void> {
  const items = await reader.ensureType(type);
  const wanted = new Set(values);
  for (const item of Array.isArray(items) ? items : []) {
    const name = (item as { name?: unknown } | null)?.name;
    const label = (item as { label?: unknown } | null)?.label;
    if (typeof name !== 'string' || !wanted.has(name)) continue;
    if (typeof label !== 'string' || !label.trim()) continue;
    const ref = `${kind}:${name}`;
    into.set(ref, { ...into.get(ref), label: label.trim() });
  }
}

/**
 * Resolve the staffing leg for `position:` references — who sits in each seat.
 * A seat that the junction never mentions is recorded as `[]` (probed, empty),
 * which is what makes the unstaffed state sayable; a REJECTION leaves every
 * seat's `holders` untouched, i.e. unknown.
 */
async function resolveStaffing(
  adapter: any,
  positionNames: string[],
  into: Map<string, ResolvedApprover>,
): Promise<void> {
  const assignments = asArray(
    await adapter.find(USER_POSITION_OBJECT, {
      $filter: { [USER_POSITION_NAME_FIELD]: { $in: positionNames } },
      $top: 500,
    }),
  );
  const userIdsByPosition = new Map<string, string[]>();
  for (const name of positionNames) userIdsByPosition.set(name, []);
  for (const a of assignments) {
    const name = a?.[USER_POSITION_NAME_FIELD];
    const uid = a?.[USER_POSITION_USER_FIELD];
    if (name == null || uid == null) continue;
    const bucket = userIdsByPosition.get(String(name));
    if (bucket && !bucket.includes(String(uid))) bucket.push(String(uid));
  }

  const allIds = [...new Set([...userIdsByPosition.values()].flat())];
  const nameById = new Map<string, string>();
  if (allIds.length > 0) {
    const people = asArray(
      await adapter.find(PERSON_OBJECT, { $filter: { id: { $in: allIds } }, $top: 500 }),
    );
    for (const p of people) {
      if (p?.id == null) continue;
      nameById.set(String(p.id), rowLabel(p, PERSON_DISPLAY_FIELDS) || String(p.id));
    }
  }

  for (const [name, ids] of userIdsByPosition) {
    const ref = `position:${name}`;
    into.set(ref, { ...into.get(ref), holders: ids.map((id) => nameById.get(id) ?? id) });
  }
}

/**
 * Resolve one slate of references, writing every answer into the shared cache.
 *
 * Each leg is isolated: a kind whose object the viewer cannot list must not cost
 * the other kinds their labels, and a failed staffing leg must not cost the
 * position its label. Every reference asked about is written back even when
 * nothing resolved, so a second mount does not re-ask a question the directory
 * has already declined to answer.
 *
 * Which label leg a kind takes is the spec's published binding, read per kind:
 * a `data` binding reads its directory object through the adapter, a
 * `registry` binding reads its metadata type through the store. A leg whose
 * reader is absent (no adapter, no `<MetadataProvider>`) is skipped, which is
 * the same answer as a leg that failed.
 */
async function loadSlate(
  adapter: any,
  registry: ApproverRegistryReader | null,
  refs: string[],
): Promise<void> {
  const answers = new Map<string, ResolvedApprover>();
  const valuesByKind = new Map<string, string[]>();
  for (const raw of refs) {
    const ref = parseApproverRef(raw);
    if (!ref || !approverKindIsResolvable(ref.kind)) continue;
    const bucket = valuesByKind.get(ref.kind) ?? [];
    if (!bucket.includes(ref.value)) bucket.push(ref.value);
    valuesByKind.set(ref.kind, bucket);
  }

  await Promise.all(
    [...valuesByKind].map(([kind, values]) => {
      const registryType = APPROVER_REGISTRY_TYPES[kind];
      const leg = registryType
        ? registry
          ? resolveRegistryLabels(registry, kind, registryType, values, answers)
          : Promise.resolve()
        : adapter
          ? resolveLabels(adapter, kind, values, answers)
          : Promise.resolve();
      return leg.catch(() => {
        /* label leg unavailable — the prettified machine name still reads */
      });
    }),
  );

  const positions = valuesByKind.get('position');
  if (adapter && positions && positions.length > 0) {
    await resolveStaffing(adapter, positions, answers).catch(() => {
      /* staffing unknown — NOT the same claim as "the seat is empty" */
    });
  }

  for (const raw of refs) CACHE.set(raw, answers.get(raw) ?? {});
}

/**
 * Directory answers for `refs`, resolved once per page session.
 *
 * Pass `[]` (or only server-unresolved references) to keep the hook inert.
 */
export function useApproverDirectory(refs: readonly string[]): ApproverDirectory {
  const adapter = useAdapter() as any;
  // The console's metadata store, or `null` outside a `<MetadataProvider>` —
  // the reader of the registry label leg. Read raw rather than through
  // `useMetadata()`, whose no-provider fallback answers every type with `[]`,
  // and held in a ref: the store's context value is rebuilt whenever any type
  // it caches settles, and no effect may key on that identity (AGENTS.md #10).
  const metadataStore = useContext(MetadataCtx);
  const registryRef = useRef<ApproverRegistryReader | null>(metadataStore);
  // Synced in an effect, not during render; declared before the load effect
  // below, so it runs first in the same commit.
  useEffect(() => {
    registryRef.current = metadataStore;
  });
  // Sorted + de-duplicated so a re-render that reorders the slate does not
  // re-run the effect, and so the in-flight key is stable across callers.
  const wanted = useMemo(() => [...new Set(refs)].filter(Boolean).sort(), [refs]);
  const key = wanted.join('|');
  const [tick, bump] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const registry = registryRef.current;
    if ((!adapter && !registry) || wanted.length === 0) return;
    const missing = wanted.filter((r) => !CACHE.has(r));
    if (missing.length === 0) return;
    const batch = missing.join('|');
    let pending = INFLIGHT.get(batch);
    if (!pending) {
      pending = loadSlate(adapter, registry, missing).finally(() => INFLIGHT.delete(batch));
      INFLIGHT.set(batch, pending);
    }
    void pending.then(() => { if (alive.current) bump((n) => n + 1); });
    // `key` is the stable identity of `wanted`; listing the array itself would
    // re-run on every render that rebuilds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, key]);

  return useMemo(() => {
    const out: ApproverDirectory = {};
    for (const r of wanted) {
      const hit = CACHE.get(r);
      if (hit) out[r] = hit;
    }
    return out;
    // `tick` is bumped when a load settles; `key` identifies the slate. The
    // cache itself is module state and cannot be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
}
