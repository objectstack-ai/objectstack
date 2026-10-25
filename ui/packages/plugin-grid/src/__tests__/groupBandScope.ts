/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { within, type Matcher } from '@testing-library/react';

/**
 * objectui#12620 — a grouped grid is ONE table, and a group is a band row in
 * its body. The rows a group owns are the rows AFTER its band, up to the next
 * band: its data rows, then its footer (a server group's pager or loading
 * line). `groupRowEl` is the band's content (`group-row-KEY`).
 */
export function bandRowsOf(groupRowEl: Element): HTMLElement[] {
  const band = groupRowEl.closest('tr');
  if (!band || band.getAttribute('data-testid') !== 'data-table-group-band') {
    throw new Error('bandRowsOf: the element is not inside a group band row');
  }
  const rows: HTMLElement[] = [];
  for (
    let tr = band.nextElementSibling;
    tr && tr.getAttribute('data-testid') !== 'data-table-group-band';
    tr = tr.nextElementSibling
  ) {
    rows.push(tr as HTMLElement);
  }
  return rows;
}

/** `within`-style text queries over the rows one group band owns. */
export function withinBand(groupRowEl: Element) {
  const queryAllByText = (text: Matcher) =>
    bandRowsOf(groupRowEl).flatMap((row) => within(row).queryAllByText(text));
  return {
    queryAllByText,
    queryByText: (text: Matcher) => queryAllByText(text)[0] ?? null,
    getByText: (text: Matcher) => {
      const hits = queryAllByText(text);
      if (hits.length !== 1) throw new Error(`withinBand: expected one match for ${String(text)}, found ${hits.length}`);
      return hits[0];
    },
    querySelector: (selector: string) =>
      bandRowsOf(groupRowEl).map((row) => row.querySelector(selector)).find((hit) => hit != null) ?? null,
  };
}
