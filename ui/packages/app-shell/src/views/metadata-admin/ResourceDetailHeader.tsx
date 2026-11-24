// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The header of a metadata item's full-screen page (objectstack#36901, epic
 * objectstack#36890): `StudioDetailHeader` wired to the item's address — ×
 * back to the type's list, ‹ › to the neighbours in the list's order — for the
 * generic item page and the area's form editor alike.
 *
 * The addresses (ADR-0146 D1 as amended, decisions 7 and 10):
 *
 *  - × opens the type's list, one path segment up, with the list context the
 *    item's address carries (its search, filters and sort) and its package
 *    scope (`?package=`, `?scope=`): the list as the person left it.
 *  - ‹ › open the previous and the next name of `useListOrderedNames`, a
 *    sibling segment, with the same list context and scope and the open tab,
 *    so a walk keeps the list and the tab. A same-name group (two members of
 *    a bundle, two holders of a permission set) is one step, and the step
 *    opens the name's canonical member.
 *  - What belongs to this item alone does not travel: its member, its review
 *    request, its related target and its designer selection
 *    ({@link ITEM_ONLY_PARAMS}).
 *
 * Both go through the leave guard (`StudioDetailHeader`). That the person
 * came from Studio is the address itself — this page is Studio's — so no
 * marker param is added (decision 15 governs the pages that open in an app).
 */

import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StudioDetailHeader, type StudioDetailHeaderProps } from '../studio-detail/StudioDetailHeader.js';
import { BUNDLE_MEMBER_PARAM } from './registry.js';
import { useListOrderedNames } from './useListOrderedNames.js';
import { ITEM_TOOL_TAB_PARAM } from '../item-tools/ItemToolTabs.js';

/** The params that belong to one item and never travel to the list or to a neighbour. */
export const ITEM_ONLY_PARAMS: readonly string[] = [
  ITEM_TOOL_TAB_PARAM,
  'review',
  'open',
  'sel',
  BUNDLE_MEMBER_PARAM,
];

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** The query × hands the list: the item's address minus {@link ITEM_ONLY_PARAMS}. */
export function detailListSearch(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of ITEM_ONLY_PARAMS) next.delete(key);
  return next;
}

/** Where × goes, relative to the item's path: one segment up, with {@link detailListSearch}. */
export function detailListHref(search: URLSearchParams): string {
  return withQuery('..', detailListSearch(search));
}

/** Where ‹ › go, relative to the item's path: the sibling `name`, with the list context and the open tab. */
export function detailSiblingHref(search: URLSearchParams, name: string, tabAddress: string | null): string {
  const next = detailListSearch(search);
  if (tabAddress) next.set(ITEM_TOOL_TAB_PARAM, tabAddress);
  return withQuery(`../${encodeURIComponent(name)}`, next);
}

export interface ResourceDetailHeaderProps
  extends Omit<StudioDetailHeaderProps, 'onClose' | 'onOpenItem' | 'sequence'> {
  type: string;
  /** The item's name; empty on a create page. */
  name: string;
  /** Draw ‹ ›: an item that exists. A create page has no place in the list. */
  pager?: boolean;
  /** The open tab's address value (`useItemToolTab`), carried by ‹ ›. */
  tabAddress?: string | null;
}

export function ResourceDetailHeader({ pager = true, ...props }: ResourceDetailHeaderProps): React.ReactElement {
  return pager && props.name ? <SequencedHeader {...props} /> : <PlainHeader {...props} />;
}

function useAddressNavigation(name: string, tabAddress: string | null | undefined) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return {
    close: () => navigate(detailListHref(searchParams), { relative: 'path' }),
    open: (next: string) => {
      if (next !== name) navigate(detailSiblingHref(searchParams, next, tabAddress ?? null), { relative: 'path' });
    },
  };
}

type HeaderInput = Omit<ResourceDetailHeaderProps, 'pager'>;

function PlainHeader({ type: _type, name, tabAddress, ...header }: HeaderInput): React.ReactElement {
  const go = useAddressNavigation(name, tabAddress);
  return <StudioDetailHeader {...header} onClose={go.close} />;
}

function SequencedHeader({ type, name, tabAddress, ...header }: HeaderInput): React.ReactElement {
  const go = useAddressNavigation(name, tabAddress);
  const ordered = useListOrderedNames(type);
  // No ‹ › until the list answered: a pager over no names would read "not in
  // the list" while it is only unread.
  const sequence = ordered.status === 'ready' ? { names: ordered.names, current: name } : undefined;
  return <StudioDetailHeader {...header} sequence={sequence} onOpenItem={go.open} onClose={go.close} />;
}
