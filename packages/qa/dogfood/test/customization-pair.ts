// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28576] ADR-0146 D11 closed the package-less write onto a packaged item.
// `PUT` or `DELETE /meta/<type>/<name>` with no `?package=`, for a view,
// dashboard, report, translation or email template that a read-only package
// ships, now answers `403 NOT_OVERRIDABLE`. An administrator's customization
// of such an item goes into the base's `.custom` pair instead, declaring the
// item it overrides. These helpers are that write, for the suites that
// customize a shipped item on a real boot.

import { expect } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';

/** The `.custom` pair of a base package. */
export const pairOf = (base: string): string => `${base}.custom`;

/** Ensure the base's pair exists (`201` the first time, `200` after). */
export async function ensurePair(stack: VerifyStack, token: string, base: string): Promise<string> {
  const res = await stack.apiAs(token, 'POST', `/packages/${base}/ensure-customization`);
  expect([200, 201], await res.clone().text()).toContain(res.status);
  return pairOf(base);
}

/** `path` addressed to the base's pair (`package=<base>.custom` added to its query). */
export const inPair = (path: string, base: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}package=${pairOf(base)}`;

/** `body` declared as the pair's override of the item `base` ships at `version`. */
export const declaredOverride = <T extends Record<string, unknown>>(body: T, base: string, version: string) =>
  ({ ...body, overrides: { package: base, basedOn: version } });
