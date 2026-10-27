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
 * - a second formatter (`{{ x | default:0 | number:2 }}`) — the renderer used
 *   to read it as part of the first formatter's argument and print the text
 *   `0 | number:2`, or leave the whole hole on the page;
 * - a `currency` argument that is not a literal ISO 4217 code
 *   (`currency:currency_code`, a path) — it is not read as a path, and the
 *   renderer used to print the amount in USD instead.
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

import { judgeMailHoleGrammar } from '@objectstack/formula';

import { collectionEntries } from './collection-entries.js';

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

export function validateEmailTemplateHoleGrammar(stack: AnyRec): EmailTemplateHoleGrammarFinding[] {
  const findings: EmailTemplateHoleGrammarFinding[] = [];
  for (const { rec: template, path } of collectionEntries(stack.emailTemplates, 'emailTemplates')) {
    const name = typeof template.name === 'string' ? template.name : '(unnamed)';
    const locale = typeof template.locale === 'string' ? ` [${template.locale}]` : '';
    for (const face of FACES) {
      const text = template[face];
      if (typeof text !== 'string') continue;
      for (const hole of judgeMailHoleGrammar(text)) {
        findings.push({
          severity: 'error',
          rule: EMAIL_TEMPLATE_HOLE_GRAMMAR,
          where: `email template "${name}"${locale}`,
          path: `${path}.${face}`,
          message: `${face}: ${hole.refusal.message} (offset ${hole.start})`,
          hint:
            'A mail template hole is `{{ path }}` or `{{ path | formatter[:arg] }}`: one formatter, and a '
            + '`currency` argument that is a literal ISO 4217 code such as EUR. Anything more belongs in the '
            + 'caller that supplies the data.',
        });
      }
    }
  }
  return findings;
}
