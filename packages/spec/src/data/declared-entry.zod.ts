// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared-entry factory: one sentence a declaration hands over in the
 * source locale, keyed by name, translated whole, with `{{ }}` holes over the
 * names it declares in `params`. Two kinds share it:
 *
 *  - a **refusal** entry — `HookSchema.refusals` (#26170, maintainer ruling
 *    6431311681 letter A; #33214, ruling 6879477573) and `ActionSchema.refusals`
 *    (#34273), keyed by code: `{ message, status?, reasons?, params? }`, read
 *    in the CALLER's locale when the code is thrown;
 *  - a **text** entry — `HookSchema.texts` (#34374, ruling 6913660232
 *    parameter 7) and `ActionSchema.texts` (#34374 PR2), keyed by snake_case
 *    key: `{ message, params? }`, read in the ORGANIZATION's language when the
 *    code asks for it (`ctx.text`).
 *
 * Both are built from the same core so they cannot drift: `message` (a
 * trimmed, non-empty sentence), `params` (identifiers, each declared once),
 * and one rule over every sentence of the entry — no `params`, plain text and
 * a `{{ }}` hole is refused; with `params`, the closed-scope template rule over
 * the declared names (`closedScopeTemplateRefusal`). The compile half of the
 * same rule (logic, an unknown formatter, an empty hole, `currency` with no
 * code) is `@objectstack/lint` `validate-hook-refusal-templates.ts`.
 *
 * Only the words differ per declaration — which subject the entry sits on,
 * where its translation lives, who throws or asks for it. They are tables
 * below, keyed by subject; a new subject is one row in a table, never a second
 * transcription of the shape. Every sentence a row produces for `hook` is
 * byte-identical to the schema it replaced, so the published JSON Schema and
 * reference docs do not move.
 *
 * Not on any barrel: each entry schema is published by the declaration that
 * carries it — {@link HookSchema}'s module exports `HookRefusalSchema` and
 * `HookTextSchema`, `ui/action.zod.ts` exports `ActionRefusalSchema` and
 * `ActionTextSchema`.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import {
  ACTION_REFUSAL_MESSAGE_HOLE_REFUSED,
  ACTION_TEXT_MESSAGE_HOLE_REFUSED,
  HOOK_REFUSAL_MESSAGE_HOLE_REFUSED,
  HOOK_REFUSAL_MESSAGE_WITHOUT_HOLE,
  HOOK_REFUSAL_PARAM_PATTERN,
  HOOK_REFUSAL_REASON_PATTERN,
  HOOK_TEXT_MESSAGE_HOLE_REFUSED,
} from './hook-refusal-codes';
// [#33214] The closed-scope `{{ }}` judge a sentence with declared `params` is
// read by — the one the action copy slots and a bulk action's `confirmText`
// use, over the same hole grammar the flow `end` refusal renders. It imports
// nothing outside its own leaf.
import { closedScopeTemplateRefusal } from '../automation/flow-text-slot-template';

// ── The shared core ──────────────────────────────────────────────────────────

/** How one subject's sentences are judged. */
interface SentenceRule {
  /** The slot a hole is judged in, as the refusal names it (e.g. A hook refusal `message`). */
  slot: string;
  /** The refusal for a `{{ }}` hole in an entry that declares no `params`. */
  holeRefused: string;
}

/**
 * Why `message` is refused as a sentence of an entry declaring `params`, or
 * `undefined`. No params: the plain-text rule (a hole is refused). Params: the
 * closed-scope template rule over the declared names (a hole over a declared
 * param only, a single-brace token prescribed its hole).
 */
function sentenceRefusal(rule: SentenceRule, message: string, params: readonly string[] | undefined): string | undefined {
  if (!params || params.length === 0) {
    return HOOK_REFUSAL_MESSAGE_WITHOUT_HOLE.test(message) ? undefined : rule.holeRefused;
  }
  return closedScopeTemplateRefusal(message, { slot: rule.slot, roots: params });
}

/** The entry's `params`: identifiers, the roots a `{{ }}` hole may name. */
function paramsSchema(patternMessage: string, describe: string) {
  return z.array(z.string().regex(HOOK_REFUSAL_PARAM_PATTERN, { message: patternMessage })).optional().describe(describe);
}

/**
 * The object-level check every entry runs: `params` names each root once, and
 * the entry's own `message` plus every further sentence (`sentences`, path
 * and text) follow the hole rule over those `params`.
 */
function refuseEntrySentences(
  rule: SentenceRule,
  entry: { message: string; params?: readonly string[] },
  further: ReadonlyArray<{ path: (string | number)[]; message: string }>,
  ctx: z.RefinementCtx,
): void {
  const params = entry.params;
  if (params) {
    const seen = new Set<string>();
    params.forEach((name, i) => {
      if (seen.has(name)) {
        ctx.addIssue({ code: 'custom', path: ['params', i], message: `\`params\` names '${name}' twice — declare each once.` });
      }
      seen.add(name);
    });
  }
  const own = sentenceRefusal(rule, entry.message, params);
  if (own !== undefined) ctx.addIssue({ code: 'custom', path: ['message'], message: own });
  for (const sentence of further) {
    const refusal = sentenceRefusal(rule, sentence.message, params);
    if (refusal !== undefined) ctx.addIssue({ code: 'custom', path: sentence.path, message: refusal });
  }
}

// ── Refusal entries ──────────────────────────────────────────────────────────

/** The declarations a refusal catalogue sits on. */
export type DeclaredRefusalSubject = 'hook' | 'action';

/** What a refusal entry's text says about its subject. */
interface RefusalWords {
  /** `hook` / `action`. */
  noun: DeclaredRefusalSubject;
  /** The noun with its sentence-initial article: `A hook` / `An action`. */
  aNoun: string;
  /** The translation key of a code's message, as the describe text spells it. */
  messageKey: string;
  /** The translation key of a reason's message, as the describe text spells it. */
  reasonKey: string;
  /** Who throws the code, as the `code` guidance names it. */
  thrower: string;
  /** The refusal for a `{{ }}` hole in an entry with no `params`. */
  holeRefused: string;
}

const REFUSAL_WORDS: Record<DeclaredRefusalSubject, RefusalWords> = {
  hook: {
    noun: 'hook',
    aNoun: 'A hook',
    messageKey: 'hooks.<hook>.refusals.<CODE>.message',
    reasonKey: 'hooks.<hook>.refusals.<CODE>.reasons.<REASON>.message',
    thrower: 'the body',
    holeRefused: HOOK_REFUSAL_MESSAGE_HOLE_REFUSED,
  },
  action: {
    noun: 'action',
    aNoun: 'An action',
    messageKey:
      'objects.<object>._actions.<action>.refusals.<CODE>.message (globalActions.<action>.… for an object-less action)',
    reasonKey:
      'objects.<object>._actions.<action>.refusals.<CODE>.reasons.<REASON>.message '
      + '(globalActions.<action>.… for an object-less action)',
    thrower: "the action's body",
    holeRefused: ACTION_REFUSAL_MESSAGE_HOLE_REFUSED,
  },
};

/**
 * One sentence under a declared refusal code (#33214, ruling 6879477573,
 * S1): the sentence the user reads when the code is thrown with this reason.
 * Its `{{ }}` holes are judged against the entry's `params`, like the entry's
 * own message. Published only as part of an entry schema.
 */
function refusalReasonSchema(w: RefusalWords) {
  return strictObject(
    {
      surface: `this ${w.noun} refusal reason`,
      history: 'Closed from the day it was declared — a key this reason does not declare would be served nowhere.',
      aliases: { text: 'message', description: 'message' },
      guidance: {
        code:
          'A reason has no `code` of its own — it sits under the code it refines (`refusals.CODE.reasons.REASON`), and '
          + 'the wire code is that code.',
        status:
          'A reason has no `status` of its own — the code it sits under decides the status. Declare a second code if '
          + 'the status differs.',
      },
    },
    {
      message: z.string().trim().min(1).describe(
        `The sentence the user reads when the ${w.noun} throws this reason under its code — in the source locale, `
        + `translated through ${w.reasonKey} in the caller's locale; its {{ }} `
        + 'holes follow the entry\'s message rule',
      ),
    },
  );
}

/**
 * One entry of a refusal catalogue (#26170): the sentence the user reads when
 * the code is thrown, and the status the refusal is answered with.
 *
 * The message is handed over in the source locale and replaced whole by its
 * translation — the validation-rule message's posture
 * (`objects.<object>._validations.<rule>.message`).
 *
 * [#33214, ruling 6879477573] Two optional parts, both declared and counted:
 *
 *  - `reasons` — further sentences under the SAME code, keyed by a snake_case
 *    reason. The code throws `{ code, reason }`; the runtime answers with the
 *    reason's sentence, the code's status and the code on the wire, unchanged.
 *    A reason the code does not declare is refused loudly, like a code. Under
 *    a code that declares no `reasons`, a thrown `reason` is not read, as before.
 *  - `params` — the names the entry's sentences may fill. The code throws
 *    `{ code, params: { NAME: value } }`, and each `{{ NAME }}` hole renders
 *    through the template engine the flow `end` refusal renders with. A hole
 *    over a name the entry does not declare is refused at parse; a hole
 *    holding logic, an unknown formatter, an empty hole and a `currency`
 *    formatter with no code (a refusal carries no default currency) are
 *    refused where the sentence is compiled — `os validate`, `compile` and the
 *    publish gate (`@objectstack/lint` `validate-hook-refusal-templates.ts`).
 *    An entry that declares no `params` is plain text and every `{{ }}` hole
 *    in it is refused, as before.
 */
export function declaredRefusalEntrySchema(subject: DeclaredRefusalSubject) {
  const w = REFUSAL_WORDS[subject];
  const rule: SentenceRule = { slot: `${w.aNoun} refusal \`message\``, holeRefused: w.holeRefused };
  return lazySchema(() => strictObject(
    {
      surface: `this ${w.noun} refusal`,
      history: 'Closed from the day it was declared — a key this entry does not declare would be served nowhere.',
      aliases: {
        text: 'message', reason: 'message', description: 'message', httpStatus: 'status', statusCode: 'status',
        variants: 'reasons', messages: 'reasons', placeholders: 'params', parameters: 'params', variables: 'params',
      },
      guidance: {
        code:
          '`code` is not a refusal key — the code is the entry\'s KEY in `refusals` '
          + `(\`refusals: { CLEAN_VERSION_REQUIRED: { message } }\`), and ${w.thrower} throws it.`,
        title:
          `${w.aNoun} refusal has no heading — the caller reads the \`message\` alone. Write the sentence in \`message\`.`,
      },
    },
    {
      message: z.string().trim().min(1).describe(
        `The sentence the user reads when the ${w.noun} throws this code — in the source locale, translated whole through `
        + `${w.messageKey} in the caller's locale. With no params every {{ }} hole is refused; `
        + 'with params a hole is a path over one of them with an optional known formatter, and a hole over another name, '
        + 'a hole holding logic, an unknown formatter, an empty hole and a currency formatter with no code are refused',
      ),
      status: z.number().int().min(400).max(499).optional().describe(
        'HTTP status the refusal is answered with (4xx; a refusal is never a fault). Absent: 400. A status the '
        + 'body itself sets on the throw is not read — the catalogue decides',
      ),
      reasons: z.record(
        z.string().regex(HOOK_REFUSAL_REASON_PATTERN, {
          message: `A refusal reason is snake_case (e.g. plan_locked) — the reason the ${w.noun} throws beside the code`,
        }),
        lazySchema(() => refusalReasonSchema(w)),
      ).optional().describe(
        `Further sentences under this same code, keyed by the snake_case reason the ${w.noun} throws beside the code `
        + '({ code, reason }): { message }. The wire code and status stay this entry\'s. A reason not declared here '
        + 'is refused loudly. Absent: the code has the one sentence, and a thrown reason is not read',
      ),
      params: paramsSchema(
        'A refusal param is an identifier (e.g. state) — the root a {{ }} hole names',
        'The names this entry\'s sentences may fill: a {{ NAME }} or {{ NAME | formatter }} hole renders the value '
        + `the ${w.noun} throws in \`params\` ({ code, params: { NAME: value } }). A hole over any other name, logic, an `
        + 'unknown formatter, an empty hole and a currency formatter with no code are refused. Absent: the sentences '
        + 'are plain text and a {{ }} hole is refused',
      ),
    },
  ).superRefine((entry, ctx) => {
    refuseEntrySentences(
      rule,
      entry,
      Object.entries(entry.reasons ?? {}).map(([reason, sentence]) => ({
        path: ['reasons', reason, 'message'],
        message: sentence.message,
      })),
      ctx,
    );
  }));
}

// ── Text entries ─────────────────────────────────────────────────────────────

/**
 * The declarations a text catalogue sits on: `hook` (#34374 PR1) and `action`
 * (#34374 PR2), one row each in {@link TEXT_WORDS}.
 */
export type DeclaredTextSubject = 'hook' | 'action';

/** What a text entry's text says about its subject — each a whole sentence, so a row reads as it publishes. */
interface TextWords {
  /** The entry's `surface`. */
  surface: string;
  /** The `locale` guidance: where the language comes from and where the translation lives. */
  localeGuidance: string;
  /** `message`'s describe text. */
  messageDescribe: string;
  /** The refusal for a `params` element that is not an identifier. */
  paramPatternMessage: string;
  /** `params`'s describe text. */
  paramsDescribe: string;
  /** How a sentence's holes are judged. */
  rule: SentenceRule;
}

const TEXT_WORDS: Record<DeclaredTextSubject, TextWords> = {
  hook: {
    surface: 'this hook text',
    localeGuidance:
      'A hook text has no language of its own — the runtime picks the organization\'s language. Write the sentence '
      + 'in the source locale in `message` and translate it through `hooks.HOOK.texts.KEY.message`.',
    messageDescribe:
      'The sentence the hook writes into a record — in the source locale, translated whole through '
      + 'hooks.<hook>.texts.<key>.message in the organization\'s language when the hook asks for it (ctx.text). '
      + 'With no params every {{ }} hole is refused; with params a hole is a path over one of them with an optional '
      + 'known formatter',
    paramPatternMessage: 'A text param is an identifier (e.g. lead) — the root a {{ }} hole names',
    paramsDescribe:
      'The names this text may fill: a {{ NAME }} or {{ NAME | formatter }} hole renders the value the hook passes '
      + 'in ctx.text(KEY, { NAME: value }). A hole over any other name is refused at parse; a hole holding logic, an '
      + 'unknown formatter, an empty hole and a currency formatter with no code are refused where the text is compiled '
      + '(os validate, compile, the publish gate). Absent: the sentence is plain text and a {{ }} hole is refused',
    rule: { slot: 'A hook text `message`', holeRefused: HOOK_TEXT_MESSAGE_HOLE_REFUSED },
  },
  action: {
    surface: 'this action text',
    localeGuidance:
      'An action text has no language of its own — the runtime picks the organization\'s language. Write the sentence '
      + 'in the source locale in `message` and translate it through `objects.OBJ._actions.ACT.texts.KEY.message` '
      + '(`globalActions.ACT.texts.KEY.message` for an object-less action).',
    messageDescribe:
      'The sentence the action\'s body writes into a record — in the source locale, translated whole through '
      + 'objects.<object>._actions.<action>.texts.<key>.message (globalActions.<action>.texts.<key>.message for an '
      + 'object-less action) in the organization\'s language when the body asks for it (ctx.text). With no params '
      + 'every {{ }} hole is refused; with params a hole is a path over one of them with an optional known formatter',
    paramPatternMessage: 'A text param is an identifier (e.g. subject) — the root a {{ }} hole names',
    paramsDescribe:
      'The names this text may fill: a {{ NAME }} or {{ NAME | formatter }} hole renders the value the action\'s body '
      + 'passes in ctx.text(KEY, { NAME: value }). A hole over any other name is refused at parse; a hole holding '
      + 'logic, an unknown formatter, an empty hole and a currency formatter with no code are refused where the text '
      + 'is compiled (os validate, compile, the publish gate). Absent: the sentence is plain text and a {{ }} hole is '
      + 'refused',
    rule: { slot: 'An action text `message`', holeRefused: ACTION_TEXT_MESSAGE_HOLE_REFUSED },
  },
};

/**
 * One declared text (#34374, ruling 6913660232 parameter 7): a sentence the
 * declaration writes into a record for people to read, picked in the
 * ORGANIZATION's language when its code asks for it (`ctx.text(key, params)`).
 * `{ message, params? }` — a refusal entry's core with no `status` or
 * `reasons`: a text is written, never answered.
 */
export function declaredTextEntrySchema(subject: DeclaredTextSubject) {
  const w = TEXT_WORDS[subject];
  return lazySchema(() => strictObject(
    {
      surface: w.surface,
      history: 'Closed from the day it was declared — a key this entry does not declare would be served nowhere.',
      aliases: {
        text: 'message', template: 'message', value: 'message', description: 'message',
        placeholders: 'params', parameters: 'params', variables: 'params',
      },
      guidance: { locale: w.localeGuidance },
    },
    {
      message: z.string().trim().min(1).describe(w.messageDescribe),
      params: paramsSchema(w.paramPatternMessage, w.paramsDescribe),
    },
  ).superRefine((entry, ctx) => {
    refuseEntrySentences(w.rule, entry, [], ctx);
  }));
}
