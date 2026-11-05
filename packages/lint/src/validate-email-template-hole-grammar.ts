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
 *   stack does not carry (`PLATFORM_PROVIDED_OBJECT_NAMES`). At the publish
 *   door the stack's objects are the live object universe the gate carries.
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

import { CURRENCY_ARGUMENT_RULE, declaresOptionsOnceServed, judgeMailHoleGrammar, OPTION_ARGUMENT_RULE } from '@objectstack/formula';

import { collectionEntries } from './collection-entries.js';
import { PLATFORM_PROVIDED_OBJECT_NAMES } from '@objectstack/spec/system';

import { objectsAsServed, packagesOf, recordsOf } from './object-graph.js';
import { injectedColumnDefsFor } from './system-fields.js';

type AnyRec = Record<string, unknown>;

export const EMAIL_TEMPLATE_HOLE_GRAMMAR = 'email-template-hole-grammar';

export interface EmailTemplateHoleGrammarFinding {
  severity: 'error';
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
 * Any other name resolves to nothing and is refused.
 */
function optionFieldIndex(stack: AnyRec): Map<string, Map<string, boolean> | null> {
  const index = new Map<string, Map<string, boolean> | null>();
  for (const obj of objectsAsServed(stack).objects) {
    if (typeof obj.name === 'string' && obj.name !== '') index.set(obj.name, optionFieldsOf(obj));
  }
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

export function validateEmailTemplateHoleGrammar(stack: AnyRec): EmailTemplateHoleGrammarFinding[] {
  const findings: EmailTemplateHoleGrammarFinding[] = [];
  let objects: Map<string, Map<string, boolean> | null> | undefined;
  for (const { rec: template, path } of collectionEntries(stack.emailTemplates, 'emailTemplates')) {
    const name = typeof template.name === 'string' ? template.name : '(unnamed)';
    const locale = typeof template.locale === 'string' ? ` [${template.locale}]` : '';
    const variables = declaredVariableNames(template.variables);
    for (const face of FACES) {
      const text = template[face];
      if (typeof text !== 'string') continue;
      objects ??= optionFieldIndex(stack);
      for (const hole of judgeMailHoleGrammar(text, { variables, objects })) {
        findings.push({
          severity: 'error',
          rule: EMAIL_TEMPLATE_HOLE_GRAMMAR,
          where: `email template "${name}"${locale}`,
          path: `${path}.${face}`,
          message: `${face}: ${hole.refusal.message} (offset ${hole.start})`,
          hint:
            'A mail template hole is `{{ path }}` or `{{ path | formatter[:arg] }}`, with one formatter. '
            + `${hole.refusal.rule.startsWith('option-') ? OPTION_ARGUMENT_RULE : CURRENCY_ARGUMENT_RULE} `
            + 'Anything more belongs in the caller that supplies the data.',
        });
      }
    }
  }
  return findings;
}
