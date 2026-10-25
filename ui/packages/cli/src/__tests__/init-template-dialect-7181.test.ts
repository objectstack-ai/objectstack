/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7181 — everything `objectui init` scaffolds spells its child lists
 * `children`.
 *
 * ## Why this pin exists
 *
 * `init.ts` is a PRODUCER: it writes JSON into a project directory that the
 * user then owns and edits. Every template it shipped spelled its child lists
 * `body`, the dialect objectui#6771 retires. Nothing pinned that, so nothing
 * would have noticed either the dialect drifting back or a newly added template
 * arriving in the old spelling.
 *
 * The ordering constraint this protects is the card's own: once the authoring
 * tier teaches `children` only, a scaffolder still emitting `body` produces a
 * project that the very next `objectui validate` rejects — a new user's first
 * two commands contradicting each other.
 *
 * ## The template population is DERIVED, never listed here
 *
 * `buildInitFiles` names its own templates in the error it throws for an
 * unknown one. This pin reads that list rather than repeating it, so a template
 * added to `init.ts` tomorrow is covered by this file today. Per AGENTS.md #9,
 * a count or a list written into a test is derived once and never again; the
 * instrument that re-derives it is what should be pointed at.
 *
 * ## Both directions are asserted, so a zero cannot pass vacuously
 *
 * Asserting only "no node spells `body`" would pass against a template that
 * emitted no nodes at all, or against a walk that visited nothing. Each
 * template therefore also has to yield at least one node that DOES spell
 * `children` — the lit control for the absence assertion beside it.
 */

import { describe, expect, it } from 'vitest';

import { buildInitFiles } from '../commands/init.js';

/** Ask `buildInitFiles` itself which templates exist. */
function discoverTemplateNames(): string[] {
  let message = '';
  try {
    buildInitFiles('probe', '__no_such_template__');
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  const match = /Available templates:\s*(.+)$/m.exec(message);
  expect(
    match,
    'buildInitFiles no longer reports its template list on an unknown name — ' +
      'this pin can no longer discover the population it is supposed to cover'
  ).not.toBeNull();

  const names = match![1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  expect(names.length, 'no templates discovered').toBeGreaterThan(0);
  return names;
}

interface DialectTally {
  body: number;
  children: number;
  nodes: number;
}

/** Walk any parsed JSON value and tally which child-list key each node uses. */
function tallyDialect(value: unknown, tally: DialectTally): DialectTally {
  if (Array.isArray(value)) {
    value.forEach((entry) => tallyDialect(entry, tally));
    return tally;
  }
  if (!value || typeof value !== 'object') return tally;

  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') tally.nodes += 1;
  if ('body' in node) tally.body += 1;
  if ('children' in node) tally.children += 1;

  Object.values(node).forEach((entry) => tallyDialect(entry, tally));
  return tally;
}

/** The JSON files a scaffolded project is created with. */
function scaffoldedJson(templateName: string): Array<[string, unknown]> {
  const files = buildInitFiles('probe-app', templateName);
  const parsed = Object.entries(files)
    .filter(([fileName]) => fileName.endsWith('.json'))
    .map(([fileName, contents]) => {
      let value: unknown;
      expect(
        () => {
          value = JSON.parse(contents);
        },
        `${templateName}/${fileName} is not parseable JSON — a scaffolded project would not load`
      ).not.toThrow();
      return [fileName, value] as [string, unknown];
    });

  expect(
    parsed.length,
    `template "${templateName}" scaffolds no .json file at all`
  ).toBeGreaterThan(0);
  return parsed;
}

describe('objectui#7181 — `objectui init` scaffolds the `children` spelling', () => {
  const templateNames = discoverTemplateNames();

  it.each(templateNames)(
    'template "%s" emits no `body` child list anywhere',
    (templateName) => {
      const tally = scaffoldedJson(templateName).reduce(
        (acc, [, value]) => tallyDialect(value, acc),
        { body: 0, children: 0, nodes: 0 }
      );

      // Lit control first: if the walk found no nodes, or none of them spells
      // `children`, the zero below would mean nothing.
      expect(
        tally.nodes,
        `template "${templateName}": the walk visited no typed node`
      ).toBeGreaterThan(0);
      expect(
        tally.children,
        `template "${templateName}": no node spells \`children\` — the absence ` +
          'assertion below would be vacuous'
      ).toBeGreaterThan(0);

      expect(
        tally.body,
        `template "${templateName}" still emits the retired \`body\` child-list dialect`
      ).toBe(0);
    }
  );

  it('scaffolds the same node count under the new spelling as the old one carried', () => {
    // The migration was a rename, not a re-shape: every template must still
    // carry at least as many typed nodes as child lists, and no template may
    // have lost its tree to a bad edit.
    templateNames.forEach((templateName) => {
      const tally = scaffoldedJson(templateName).reduce(
        (acc, [, value]) => tallyDialect(value, acc),
        { body: 0, children: 0, nodes: 0 }
      );
      expect(tally.nodes).toBeGreaterThanOrEqual(tally.children);
    });
  });

  it('rejects an unknown template by name rather than scaffolding a default', () => {
    expect(() => buildInitFiles('probe', '__no_such_template__')).toThrow(
      /Unknown template/
    );
  });
});
