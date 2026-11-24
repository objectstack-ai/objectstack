// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-skill-served-sections — the sections of the published skills that the
 * hosted MCP door serves keep their headings, and the JSON they show is JSON
 * the spec accepts.
 *
 *   tsx scripts/check-skill-served-sections.ts              # the gate
 *   tsx scripts/check-skill-served-sections.ts --self-test  # verify the checker
 *
 * ## The contract it guards
 *
 * The hosted door finds a section by its exact heading text, outside code
 * fences; the heading must occur exactly once in its file, and the section runs
 * to the next heading of the same or a higher level. A renamed, removed or
 * duplicated heading fails that product at module load, and nothing in this
 * repository knew which headings are read. The list is
 * `skill-served-sections.json`, beside this file; `readSection` below is that
 * rule, line for line, so a verdict here is the verdict there.
 *
 * A client served these sections writes JSON, so each row also declares the
 * form its section takes (`forms` in the list) and, in document order, the
 * validator every ```json fence of the section must pass. A fence the row does
 * not declare is red, and so is a declared one that is gone: a JSON example
 * cannot enter a served section unvalidated.
 *
 * ## What is judged
 *
 *   heading   occurs exactly once in its file, outside fences
 *   item      a row naming a numbered list item: `N. ` starts exactly one line
 *   form      `neutral` carries no TypeScript fence; `json` carries JSON and no
 *             TypeScript fence; `json+ts` carries both
 *   json      each fence parses, and the spec schema its validator names
 *             accepts it (a flow node also against its node type's config
 *             contract, which is what refuses it at registration)
 *
 * Not judged: the passages the hosted door replaces inside two sections. They
 * are that product's strings and only it can check them.
 *
 * Reads `src/` through tsx and needs no build.
 */

import fs from 'fs';
import path from 'path';

import {
  FlowNodeSchema,
  FlowSchema,
  TimeRelativeTriggerSchema,
  flowNodeConfigRefusals,
} from '../src/automation';
import { FieldSchema, ObjectSchema, ValidationRuleSchema } from '../src/data';
import { PermissionSetSchema } from '../src/security';
import { ActionSchema } from '../src/ui';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const LIST_FILE = path.resolve(__dirname, 'skill-served-sections.json');

/**
 * The files this gate READS, declared for `scripts/pm/dispatch-gates.mjs` as a
 * LITERAL array (its hint extractor reads source text). Eleven files, not the
 * skills root: the gate opens only the files the list names, and
 * `assertWatchHintsNameTheList` holds this declaration equal to the list.
 */
const DECLARED_WATCH_HINTS = [
  'skills/objectstack-automation/SKILL.md',
  'skills/objectstack-automation/references/examples-flows.md',
  'skills/objectstack-automation/references/state-machines-and-approvals.md',
  'skills/objectstack-data/SKILL.md',
  'skills/objectstack-data/references/seeds.md',
  'skills/objectstack-data/rules/lifecycle.md',
  'skills/objectstack-data/rules/naming.md',
  'skills/objectstack-data/rules/relationships.md',
  'skills/objectstack-data/rules/validation.md',
  'skills/objectstack-ui/SKILL.md',
  'skills/objectstack-ui/rules/list-views.md',
];

const FORMS = ['json', 'json+ts', 'neutral'] as const;
type Form = (typeof FORMS)[number];

interface ServedSection {
  /** Repository-relative path of the skill file. */
  file: string;
  heading: string;
  item?: number;
  form: Form;
  json: string[];
}

/** A validator answers with the reasons it refuses a parsed JSON value; none means accepted. */
type Validator = (value: unknown) => string[];
type SafeParser = {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } };
};

function bySchema(schema: SafeParser): Validator {
  return (value) => {
    const result = schema.safeParse(value);
    if (result.success) return [];
    return (result.error?.issues ?? []).map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
  };
}

const flowNode: Validator = (value) => {
  const shape = bySchema(FlowNodeSchema)(value);
  if (shape.length > 0) return shape;
  const node = value as { type: string; config?: { timeRelative?: unknown } };
  const out = flowNodeConfigRefusals(node.type, node.config).map((refusal) => refusal.message);
  if (node.config?.timeRelative !== undefined) {
    out.push(...bySchema(TimeRelativeTriggerSchema)(node.config.timeRelative).map((m) => `config.timeRelative.${m}`));
  }
  return out;
};

const VALIDATORS: Readonly<Record<string, Validator>> = {
  Object: bySchema(ObjectSchema),
  Field: bySchema(FieldSchema),
  ValidationRule: bySchema(ValidationRuleSchema),
  PermissionSet: bySchema(PermissionSetSchema),
  Action: bySchema(ActionSchema),
  Flow: bySchema(FlowSchema),
  FlowNode: flowNode,
  FlowNodeList: (value) =>
    Array.isArray(value) && value.length > 0
      ? value.flatMap((node, at) => flowNode(node).map((m) => `[${at}] ${m}`))
      : ['expected a non-empty array of flow nodes'],
  /** A CRUD node's `filter` value, judged where the engine judges it: inside a `get_record` config. */
  FlowFilter: (value) =>
    flowNode({ id: 'probe', type: 'get_record', label: 'Probe', config: { objectName: 'probe', filter: value } }),
};

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** The hosted door's rule: every match of `heading` outside fences, each with the lines of its section. */
function readSection(text: string, heading: string): string[][] {
  const lines = text.split('\n');
  const headings: Array<{ at: number; level: number; text: string }> = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) return;
    const m = HEADING.exec(line);
    if (m) headings.push({ at, level: m[1].length, text: m[2] });
  });
  return headings
    .filter((h) => h.text === heading)
    .map((start) => {
      const next = headings.find((h) => h.at > start.at && h.level <= start.level);
      return lines.slice(start.at, next ? next.at : lines.length);
    });
}

/** The fences of a section, in order: the info string's first word and the body. */
function fencesOf(section: string[]): Array<{ lang: string; body: string }> {
  const out: Array<{ lang: string; body: string }> = [];
  let open: { lang: string; lines: string[] } | undefined;
  for (const line of section) {
    if (FENCE.test(line)) {
      if (open) {
        out.push({ lang: open.lang, body: open.lines.join('\n') });
        open = undefined;
      } else {
        open = { lang: (/^\s*(?:```|~~~)\s*([^\s`~]*)/.exec(line)?.[1] ?? '').toLowerCase(), lines: [] };
      }
    } else if (open) {
      open.lines.push(line);
    }
  }
  if (open) out.push({ lang: open.lang, body: open.lines.join('\n') });
  return out;
}

const TS_LANGS = new Set(['ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx']);

/** Every problem with `rows`, read through `read` (a repository-relative path, or undefined when absent). */
function judge(
  rows: readonly ServedSection[],
  read: (rel: string) => string | undefined,
  validators: Readonly<Record<string, Validator>> = VALIDATORS,
): string[] {
  const problems: string[] = [];
  if (rows.length === 0) problems.push('the list names no section: a gate with nothing to read must not pass');
  const seen = new Set<string>();
  for (const row of rows) {
    const rel = row.file;
    const label = `${rel} § ${row.heading}`;
    const key = label;
    if (seen.has(key)) {
      problems.push(`${label}: listed more than once`);
      continue;
    }
    seen.add(key);
    if (!FORMS.includes(row.form)) {
      problems.push(`${label}: form ${JSON.stringify(row.form)} is not one of ${FORMS.join(', ')}`);
      continue;
    }
    const text = read(rel);
    if (text === undefined) {
      problems.push(`${label}: the file does not exist`);
      continue;
    }
    const found = readSection(text, row.heading);
    if (found.length !== 1) {
      problems.push(
        `${label}: the heading must occur exactly once in its file, outside code fences; found ${found.length}` +
          (found.length === 0 ? ' (renamed or removed)' : ' (duplicated)') +
          '. The hosted MCP door reads this section by that exact text and fails at start otherwise: restore the ' +
          'heading, or change it together with the hosted table and this list.',
      );
      continue;
    }
    const section = found[0];
    if (row.item !== undefined) {
      const starts = section.filter((line) => new RegExp(`^${row.item}\\.\\s`).test(line)).length;
      if (starts !== 1) problems.push(`${label}: list item ${row.item} must start exactly one line of the section; found ${starts}`);
    }
    const fences = fencesOf(section);
    const json = fences.filter((f) => f.lang === 'json');
    const ts = fences.filter((f) => TS_LANGS.has(f.lang)).length;
    if (row.form === 'neutral' && (json.length > 0 || ts > 0)) {
      problems.push(`${label}: form "neutral" but the section carries ${json.length} JSON and ${ts} TypeScript fence(s): declare its form and validators`);
    }
    if (row.form === 'json' && ts > 0) {
      problems.push(`${label}: form "json" but the section carries ${ts} TypeScript fence(s): give the example as JSON, or declare "json+ts"`);
    }
    if (row.form === 'json+ts' && ts === 0) {
      problems.push(`${label}: form "json+ts" but the section carries no TypeScript fence: declare "json"`);
    }
    if (row.form !== 'neutral' && json.length === 0) {
      problems.push(`${label}: form "${row.form}" but the section carries no JSON fence`);
    }
    if (json.length !== row.json.length) {
      problems.push(`${label}: ${json.length} JSON fence(s) in the section, ${row.json.length} validator(s) declared: every JSON fence names its validator, in document order`);
      continue;
    }
    json.forEach((fence, at) => {
      const name = row.json[at];
      const validate = validators[name];
      if (!validate) {
        problems.push(`${label}: JSON fence ${at + 1} names validator ${JSON.stringify(name)}, which is not one of ${Object.keys(validators).join(', ')}`);
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(fence.body);
      } catch (error) {
        problems.push(`${label}: JSON fence ${at + 1} does not parse: ${(error as Error).message}`);
        return;
      }
      for (const reason of validate(value)) problems.push(`${label}: JSON fence ${at + 1} is refused as ${name}: ${reason}`);
    });
  }
  return problems;
}

function readList(): ServedSection[] {
  const parsed = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')) as { sections?: ServedSection[] };
  if (!Array.isArray(parsed.sections)) throw new Error(`${LIST_FILE}: no "sections" array`);
  return parsed.sections;
}

/** A file the list names and the declaration does not (or the reverse) is a hint that went stale. */
function assertWatchHintsNameTheList(rows: readonly ServedSection[]): void {
  const expected = [...new Set(rows.map((row) => row.file))].sort();
  if (expected.join('|') !== [...DECLARED_WATCH_HINTS].sort().join('|')) {
    throw new Error(
      `check-skill-served-sections: DECLARED_WATCH_HINTS no longer names the files the list reads ` +
        `(${JSON.stringify(expected)}): update the declaration, as a LITERAL array.`,
    );
  }
}

function readSkillFile(rel: string): string | undefined {
  const abs = path.resolve(REPO_ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
}

// ── Self-test ────────────────────────────────────────────────────────────────

let selfTestReachedVerdict = false;

/** Battery name → minimum case count. A battery that stops registering its cases is red by name. */
const SELF_TEST_BATTERIES: Readonly<Record<string, number>> = Object.freeze({
  'heading — one match is green': 3,
  'heading — renamed, removed or duplicated is red': 5,
  'heading — the door\'s fence and level rule': 4,
  'item — a numbered item occurs exactly once': 3,
  'form — the declared form matches the fences': 5,
  'json — fence count, parse and schema': 7,
  'list — empty, repeated row, unknown form, missing file': 4,
  'real tree — the list is read and names real validators': 2,
});
const SELF_TEST_BATTERY_FLOOR = 8;

function selfTest(): void {
  let failed = 0;
  const batterySeen = new Map<string, number>();
  const row = (over: Partial<ServedSection> = {}): ServedSection => ({
    file: 'f.md', heading: 'Target', form: 'neutral', json: [], ...over,
  });
  const expect = (battery: string, label: string, text: string | undefined, rows: ServedSection[], want: 'green' | RegExp) => {
    batterySeen.set(battery, (batterySeen.get(battery) ?? 0) + 1);
    const problems = judge(rows, () => text);
    const ok = want === 'green' ? problems.length === 0 : problems.some((p) => want.test(p));
    if (ok) {
      console.log(`  ✓ ${label}`);
    } else {
      failed += 1;
      console.error(`  ✗ ${label}\n      wanted ${want === 'green' ? 'no problem' : String(want)}; got ${JSON.stringify(problems)}`);
    }
  };
  const node = '{ "id": "n", "type": "notify", "label": "N", "config": { "recipients": "u1", "title": "T" } }';
  const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\`\n`;

  let b = 'heading — one match is green';
  expect(b, 'a heading that occurs once', '# Doc\n\n## Target\n\nbody\n', [row()], 'green');
  expect(b, 'trailing whitespace after the heading text still matches', '## Target  \nbody\n', [row()], 'green');
  expect(b, 'a heading whose text is a code span', '### `notify`\nbody\n', [row({ heading: '`notify`' })], 'green');

  b = 'heading — renamed, removed or duplicated is red';
  expect(b, 'renamed', '## Targets\nbody\n', [row()], /found 0 \(renamed or removed\)/);
  expect(b, 'removed', '# Doc\nbody\n', [row()], /found 0/);
  expect(b, 'duplicated at one level', '## Target\na\n## Target\nb\n', [row()], /found 2 \(duplicated\)/);
  expect(b, 'duplicated across levels', '## Target\na\n#### Target\nb\n', [row()], /found 2/);
  expect(b, 'a different case is a different heading', '## target\nbody\n', [row()], /found 0/);

  b = 'heading — the door\'s fence and level rule';
  expect(b, 'a heading only inside a fence is not a heading', fence('md', '## Target'), [row()], /found 0/);
  expect(b, 'a fenced copy beside the real one is not a duplicate', `## Target\n${fence('md', '## Target')}`, [row()], 'green');
  expect(b, 'a deeper heading stays inside the section', `## Target\n### Sub\n${fence('ts', 'x')}`, [row()], /form "neutral"/);
  expect(b, 'a heading of the same level ends the section', `## Target\nbody\n## Next\n${fence('ts', 'x')}`, [row()], 'green');

  b = 'item — a numbered item occurs exactly once';
  expect(b, 'the item is there', '## Target\n1. a\n2. b\n', [row({ item: 2 })], 'green');
  expect(b, 'the item is gone', '## Target\n1. a\n', [row({ item: 2 })], /list item 2 .* found 0/);
  expect(b, 'the item number repeats', '## Target\n2. a\n2. b\n', [row({ item: 2 })], /list item 2 .* found 2/);

  b = 'form — the declared form matches the fences';
  expect(b, 'neutral with a TypeScript fence', `## Target\n${fence('typescript', 'x')}`, [row()], /form "neutral"/);
  expect(b, 'json with a TypeScript fence beside it', `## Target\n${fence('json', node)}${fence('ts', 'x')}`, [row({ form: 'json', json: ['FlowNode'] })], /form "json" but/);
  expect(b, 'json+ts with no TypeScript fence', `## Target\n${fence('json', node)}`, [row({ form: 'json+ts', json: ['FlowNode'] })], /no TypeScript fence/);
  expect(b, 'json with no JSON fence', '## Target\nbody\n', [row({ form: 'json' })], /no JSON fence/);
  expect(b, 'json+ts with both', `## Target\n${fence('json', node)}${fence('ts', 'x')}`, [row({ form: 'json+ts', json: ['FlowNode'] })], 'green');

  b = 'json — fence count, parse and schema';
  expect(b, 'a valid node', `## Target\n${fence('json', node)}`, [row({ form: 'json', json: ['FlowNode'] })], 'green');
  expect(b, 'an undeclared JSON fence', `## Target\n${fence('json', node)}${fence('json', node)}`, [row({ form: 'json', json: ['FlowNode'] })], /2 JSON fence\(s\) in the section, 1 validator/);
  expect(b, 'a declared fence that is gone', `## Target\n${fence('json', node)}`, [row({ form: 'json', json: ['FlowNode', 'Flow'] })], /1 JSON fence\(s\) in the section, 2 validator/);
  expect(b, 'JSON that does not parse', `## Target\n${fence('json', "{ id: 'n' }")}`, [row({ form: 'json', json: ['FlowNode'] })], /does not parse/);
  expect(b, 'a node the schema refuses', `## Target\n${fence('json', '{ "id": "n", "type": "notify" }')}`, [row({ form: 'json', json: ['FlowNode'] })], /refused as FlowNode/);
  expect(b, 'a node its config contract refuses', `## Target\n${fence('json', '{ "id": "n", "type": "notify", "label": "N", "config": { "recipientz": "u1" } }')}`, [row({ form: 'json', json: ['FlowNode'] })], /refused as FlowNode: .*recipients/);
  expect(b, 'a validator the checker does not have', `## Target\n${fence('json', node)}`, [row({ form: 'json', json: ['Nope'] })], /names validator "Nope"/);

  b = 'list — empty, repeated row, unknown form, missing file';
  expect(b, 'an empty list', '## Target\n', [], /names no section/);
  expect(b, 'a row listed twice', '## Target\n', [row(), row()], /listed more than once/);
  expect(b, 'an unknown form', '## Target\n', [row({ form: 'ts' as Form })], /is not one of/);
  expect(b, 'a file that does not exist', undefined, [row()], /does not exist/);

  b = 'real tree — the list is read and names real validators';
  const real = readList();
  assertWatchHintsNameTheList(real);
  const count = (label: string, ok: boolean) => {
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    if (ok) console.log(`  ✓ ${label}`);
    else {
      failed += 1;
      console.error(`  ✗ ${label}`);
    }
  };
  count(`the list file holds ${real.length} row(s)`, real.length > 0);
  count('every validator a row names exists', real.every((r) => r.json.every((name) => name in VALIDATORS)));

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failed += 1;
    console.error(`✗ self-test floor: ${declared.length} batteries declared, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const [name, seen] of batterySeen) {
    if (declared.includes(name)) continue;
    failed += 1;
    console.error(`✗ self-test floor: battery "${name}" registered ${seen} case(s) but is not declared`);
  }
  for (const name of declared) {
    const seen = batterySeen.get(name) ?? 0;
    if (seen >= SELF_TEST_BATTERIES[name]) continue;
    failed += 1;
    console.error(`✗ self-test floor: battery "${name}" registered ${seen} case(s), below its pinned ${SELF_TEST_BATTERIES[name]}`);
  }

  if (failed > 0) {
    console.error(`\n✗ check-skill-served-sections self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-skill-served-sections self-test: ${[...batterySeen.values()].reduce((a, n) => a + n, 0)} cases pass in ${declared.length} batteries.`);
  selfTestReachedVerdict = true;
}

function main(): void {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ check-skill-served-sections self-test: selfTest() returned without reaching its verdict.');
      process.exit(1);
    }
    return;
  }
  const rows = readList();
  assertWatchHintsNameTheList(rows);
  const problems = judge(rows, readSkillFile);
  if (problems.length > 0) {
    console.error(`✗ check-skill-served-sections: ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const fences = rows.reduce((n, r) => n + r.json.length, 0);
  const byForm = FORMS.map((form) => `${rows.filter((r) => r.form === form).length} ${form}`).join(', ');
  console.log(
    `✓ check-skill-served-sections: ${rows.length} served section(s), each heading exactly once in its file (${byForm}); ` +
      `${fences} JSON fence(s) parse and pass their spec validators.`,
  );
}

main();
