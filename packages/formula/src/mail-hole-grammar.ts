// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mail template hole grammar — ONE copy, read by every reader of a mail
 * template's holes:
 *
 * - `@objectstack/plugin-email`'s renderer (`template-engine.ts`), which
 *   substitutes the holes of every face (`subject`, `bodyText`, `bodyHtml`);
 * - this package's placement judge (`mail-html-hole-placement.ts`), which
 *   classifies where each hole of `bodyHtml` sits;
 * - `@objectstack/lint`'s `email-template-hole-grammar` authoring rule, which
 *   refuses a hole the grammar refuses at `os validate`, `os build`, `os lint`
 *   and the metadata publish door.
 *
 * A hole is `{{path}}`, `{{{path}}}` or either with one formatter from the
 * shared whitelist, `{{ path | formatter[:arg] }}`. The path is a dotted path
 * of word characters. Text between braces whose part before any `|` is not
 * a path (`{{ not a path }}`, `{{}}`, `{{ | upper }}`) is not a hole: the
 * renderer leaves it as written. A path followed by `|` is a formatter use,
 * and is judged.
 *
 * What follows the first `|` is split by `splitHoleFormatter` and judged by
 * `judgeHoleFormatter` (`template-engine.ts`), the two functions the in-app
 * template dialect reads its holes with too, so the two dialects accept the
 * same formatter parts (`currency :EUR` is `currency` with `EUR` in both) and
 * refuse the rest with the same sentence: a formatter name of one word
 * (`{{ due | date-long }}` is refused, never printed as written), one
 * formatter per hole, a formatter the whitelist names (`MAIL_TEMPLATE_FORMATTERS`),
 * and a `currency` argument that is a literal ISO 4217 code. A refused hole is a hole — it is found, located and
 * named — and the renderer refuses to render it rather than print a wrong
 * value or formatter syntax.
 *
 * One argument form is the mail dialect's own: `currency:@path` reads the
 * ISO 4217 code from the send's data (`CURRENCY_ARGUMENT_RULE`), so one
 * template formats each record's amount in that record's currency. The path
 * after the `@` is the same dotted path a hole names. Here it is parsed
 * ({@link ParsedMailHole}.`codePath`), checked against the template's declared
 * `variables` when it declares any ({@link judgeMailHoleGrammar}), and the
 * renderer resolves it and refuses a value that is not a code
 * (`currencyCodeValueRefusal`) — it never formats the amount in a default
 * currency in its place.
 *
 * One formatter is the mail dialect's own: `option:object.field` prints a
 * select value as its option's label in the recipient's language
 * (`OPTION_ARGUMENT_RULE`), from a table the renderer builds per send. Its
 * argument is parsed ({@link ParsedMailHole}.`optionField`) and, when the
 * caller hands in the app's objects ({@link MailHoleGrammarOptions}.`objects`),
 * judged against them: the object must exist, the field must be one of its
 * fields, and that field must declare options. A name the objects do not
 * carry that has a platform prefix (`sys_`, `cloud_`, `ai_`) is rung ④ of the
 * object-reference ladder: a package outside this app may register it, so the
 * grammar does not refuse it and does not judge its field
 * ({@link optionObjectUnregisteredPlatform}); the authoring rule advises on it
 * at the CLI doors. Objects that are the live served universe (the publish
 * door, the renderer; {@link MailHoleGrammarOptions}.`liveUniverse`) have no
 * rung ④: there nothing else can register the name, and it is refused.
 */

import { hasPlatformObjectPrefix } from '@objectstack/spec/system';
import {
  CURRENCY_ARGUMENT_RULE,
  currencyCodePath,
  judgeHoleFormatter,
  OPTION_ARGUMENT_RULE,
  optionFieldReference,
  splitHoleFormatter,
  type OptionFieldReference,
  type TemplateHoleGrammarRefusal,
} from './template-engine';

/** 1=open (`{{` or `{{{`), 2=brace-free inner body, 3=close (`}}` or `}}}`). */
const MAIL_HOLE_SOURCE = String.raw`(\{\{\{?)([^{}]*)(\}\}\}?)`;

/**
 * A fresh global matcher for mail template holes. Capturing the inner body
 * with `[^{}]*` (one star over a negated class, no nested quantifier) keeps
 * the match linear — no polynomial-ReDoS shape; the body is then parsed with
 * plain string operations ({@link parseMailHole}). A new instance per caller,
 * so no two scans share a `lastIndex`.
 */
export function mailHolePattern(): RegExp {
  return new RegExp(MAIL_HOLE_SOURCE, 'g');
}

// Validated against small, already-extracted strings (bounded input → no ReDoS).
const PATH_RE = /^[\w.]+$/;

/** A mail hole's inner body, parsed. */
export interface ParsedMailHole {
  path: string;
  formatter?: string;
  /** The formatter's argument, quotes removed; absent when none was written. */
  arg?: string;
  /**
   * Set for `currency:@path`: the path into the send's data the currency code is
   * read from (`currency_code`). The renderer resolves it; `arg` keeps the text
   * as written (`@currency_code`).
   */
  codePath?: string;
  /**
   * Set for `option:object.field`: the object and field whose option labels
   * the renderer prints the value with. `arg` keeps the text as written
   * (`opportunity.stage`), which is also the key of the renderer's label table.
   */
  optionField?: OptionFieldReference;
  /** Set when the grammar refuses the hole: it is not rendered, and authoring refuses it. */
  refusal?: TemplateHoleGrammarRefusal;
}

/**
 * Parse a hole's inner body (the text between the braces). `null` when the
 * part before any `|` is not a path — text the renderer leaves verbatim, and
 * that no reader treats as a hole. A path followed by `|` always parses: a
 * formatter part the grammar refuses is carried as the hole's `refusal`.
 */
export function parseMailHole(inner: string, hole = `{{${inner}}}`): ParsedMailHole | null {
  const pipe = inner.indexOf('|');
  if (pipe === -1) {
    const path = inner.trim();
    return PATH_RE.test(path) ? { path } : null;
  }
  const path = inner.slice(0, pipe).trim();
  if (!PATH_RE.test(path)) return null;
  const formatterPart = inner.slice(pipe + 1).trim();
  const { name, arg } = splitHoleFormatter(formatterPart);
  const refusal = judgeHoleFormatter(hole, formatterPart, name, arg, 'mail');
  if (refusal?.rule === 'one-formatter') {
    // `{{ x | upper | lower }}`: the renderer used to leave it on the page as
    // written. Its formatter is the name before the second `|`.
    return { path, formatter: formatterPart.split(/[:|]/, 1)[0].trim(), refusal };
  }
  const formatter = name;
  const codePath = refusal ? undefined : currencyCodePath(formatterPart);
  const optionField = refusal ? undefined : optionFieldReference(formatterPart);
  return {
    path,
    formatter,
    ...(arg !== undefined ? { arg } : {}),
    ...(codePath !== undefined ? { codePath } : {}),
    ...(optionField !== undefined ? { optionField } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/**
 * True when a `currency:@path` path is one the template declares: a declared
 * variable names the path itself, or a root it lies under (`contract`
 * declares `contract.currency_code`).
 */
function isDeclaredPath(path: string, variables: readonly string[]): boolean {
  return variables.some((name) => name === path || path.startsWith(`${name}.`));
}

/** What {@link judgeMailHoleGrammar} judges a face against, beyond its own text. */
export interface MailHoleGrammarOptions {
  /**
   * The names of the template's declared `variables`. When the template
   * declares any, a `currency:@path` hole whose path none of them declares is
   * refused (`currency-code-path-undeclared`). Absent or empty, the path is
   * judged at render, where a code that does not resolve is refused.
   */
  variables?: readonly string[];
  /**
   * The objects an `option` hole may name, each object's name to its fields'
   * names, each field's value `true` when the field declares options; `null`
   * for an object that resolves but whose fields are not in hand (a platform
   * object a stack names without carrying it), whose field is then not
   * judged here. Present, an `option:object.field` hole is judged against
   * it: an object it does not name (`option-object-unknown`), a field that
   * object does not have (`option-field-unknown`) and a field without options
   * (`option-field-no-options`) are refused. A name it does not carry that
   * has a platform prefix is not refused and its field not judged
   * ({@link optionObjectUnregisteredPlatform}). Absent, the reference is not
   * judged here.
   */
  objects?: ReadonlyMap<string, ReadonlyMap<string, boolean> | null>;
  /**
   * `true` when `objects` is the deployment's whole served object universe —
   * the live objects the metadata publish door carries, or the renderer's at
   * send — rather than one app's declaration. Then nothing else can register
   * a name `objects` does not carry, so rung ④ does not apply: a
   * platform-prefixed name it does not carry is refused
   * (`option-object-unknown`) like any other. Absent or `false`, rung ④
   * applies ({@link optionObjectUnregisteredPlatform}).
   */
  liveUniverse?: boolean;
}

/**
 * Whether an `option` hole's object is rung ④ of the object-reference ladder
 * against `objects`: not among them, and spelled with a platform prefix
 * (`sys_`, `cloud_`, `ai_`), so a package outside this app may still register
 * it. Unless the objects are the live universe (`liveUniverse`), such a name
 * is neither refused nor judged by {@link judgeMailHoleGrammar}; a caller that
 * advises (the authoring rule at the CLI doors, at `warning`) reads this.
 */
export function optionObjectUnregisteredPlatform(
  ref: OptionFieldReference,
  objects: ReadonlyMap<string, ReadonlyMap<string, boolean> | null>,
): boolean {
  return !objects.has(ref.object) && hasPlatformObjectPrefix(ref.object);
}

/** Why an `option` hole's object and field cannot label its value, or `null` when the field declares options. */
function optionFieldRefusal(
  hole: string,
  ref: OptionFieldReference,
  objects: ReadonlyMap<string, ReadonlyMap<string, boolean> | null>,
  liveUniverse: boolean,
): TemplateHoleGrammarRefusal | null {
  if (!liveUniverse && optionObjectUnregisteredPlatform(ref, objects)) return null;
  const fields = objects.get(ref.object);
  if (fields === undefined) {
    return {
      rule: 'option-object-unknown',
      message:
        `the hole ${hole} names the object \`${ref.object}\`, which resolves to no object this app defines, a `
        + 'package of its artifact provides or the platform provides, so no option list labels the value. '
        + `${OPTION_ARGUMENT_RULE} Name the object the value comes from by its \`name\`.`,
    };
  }
  if (fields === null) return null;
  const hasOptions = fields.get(ref.field);
  if (hasOptions === undefined) {
    return {
      rule: 'option-field-unknown',
      message:
        `the hole ${hole} names the field \`${ref.field}\`, which the object \`${ref.object}\` does not have, so `
        + `no option list labels the value. ${OPTION_ARGUMENT_RULE} Name the field the value comes from by its \`name\`.`,
    };
  }
  if (!hasOptions) {
    return {
      rule: 'option-field-no-options',
      message:
        `the hole ${hole} names the field \`${ref.object}.${ref.field}\`, which declares no options, so it has no `
        + `option labels to print. ${OPTION_ARGUMENT_RULE} Name a select field, or print the value with a plain `
        + 'hole or another formatter.',
    };
  }
  return null;
}

/** One hole of a mail template face that the grammar refuses. */
export interface MailHoleGrammarFinding {
  /** Offset of the hole's first brace in the face. */
  start: number;
  /** The hole as written, braces included. */
  text: string;
  refusal: TemplateHoleGrammarRefusal;
}

/** Every hole in one mail template face (`subject`, `bodyText` or `bodyHtml`) the grammar refuses, in order. */
export function judgeMailHoleGrammar(face: string, options: MailHoleGrammarOptions = {}): MailHoleGrammarFinding[] {
  if (typeof face !== 'string' || face === '') return [];
  const variables = options.variables ?? [];
  const findings: MailHoleGrammarFinding[] = [];
  for (const m of face.matchAll(mailHolePattern())) {
    const parsed = parseMailHole(m[2], m[0]);
    const optionRefusal = parsed?.optionField !== undefined && options.objects !== undefined
      ? optionFieldRefusal(m[0], parsed.optionField, options.objects, options.liveUniverse === true)
      : null;
    if (parsed?.refusal) {
      findings.push({ start: m.index ?? 0, text: m[0], refusal: parsed.refusal });
    } else if (optionRefusal) {
      findings.push({ start: m.index ?? 0, text: m[0], refusal: optionRefusal });
    } else if (parsed?.codePath !== undefined && variables.length > 0 && !isDeclaredPath(parsed.codePath, variables)) {
      findings.push({
        start: m.index ?? 0,
        text: m[0],
        refusal: {
          rule: 'currency-code-path-undeclared',
          message:
            `the hole ${m[0]} reads its currency code from \`${parsed.codePath}\`, which this template's `
            + `\`variables\` do not declare (it declares ${variables.map((v) => `\`${v}\``).join(', ')}). `
            + `${CURRENCY_ARGUMENT_RULE} Declare \`${parsed.codePath}\` beside them, or read the code from a path `
            + 'they declare.',
        },
      });
    }
  }
  return findings;
}
