/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13037 — a record link in an assistant answer opens that record
 * inside the console.
 *
 * An answer names a record with ONE fixed link form, carrying only the object
 * name and the record id:
 *
 *     [Wayne Enterprises](/record/account/acc_42)
 *
 * The href must match {@link RECORD_LINK_PATTERN} exactly: object names follow
 * the spec's object-name grammar (`^[a-z_][a-z0-9_]*$`), record ids are 1-128
 * letters, digits, `_` or `-`. A query string, a fragment, an encoded slash or
 * any further path segment fails the match, so such a link is not navigated
 * and keeps streamdown's default link safety like every other link.
 *
 * A matching click calls the host's `onOpenRecord` — the same handler the
 * `open_record` tool's card calls — so the host resolves the app segment and
 * the router base; the answer never names a mount or a package id.
 *
 * The interception rides streamdown's own `linkSafety.onLinkCheck`, and only
 * for the record form. Every other link (external, or any other same-origin
 * path) gets the caller's check, or none, and so the same confirmation dialog
 * and new tab as before. Overriding `components.a` instead would replace
 * streamdown's link component for EVERY link, and that component (with its
 * dialog) is not exported, so the default could not be kept for the rest.
 *
 * objectstack#31869 — an answer that counts records ("12 open
 * opportunities") names the matching LIST with a second fixed form, beside the
 * record form and as closed as it:
 *
 *     [12 open opportunities](/list/opportunity?uf__filter=ENCODED_JSON)
 *
 * The path is `/list/OBJECT` ({@link LIST_LINK_PATH_PATTERN}); the query may
 * carry `view` (a view name) and `uf__filter` (the list's Filter panel
 * conditions, `{ logic, conditions }` with one spec `ViewFilterRule` each, the
 * value the list route already reads under that name), each at most once and
 * never empty, and nothing else. Any other key, a repeat, an empty value, a
 * fragment or a filter that is not that envelope makes the href not the list
 * form, so it keeps the default link safety: an assistant answer never hands
 * the console an open URL. A matching click calls the host's `onOpenList`,
 * which resolves the app and BUILDS the list address from the parsed values,
 * so the href's own query string is never forwarded. Whether the conditions
 * name fields this reader may filter on is the list page's question, not this
 * grammar's.
 *
 * Module-private: imported by `elements/message.tsx` and
 * `ChatbotEnhanced.tsx`, never re-exported from the package entry. It lives
 * outside `elements/`, which holds vendored upstream files only.
 */
import { createContext } from "react";
import type { LinkSafetyConfig } from "streamdown";

/** The record a record link names. */
export type RecordLinkTarget = { objectName: string; recordId: string };

/** The host's way to open a record (the chat's `onOpenRecord`). */
export type OpenRecordLink = (target: RecordLinkTarget) => void;

/**
 * The one record-link form, as streamdown hands the href to `onLinkCheck`.
 * (rehype-harden normalises `./record/...` to `/record/...` before that, and
 * drops a bare `record/...`.)
 */
export const RECORD_LINK_PATTERN =
  /^\/record\/([a-z_][a-z0-9_]*)\/([A-Za-z0-9_-]{1,128})$/;

/** The record a link names, or `null` when the href is not the record form. */
export function parseRecordLink(href: string | null | undefined): RecordLinkTarget | null {
  if (typeof href !== "string") {
    return null;
  }
  const match = RECORD_LINK_PATTERN.exec(href);
  return match ? { objectName: match[1], recordId: match[2] } : null;
}

/**
 * The host's record opener for the answers rendered below it. `null` (no
 * host handler) leaves every link, the record form included, on streamdown's
 * default link safety.
 */
export const RecordLinkContext = createContext<OpenRecordLink | null>(null);

/** The Filter panel envelope a list link carries in `uf__filter`. */
export type ListLinkFilter = { logic: "and" | "or"; conditions: unknown[] };

/** The list a list link names (objectstack#31869). */
export type ListLinkTarget = { objectName: string; view?: string; filter?: ListLinkFilter };

/** The host's way to open a list (the chat's `onOpenList`). */
export type OpenListLink = (target: ListLinkTarget) => void;

/** The list-link path, everything before the `?` (objectstack#31869). */
export const LIST_LINK_PATH_PATTERN = /^\/list\/([a-z_][a-z0-9_]*)$/;

/** A view name a list link may carry, the object-name grammar. */
const LIST_LINK_VIEW_PATTERN = /^[a-z_][a-z0-9_]*$/;

/** The list-link query keys, and the only ones. */
const LIST_LINK_VIEW_PARAM = "view";
const LIST_LINK_FILTER_PARAM = "uf__filter";

function parseListLinkFilter(raw: string): ListLinkFilter | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const { logic, conditions } = parsed as { logic?: unknown; conditions?: unknown };
  if ((logic !== "and" && logic !== "or") || !Array.isArray(conditions) || conditions.length === 0) {
    return null;
  }
  return { logic, conditions };
}

/** The list a link names, or `null` when the href is not the list form. */
export function parseListLink(href: string | null | undefined): ListLinkTarget | null {
  if (typeof href !== "string" || href.includes("#")) {
    return null;
  }
  const queryAt = href.indexOf("?");
  const path = queryAt === -1 ? href : href.slice(0, queryAt);
  const match = LIST_LINK_PATH_PATTERN.exec(path);
  if (!match) {
    return null;
  }
  const target: ListLinkTarget = { objectName: match[1] };
  if (queryAt === -1) {
    return target;
  }
  const seen = new Set<string>();
  for (const [key, value] of new URLSearchParams(href.slice(queryAt + 1))) {
    if (seen.has(key) || value === "") {
      return null;
    }
    seen.add(key);
    if (key === LIST_LINK_VIEW_PARAM) {
      if (!LIST_LINK_VIEW_PATTERN.test(value)) {
        return null;
      }
      target.view = value;
    } else if (key === LIST_LINK_FILTER_PARAM) {
      const filter = parseListLinkFilter(value);
      if (!filter) {
        return null;
      }
      target.filter = filter;
    } else {
      return null;
    }
  }
  return seen.size > 0 ? target : null;
}

/**
 * The host's list opener for the answers rendered below it (objectstack#31869).
 * `null` leaves a list link on the default link safety.
 */
export const ListLinkContext = createContext<OpenListLink | null>(null);

/**
 * `linkSafety` for an answer: the caller's config, with the record form routed
 * to `open`.
 *
 * streamdown's link click awaits `onLinkCheck(url)`: `true` opens the url in a
 * new tab, anything else opens the confirmation dialog. A record link wants
 * neither, so after handing the record to `open` the check returns a promise
 * that never settles, and the click ends there (a fresh promise per click, so
 * nothing accumulates once the click's continuation is dropped).
 */
export function withRecordLinks(
  base: LinkSafetyConfig | undefined,
  open: OpenRecordLink | null,
  openList: OpenListLink | null = null
): LinkSafetyConfig | undefined {
  if (!open && !openList) {
    return base;
  }
  // streamdown's own default when no config is passed.
  const config: LinkSafetyConfig = base ?? { enabled: true };
  return {
    ...config,
    onLinkCheck: (url) => {
      const target = open ? parseRecordLink(url) : null;
      if (target && open) {
        open(target);
        return new Promise<boolean>(() => {});
      }
      // objectstack#31869 — the list form, the same way.
      const list = openList ? parseListLink(url) : null;
      if (list && openList) {
        openList(list);
        return new Promise<boolean>(() => {});
      }
      return config.onLinkCheck ? config.onLinkCheck(url) : false;
    },
  };
}
