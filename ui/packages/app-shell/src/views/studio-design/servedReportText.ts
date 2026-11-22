// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The served (current-language) text of a report's name and description,
 * paired with the published layer it was translated from — the report's half
 * of `servedDashboardText.ts`, read by the report inspector's Name box
 * (`servedLabel.ts`).
 *
 * The runtime report page and the Studio both edit a report through its
 * authored buffer, which the server does not translate; the `/meta` report
 * list the console's metadata store holds is translated for this session's
 * language (`translateReport`). A host that holds both provides them through
 * {@link ServedReportTextContext}; outside a provider the inspector reads the
 * buffer alone, as it always has. Internal to app-shell.
 */

import * as React from 'react';
import type { ServedLabelPair } from '../metadata-admin/inspectors/servedLabel.js';
import { isLabel } from './servedNavText.js';

/** The served text of one report's translatable slots. */
export interface ServedReportText {
  label?: ServedLabelPair;
  description?: ServedLabelPair;
}

/**
 * Pair the served report (`served`, a row of the `/meta` report list) with the
 * published layer it was translated from (`published`). `null` when either is
 * missing or the two are not the same report.
 */
export function servedReportTextOf(
  published: Record<string, unknown> | null | undefined,
  served: Record<string, unknown> | null | undefined,
): ServedReportText | null {
  if (!published || !served) return null;
  if (typeof published.name !== 'string' || published.name !== served.name) return null;
  const out: ServedReportText = {};
  for (const slot of ['label', 'description'] as const) {
    const s = served[slot];
    const a = published[slot];
    if (!isLabel(s)) continue;
    out[slot] = { authored: isLabel(a) ? a : undefined, served: s };
  }
  return out;
}

/** `null` (the default) is "no served text": the inspector reads the buffer alone. */
export const ServedReportTextContext = React.createContext<ServedReportText | null>(null);

/** The served report text the nearest host provides, or `null`. */
export function useServedReportText(): ServedReportText | null {
  return React.useContext(ServedReportTextContext);
}
