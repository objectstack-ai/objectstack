// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4762 — the two STATIC artifacts a validation rule carries must compile at
 * publish time, because at runtime they are fail-OPEN.
 *
 * A `format` rule's `regex` and a `json_schema` rule's `schema` are handed to a
 * real compiler on the write path (`objectql/src/validation/rule-validator.ts`):
 *
 *   • `checkFormat`     → `new RegExp(rule.regex)`, inside a `try/catch` whose
 *     catch logs `… has an invalid regex — skipped` and returns `null`;
 *   • `checkJsonSchema` → `ajv.compile(rule.schema)`, inside a `try/catch` whose
 *     catch logs `… has an uncompilable JSON Schema — skipped` and returns `null`.
 *
 * "Skipped" means the rule is declared, appears in the metadata, appears in any
 * "what protects this object" listing — and enforces nothing, for every record,
 * forever, with a WARN line in a log nobody reads as the only signal. That is
 * the shape #4649 was filed about one rule type over, and #4761 closed for the
 * CEL predicates (`script` / `cross_field` / `conditional.when`, now fail-closed).
 *
 * ## Why this gate is at AUTHORING time, and the runtime is deliberately untouched
 *
 * #4762's ruling: route 1 only. A broken regex or an uncompilable schema is
 * **static** — it is decidable from the metadata alone, with no record in hand —
 * so it can be rejected before it is ever deployed, which kills the rule class
 * outright ("declared = enforced", PD #12). The runtime alternative is strictly
 * worse as a FIRST move: an unevaluable *predicate* rejects only the writes whose
 * data triggers the fault, whereas a broken *regex* would reject **every** write
 * touching that field for as long as the bad metadata is deployed. So the
 * authoring door is closed here, and whether a runtime backstop is still wanted
 * stays open for the maintainer on #4762.
 *
 * Consequently `rule-validator.ts` is untouched by this rule's PR, and its
 * "Deliberately NOT changed here" paragraph plus the `#4649 — unchanged
 * neighbours` pin tests in `rule-fail-closed.test.ts` stand exactly as they are:
 * they remain the honest record that the RUNTIME half is still fail-open.
 *
 * ## Detection is the real compilers, never a pattern that judges a pattern
 *
 * Parsing a regex with a regex, or type-checking a JSON Schema by hand, would
 * build a SECOND opinion about compilability that can only drift from the
 * runtime's — a fresh declared≠enforced gap one level up. So:
 *
 *  - the regex is compiled with `new RegExp(source)`, the exact call
 *    `checkFormat` makes (no flags, same as the runtime);
 *  - the schema is compiled with ajv, constructed with the SAME options the
 *    runtime's shared instance uses — `{ allErrors: true, strict: false }` —
 *    and carrying the SAME plugins, which since #5029 means `ajv-formats`.
 *    `strict: false` is load-bearing in both directions: it is what lets an
 *    author-written schema carry vendor keywords, so a gate running `strict:
 *    true` would reject schemas the runtime compiles happily. `ajv-formats` is
 *    load-bearing in one direction and it is the dangerous one: the plugin also
 *    registers `formatMinimum` / `formatMaximum`, so a gate WITHOUT it treats
 *    those as unknown keywords (`strict: false` ⇒ ignored) and publishes a
 *    schema the runtime then refuses to compile — a rule that passes review and
 *    enforces nothing, which is the exact failure this file was written for.
 *
 * Those options *and* that plugin registration are pinned against
 * `rule-validator.ts`'s own source by `validate-rule-compilability.test.ts`, so
 * the day the runtime changes either one this gate is told rather than left
 * quietly disagreeing.
 *
 * What this gate deliberately does NOT judge is a MISSPELLED format name.
 * `format: 'emial'` compiles in both environments — under `strict: false` ajv
 * logs one line and drops the keyword — so refusing it *on the compile's
 * verdict* would be this gate inventing an outcome the runtime does not share,
 * the mirror image of the `strict: true` mistake above. #5029 pinned that, and
 * the pin still stands: `validateRuleCompilability` publishes a typo'd format.
 *
 * #5178 closed the residual gap the other way — with a SEPARATE judgement laid
 * beside this compile rather than folded into it. `validate-rule-schema-formats.ts`
 * walks the same schemas for `format` NAMES and refuses any name the
 * `ajv-formats` registry does not carry. It never compiles anything, so the
 * parity above is untouched: the two rules answer two different questions about
 * one artifact ("does ajv accept this?" and "will this keyword do anything?"),
 * and it reaches the registry through {@link registeredFormatNames} — this
 * file's own instance — so "registered" cannot come to mean two things in one
 * publish. Both rules walk one traversal, {@link walkObjectValidationRules},
 * for the same reason.
 *
 * ### One ajv instance per schema, on purpose
 *
 * The runtime keeps ONE module-level ajv for the whole process; this gate
 * constructs a fresh one per schema. That is not a mismatch of options, it is a
 * deliberate narrowing of the question: "can ajv compile THIS schema?" is
 * decidable per rule, while a shared instance additionally fails on a duplicate
 * `$id` — an outcome that depends on which other schemas happened to be compiled
 * first, i.e. on process history a build-time gate cannot know. Rejecting on
 * that would be a verdict invented from ordering. (A duplicate `$id` between two
 * deployed rules therefore remains a runtime fail-open case this gate does not
 * see; it is part of the runtime-backstop question #4762 leaves open, not a
 * silent omission.)
 *
 * ## Scope
 *
 * Object validation rules only — `object.validations[]`, including the rules
 * nested in a `conditional`'s `then` / `otherwise`, since `evaluateRule`
 * recurses into those and reaches the very same `checkFormat` /
 * `checkJsonSchema`. Nothing else in the stack is judged here.
 *
 * ### The keys read, and the one deliberately NOT read (#5096)
 *
 * This rule is registered `input: 'parsed'` (`authoring-rules.ts`), so on the
 * compile path it sees what `ObjectStackSchema` returned. Every key it reads is
 * one `@objectstack/spec` DECLARES — a contract, not a style preference: the
 * strict sub-schemas reject an undeclared key by NAME, so a branch keyed on one
 * is inert for every stack an author can ship (#4984, #5009, #5017, #5096).
 *
 * | Read                                        | Declared by                          |
 * |---------------------------------------------|--------------------------------------|
 * | `objects[].validations[]`                   | `ObjectSchema`                       |
 * | `validations[].type` / `.name`              | every `*ValidationSchema` variant    |
 * | `validations[].regex`                       | `FormatValidationSchema`             |
 * | `validations[].schema`                      | `JSONValidationSchema`               |
 * | `validations[].then` / `.otherwise`         | `ConditionalValidationSchema`        |
 *
 * NOT read: **`objects[].validationRules`**. `ObjectSchema` declares
 * `validations` and is strict, so the alias is refused by name — "Unrecognized
 * key(s) on this object: `validationRules`. … Did you mean `validationRules` →
 * `validations`?" (#4001). It was read here as a `??` fallback with the
 * canonical key FIRST, so the limb could not run on any parsing stack; what it
 * did do was assert, to every later reader and to every AI writing metadata
 * against this source, that `objects[].validationRules` is a real authoring
 * surface. Alias tolerance belongs at the schema's refusal, never in a consumer
 * (Prime Directive #12) — `validate-expressions.ts` shed the identical read in
 * #5017/PR #5046, and this was the eighth of that family (#5096). The live
 * `.shape` and the refusal text are both pinned in this rule's test.
 *
 * ## Why `error`
 *
 * The severity bar `lint-flow-patterns.ts` states — gate when NO reading of the
 * metadata behaves as written. A rule that cannot compile does not validate
 * loosely or partially; it does not run at all. There is no deployment in which
 * the author's declared guarantee holds.
 */

import { createRequire } from 'node:module';
// `import type` only — ajv must not load at import time. `@objectstack/lint` is
// on the kernel boot path (`@objectstack/lint/runtime`, reached by every runtime
// metadata write), while this gate needs a JSON-Schema compiler only when a
// stack actually declares a `json_schema` validation rule. Same lazy-load
// contract as `typescript`/`sucrase`, and guarded the same way by
// `lazy-deps.test.ts`. `ajv-formats` (#5029) is under the same contract and for
// a sharper reason: it `require`s `ajv/dist/compile/codegen`, so importing it
// eagerly would drag ajv onto the boot path through the back door.
import type { Options as AjvOptions } from 'ajv';

export type RuleCompilabilitySeverity = 'error';

export interface RuleCompilabilityFinding {
  severity: RuleCompilabilitySeverity;
  /** Stable diagnostic rule id (`--json` consumers and allowlists key on it). */
  rule: string;
  /** Human-readable location, e.g. `object 'account' · validation 'tax_id_format'`. */
  where: string;
  /** Config path, e.g. `objects.account.validations.tax_id_format.regex`. */
  path: string;
  message: string;
  hint: string;
}

/** A `format` rule whose `regex` `new RegExp(...)` refuses to compile. */
export const VALIDATION_RULE_REGEX_UNCOMPILABLE = 'validation-rule-regex-uncompilable';
/** A `json_schema` rule whose `schema` ajv refuses to compile. */
export const VALIDATION_RULE_SCHEMA_UNCOMPILABLE = 'validation-rule-json-schema-uncompilable';

/**
 * The ajv options the runtime's shared instance is constructed with
 * (`rule-validator.ts`). Exported so the parity test can assert BOTH halves —
 * that this object is what the gate compiles with, and that the runtime source
 * still says the same thing.
 */
export const RUNTIME_AJV_OPTIONS: AjvOptions = { allErrors: true, strict: false };

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerce an array-or-name-keyed-map collection to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter(isRec);
  if (isRec(v)) {
    return Object.entries(v)
      .filter(([, def]) => isRec(def))
      .map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * Minimal structural type for the slice of ajv this gate uses. Declared here
 * rather than imported as a value so no import statement can accidentally become
 * eager — see the lazy-load note at the top.
 */
type AjvLike = {
  compile: (schema: unknown) => unknown;
  /**
   * ajv's own format registry — `readonly formats` on the `Ajv` class, the map
   * `addFormat` writes into and the `format` keyword reads back out. Declared
   * here because #5178's gate enumerates the registered names from it rather
   * than hardcoding a list that would silently stop tracking the plugin.
   */
  formats: Record<string, unknown>;
};
type AjvCtor = new (options?: AjvOptions) => AjvLike;
/** `ajv-formats`' plugin entry — mutates the instance it is handed (#5029). */
type AddFormats = (ajv: AjvLike) => unknown;

let cachedAjv: AjvCtor | null = null;
let cachedAddFormats: AddFormats | null = null;

/**
 * Load ajv on first use. `node:module` is a Node builtin untouched by
 * esbuild/tsup, so the static `createRequire` import survives bundling; the
 * `createRequire(...)` CALL is deferred because `import.meta.url` is rewritten to
 * an empty stub in the CJS build (the same pattern
 * `validate-hook-body-writes.ts` uses for `typescript`).
 */
function loadAjv(): AjvCtor {
  if (cachedAjv) return cachedAjv;
  const anchor =
    typeof import.meta !== 'undefined' && import.meta.url
      ? import.meta.url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  let mod: unknown;
  try {
    mod = createRequire(anchor)('ajv');
  } catch (err) {
    throw new Error(
      `@objectstack/lint: checking a \`json_schema\` validation rule requires the "ajv" package, which could ` +
        `not be loaded (${err instanceof Error ? err.message : String(err)}). It is a declared dependency of ` +
        `@objectstack/lint — if this deployment prunes packages, keep "ajv" in the image; it is only loaded ` +
        `when a stack declares a \`json_schema\` validation rule.`,
    );
  }
  // ajv 8 is CJS with an ESM-interop default export; both shapes are seen
  // depending on which build of this package is running.
  const ctor = (isRec(mod) && 'default' in mod ? (mod as AnyRec).default : mod) as AjvCtor;
  cachedAjv = ctor;
  return ctor;
}

/**
 * Load `ajv-formats` on first use — same deferral, same reason, as {@link loadAjv}
 * (#5029). Kept as its own loader rather than folded into that one so the
 * failure message names the package the deployment actually pruned.
 */
function loadAddFormats(): AddFormats {
  if (cachedAddFormats) return cachedAddFormats;
  const anchor =
    typeof import.meta !== 'undefined' && import.meta.url
      ? import.meta.url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  let mod: unknown;
  try {
    mod = createRequire(anchor)('ajv-formats');
  } catch (err) {
    throw new Error(
      `@objectstack/lint: checking a \`json_schema\` validation rule requires the "ajv-formats" package, which ` +
        `could not be loaded (${err instanceof Error ? err.message : String(err)}). It is a declared dependency ` +
        `of @objectstack/lint — if this deployment prunes packages, keep "ajv-formats" in the image; it is only ` +
        `loaded when a stack declares a \`json_schema\` validation rule. The runtime registers it too, and this ` +
        `gate must compile in the SAME environment or it starts disagreeing with the write path.`,
    );
  }
  const plugin = (isRec(mod) && 'default' in mod ? (mod as AnyRec).default : mod) as AddFormats;
  cachedAddFormats = plugin;
  return plugin;
}

/**
 * A fresh ajv in the runtime's EXACT environment: the runtime's options, plus
 * the `ajv-formats` plugin the runtime registers (#5029).
 *
 * Registering formats is not cosmetic parity. `ajv-formats` also installs the
 * `formatMinimum` / `formatMaximum` keywords, which are *unknown keywords*
 * without it — and `strict: false` ignores an unknown keyword while a
 * registered one is metaschema-checked. So a schema the runtime would refuse to
 * compile is one this gate would otherwise wave through, which is precisely the
 * disagreement this whole file exists to prevent.
 */
function createRuntimeAjv(): AjvLike {
  const instance = new (loadAjv())(RUNTIME_AJV_OPTIONS);
  loadAddFormats()(instance);
  return instance;
}

/**
 * Every `format` name the runtime's environment actually has registered, sorted
 * (#5178).
 *
 * Read out of a live {@link createRuntimeAjv} instance rather than written down
 * as a list. A hardcoded vocabulary would be a THIRD opinion — after the
 * runtime's registration and this gate's mirror of it — and the only one nobody
 * updates: the day `ajv-formats` adds a name, a list here starts refusing a
 * format the write path enforces, which is the "gate turns working metadata
 * red" failure this whole file is written against. Enumerating means the gate
 * follows the plugin across an upgrade with no edit at all, and the `fast` /
 * default mode question answers itself (both modes register the same NAMES;
 * only the implementations differ — and if that ever stops being true, the
 * instance still knows and a list still would not).
 *
 * Throws rather than degrading if the registry comes back empty: an empty set
 * would make this gate refuse EVERY format in the stack, so failing loudly with
 * the cause named beats a run that reports the whole codebase as misspelled.
 */
export function registeredFormatNames(): readonly string[] {
  const names = Object.keys(createRuntimeAjv().formats).sort();
  if (names.length === 0) {
    throw new Error(
      `@objectstack/lint: the runtime-parity ajv instance has no \`format\` registered. "ajv-formats" ` +
        `loaded but added nothing, so the set of legitimate format names is unknown — refusing to judge ` +
        `format names against an empty vocabulary, which would report every \`format\` in the stack as ` +
        `misspelled. Check that the installed "ajv-formats" is the real package and matches the version ` +
        `@objectstack/lint declares.`,
    );
  }
  return names;
}

/** The message a thrown compile error contributes, verbatim. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Depth cap on `conditional` nesting. Parsed metadata is a tree, so this is not
 * a cycle guard — it is the same cheap promise `flow-walk.ts`'s
 * `MAX_REGION_DEPTH` makes: a hand-authored (PRE-parse) stack cannot make a lint
 * hang. `os lint` never parses, so it hands this walker whatever object the
 * author's module actually built, and `const r = {…}; r.then = r` is a two-line
 * accident. Well past anything reviewable — three levels of nested conditional
 * validation is already unreadable.
 */
export const MAX_RULE_NESTING_DEPTH = 16;

/**
 * Every rule reachable from one authored `validations[]` entry: the rule itself
 * plus, for a `conditional`, its `then` / `otherwise` branches — which
 * `evaluateRule` dispatches to exactly like a top-level rule, and which
 * therefore reach `checkFormat` / `checkJsonSchema` on the same terms.
 *
 * `label` carries the nesting so a finding points at the branch the author has
 * to edit, not merely at the outermost rule's name.
 */
function flattenRules(
  rule: AnyRec,
  labelTrail: string,
  pathTrail: string,
  depth = 0,
): Array<{ rule: AnyRec; label: string; path: string }> {
  const name = typeof rule.name === 'string' && rule.name ? rule.name : '?';
  // The two trails are deliberately different: the LABEL reads as prose for a
  // human (`'outer' → 'inner'`), the PATH points at the config key an editor
  // has to open (`outer.then.inner`).
  const label = labelTrail ? `${labelTrail} → '${name}'` : `'${name}'`;
  const path = pathTrail ? `${pathTrail}.${name}` : name;
  const out = [{ rule, label, path }];
  if (depth >= MAX_RULE_NESTING_DEPTH) return out;
  for (const branch of ['then', 'otherwise'] as const) {
    const nested = rule[branch];
    if (isRec(nested)) out.push(...flattenRules(nested, label, `${path}.${branch}`, depth + 1));
  }
  return out;
}

/** One authored validation rule, located for a finding. */
export interface WalkedValidationRule {
  /** The rule record itself — a top-level entry, or a `conditional` branch. */
  rule: AnyRec;
  /** The declaring object's `name`, or `(unnamed object)`. */
  objectName: string;
  /** The nesting-aware rule name as prose: `'outer' → 'inner'`. */
  label: string;
  /** Human-readable location: `object 'account' · validation 'outer' → 'inner'`. */
  where: string;
  /** Config path of the rule: `objects.account.validations.outer.then.inner`. */
  basePath: string;
}

/**
 * Every object validation rule an author declared, `conditional` branches
 * flattened in, each carrying the location strings a finding needs.
 *
 * Exported because #5178's format-NAME gate judges exactly this set. A second
 * walker there would be a second opinion about which rules EXIST — the same
 * drift this file refuses for the compile verdict itself, one question over —
 * and it would drift silently, because a rule the two walkers disagree about is
 * simply one that no finding ever mentions.
 */
export function walkObjectValidationRules(stack: unknown): WalkedValidationRule[] {
  const walked: WalkedValidationRule[] = [];
  if (!isRec(stack)) return walked;

  for (const obj of asArray(stack.objects)) {
    const objectName = typeof obj.name === 'string' ? obj.name : '(unnamed object)';
    // `validations` is the key `ObjectSchema` declares; `validationRules` is a
    // rejected alias of it (#5096) — see the `### The keys read` note above.
    // The two rules that judge one object's validation list still see the same
    // list, because `validate-expressions.ts` reads the same single key (#5017).
    const validations = obj.validations;

    for (const authored of asArray(validations)) {
      for (const { rule, label, path } of flattenRules(authored, '', '')) {
        walked.push({
          rule,
          objectName,
          label,
          where: `object '${objectName}' · validation ${label}`,
          basePath: `objects.${objectName}.validations.${path}`,
        });
      }
    }
  }

  return walked;
}

/**
 * Reject every object validation rule whose static artifact — a `format` rule's
 * `regex`, a `json_schema` rule's `schema` — the runtime's own compiler cannot
 * compile. Pure `(stack) => Finding[]`; never throws.
 */
export function validateRuleCompilability(stack: unknown): RuleCompilabilityFinding[] {
  const findings: RuleCompilabilityFinding[] = [];

  for (const { rule, objectName, label, where, basePath } of walkObjectValidationRules(stack)) {
    if (rule.type === 'format' && typeof rule.regex === 'string' && rule.regex !== '') {
      try {
        // The exact call `checkFormat` makes — no flags, same constructor.
        new RegExp(rule.regex);
      } catch (err) {
        findings.push({
          severity: 'error',
          rule: VALIDATION_RULE_REGEX_UNCOMPILABLE,
          where,
          path: `${basePath}.regex`,
          message:
            `\`format\` validation ${label} on object '${objectName}' declares a \`regex\` that does not ` +
            `compile: ${errorText(err)}. The write path builds it with \`new RegExp(rule.regex)\` and ` +
            `SKIPS the rule when that throws (rule-validator.ts \`checkFormat\`), so the rule is declared, ` +
            `listed in the metadata, and enforces nothing on any record.`,
          hint:
            `Fix the pattern so \`new RegExp('${rule.regex}')\` compiles — a literal \`(\`, \`[\` or \`\\\` ` +
            `must be escaped (\`\\\\(\`, \`\\\\[\`, \`\\\\\\\\\`), and the source is a STRING, so a backslash ` +
            `is written twice in TypeScript ('^\\\\d{2}-\\\\d{7}$'). Or drop \`regex\` and use a named ` +
            `\`format\` ('email' | 'url' | 'phone' | 'json').`,
        });
      }
    }

    if (rule.type === 'json_schema' && isRec(rule.schema)) {
      try {
        // A fresh instance per schema — see "One ajv instance per schema".
        createRuntimeAjv().compile(rule.schema);
      } catch (err) {
        findings.push({
          severity: 'error',
          rule: VALIDATION_RULE_SCHEMA_UNCOMPILABLE,
          where,
          path: `${basePath}.schema`,
          message:
            `\`json_schema\` validation ${label} on object '${objectName}' declares a \`schema\` ajv cannot ` +
            `compile: ${errorText(err)}. The write path compiles it with the same ajv ` +
            `(\`new Ajv({ allErrors: true, strict: false })\` + \`ajv-formats\`) and SKIPS the rule when that throws ` +
            `(rule-validator.ts \`checkJsonSchema\`), so the rule is declared and enforces nothing on any ` +
            `record.`,
          hint:
            `Correct the schema so ajv compiles it — the message above names the offending keyword. ` +
            `\`type\` must be one of null|boolean|object|array|number|string|integer (or an array of ` +
            `those), \`required\` an array of strings, and every \`$ref\` must resolve. Vendor keywords ` +
            `are fine (the runtime runs \`strict: false\`); a MALFORMED standard keyword is not.`,
        });
      }
    }
  }

  return findings;
}
