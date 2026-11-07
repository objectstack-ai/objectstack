// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where Connect an AI Assistant opens, for every entry that leads to it: the
 * avatar menu item, the Home card and the administrator's first-run checklist
 * row.
 *
 * The page is `@objectstack/mcp`'s `connect_agent`, reached through the served
 * Account app. `@objectstack/mcp` contributes the Account nav entry exactly
 * when it registers the page, so a deployment with MCP turned off answers
 * `undefined` here and no entry draws a dead link.
 */

import { appAddressSegment } from '../../utils/appRoute.js';

/** The page the Connect an AI Assistant entries open (`@objectstack/mcp`). */
export const CONNECT_ASSISTANT_PAGE = 'connect_agent';

/**
 * Whether a served navigation tree carries a `page` entry for `pageName`,
 * groups included. The tree is the server's, already folded and filtered for
 * this caller, so a hit means the page is registered and reachable.
 */
export function navCarriesPage(items: unknown, pageName: string): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((item: any) =>
    (item?.type === 'page' && item?.pageName === pageName)
    || navCarriesPage(item?.children, pageName));
}

/** The Console path of Connect an AI Assistant, or `undefined` while the served Account app does not carry it. */
export function connectAssistantPath(apps: readonly any[] | null | undefined): string | undefined {
  const accountApp = (apps || []).find((a: any) => a?.name === 'account');
  return accountApp && navCarriesPage((accountApp as any).navigation, CONNECT_ASSISTANT_PAGE)
    ? `/apps/${appAddressSegment(apps, accountApp)}/page/${CONNECT_ASSISTANT_PAGE}`
    : undefined;
}
