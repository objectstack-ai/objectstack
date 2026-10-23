// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An email template's HTML body places each hole where the mail renderer's
 * encoding is right for it (#25189 — the email half of #25082, ruling
 * `6335348115` letters F1 A2 and F3 C2).
 *
 * ## The rule
 *
 * The mail renderer encodes a double-braced hole one way and leaves a
 * triple-braced hole unencoded, and the template's author decides where each
 * hole sits. Maintainer ruling 3C (`6308462370` on #25040) asks every outlet
 * that renders a text field into HTML to escape by context, and triage read it
 * on #25082 (`6332255183`) as reaching every placement an author can write,
 * with a placement restriction — not a per-context encoder, not guidance — as
 * the remedy. So a hole the renderer cannot encode for its placement is
 * refused when the template is authored or published, naming the placement
 * and the supported ones.
 *
 * WHICH placements are supported is not decided here: it is
 * `@objectstack/formula`'s `judgeMailHtmlHoles`, the one judge this rule and
 * `@objectstack/plugin-email`'s built-in template pin both read, whose header
 * carries the classification and whose pin holds its grammar to the
 * renderer's. This module only walks the collection and words the finding.
 *
 * ## Where it runs
 *
 * Every authoring door: `os validate`, `os build`, `os lint`, and the runtime
 * publish gate (an ACTIVE save, and a draft's promotion) for `email_template`
 * writes, refused there with the existing `422 INVALID_METADATA`. A draft is
 * not judged. A stored template keeps rendering — nothing judges it at send
 * or at boot — and is judged at its next publish (ruling item 4).
 *
 * Only `bodyHtml` is judged: `subject` and `bodyText` are plain-text faces the
 * renderer writes verbatim, where a hole has no markup context at all.
 */

import {
  judgeMailHtmlHoles,
  MAIL_HTML_PLACEMENT_LABELS,
  MAIL_HTML_SUPPORTED_SHAPES,
} from '@objectstack/formula';

import { collectionEntries } from './collection-entries.js';

type AnyRec = Record<string, unknown>;

export const EMAIL_TEMPLATE_HOLE_PLACEMENT = 'email-template-hole-placement';

export interface EmailTemplateHolePlacementFinding {
  severity: 'error';
  rule: typeof EMAIL_TEMPLATE_HOLE_PLACEMENT;
  where: string;
  /** Positional config path, e.g. `emailTemplates[0].bodyHtml`. */
  path: string;
  message: string;
  hint: string;
}

/** The variables a template declares with `type: 'url'` — the paths a triple-braced `href` hole may read. */
function urlVariablesOf(template: AnyRec): string[] {
  const variables = template.variables;
  if (!Array.isArray(variables)) return [];
  return variables
    .filter((v): v is AnyRec => !!v && typeof v === 'object' && (v as AnyRec).type === 'url')
    .map((v) => v.name)
    .filter((name): name is string => typeof name === 'string');
}

export function validateEmailTemplateHolePlacements(stack: AnyRec): EmailTemplateHolePlacementFinding[] {
  const findings: EmailTemplateHolePlacementFinding[] = [];
  for (const { rec: template, path } of collectionEntries(stack.emailTemplates, 'emailTemplates')) {
    const body = template.bodyHtml;
    if (typeof body !== 'string' || body === '') continue;
    const name = typeof template.name === 'string' ? template.name : '(unnamed)';
    const locale = typeof template.locale === 'string' ? ` [${template.locale}]` : '';
    for (const hole of judgeMailHtmlHoles(body, { urlVariables: urlVariablesOf(template) })) {
      if (hole.supported) continue;
      const form = hole.raw ? 'triple-braced (unencoded) hole' : 'hole';
      const why = hole.raw
        ? 'the renderer writes that form without encoding, which only the url href shape admits'
        : 'the renderer\'s encoding is not the one that placement needs';
      findings.push({
        severity: 'error',
        rule: EMAIL_TEMPLATE_HOLE_PLACEMENT,
        where: `email template "${name}"${locale}`,
        path: `${path}.bodyHtml`,
        message:
          `bodyHtml places the ${form} ${hole.text} (offset ${hole.start}) in `
          + `${MAIL_HTML_PLACEMENT_LABELS[hole.placement]}; ${why}.`,
        hint:
          `Supported placements: ${MAIL_HTML_SUPPORTED_SHAPES}. Move the hole to one of them — a link `
          + 'goes in a variable declared with type \'url\', written as the whole double-quoted href value.',
      });
    }
  }
  return findings;
}
