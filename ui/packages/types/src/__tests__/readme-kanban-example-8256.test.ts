/**
 * The root README's "Kanban Board" example must survive the validator a reader
 * hands it to — `@object-ui/types/zod`'s `safeValidateSchema` (objectui#8256).
 *
 * ## The defect this closes
 *
 * The example authored its lanes as `{ value, label, color }`. The document is
 * a `type: "object-kanban"` one, so `objectql.zod.ts#ObjectKanbanSchema` judges
 * it, and that face declares `columns` as a union of two ARRAYS — bare value
 * strings, or `{ id, title }` lanes (objectui#8913). A `{ value, label }` lane
 * is neither, so the whole document was refused with a single `invalid_union`
 * at `columns`. A reader who copied the block got a rejection.
 *
 * ## Why no gate saw it, measured on this tree rather than assumed
 *
 * Gates DO read this README's `json` fences — `check:doc-types` reads every
 * `type` literal in them and `check:doc-fences` reads their language tag, both
 * widened onto the root page by objectui#7115. Neither VALIDATES the fence:
 * `check:doc-types`'s own header names "whether the snippet's OTHER keys are
 * read by the renderer" as the question it deliberately does not answer, and
 * `check:doc-snippets` / `check:doc-examples` compile `ts`/`tsx` fences, of
 * which a `json` block is not one. So the document could be refused by the
 * shipped schema with every check green — which is the hole this file closes
 * for this one example, the way `plugin-gantt`'s
 * `readme-navigation-example.test.ts` closes it for that package's README.
 *
 * ## The example is EXTRACTED, never retyped
 *
 * A hand copy drifts from the page it claims to pin and therefore pins nothing.
 * A moved heading, a removed fence or a non-JSON body throws out of the
 * extractor rather than passing vacuously on an empty fixture.
 *
 * ## The green carries its own control
 *
 * A `safeValidateSchema` that succeeds proves nothing if the validator accepts
 * everything, so the HISTORICAL lane shape is parsed alongside and must be
 * refused. ⚠️ And the third leg is the reason a TEXT assertion is needed at
 * all: on this face `color` is NOT a named refusal. `ObjectKanbanLaneSchema` is
 * a plain strip-postured `z.object`, so a lane carrying `color` PARSES and the
 * key is dropped from the parsed document. (The named refusal for `color` lives
 * on `complex.zod.ts#KanbanColumnSchema`, which judges nothing authored today:
 * the bare `kanban` arm it served retired in objectui#8802.) An
 * accepted-and-dropped key cannot be caught by validity alone.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeValidateSchema } from '../zod/index.zod';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

const README = join(uiRoot(), 'README.md');
const HEADING = 'Kanban Board';

/** The README section this example lives in, bounded to its own heading. */
function kanbanSection(): string {
  const src = readFileSync(README, 'utf8');
  const heading = new RegExp(`^#{2,6} .*${HEADING}\\s*$`, 'm').exec(src);
  if (!heading) throw new Error(`no "${HEADING}" heading in ${README}`);
  const start = heading.index;
  const next = src.slice(start + heading[0].length).search(/^#{1,6} /m);
  return next < 0 ? src.slice(start) : src.slice(start, start + heading[0].length + next);
}

/** The `json` fence in that section — the example itself. */
function readmeExample(): Record<string, unknown> {
  const fence = /^[ \t]*```json[ \t]*\n([\s\S]*?)\n[ \t]*```/m.exec(kanbanSection());
  if (!fence) throw new Error(`no \`\`\`json fence under the "${HEADING}" heading in ${README}`);
  // Not wrapped in a try/catch: `JSON.parse`'s own `SyntaxError` names the
  // offending token and is thrown from this line, which is louder than anything
  // a re-throw could add.
  const parsed: unknown = JSON.parse(fence[1]);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error("the README's Kanban example is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

const EXAMPLE = readmeExample();

/** The shape the page taught before objectui#8256 — the control's input. */
const HISTORICAL_LANES = [
  { value: 'todo', label: 'To Do', color: '#6366f1' },
  { value: 'done', label: 'Done', color: '#22c55e' },
];

function reasons(document: unknown): string[] {
  const result = safeValidateSchema(document);
  return result.success ? [] : result.error.issues.map((i) => `${i.code} [${i.path.join('.')}]: ${i.message}`);
}

describe("root README: the 'Kanban Board' example", () => {
  it('is an object-kanban board — the face that judges it', () => {
    // A silent retype to another `type` would make every leg below a statement
    // about a different validator while still reading green.
    expect(EXAMPLE.type).toBe('object-kanban');
    expect(Array.isArray(EXAMPLE.columns) && (EXAMPLE.columns as unknown[]).length).toBeGreaterThan(0);
  });

  it('validates under the shipped safeValidateSchema', () => {
    expect(
      reasons(EXAMPLE),
      'The documented example must survive the validator a reader hands it to. It did not: ' +
        '`{ value, label, color }` lanes are neither arm of `ObjectKanbanSchema.columns`, so the ' +
        'whole board was refused at `columns` and nothing the snippet promises rendered.',
    ).toEqual([]);
  });

  it('CONTROL: the same call still REFUSES the historical lane shape', () => {
    expect(
      reasons({ ...EXAMPLE, columns: HISTORICAL_LANES }),
      'This control is what makes the leg above a measurement rather than a validator that ' +
        'accepts anything. If it ever comes back empty, `columns` has stopped being judged and ' +
        'the green above no longer says what it claims.',
    ).not.toEqual([]);
  });

  it('carries no `color` on a lane — ACCEPTED AND DROPPED here, so validity alone cannot see it', () => {
    const withColour = { ...EXAMPLE, columns: [{ id: 'todo', title: 'To Do', color: '#6366f1' }] };
    const parsed = safeValidateSchema(withColour);
    // First half: the measurement. A lane `color` parses and is stripped.
    expect(parsed.success).toBe(true);
    expect(
      parsed.success ? Object.keys((parsed.data as { columns: object[] }).columns[0]) : [],
      '`ObjectKanbanLaneSchema` strips what it does not declare, so an authored lane `color` ' +
        'reaches no renderer and raises no issue. Style a lane through its `className`.',
    ).not.toContain('color');
    // Second half: therefore the page is checked as TEXT, not only as a parse.
    expect(JSON.stringify(EXAMPLE)).not.toContain('"color"');
  });
});
