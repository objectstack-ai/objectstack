/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { extractRecords } from '@object-ui/core';

/**
 * The line-item grid's record reads, one per referenced object (objectstack#36552).
 *
 * Every people and lookup cell of the grid is its own `LookupField`, and each
 * one that holds a bare id reads that record to draw its name: one
 * `findOne(object, id)` per line, so a grid of twenty lines with a people
 * column made twenty reads of `sys_user`, and a lookup column twenty more of
 * its target, however few distinct records the lines named.
 *
 * The grid hands its cells this data source instead of the page's. It answers
 * the plain by-id read (`findOne(object, id)`, no options) from ONE
 * `find(object, { $filter: { id: { $in: ids } } })` per object, gathering the
 * reads that every cell makes in the same tick (the cells' mount effects all
 * run in one flush). The ids are de-duplicated, so twenty lines naming two
 * products ask for two rows. Every other member, and a by-id read that carries
 * options, goes to the page's data source untouched.
 *
 * Why here and not an `$expand` on the read of the lines (AGENTS.md, Prime
 * Directive 5, SQL first): the grid does not make that read. Its rows reach it
 * as a value — from the master-detail form's or the line-items panel's read of
 * the child object, or stored inline on the record as the `grid` field's JSON,
 * which no `$expand` can reach — and an expanded reference held in a row is
 * also what the save path and the blank-line check would then read and write
 * back. One `$in` read per object is one SQL query with an `IN` list, at the
 * one place every host's rows pass through.
 *
 * At most {@link CHUNK} ids go in one read, the page size `LookupField` caps
 * its own `$in` reads at, so no read asks for more rows than a server may
 * return; a grid naming more distinct records than that makes one read per
 * chunk.
 */

/** `LookupField`'s `LOOKUP_PAGE_SIZE`: the most ids one `$in` read names. */
const CHUNK = 50;

type ReadSource = {
  find: (object: string, params?: Record<string, unknown>) => Promise<unknown>;
  findOne?: (object: string, id: string | number, params?: unknown) => Promise<unknown>;
};

type Waiter = { id: string | number; resolve: (row: unknown) => void; reject: (error: unknown) => void };

const isReadSource = (source: unknown): source is ReadSource =>
  source != null && typeof source === 'object' && typeof (source as ReadSource).find === 'function';

/** One wrapper per page data source, so every grid on the page shares its batches and each cell sees one stable source. */
const wrappers = new WeakMap<object, object>();

/**
 * The data source the grid hands its people and lookup cells: `source`, with
 * its by-id read gathered into one read per object (see the module note).
 * `undefined` when there is no data source to read through, so the cells
 * resolve theirs as they do without the grid.
 */
export function lineReferenceSource(source: unknown): unknown {
  if (!isReadSource(source) || typeof source.findOne !== 'function') return undefined;
  const held = wrappers.get(source);
  if (held) return held;

  const waiting = new Map<string, Waiter[]>();

  const flush = (object: string) => {
    const waiters = waiting.get(object) ?? [];
    waiting.delete(object);
    const ids = new Map<string, string | number>();
    for (const w of waiters) if (!ids.has(String(w.id))) ids.set(String(w.id), w.id);
    const all = [...ids.values()];
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK);
      const keys = new Set(chunk.map(String));
      const mine = waiters.filter((w) => keys.has(String(w.id)));
      source
        .find(object, { $filter: { id: { $in: chunk } }, $top: chunk.length })
        .then((result) => {
          const byId = new Map<string, unknown>();
          for (const row of extractRecords(result)) {
            if (row && typeof row === 'object' && row.id != null) byId.set(String(row.id), row);
          }
          // `findOne`'s own answer for a record it cannot find: `null`.
          for (const w of mine) w.resolve(byId.get(String(w.id)) ?? null);
        })
        .catch((error: unknown) => {
          for (const w of mine) w.reject(error);
        });
    }
  };

  const findOne = (object: string, id: string | number, params?: unknown): Promise<unknown> => {
    if (params !== undefined || (typeof id !== 'string' && typeof id !== 'number') || id === '') {
      return source.findOne!(object, id, params);
    }
    return new Promise((resolve, reject) => {
      const queue = waiting.get(object);
      if (queue) {
        queue.push({ id, resolve, reject });
        return;
      }
      waiting.set(object, [{ id, resolve, reject }]);
      queueMicrotask(() => flush(object));
    });
  };

  // Every other member is the page source's own, bound to it, so a method
  // that reads its instance state runs exactly as it does unwrapped. Bound
  // once per member, so a member reads as the same function on every access.
  const bound = new WeakMap<(...args: unknown[]) => unknown, unknown>();
  const wrapper = new Proxy(source as object, {
    get(target, prop) {
      if (prop === 'findOne') return findOne;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!bound.has(value)) bound.set(value, value.bind(target));
      return bound.get(value);
    },
  });
  wrappers.set(source, wrapper);
  return wrapper;
}
