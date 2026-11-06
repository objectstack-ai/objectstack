// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every hole of an email template is within the mail hole grammar.
 *
 * ## The rule
 *
 * A mail template hole is a path with at most one formatter from the shared
 * whitelist, `{{ path | formatter[:arg] }}`, and a formatter argument the
 * renderer can honour as written. A hole the grammar refuses never renders as
 * its author meant it:
 *
 * - text after the `|` that is not a formatter name, one word optionally
 *   followed by `:` and its argument (`{{ due | date-long }}`) — the renderer
 *   used to print the hole to the reader as written;
 * - a formatter the whitelist (`MAIL_TEMPLATE_FORMATTERS`) does not name
 *   (`{{ amount | curency:EUR }}`) — the renderer used to print the raw value
 *   (`1234.5`) where a formatted one was meant;
 * - a second formatter (`{{ x | default:0 | number:2 }}`) — the renderer used
 *   to read it as part of the first formatter's argument and print the text
 *   `0 | number:2`, or leave the whole hole on the page;
 * - a `currency` argument that is neither a literal ISO 4217 code nor a
 *   marked path (`currency:currency_code`, a bare path) — it is not read as a
 *   path, and the renderer used to print the amount in USD instead;
 * - a marked path (`currency:@currency_code`, which reads the code from the
 *   send's data) that the template's declared `variables` do not declare,
 *   when it declares any. A template that declares none has its path judged
 *   at render, where a value that is not a code is refused.
 * - an `option` argument that is not a bare `object.field`
 *   (`option:'opportunity.stage'`, `option:stage`, `option:@stage_ref`), or
 *   one that names an object the app does not have, a field that object does
 *   not have, or a field that declares no options. The renderer prints such a
 *   hole's value with that field's option labels in the recipient's language
 *   (`OPTION_ARGUMENT_RULE`), so a reference that names no option list could
 *   only ever print the stored value. The object resolves on the
 *   object-reference ladder: the stack's own objects as the registry serves
 *   them (`objectExtensions` folded in, the injected system columns beside
 *   the declared fields), the objects this artifact's `packages[]` provide,
 *   and, with its field left unjudged here, a platform-provided object the
 *   stack does not carry (`PLATFORM_PROVIDED_OBJECT_NAMES`). A name none of
 *   these carries that has a platform prefix (`sys_`, `cloud_`, `ai_`) is the
 *   ladder's rung ④ (`object-reference-unregistered-platform`): a package
 *   outside the app may register it, so at the CLI doors the hole is not
 *   refused — it gets a `warning`, its field unjudged. At the publish door
 *   the stack's objects are the live object universe the gate carries, the
 *   whole of what resolves: no rung below it, and a name it does not carry is
 *   refused whatever its prefix. A write into a package is judged against
 *   that universe narrowed to the package's closure, and a name outside it is
 *   refused with the closure verdict and the declare-the-dependency remedy.
 *
 * WHICH holes are refused is not decided here: it is `@objectstack/formula`'s
 * `judgeMailHoleGrammar`, the grammar the mail renderer itself parses with,
 * whose formatter judgement (`judgeHoleFormatter`) the in-app template dialect
 * shares. This module only walks the collection and words the finding.
 *
 * ## Where it runs
 *
 * Every authoring door: `os validate`, `os build`, `os lint`, and the runtime
 * publish gate (an ACTIVE save, and a draft's promotion) for `email_template`
 * writes, refused there with the existing `422 INVALID_METADATA`. A draft is
 * not judged. A stored template that predates the rule is judged at its next
 * publish; until then the renderer refuses the hole with `TEMPLATE_INVALID`
 * rather than print a wrong value.
 *
 * All three faces are judged — `subject`, `bodyText` and `bodyHtml` — because
 * the grammar is the same in each; where a hole may sit in the html face is the
 * placement rule's question (`validate-email-template-hole-placements.ts`).
 */

import {
  CURRENCY_ARGUMENT_RULE,
  declaresOptionsOnceServed,
  judgeMailHoleGrammar,
  mailHolePattern,
  OPTION_ARGUMENT_RULE,
  optionObjectUnregisteredPlatform,
  parseMailHole,
} from '@objectstack/formula';

import { collectionEntries } from './collection-entries.js';
import { PLATFORM_PROVIDED_OBJECT_NAMES } from '@objectstack/spec/system';

import { closureDependencyRemedy, objectsAsServed, packagesOf, recordsOf } from './object-graph.js';
import { injectedColumnDefsFor } from './system-fields.js';

type AnyRec = Record<string, unknown>;

export const EMAIL_TEMPLATE_HOLE_GRAMMAR = 'email-template-hole-grammar';

export interface EmailTemplateHoleGrammarFinding {
  /** `error` for a hole the grammar refuses; `warning` for an `option` hole on rung ④ of the object ladder. */
  severity: 'error' | 'warning';
  rule: typeof EMAIL_TEMPLATE_HOLE_GRAMMAR;
  where: string;
  /** Positional config path, e.g. `emailTemplates[0].subject`. */
  path: string;
  message: string;
  hint: string;
}

/** The faces a mail template renders, in the order a finding reports them. */
const FACES = ['subject', 'bodyText', 'bodyHtml'] as const;

/** The names a template's `variables` declare; a malformed entry declares nothing. */
function declaredVariableNames(variables: unknown): string[] {
  if (!Array.isArray(variables)) return [];
  return variables.flatMap((v) =>
    v && typeof v === 'object' && typeof (v as AnyRec).name === 'string' && (v as AnyRec).name !== ''
      ? [(v as AnyRec).name as string]
      : []);
}

/** One object's fields as the index reads them: each `true` when it declares options once served. */
function optionFieldsOf(obj: AnyRec): Map<string, boolean> {
  const fields = new Map<string, boolean>();
  for (const [name, def] of injectedColumnDefsFor(obj)) fields.set(name, declaresOptionsOnceServed(def));
  for (const f of recordsOf(obj.fields)) {
    if (typeof f.name === 'string' && f.name !== '') fields.set(f.name, declaresOptionsOnceServed(f));
  }
  return fields;
}

/**
 * The objects an `option` hole may name, as the mail grammar's `objects`
 * option reads them, on the object-reference ladder
 * (`validate-object-references.ts`):
 *
 * 1. the stack's own objects, as the registry serves them (declared and
 *    `objectExtensions` fields, the injected system columns beside them, a
 *    declared field winning over an injected one of the same name), then the
 *    objects an entry of this artifact's `packages[]` provides (ADR-0130 D4),
 *    whose fields are in hand too — each field `true` when it declares
 *    options once served (inline `options` or a `picklist` name);
 * 2. a name in `PLATFORM_PROVIDED_OBJECT_NAMES` the stack does not carry
 *    resolves, with its fields not in hand (`null`): its field is judged at
 *    the publish door, whose live universe carries the served object, and at
 *    send, never here.
 *
 * A name none of these carries resolves to nothing: refused, unless it has a
 * platform prefix (rung ④, {@link unregisteredPlatformOptionHoles}).
 *
 * At the publish door (`liveUniverse`) the stack's objects are the live
 * universe the gate carries, every object the deployment serves, so the index
 * is that universe alone: no `packages[]` rung, no platform-name rung, and no
 * rung ④ — a name it does not carry is refused, whatever its prefix, as
 * `list-view-object-unknown` refuses a list view's unresolvable binding there.
 */
function optionFieldIndex(stack: AnyRec, liveUniverse: boolean): Map<string, Map<string, boolean> | null> {
  const index = new Map<string, Map<string, boolean> | null>();
  for (const obj of objectsAsServed(stack).objects) {
    if (typeof obj.name === 'string' && obj.name !== '') index.set(obj.name, optionFieldsOf(obj));
  }
  // The live universe is every object the deployment serves: no rung below it.
  if (liveUniverse) return index;
  for (const entry of packagesOf(stack)) {
    const body = entry.manifest;
    if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
    for (const obj of recordsOf((body as AnyRec).objects)) {
      if (typeof obj.name === 'string' && obj.name !== '' && !index.has(obj.name)) index.set(obj.name, optionFieldsOf(obj));
    }
  }
  for (const name of PLATFORM_PROVIDED_OBJECT_NAMES) {
    if (!index.has(name)) index.set(name, null);
  }
  return index;
}

/** The object an `option` hole as written names, braces included. */
function optionObjectOf(holeText: string): string | undefined {
  const inner = holeText.replace(/^\{\{\{?/, '').replace(/\}\}\}?$/, '');
  return parseMailHole(inner, holeText)?.optionField?.object;
}

/**
 * The `option` holes of one face whose object is rung ④ of the object ladder
 * against `objects` — platform-prefixed, and carried by no rung above — which
 * the grammar neither refuses nor judges, in order.
 */
function unregisteredPlatformOptionHoles(
  face: string,
  objects: ReadonlyMap<string, ReadonlyMap<string, boolean> | null>,
): { start: number; text: string; object: string }[] {
  const holes: { start: number; text: string; object: string }[] = [];
  for (const m of face.matchAll(mailHolePattern())) {
    const ref = parseMailHole(m[2], m[0])?.optionField;
    if (ref && optionObjectUnregisteredPlatform(ref, objects)) holes.push({ start: m.index ?? 0, text: m[0], object: ref.object });
  }
  return holes;
}

/** How the rule reads the stack's objects. */
export interface EmailTemplateHoleGrammarOptions {
  /**
   * `true` at the runtime publish door (`AuthoringRuleContext.runtimeWriteType`
   * set): the stack's objects are the live object universe the gate carries,
   * judged as the whole of what resolves. Absent or `false` (the CLI doors),
   * the object-reference ladder applies, rung ④ advising at `warning`.
   */
  liveUniverse?: boolean;
  /**
   * The written package's closure at the publish door
   * (`AuthoringRuleContext.packageScope`), when the gate narrowed the live
   * universe to it. Implies `liveUniverse`. An object the narrowed universe
   * does not carry is then outside the closure, refused
   * `option-object-outside-closure`, the remedy being to declare the
   * dependency — the verdict `list-view-object-outside-closure` gives a list
   * view's binding.
   */
  packageScope?: { readonly packageId: string };
}

export function validateEmailTemplateHoleGrammar(
  stack: AnyRec,
  options: EmailTemplateHoleGrammarOptions = {},
): EmailTemplateHoleGrammarFinding[] {
  const packageScope = options.packageScope?.packageId ? options.packageScope : undefined;
  const liveUniverse = options.liveUniverse === true || packageScope !== undefined;
  const findings: EmailTemplateHoleGrammarFinding[] = [];
  let objects: Map<string, Map<string, boolean> | null> | undefined;
  for (const { rec: template, path } of collectionEntries(stack.emailTemplates, 'emailTemplates')) {
    const name = typeof template.name === 'string' ? template.name : '(unnamed)';
    const locale = typeof template.locale === 'string' ? ` [${template.locale}]` : '';
    const variables = declaredVariableNames(template.variables);
    for (const face of FACES) {
      const text = template[face];
      if (typeof text !== 'string') continue;
      objects ??= optionFieldIndex(stack, liveUniverse);
      for (const hole of judgeMailHoleGrammar(text, { variables, objects, liveUniverse, ...(packageScope ? { packageScope } : {}) })) {
        const outside = hole.refusal.rule === 'option-object-outside-closure' && packageScope
          ? optionObjectOf(hole.text)
          : undefined;
        findings.push({
          severity: 'error',
          rule: EMAIL_TEMPLATE_HOLE_GRAMMAR,
          where: `email template "${name}"${locale}`,
          path: `${path}.${face}`,
          message: `${face}: ${hole.refusal.message} (offset ${hole.start})`,
          hint: outside !== undefined && packageScope
            ? `${closureDependencyRemedy(outside, packageScope.packageId, 'name an object inside that closure')}. ${OPTION_ARGUMENT_RULE}`
            : 'A mail template hole is `{{ path }}` or `{{ path | formatter[:arg] }}`, with one formatter. '
              + `${hole.refusal.rule.startsWith('option-') ? OPTION_ARGUMENT_RULE : CURRENCY_ARGUMENT_RULE} `
              + 'Anything more belongs in the caller that supplies the data.',
        });
      }
      for (const hole of liveUniverse ? [] : unregisteredPlatformOptionHoles(text, objects)) {
        findings.push({
          severity: 'warning',
          rule: EMAIL_TEMPLATE_HOLE_GRAMMAR,
          where: `email template "${name}"${locale}`,
          path: `${path}.${face}`,
          message:
            `${face}: the hole ${hole.text} names the object \`${hole.object}\`, which has a platform prefix, but no `
            + 'known package registers it and this stack does not define it, so it likely resolves to nothing; its '
            + `field is not judged here, and a send that finds no option list for it is refused (offset ${hole.start})`,
          hint:
            'Check the spelling against the object the providing package registers, or ignore this if a third-party '
            + `package provides it (\`os explain object-reference-unregistered-platform\`). ${OPTION_ARGUMENT_RULE}`,
        });
      }
    }
  }
  return findings;
}
