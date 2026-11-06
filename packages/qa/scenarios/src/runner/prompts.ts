// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the runner tells the agent, and the data contract it holds the built
 * app to.
 *
 * A card's prompt describes the business; the Run half then seeds the card's
 * rows and signs each persona in. So the build is told, besides the card's own
 * prompt, exactly what the Run half will rely on — and nothing it will be
 * graded on beyond that:
 *
 *   - the data the app is loaded with (the card's seed rows, verbatim): object
 *     and field machine names, and the values each field must accept;
 *   - the people who use it: one permission set per persona, named
 *     `<namespace>_<persona id>`, with what that persona must not see and
 *     which rows it sees (the card states these as requirements of the app);
 *   - the business actions an agent may call, when the card declares them;
 *   - the naming rule: EVERY item the app declares is named
 *     `<namespace>_<short>`, not only its objects ({@link namingRule}). The
 *     scorer reports a bare one as a Build finding, so every authoring prompt
 *     (build, iterate, template iterate) states it.
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
import { scenarioNamespace, type ScenarioCard } from '../schema.js';
import { permissionSetName } from './namespace.js';

type Card = ScenarioCard;
type Persona = Card['run']['personas'][number];

const text = (t: { en?: string; zh?: string }): string => t.en ?? t.zh ?? '';

/** A direct (non-path) row-scope rule names the user handle that persona signs in as, e.g. `u_sam`. */
export function personaHandles(card: Card): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of card.run.personas) {
    for (const sc of p.scope ?? []) {
      if (!sc.field.includes('.') && typeof sc.value === 'string') out.set(sc.value, p.id);
    }
  }
  return out;
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
  lines.push('');
  lines.push(
    'People: declare one permission set per person below, named exactly as shown, granting what that role needs ' +
      'on the app’s objects and nothing it must not see. The runner signs each person in as a user holding only that set.',
  );
  for (const p of card.run.personas) lines.push(personaLine(card, p));
  const handles = personaHandles(card);
  if (handles.size) {
    lines.push('');
    lines.push(
      `Row ownership: a row whose ${[...new Set(card.run.personas.flatMap((p) => (p.scope ?? []).filter((s) => !s.field.includes('.')).map((s) => `\`${s.field}\``)))].join(' / ')} names a handle ` +
        `(${[...handles].map(([h, id]) => `\`${h}\` = \`${id}\``).join(', ')}) is loaded as owned by that person’s user.`,
    );
  }
  if (card.run.agentActions?.length) {
    lines.push('');
    lines.push('Business actions an AI agent may call (expose each to AI; ask before acting where marked):');
    for (const a of card.run.agentActions) lines.push(`- \`${a.name}\` on \`${a.object}\`: ${a.summary}${a.confirm ? ' (confirm first)' : ''}`);
  }
  return lines.join('\n');
}

const BUILD_PREAMBLE =
  'You are building an ObjectStack app in this project (scaffolded by `create-objectstack`; follow the project’s AGENTS.md ' +
  'and its objectstack skills). Author the metadata, then run `npx objectstack validate` and `npx objectstack build` ' +
  'and fix what they report until both pass. Work without asking questions.';

export function buildPrompt(card: Card): string {
  return [BUILD_PREAMBLE, '', '## The app', '', text(card.prompt.detailed), '', dataContract(card)].join('\n');
}

export function iteratePrompt(card: Card): string {
  return [
    'This project holds a working ObjectStack app. Apply the change below, then run `npx objectstack validate` and ' +
      '`npx objectstack build` and fix what they report until both pass. Keep everything else working. Work without asking questions.',
    '',
    namingRule(card),
    '',
    `Change: ${text(card.iterate.change)}`,
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
  ].join('\n');
}

export function questionPrompt(scenario: LoadedScenario, questionId: string): string {
  const q = scenario.card.run.questions.find((x) => x.id === questionId)!;
  const today = scenario.card.asOf ? ` Today is ${scenario.card.asOf}.` : '';
  return (
    `${text(q.ask)}${today}\n\nAnswer from the app’s data using the \`app\` tools. State the figures, and end with a line ` +
    '`Source: <object>` naming the object the figures come from.'
  );
}

export function operationPrompt(card: Card, operationId: string): string {
  const op = card.run.operations.find((o) => o.id === operationId)!;
  const persona = card.run.personas.find((p) => p.id === op.actingAs);
  return `${text(op.ask)}\n\nYou act for ${persona?.role ?? op.actingAs}, through the \`app\` tools.`;
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
