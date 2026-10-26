// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * gh-pages — every page of one paginated REST read, walked by `page=N` until a
 * short page comes back (#25962). Shared by `fleet-roster.mjs` and
 * `mailbox-open.mjs`.
 *
 * ## Why not `gh api --paginate --slurp`
 *
 * The built-in gh of cloud sessions answers `--slurp is not supported by this
 * built-in gh.`, and the fleet runs in cloud sessions — so a reader that leans
 * on that flag is a reader no seat can run. Plain `gh api <path>` works under
 * both the real CLI and the built-in one, so the loop lives here instead.
 *
 * ⛔ No `Link` header: a page shorter than `per_page` is the last one, the same
 * rule as `board-snapshot.mjs`'s `readAllPages`. An exact multiple of
 * `per_page` costs one extra, empty read.
 *
 * A library, not an instrument: no CLI and no `--self-test` of its own. Both
 * importers' self-tests read a three-page fixture through `readAllPages` with
 * an injected `get`, so the loop is tested offline twice.
 */

import { spawnSync } from 'node:child_process';

export const PER_PAGE = 100;
/** A runaway guard, not a budget: 50 pages × 100 is far past any read these scripts make. */
export const MAX_PAGES = 50;

/** `path` with `per_page` forced to `PER_PAGE` and `page` set to `page`; every other query key kept in order. */
export function pagePath(path, page) {
  const [base, query = ''] = String(path).split('?', 2);
  const keep = query.split('&').filter((kv) => kv && !/^(?:per_page|page)=/.test(kv));
  return `${base}?${[...keep, `per_page=${PER_PAGE}`, `page=${page}`].join('&')}`;
}

/** One `gh api <path>` read, parsed. `{ ok: true, value }` or `{ ok: false, error }` — never throws. */
export function ghApi(path, { maxBuffer = 256 * 1024 * 1024 } = {}) {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8', maxBuffer });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || `gh exited ${r.status}`).trim() };
  try {
    return { ok: true, value: JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, error: `unparseable answer from GET ${path}: ${e.message}` };
  }
}

/**
 * Every row of a paginated list read: `page=1, 2, …` until a page shorter than
 * `PER_PAGE`. Same answer shape as `ghApi`. A page that is not an array, a
 * failed page, or a read past `MAX_PAGES` is an error — ⛔ never a partial list
 * returned as if whole.
 */
export function readAllPages(path, { get = ghApi } = {}) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = pagePath(path, page);
    const r = get(p);
    if (!r.ok) return r;
    if (!Array.isArray(r.value)) return { ok: false, error: `GET ${p} answered ${r.value === null ? 'null' : typeof r.value}, not a list page` };
    rows.push(...r.value);
    if (r.value.length < PER_PAGE) return { ok: true, value: rows };
  }
  return { ok: false, error: `GET ${path} still returned full pages after ${MAX_PAGES}; refusing a partial read` };
}
