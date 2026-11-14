// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `default` argument of an email template hole that reads like a variable
 * path prints that text literally.
 *
 * ## The trap
 *
 * `{{ person_name | default:'Customer' }}` prints `Customer` when the send's
 * `person_name` is empty: the argument of the `default` formatter is literal
 * text (`@objectstack/formula`'s `default` formatter, in the mail whitelist).
 * Nothing in the hole grammar reads it as a path, so
 * `{{ person_name | default:first_name }}` does not fall back to the send's
 * `first_name` — it prints the word `first_name` to the recipient. The grammar
 * admits the hole (it is well formed, and `judgeHoleFormatter` judges no
 * argument of `default`), and the renderer prints it as written, so nothing
 * tells the author.
 *
 * The platform's answer to "use X, or else Y" is to decide the value in the
 * flow that sends the template and pass the finished value as its own
 * variable: a template renders, the caller branches (ruling record
 * 6845318122, letter B: no fallback-to-another-variable syntax; the two
 * authoring checks it orders are this rule and
 * `validate-notify-template-variables.ts`).
 *
 * ## What reads like a path
 *
 * The argument as written, before the quotes are removed. A quoted argument
 * (`default:'first_name'`) is the author saying "this text", and is never
 * flagged: quoting is also the way to silence this rule for a literal that
 * happens to look like a name. An unquoted argument is flagged when it is:
 *
 * - an `@`-marked path (`default:@first_name`), the form `currency:@path` reads
 *   a value with — `default` has no such form, and prints the `@` too;
 * - a dotted path (`default:contact.first_name`);
 * - one name with an underscore (`default:first_name`), the snake_case shape
 *   of a variable name;
 * - one name the template itself uses as a variable: a declared `variables`
 *   name (or the root of one), or the path (or root) of another hole in any
 *   of its faces (`default:name` beside `{{ name }}`).
 *
 * A plain word (`default:Customer`, `default:none`), a number
 * (`default:0`) and any other text are left alone: they read as the literal
 * they are.
 *
 * ## Severity and doors
 *
 * `warning`, never `error`: the hole renders exactly as the grammar defines,
 * and the literal may be what the author meant. It runs at every authoring
 * door the hole grammar runs at — `os validate`, `os build`, `os lint` and the
 * runtime publish door for an `email_template` write, where it is an advisory
 * on the save response, never a refusal.
 */

import { mailHolePattern, parseMailHole } from '@objectstack/formula';

import { collectionEntries } from './collection-entries.js';

type AnyRec = Record<string, unknown>;

export const EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH = 'email-template-default-reads-as-path';

export interface EmailTemplateDefaultArgumentFinding {
  /** Always `warning`: the hole renders as the grammar defines; see the module note. */
  severity: 'warning';
  rule: typeof EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH;
  where: string;
  /** Positional config path, e.g. `emailTemplates[0].bodyText`. */
  path: string;
  message: string;
  hint: string;
}

/** The faces a mail template renders, in the order a finding reports them. */
const FACES = ['subject', 'bodyText', 'bodyHtml'] as const;

/** An `@`-marked dotted path, the `currency:@path` form. */
const MARKED_PATH_RE = /^@\w+(?:\.\w+)*$/;
/** Two or more names joined by dots. */
const DOTTED_PATH_RE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/;
/** One name. */
const NAME_RE = /^[A-Za-z_]\w*$/;

/** The root segment of a dotted path. */
const rootOf = (path: string): string => path.split('.', 1)[0];

/** The `default` argument as written — quotes kept — or `undefined` when the hole names no argument. */
function rawArgumentOf(inner: string): string | undefined {
  const pipe = inner.indexOf('|');
  if (pipe === -1) return undefined;
  const formatterPart = inner.slice(pipe + 1);
  const colon = formatterPart.indexOf(':');
  return colon === -1 ? undefined : formatterPart.slice(colon + 1).trim();
}

/** Every name the template uses as a variable: declared names and hole paths, each with its root. */
function variableNamesOf(template: AnyRec): Set<string> {
  const names = new Set<string>();
  const add = (path: string): void => {
    names.add(path);
    names.add(rootOf(path));
  };
  if (Array.isArray(template.variables)) {
    for (const v of template.variables) {
      if (v && typeof v === 'object' && typeof (v as AnyRec).name === 'string' && (v as AnyRec).name !== '') {
        add((v as AnyRec).name as string);
      }
    }
  }
  for (const face of FACES) {
    const text = template[face];
    if (typeof text !== 'string') continue;
    for (const m of text.matchAll(mailHolePattern())) {
      const parsed = parseMailHole(m[2], m[0]);
      if (parsed) add(parsed.path);
    }
  }
  return names;
}

/** Why an unquoted `default` argument reads like a path, or `undefined` when it reads as the literal it is. */
function pathShapeOf(arg: string, names: ReadonlySet<string>): string | undefined {
  if (MARKED_PATH_RE.test(arg)) return 'an `@`-marked path, the form `currency:@path` reads a value with';
  if (DOTTED_PATH_RE.test(arg)) return 'a dotted variable path';
  if (!NAME_RE.test(arg)) return undefined;
  if (names.has(arg)) return 'the name of a variable this template uses';
  if (arg.includes('_')) return 'a snake_case variable name';
  return undefined;
}

/**
 * Flag every `{{ path | default:ARG }}` hole of every email template whose
 * unquoted argument reads like a variable path (module note). Pure
 * `(stack) => Finding[]`; safe on pre- or post-parse stacks.
 */
export function validateEmailTemplateDefaultArguments(stack: AnyRec): EmailTemplateDefaultArgumentFinding[] {
  const findings: EmailTemplateDefaultArgumentFinding[] = [];
  for (const { rec: template, path } of collectionEntries(stack.emailTemplates, 'emailTemplates')) {
    const name = typeof template.name === 'string' ? template.name : '(unnamed)';
    const locale = typeof template.locale === 'string' ? ` [${template.locale}]` : '';
    let names: Set<string> | undefined;
    for (const face of FACES) {
      const text = template[face];
      if (typeof text !== 'string') continue;
      for (const m of text.matchAll(mailHolePattern())) {
        const parsed = parseMailHole(m[2], m[0]);
        // A hole the grammar refuses is `email-template-hole-grammar`'s to name.
        if (!parsed || parsed.refusal || parsed.formatter !== 'default') continue;
        const raw = rawArgumentOf(m[2]);
        if (raw === undefined || raw === '' || raw[0] === "'" || raw[0] === '"') continue;
        names ??= variableNamesOf(template);
        const shape = pathShapeOf(raw, names);
        if (shape === undefined) continue;
        findings.push({
          severity: 'warning',
          rule: EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH,
          where: `email template "${name}"${locale}`,
          path: `${path}.${face}`,
          message:
            `${face}: the hole ${m[0]} gives \`default\` the argument '${raw}', which reads like ${shape}, but a `
            + `default is literal text: when \`${parsed.path}\` is empty, the recipient reads the text '${raw}' itself, `
            + `and no variable of that name is ever read (offset ${m.index ?? 0})`,
          hint:
            'A default is literal text; to read another variable, compute it in the flow: decide the value in '
            + `the flow that sends this template and pass it as \`${parsed.path}\` in the node's \`templateData\`. `
            + `If you mean the text itself, quote it (\`default:'${raw}'\`).`,
        });
      }
    }
  }
  return findings;
}
