/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useNavDocTargetCheck — the console's answer to "may THIS member read what
 * this `doc` navigation entry opens?" (objectui#10188), as the
 * {@link DocTargetChecker} `@object-ui/layout`'s item guard asks.
 *
 * ## Defence in depth, not a second enforcer
 *
 * The server is the enforcer (ADR-0046 §6.7). Since objectstack#19790 its app
 * read drops a `doc` entry the caller may not read, so on a current server the
 * menu never receives one. That ruling's point 2 keeps the renderer's pruning
 * as defence in depth behind it, which is what this hook feeds.
 *
 * ## What it reads: the member's own answers, no audience rule of its own
 *
 * `useMetadata()` — `MetadataProvider`'s per-type cache, the shell's one
 * metadata door — for the `doc` list and, only when an entry names a book, the
 * `book` list. The server prunes both per caller (ADR-0046 §6.7: a book by its
 * own audience, a doc by its effective audience), so they ARE the member's
 * readable set. Nothing here reads an `audience`. Nothing is fetched unless the
 * navigation holds a `doc` entry: one list request per type (the cache's),
 * never one per entry.
 *
 *  - a page (`doc`) — the member's `doc` list names it;
 *  - a book (`book`) — the member's `book` list names it (a declared book whose
 *    own audience admits them), or the name is a PACKAGE one of the member's
 *    readable docs comes from: the implicit per-package book (§6.4), which
 *    claims every doc of its package, so it has a readable page exactly then;
 *  - a page in a book — both halves hold.
 *
 * A declared book the member may read has a readable page whenever it claims
 * one: a doc's effective audience is the union over every book claiming it, so
 * a book that admits the member admits every page it claims. So the list
 * membership above is the whole AUDIENCE question for a book. Whether an
 * admitted book claims any page at all is a question about its content, the
 * same for every member; the server's nav gate answers it, and this hook does
 * not re-derive book membership.
 *
 * ## Until the answer is known, the server's answer stands
 *
 * While either list is loading, when its read failed, or outside a
 * `MetadataProvider` (whose no-provider fallback reports every type "ready" and
 * empty), this returns `undefined` — the guard then passes every `doc` entry,
 * exactly as the server sent it. It never hides an entry on a missing answer.
 */

import { useContext, useMemo } from 'react';
import { MetadataCtx } from '@object-ui/react';
import type { DocNavTarget, DocTargetChecker } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { useMetadata } from '../providers/MetadataProvider.js';

/** Which reads the `doc` entries of these trees need. */
function docTargetsIn(trees: ReadonlyArray<ReadonlyArray<NavigationItem> | undefined>): { any: boolean; books: boolean } {
  const need = { any: false, books: false };
  const walk = (items: ReadonlyArray<NavigationItem> | undefined): void => {
    for (const item of items ?? []) {
      if (item?.type === 'doc') {
        need.any = true;
        if (typeof item.book === 'string') need.books = true;
      }
      if (item?.type === 'group') walk(item.children);
    }
  };
  for (const tree of trees) walk(tree);
  return need;
}

function namesOf(items: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const it of items) {
    const name = (it as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name) names.add(name);
  }
  return names;
}

/** The packages the member's readable docs come from (`_packageId`, the list's provenance). */
function packagesOf(items: readonly unknown[]): Set<string> {
  const pkgs = new Set<string>();
  for (const it of items) {
    const pkg = (it as { _packageId?: unknown } | null)?._packageId;
    if (typeof pkg === 'string' && pkg) pkgs.add(pkg);
  }
  return pkgs;
}

/**
 * @param trees every navigation tree the caller renders or derives from (the
 *   app's `navigation` and each area's), so the lists load only when one of
 *   them holds a `doc` entry.
 * @returns the member-readability checker, or `undefined` while the answer is
 *   not known (see the module docblock).
 */
export function useNavDocTargetCheck(
  trees: ReadonlyArray<ReadonlyArray<NavigationItem> | undefined>,
): DocTargetChecker | undefined {
  const { getItemsByType, getTypeStatus } = useMetadata();
  const provided = useContext(MetadataCtx) !== null;
  const need = provided ? docTargetsIn(trees) : { any: false, books: false };
  // An absent `getTypeStatus` means "always ready" (its declared contract).
  const ready = (type: string) => (getTypeStatus ? getTypeStatus(type) === 'ready' : true);

  // Reading an idle type starts its fetch (the provider's lazy contract), so
  // the reads are made only for what the entries need.
  const docItems = need.any ? getItemsByType('doc') : undefined;
  const bookItems = need.books ? getItemsByType('book') : undefined;
  const docsReady = need.any && ready('doc');
  const booksReady = !need.books || ready('book');

  return useMemo<DocTargetChecker | undefined>(() => {
    if (!docsReady || !booksReady || !docItems) return undefined;
    const docs = namesOf(docItems);
    const docPackages = packagesOf(docItems);
    const books = bookItems ? namesOf(bookItems) : new Set<string>();
    const bookReadable = (book: string) => books.has(book) || docPackages.has(book);
    return ({ book, doc }: DocNavTarget) =>
      (book === undefined || bookReadable(book)) && (doc === undefined || docs.has(doc));
  }, [docsReady, booksReady, docItems, bookItems]);
}
