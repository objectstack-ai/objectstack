---
'@objectstack/rest': minor
---

fix(rest)!: `POST /batch` answers an update or delete op whose id names no row with the missing-id `400`, not a `500` (#24781)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A refusal at the cross-object batch door of request shapes that never wrote anything: every one of them already failed, as a 500 (or, for a delete addressed only by data.id, a 400 INVALID_FILTER), and now fails up front with the 400 a missing id already got. No metadata key, spelling, export, type or stored shape moves, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone; the remedy is sending the record's id, stated below. -->

**BREAKING** accept-set narrowing on one REST door, shipped as `minor` under the launch-window convention for accept-set narrowings. No request that succeeded before is refused now.

The cross-object batch checked up front that an `update` / `delete` op names a row, but tested only for an absent or `null` id. An id the engine does not take as one reached the engine, and its `Update requires an ID…` / `Delete requires an ID…` throw answered as a server fault. A client's retry policy keyed on `5xx` then retried a request that can never succeed. The check now judges the id the op's write arm actually sends, with the engine's own by-id rule (a truthy string or number).

- FROM: `update` with `"id": ""`, or with no `id` and a `data.id` of `""`, `0`, `true`, `false`, an object or an array, answered `500 DATABASE_ERROR`. An `"id": ""` beside a real `data.id` did too, because `id` is read first.
- FROM: `delete` with `"id": ""` answered `500 INTERNAL_ERROR`.
- FROM: `delete` with no `id` and the record's id in `data.id` answered `400 INVALID_FILTER`, with a message about a `where.id` the caller never wrote. The delete arm never read `data.id`; it is the create/update payload.
- TO: each of these answers `400 VALIDATION_FAILED` with `Operation 'update' on 'OBJECT' requires an id` (or `'delete'`), the answer the same op with no id already got. The batch is refused before the transaction opens, and nothing is written.
- Fix: send the record's id in the op's `id` (an update may carry it in `data.id` instead).

This step runs before the per-object API-exposure check, as it did for a missing id. So for such an op, this `400` now also replaces whatever a later step used to answer first, such as the `404` / `405` for an API-disabled object or method.

**Unchanged.** A missing or `null` id answers the same `400`. A real id updates and deletes as before, by `id` or (update only) by `data.id`. An update whose `data.id` is a `{ $ref }` to an earlier create still resolves. A whitespace id is an id the engine looks up: it answers `404 RECORD_NOT_FOUND`, like any unknown id. The per-object doors (`/data/:object/batch`, `updateMany`, `deleteMany`) already refused a blank id per row and are not changed.
