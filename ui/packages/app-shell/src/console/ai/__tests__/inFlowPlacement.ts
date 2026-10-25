// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How a row of the composer's area sits against the element below it, read
 * from the DOM: the structure that decides two boxes, for suites that pin a
 * row never covers the composer's input (objectui#12978, objectui#13068).
 *
 * The test environment runs no layout: every box reads as zeros, so comparing
 * two boxes would pass whatever the layout was. What is read instead, and
 * what a floating row fails:
 *
 * - `holdsConversation`: the nearest element holding both does not hold the
 *   conversation (`role="log"`). A float's nearest common element was the
 *   pane root, which holds it;
 * - `outOfFlow`: nothing between either element and that common element is
 *   taken out of flow (`absolute`, `fixed`, `sticky`, by class or inline
 *   style). A float's wrapper was `absolute`;
 * - `rowBeforeBelow`: in that element the row's own row comes before the
 *   other's, so in that flow it is laid out above it;
 * - `insideForm`: the row is not inside a form, so a button in it can never
 *   submit the chat.
 *
 * The boxes themselves are measured in a browser and recorded on each
 * suite's pull request.
 */

/** A class or inline style that takes a box out of normal flow, or null. */
export function outOfFlow(el: Element): string | null {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/);
  const hit = classes.find((c) => /^(?:[\w-]+:)*(?:absolute|fixed|sticky)$/.test(c));
  if (hit) return hit;
  const position = (el as HTMLElement).style?.position;
  return position === 'absolute' || position === 'fixed' || position === 'sticky'
    ? `style position: ${position}`
    : null;
}

/** Every out-of-flow marker from `from` up to, not including, `stop`. */
export function outOfFlowBetween(from: Element, stop: Element): string[] {
  const hits: string[] = [];
  for (let el: Element | null = from; el && el !== stop; el = el.parentElement) {
    const hit = outOfFlow(el);
    if (hit) hits.push(`${el.tagName.toLowerCase()} ${hit}`);
  }
  return hits;
}

/** `el` and its ancestors, nearest first (walked by `parentElement` alone). */
export function lineage(el: Element): Element[] {
  const chain: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
  return chain;
}

export interface Placement {
  holdsConversation: boolean;
  outOfFlow: string[];
  rowBeforeBelow: boolean;
  insideForm: boolean;
}

/**
 * How `row` sits against `below`, or null when no element holds both. Pass
 * the composer's input (`form textarea`) as `below` to read a row against it.
 */
export function readPlacement(row: Element, below: Element): Placement | null {
  const rowLine = lineage(row);
  const belowLine = lineage(below);
  // The nearest element holding both, and the row of it each one belongs to.
  const common = rowLine.find((el) => belowLine.includes(el));
  if (!common) return null;
  // Counted by siblings, never by identity: in this environment the composer's
  // form reached through `parentElement` compares unequal to the one
  // `children` lists, so `indexOf`, `contains` and `compareDocumentPosition`
  // all miss it (measured while writing objectui#12978's test).
  const rowOf = (line: Element[]) => {
    let index = 0;
    for (let n = line[line.indexOf(common) - 1].previousElementSibling; n; n = n.previousElementSibling) index += 1;
    return index;
  };
  return {
    holdsConversation: common.querySelector('[role="log"]') !== null,
    outOfFlow: [...outOfFlowBetween(row, common), ...outOfFlowBetween(below, common)],
    rowBeforeBelow: rowOf(rowLine) < rowOf(belowLine),
    insideForm: rowLine.some((el) => el.tagName === 'FORM'),
  };
}

/** The placement a row laid out in flow above `below` reads. */
export const IN_FLOW_ABOVE: Placement = {
  holdsConversation: false,
  outOfFlow: [],
  rowBeforeBelow: true,
  insideForm: false,
};
