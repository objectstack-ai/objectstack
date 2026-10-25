/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, useContext } from 'react';

/**
 * Have the RECORDS the board is about to draw settled? (objectui#8827)
 *
 * ## What this exists to stop
 *
 * `KanbanImpl` paints `DataEmptyState` — a `role="status" aria-live="polite"`
 * live region titled "No cards" — whenever the board holds zero cards. (It
 * also required more than one lane until objectui#9045 removed that conjunct
 * as unreachability rather than a guard; the lane count never had anything to
 * do with settling.) That predicate is an ASSERTION ABOUT THE DATA, and the
 * component was making it before it had the data.
 *
 * The production shape is a board whose lanes come from view metadata
 * (`schema.columns`, available synchronously) and whose records come from
 * `ObjectKanban`'s async query. `KanbanImpl` is loaded behind `React.lazy`, so
 * the chunk's arrival and the records' arrival are two UNORDERED events
 * (objectui#8534's second half — the mirror half was closed by PR #8825, this
 * one was not). Measured on post-#8825 `main`: when the chunk wins the race,
 * `KanbanImpl`'s first committed frame carries the authored lanes with zero
 * cards, satisfies the empty predicate, and announces a FALSE "No cards" to
 * assistive technology while the rows are still in flight. When the data wins,
 * the Suspense skeleton covers the same interval and nothing is announced.
 * ⇒ The only thing hiding the false announcement today is the lazy skeleton
 * happening to be slower than the fetch, and nothing makes it slower.
 *
 * ## Why a tri-state settle and not a `loading` boolean
 *
 * `ObjectKanban` already holds a `loading` boolean — and wiring THAT into the
 * predicate fixes nothing, which is the measurement that decided this shape.
 * In standalone mode it is initialised `false` (`useState(hasExternalData ?
 * (externalLoading ?? false) : false)`) and only set `true` inside the fetch
 * EFFECT, i.e. after the commit — so the first frame still reads
 * `loading === false` and the false empty state paints exactly where it did.
 * A bare boolean takes the SAME value for "not started" and "finished"; it
 * cannot express settled.
 *
 * This repo already ruled on that distinction for the sibling problem in this
 * same component (objectui#6271 / #7225, maintainer ruling B): see
 * `useSettledSchema`, whose doc carries the full argument for why "a bare
 * `objectDef` cannot express 'settled with nothing'" and why the settle is
 * DERIVED at render from one keyed piece of state rather than latched into a
 * second boolean. `ObjectKanban` follows that shape here for records.
 *
 * ## Why a context rather than a prop — and why that is not gate-dodging
 *
 * The producer is `ObjectKanban` and the consumer is `KanbanImpl`, with
 * `KanbanRenderer`'s `Suspense`/`lazy` boundary in between; context crosses
 * that boundary normally. Routing the signal as a member of
 * `KanbanRendererProps` (or of its `schema` bag) would put a new key on a
 * PUBLISHED payload — `KanbanRendererProps` is exported from `index.tsx` — for
 * a value no caller outside this package may set. The `schema` bag is worse
 * still: `BaseSchema` is `.passthrough()`, so a key there is reachable by an
 * AUTHOR on the schema-only `kanban-ui` entry, which is precisely the defect
 * objectui#7742 / decision batch #70 moved `objectFields` off that bag to
 * close. This module is NOT re-exported from `index.tsx`, the package declares
 * a single `.` module entry, and `index.tsx` carries no `export *` — so
 * nothing here reaches the published surface. It is a genuinely narrower
 * channel, not the same channel hidden.
 *
 * ## ⚠️ The default is `true`, and that is load-bearing
 *
 * The reverse regression is named in `ObjectKanban.tsx` itself: "gating on a
 * truthy definition would leave those boards empty forever." A board that
 * never settles never shows its empty state, so every exit must settle:
 *
 *   1. the fetch succeeding, and 2. the fetch throwing — both settled by
 *      `ObjectKanban`'s `finally`;
 *   3. no readable source (no `dataSource`, no `find`, no `objectName`) and
 *      4. the non-fetch record sources (`externalData`, bound data, inline
 *      `schema.data`, which are settled from the first frame) — both settled
 *      STRUCTURALLY, by `ObjectKanban` deriving "the board's own query is what
 *      we are waiting for" at render rather than by an effect remembering to
 *      say so;
 *   5. the schema-only `kanban-ui` entry, which has no `ObjectKanban` and
 *      therefore NO PROVIDER — its records arrive whole from their author and
 *      are settled by construction. That case is served by THIS DEFAULT.
 *
 * ⇒ Default `true` means: absent a producer that knows better, the board keeps
 * exactly the behaviour it had. A genuinely empty board still paints
 * `DataEmptyState`; only the claim made BEFORE the answer is withheld.
 */
export const KanbanRecordsSettledContext = createContext<boolean>(true);

/**
 * Read the settle signal above. Package-private by construction — see the
 * context's doc for why this is not a prop.
 */
export function useKanbanRecordsSettled(): boolean {
  return useContext(KanbanRecordsSettledContext);
}
