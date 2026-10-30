// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27838] The approval node's describe text is the field help an admin reads
 * in the Studio flow inspector: the inspector renders the engine-published
 * JSON schema (`getApprovalNodeConfigJsonSchema`), each property's
 * `description` becomes the help line, and a help longer than two lines opens
 * clamped behind "Learn more". So the FIRST sentence is the one an admin
 * actually reads, and it must say what the setting does to the request in
 * business words.
 *
 * What is pinned is the absence of the engineer shapes in that first sentence
 * — a decision id, a backticked key, a quoted enum literal, a snake_case or
 * camelCase identifier, an organization symbol — on every description the
 * published schema carries, nested shapes included. The prose itself is not
 * pinned; later sentences may still name the sibling key or literal an author
 * has to write, and engineer detail lives in the JSDoc.
 */

import { describe, expect, it } from 'vitest';

import { getApprovalNodeConfigJsonSchema } from './approval.zod';

/** Every `description` in a JSON-schema tree, with the path that reached it. */
function descriptions(node: unknown, path: string, out: { path: string; text: string }[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => descriptions(child, `${path}[${i}]`, out));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'description' && typeof value === 'string') out.push({ path: path || '(root)', text: value });
    else descriptions(value, path ? `${path}.${key}` : key, out);
  }
}

/** The text up to the first sentence stop. */
function firstSentence(text: string): string {
  return text.split(/\.(?:\s|$)/)[0] ?? '';
}

const ENGINEER_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ['a decision id', /\bADR-\d+/],
  ['a backticked key or literal', /`/],
  ["a quoted enum literal such as 'admin_rescue'", /'[a-z]+(?:_[a-z]+)*'/],
  ['a snake_case identifier', /\b[a-z]+_[a-z_]+\b/],
  ['a camelCase identifier', /\b[a-z]+[A-Z][A-Za-z]*\b/],
  ['an organization symbol', /\$root|\$parent/],
];

const collected: { path: string; text: string }[] = [];
descriptions(getApprovalNodeConfigJsonSchema(), '', collected);

describe('approval describe text opens in business words', () => {
  it('reads the descriptions the designer renders, nested shapes included', () => {
    const paths = collected.map((d) => d.path);
    // Controls: a node-level key, an approver column, an escalation field and a
    // typed decision output, so a walk that stopped at the top level reds here.
    expect(paths).toContain('properties.excludeSubmitter');
    expect(paths.some((p) => p.endsWith('properties.organization'))).toBe(true);
    expect(paths.some((p) => p.endsWith('properties.timeoutHours'))).toBe(true);
    expect(paths.some((p) => p.endsWith('properties.multiple'))).toBe(true);
  });

  it.each(ENGINEER_SHAPES)('no first sentence carries %s', (_label, shape) => {
    const offenders = collected
      .map((d) => ({ path: d.path, first: firstSentence(d.text) }))
      .filter((d) => shape.test(d.first));
    expect(offenders).toEqual([]);
  });
});
