// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the runner tells the agent, and the data contract it holds the built
 * app to.
 *
 * A card's prompt describes the business; the Run half then seeds the card's
 * rows and signs each persona in. So the build is told, besides the card's own
 * prompt, exactly what the Run half will rely on and every name its Build half
 * is checked by:
 *
 *   - the data the app is loaded with (the card's seed rows, verbatim): object
 *     and field machine names, and the values each field must accept;
 *   - the people who use it: one permission set per persona, named
 *     `<namespace>_<persona id>`, with what that persona must not see and
 *     which rows it sees (the card states these as requirements of the app);
 *   - the business actions an agent may call, when the card declares them;
 *   - the reference cycles the seed's lookups close (`seed.ts`), when there
 *     are any: the runner loads them in two passes, so at least one side of
 *     each must be optional;
 *   - the naming rule: EVERY item the app declares is named
 *     `<namespace>_<short>`, not only its objects ({@link namingRule}). The
 *     scorer reports a bare one as a Build finding, so every authoring prompt
 *     (build, iterate, template iterate) states it;
 *   - the structure the Build half checks by exact name beyond the seed
 *     ({@link structureLines}): each lookup's target, each single-choice field
 *     with its minimum option count, each dashboard and each app navigation
 *     target. Every Build check traces to text the prompt carries, so a
 *     faithful build never fails for not guessing a name; an iterate prompt
 *     states its change's own rows the same way ({@link changeContract}).
 *
 * The card handed in here is already namespace-relative (`namespace.ts`): its
 * item names carry the card's prefix (`democrm_`), so the contract states them
 * as the build must write them.
 *
 * The questions, their truths, the operations and their outcomes are never in
 * a build prompt. A question turn carries the question, the card's fixed
 * "today" when it has one, and the answer format (figures plus a source line);
 * an operation turn carries the request and whom the agent acts for.
 */

import type { LoadedScenario } from '../loader.js';
import { PERSON_USER_FIELD, scenarioNamespace, type ScenarioCard, type ScenarioExpect } from '../schema.js';
import { permissionSetName } from './namespace.js';
import { cycleText, referenceCycles } from './seed.js';

type Card = ScenarioCard;
type Persona = Card['run']['personas'][number];

const text = (t: { en?: string; zh?: string }): string => t.en ?? t.zh ?? '';

/** The tag whose check holds EVERY single-choice field the build declares to two options or more (`score/scenario-tags.ts`). */
const SELECT_OPTIONS_TAG = 'records-forms.select-options';

/** The rows of `expect` (or of an iterate's `expectDelta`) the exact-name scorer reads beyond the seed. */
type StructureRows = Pick<ScenarioExpect, 'selectFields' | 'lookups' | 'dashboards' | 'appNavTargets'>;

const code = (name: string): string => `\`${name}\``;

/**
 * One line per kind of structure row the exact-name scorer (`scoreGraph`)
 * checks and the seed does not already state: a lookup's target
 * (`lookup:<object>.<field>-><to>`), a single-choice field's minimum option
 * count (`select:<object>.<field>>=<n>opts`), a dashboard (`dashboard:<name>`)
 * and an app navigation target (`nav:<name>->exists`). On a card carrying
 * the select-options tag, one more line holds every single-choice field the
 * build declares (every other one, when rows are listed) to two options, as
 * that tag's check does.
 */
export function structureLines(rows: StructureRows, card: Card): string[] {
  const out: string[] = [];
  if (rows.lookups?.length) {
    out.push(`- Lookups, each referencing the object shown: ${rows.lookups.map((l) => `${code(`${l.object}.${l.field}`)} → ${code(l.to)}`).join(', ')}.`);
  }
  if (rows.selectFields?.length) {
    out.push(
      `- Single-choice (select) fields, each offering at least the number of options shown: ${rows.selectFields
        .map((f) => `${code(`${f.object}.${f.field}`)} (${f.minOptions})`)
        .join(', ')}.`,
    );
  }
  if (card.capabilities.includes(SELECT_OPTIONS_TAG)) {
    out.push(`- Every ${rows.selectFields?.length ? 'other ' : ''}single-choice field you declare offers at least two options: a field with one option is no choice.`);
  }
  if (rows.dashboards?.length) {
    out.push(
      `- Dashboards, each a dashboard named exactly: ${rows.dashboards.map(code).join(', ')}. A report the description asks for may be shown on one; it does not stand in for it.`,
    );
  }
  if (rows.appNavTargets?.length) {
    out.push(`- The app's navigation has an entry for each of: ${rows.appNavTargets.map(code).join(', ')}.`);
  }
  return out;
}

/** What an iterate prompt states of its change: the new objects and the structure rows the change adds, by the names the re-scored Build half checks. */
export function changeContract(card: Card): string {
  const delta = card.iterate.expectDelta;
  const lines: string[] = [];
  if (delta.objects?.length) {
    const min = card.expect.minFieldsPerObject;
    lines.push(`- New objects, named exactly: ${delta.objects.map(code).join(', ')}${min ? `, each with at least ${min} fields` : ''}.`);
  }
  lines.push(...structureLines(delta, card));
  return ['The change is checked for these, by the exact names shown:', ...lines].join('\n');
}

/**
 * The handle map: a direct (non-path) row-scope rule on a declared user-handle
 * field ({@link userHandleFields}) names the user handle that persona signs in
 * as (`account.owner` = `u_sam` → `sdr`). A rule on any other field names a
 * row (`e06`, `dep_sales`) or an option (`public`), never a handle, so it is
 * not in the map: a persona named through a row is bound by its `record`
 * ({@link personaRecords}). The first persona in `run.personas` order holds a
 * handle two of them name.
 */
export function personaHandles(card: Card): Map<string, string> {
  const fields = userHandleFields(card);
  const out = new Map<string, string>();
  for (const p of card.run.personas) {
    for (const sc of p.scope ?? []) {
      if (sc.field.includes('.') || typeof sc.value !== 'string' || !fields.has(`${sc.object}.${sc.field}`)) continue;
      if (!out.has(sc.value)) out.set(sc.value, p.id);
    }
  }
  return out;
}

/**
 * The record binding: each persona's person row (`personas[].record`, the
 * seed row that IS this person), keyed `object/id`, to the persona id. The
 * first persona in `run.personas` order holds a row two of them name.
 */
export function personaRecords(card: Card): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of card.run.personas) {
    if (p.record === undefined) continue;
    const key = `${p.record.object}/${p.record.id}`;
    if (!out.has(key)) out.set(key, p.id);
  }
  return out;
}

/** The declared lookups (`expect.lookups`) that point at a person object, the object of some persona's `record` (`ticket.assignee` → `agent`). */
function personLookups(card: Card): Array<{ object: string; field: string; to: string }> {
  const people = new Set(card.run.personas.flatMap((p) => (p.record ? [p.record.object] : [])));
  return (card.expect.lookups ?? []).filter((l) => people.has(l.to)).map(({ object, field, to }) => ({ object, field, to }));
}

/**
 * The persona a seed row is loaded as owned by (`owner_id`), or undefined
 * when it names no person and the inserter (the admin) keeps it. A row names a
 * persona when it IS that persona's record, when a declared direct lookup on
 * it holds that record's id (`ticket.assignee` = `a02`), or when a declared
 * user-handle field on it holds that persona's handle (`account.owner` =
 * `u_sam`). The first persona in `run.personas` order the row names owns it.
 * An option value (`ticket_comment.visibility` = `public`), a row id scope
 * (`department.id` = `dep_sales`) and a lookup to a row no persona is (a
 * department, a group) name nobody.
 */
export function rowOwner(card: Card, object: string, row: Readonly<Record<string, unknown>>): string | undefined {
  const lookups = personLookups(card).filter((l) => l.object === object);
  const handles = userHandleFields(card);
  for (const p of card.run.personas) {
    const rec = p.record;
    if (rec !== undefined) {
      if (rec.object === object && row.id === rec.id) return p.id;
      if (lookups.some((l) => l.to === rec.object && row[l.field] === rec.id)) return p.id;
    }
    for (const sc of p.scope ?? []) {
      if (sc.object === object && !sc.field.includes('.') && handles.has(`${object}.${sc.field}`) && row[sc.field] === sc.value) return p.id;
    }
  }
  return undefined;
}

/**
 * The seed fields whose values are user handles, `object.field`: the card's
 * declared `run.userHandleFields`, read and never inferred. In the crm card
 * that is `account.owner` (`u_sam`, `u_tia`). Every other field holds a row id
 * or an option value (`asset.custodian` = `e06`, an employee row;
 * `ticket_comment.visibility` = `public`), which the seed loads verbatim.
 */
export function userHandleFields(card: Card): Set<string> {
  return new Set((card.run.userHandleFields ?? []).map((h) => `${h.object}.${h.field}`));
}

/** The handles a seed row names in a {@link userHandleFields} field that no persona signs in as (`u_tia`): the seed loads each as the admin user. */
export function unheldHandles(card: Card): string[] {
  const held = personaHandles(card);
  const out = new Set<string>();
  for (const key of userHandleFields(card)) {
    const [object, field] = key.split('.') as [string, string];
    for (const row of card.run.seed[object] ?? []) {
      const v = row[field];
      if (typeof v === 'string' && !held.has(v)) out.add(v);
    }
  }
  return [...out].sort();
}

/** The every-item-prefixed rule, in every authoring prompt. */
export function namingRule(card: Card): string {
  const ns = scenarioNamespace(card);
  return (
    `Naming: this app's namespace is \`${ns}\`. Name EVERY metadata item you declare \`${ns}_<name>\` — not only objects, ` +
    'but also views, apps, pages, dashboards, reports, datasets, actions, flows, permission sets, picklists, skills, agents ' +
    'and every other item. Fields are not items and keep their plain names. A bare item name fails the build.'
  );
}

function personaLine(card: Card, p: Persona): string {
  const hides = [
    ...(p.hidden.objects ?? []).map((o) => `the object \`${o}\``),
    ...(p.hidden.fields ?? []).map((f) => `the field \`${f.object}.${f.field}\``),
  ];
  const scope = (p.scope ?? []).map((s) => `\`${s.object}\` rows whose \`${s.field}\` is ${JSON.stringify(s.value)}`);
  return (
    `- \`${permissionSetName(card, p.id)}\` for \`${p.id}\` (${p.role}): must not read ${hides.join(' or ')}` +
    (scope.length ? `; sees only ${scope.join(' and ')}` : '') +
    '.'
  );
}

/**
 * The build prompt's Row ownership section: which seed rows the runner loads
 * as owned (`owner_id`) by which person's user ({@link rowOwner}), the person
 * rows whose `user` field it fills, the order that settles a row naming two
 * people, and the platform boundary for a person who must see rows another
 * person owns. Empty when no persona is bound to a person (no `record`, no
 * handle).
 */
function rowOwnership(card: Card): string[] {
  const records = card.run.personas.flatMap((p) => (p.record ? [{ persona: p.id, ...p.record }] : []));
  const handleFields = userHandleFields(card);
  const handlePersonas = new Set(personaHandles(card).values());
  const owners = card.run.personas.filter((p) => p.record !== undefined || handlePersonas.has(p.id)).map((p) => p.id);
  if (owners.length === 0) return [];
  const lines: string[] = ['', 'Row ownership: the runner signs each person in as their own user, and loads a seed row as owned (`owner_id`, the record owner) by a person’s user only when the row names that person:'];
  if (records.length) {
    const objects = [...new Set(records.map((r) => r.object))];
    const lookups = personLookups(card);
    lines.push(
      `- Each of these rows is a person: ${records.map((r) => `\`${r.object}\` \`${r.id}\` is \`${r.persona}\``).join(', ')}. ` +
        `The runner loads each one’s \`${PERSON_USER_FIELD}\` field with that person’s user id, so give ${objects.map((o) => `\`${o}\``).join(' and ')} a field named exactly \`${PERSON_USER_FIELD}\` of type \`user\` (a lookup to the platform’s users), and leave it optional: no other row is a person who signs in. ` +
        `A row names a person when it is that person’s row, or when one of its lookups to that person’s object holds that row’s id` +
        (lookups.length ? ` (${lookups.map((l) => `\`${l.object}.${l.field}\``).join(', ')})` : '') +
        '.',
    );
  }
  if (handleFields.size) {
    const unheld = unheldHandles(card);
    const held = [
      ...new Set(card.run.personas.flatMap((p) => (p.scope ?? []).filter((sc) => handleFields.has(`${sc.object}.${sc.field}`)).map((sc) => `\`${String(sc.value)}\` → the \`${p.id}\` user`))),
    ];
    lines.push(
      `- In ${[...handleFields].map((k) => `\`${k}\``).join(' / ')} the value is a handle that stands for a user, and the handle text is never stored: ` +
        `the runner loads that field, and the row’s owner (\`owner_id\`), with that user’s id (${[
          ...held,
          ...(unheld.length ? [`${unheld.map((h) => `\`${h}\``).join(', ')}, which no person below holds → the admin user the runner signs in as`] : []),
        ].join('; ')}). Make that field accept a user id; a rule on it matches that user.`,
    );
  }
  lines.push(
    (owners.length > 1 ? `- A row that names more than one person is owned by the first of them in this order: ${owners.map((o) => `\`${o}\``).join(', ')}. ` : '- ') +
      'Every other row is owned by the admin user the runner loads the seed as: a row whose scope value is an option or names a row that is no person (a department, a group) names nobody.',
  );
  lines.push(
    '- Platform boundary: the open-source server has no hierarchy resolver (a hierarchy read scope, a unit or a unit and below, falls back to the user’s own rows), and one owner per row serves one person. ' +
      'So a person who must see rows another person owns (a manager over their team’s, a lead over their group’s, a customer over the comments on their tickets) gets them through what you build: ' +
      'a read policy on their permission set matching a field that names them or their group, a child object whose access is controlled by its parent, or a field you add that names them.',
  );
  return lines;
}

/** The runner's contract, appended to every build prompt. */
export function dataContract(card: Card): string {
  const lines: string[] = [];
  lines.push('## What the app will be loaded with and used by');
  lines.push('');
  lines.push(
    'After you finish, a test runner loads the rows below through the data API and signs each person in. ' +
      'Use these object and field machine names exactly (lookup values are the `id` of the referenced row), ' +
      'and make every value shown valid for its field. The object names already carry this app’s namespace prefix.',
  );
  lines.push('');
  lines.push(namingRule(card));
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(card.run.seed, null, 1));
  lines.push('```');
  const structure = structureLines(card.expect, card);
  if (structure.length) {
    lines.push('');
    lines.push('Structure: besides the objects and fields above, the build is checked for these, by the exact names shown:');
    lines.push(...structure);
  }
  lines.push('');
  lines.push(
    'People: declare one permission set per person below, named exactly as shown, granting what that role needs ' +
      'on the app’s objects and nothing it must not see. The runner signs each person in as a user holding only that set.',
  );
  for (const p of card.run.personas) lines.push(personaLine(card, p));
  lines.push(...rowOwnership(card));
  const cycles = referenceCycles(card);
  if (cycles.length) {
    lines.push('');
    lines.push(
      `Reference cycles: ${cycles.map((c) => cycleText(c)).join('; ')}. These lookups lead back to where they start, so the runner ` +
        'loads their rows in two passes: first with the lookup that closes the cycle left empty, then it sets that lookup. ' +
        'At least one side of a reference cycle must be optional: never make every lookup in it required.',
    );
  }
  if (card.run.agentActions?.length) {
    lines.push('');
    lines.push('Business actions an AI agent may call (expose each to AI; ask before acting where marked):');
    for (const a of card.run.agentActions) lines.push(`- \`${a.name}\` on \`${a.object}\`: ${a.summary}${a.confirm ? ' (confirm first)' : ''}`);
  }
  return lines.join('\n');
}

/**
 * The `objectstack verify` arguments the runner scores a build with
 * (`buildHalf` in `orchestrate.ts` runs exactly these), so every authoring
 * loop can be told to run the same proof before it stops.
 */
export function verifyArgs(card: Card): string[] {
  return ['verify', ...verifyFlags(card)];
}

/** The three commands a scratch build is scored on, as the agent runs them: `validate`, `build`, then {@link verifyArgs}. */
function authoringChecks(card: Card): string {
  return `run \`npx objectstack validate\`, \`npx objectstack build\` and \`npx objectstack ${verifyArgs(card).join(' ')}\` and fix what they report until all three pass`;
}

function buildPreamble(card: Card): string {
  return (
    'You are building an ObjectStack app in this project (scaffolded by `create-objectstack`; follow the project’s AGENTS.md ' +
    `and its objectstack skills). Author the metadata, then ${authoringChecks(card)}. Work without asking questions.`
  );
}

export function buildPrompt(card: Card): string {
  return [buildPreamble(card), '', '## The app', '', text(card.prompt.detailed), '', dataContract(card)].join('\n');
}

export function iteratePrompt(card: Card): string {
  return [
    `This project holds a working ObjectStack app. Apply the change below, then ${authoringChecks(card)}. ` +
      'Keep everything else working. Work without asking questions.',
    '',
    namingRule(card),
    '',
    `Change: ${text(card.iterate.change)}`,
    '',
    changeContract(card),
  ].join('\n');
}

export interface TemplateServer {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
}

/**
 * Template mode: the app is NOT in the project's source — it was installed
 * into the running server as environment metadata (an unmanaged copy, ADR-0131
 * D6). The change is made there, through the server's metadata door.
 */
export function templateIteratePrompt(card: Card, server: TemplateServer): string {
  return [
    `An ObjectStack app is installed in the server running at ${server.baseUrl} as editable environment metadata ` +
      '(an unmanaged install: it is not in this project’s source files). Apply the change below to that installed app, ' +
      `through the server’s metadata API (\`GET/PUT ${server.baseUrl}/api/v1/meta/<type>/<name>\`, signed in at ` +
      `\`POST ${server.baseUrl}/api/v1/auth/sign-in/email\` as ${server.adminEmail} / ${server.adminPassword}). ` +
      'Check each item you save reads back. Work without asking questions.',
    '',
    namingRule(card),
    '',
    `Change: ${text(card.iterate.change)}`,
    '',
    changeContract(card),
  ].join('\n');
}

/**
 * The card's "today", said to the agent. A question or operation that says
 * "today", "this month" or "overdue" is judged against the card's `asOf`, so
 * every run-phase prompt states it; a write the platform's clock stamps is
 * judged against the run date instead (the operation grader's `asOf` rule).
 */
function todayOf(card: Card): string {
  return card.asOf ? ` Today is ${card.asOf}.` : '';
}

export function questionPrompt(scenario: LoadedScenario, questionId: string): string {
  const q = scenario.card.run.questions.find((x) => x.id === questionId)!;
  return (
    `${text(q.ask)}${todayOf(scenario.card)}\n\nAnswer from the app’s data using the \`app\` tools. State the figures, and end with a line ` +
    '`Source: <object>` naming the object the figures come from.'
  );
}

export function operationPrompt(card: Card, operationId: string): string {
  const op = card.run.operations.find((o) => o.id === operationId)!;
  const persona = card.run.personas.find((p) => p.id === op.actingAs);
  return `${text(op.ask)}${todayOf(card)}\n\nYou act for ${persona?.role ?? op.actingAs}, through the \`app\` tools.`;
}

/** `os verify`'s opt-in proofs, chosen from the card's capability tags. */
export function verifyFlags(card: Card): string[] {
  const flags = new Set<string>();
  for (const tag of card.capabilities) {
    if (/^access-security\.(row-level-security|row-scope)$/.test(tag)) flags.add('--rls');
    if (tag === 'records-forms.lookup') flags.add('--reference-shapes');
    if (tag.startsWith('records-forms.master-detail')) {
      flags.add('--delete-behaviors');
      flags.add('--parent-write-reach');
    }
    if (tag.startsWith('dashboards.')) flags.add('--dashboard-windows');
  }
  return [...flags].sort();
}
