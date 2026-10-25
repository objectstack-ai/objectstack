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
  open: OpenRecordLink | null
): LinkSafetyConfig | undefined {
  if (!open) {
    return base;
  }
  // streamdown's own default when no config is passed.
  const config: LinkSafetyConfig = base ?? { enabled: true };
  return {
    ...config,
    onLinkCheck: (url) => {
      const target = parseRecordLink(url);
      if (target) {
        open(target);
        return new Promise<boolean>(() => {});
      }
      return config.onLinkCheck ? config.onLinkCheck(url) : false;
    },
  };
}
