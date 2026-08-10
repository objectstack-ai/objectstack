// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { I18nLabelSchema } from '../ui/i18n.zod';

/**
 * Settings Manifest Protocol
 *
 * Declarative description of a single namespace of platform settings
 * (e.g. `mail`, `branding`, `feature_flags`). Modelled on Apple's
 * `Settings.bundle/Root.plist` PreferenceSpecifiers — a small, closed
 * set of specifier types that the system-owned renderer turns into a
 * uniform Settings page.
 *
 * Storage for values is the generic `sys_setting` K/V table; manifests
 * themselves are NEVER persisted — they ship with plugin code.
 *
 * See ADR-0007 (Settings Manifest + K/V Store + Resolver).
 *
 * Resolution order (handled by `SettingsService.get`):
 *   1. process.env override   (source='env',     locked=true)
 *   2. sys_setting scope=tenant
 *   3. sys_setting scope=user
 *   4. manifest specifier.default
 */

// ---------------------------------------------------------------------------
// Specifier types — the closed enum of UI building blocks
// ---------------------------------------------------------------------------

export const SpecifierType = z.enum([
  // Layout
  'group',          // section header + divider
  'child_pane',     // nav row → sub-namespace
  'info_banner',    // static guidance (markdown)
  'title_value',    // read-only label

  // Inputs
  'text',
  'textarea',
  'password',       // implicit encrypted=true
  'email',
  'url',
  'phone',
  'number',
  'toggle',
  'select',
  'radio',
  'multiselect',
  'slider',
  'color',
  'json',

  // Actions
  'action_button',  // calls handler (test connection / rotate / etc.)
]);
export type SpecifierType = z.input<typeof SpecifierType>;

const SPECIFIERS_REQUIRING_KEY: ReadonlySet<SpecifierType> = new Set([
  'text', 'textarea', 'password', 'email', 'url', 'phone',
  'number', 'toggle', 'select', 'radio', 'multiselect',
  'slider', 'color', 'json',
]);

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const SpecifierOptionSchema = lazySchema(() => z.object({
  value: z.union([z.string(), z.number(), z.boolean()]).describe('Stored value'),
  label: I18nLabelSchema.describe('Display label'),
  description: z.string().optional().describe('Optional helper text'),
  icon: z.string().optional().describe('Optional Lucide icon name'),
}));
export type SpecifierOption = z.input<typeof SpecifierOptionSchema>;

/**
 * Action handler descriptor for `action_button` specifiers.
 *
 * - `http`     — server-side endpoint (e.g. POST /api/settings/mail/test).
 *                The renderer POSTs `body` (with `${...}` template
 *                interpolation against the current namespace value map +
 *                request context) and shows a toast with the result.
 * - `action`   — registered action machine name (delegated to ActionEngine).
 * - `navigate` — client-side navigation to a URL or route.
 */
export const SpecifierHandlerSchema = lazySchema(() => z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('http'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('POST'),
    url: z.string().describe('Endpoint URL; supports ${...} interpolation'),
    body: z.record(z.string(), z.unknown()).optional().describe('Optional JSON body; supports ${...} interpolation'),
    confirmText: I18nLabelSchema.optional().describe('Confirm dialog text before invoking (omit = no confirm)'),
  }),
  z.object({
    kind: z.literal('action'),
    name: z.string().describe('Registered action machine name'),
    params: z.record(z.string(), z.unknown()).optional(),
    confirmText: I18nLabelSchema.optional(),
  }),
  z.object({
    kind: z.literal('navigate'),
    url: z.string().describe('Target URL or in-app route'),
    target: z.enum(['_self', '_blank']).default('_self'),
  }),
]));
export type SpecifierHandler = z.input<typeof SpecifierHandlerSchema>;
/** Post-parse shape of {@link SpecifierHandler} — defaults applied, transforms run (ADR-0122). */
export type SpecifierHandlerParsed = z.infer<typeof SpecifierHandlerSchema>;

/**
 * Scope of a specifier value.
 *
 * Specifier resolution scopes. Listed in cascade order (low → high
 * priority): `env` always wins, then walk down `global → tenant → user`,
 * falling back to `default` (declared on the specifier). Adding a new
 * scope here requires updating the SettingsService cascade resolver and
 * the source-badge i18n entries on the UI side.
 *
 * - `global`  — platform-wide value (one row per deployment). Use for
 *               infrastructure-style settings such as outbound mail
 *               provider, SSO endpoints, telemetry, license. Written
 *               with `tenant_id=null`, `user_id=null`.
 * - `tenant`  — value applies to the whole tenant (the common case for
 *               product-level preferences such as branding). In
 *               project-kernel mode this is per-project; in
 *               control-plane mode this is per-tenant.
 * - `user`    — value is per-user; the resolver scopes reads/writes
 *               to ctx.user_id.
 */
export const SpecifierScopeSchema = z.enum(['global', 'tenant', 'user']);
export type SpecifierScope = z.input<typeof SpecifierScopeSchema>;

/**
 * Closed vocabulary of **standard value domains** a specifier's value may be
 * drawn from (#5933, the spec half of #5712).
 *
 * A specifier that declares `valueDomain` says: *the legal values for this key
 * are the members of this published standard*, and that membership — not the
 * `options` table — is the enforcement boundary. See {@link Specifier} for the
 * authoring semantics; enforcement itself lives in `service-settings`
 * (Prime Directive #2 — the spec declares, it does not execute).
 *
 * The vocabulary is closed and deliberately small: a member earns its place by
 * a metadata key that actually needs it, not by being a standard that exists.
 * Each member below carries the **definition of membership** the enforcing side
 * must implement, because "the IANA time zone database" and "what this Node
 * happens to enumerate" are measurably different sets, and picking the wrong
 * one rejects legal values.
 *
 * - `iana_time_zone` — an IANA/tzdb zone identifier (`UTC`, `Asia/Kolkata`,
 *   `Europe/Kyiv`). **Membership is the `Intl.DateTimeFormat` probe**
 *   (construct with `{ timeZone: value }`, catch `RangeError`) — the definition
 *   already used by `isValidTimeZone` in
 *   `packages/core/src/security/resolve-authz-context.ts` and by
 *   `localization.manifest.test.ts`.
 *   NOT `Intl.supportedValuesOf('timeZone')`: measured on the repo's Node 22
 *   baseline it returns 418 CLDR *canonical* names and omits `UTC` (this
 *   platform's own declared default), `Asia/Kolkata` (a curated option in the
 *   shipped localization manifest), `Europe/Kyiv`, `Asia/Ho_Chi_Minh`,
 *   `US/Eastern` and `GMT`. Testing membership against that list rejects values
 *   every runtime accepts.
 * - `iso_4217_currency` — an ISO 4217 alphabetic currency code (`USD`, `CHF`).
 *   Here `Intl.supportedValuesOf('currency')` IS usable: measured 162 entries
 *   on the same baseline, admitting `CHF` and all nine curated localization
 *   options while rejecting `XYZ`. Known gaps are the recently assigned `VED`
 *   and the metal/fund codes (`XAU`, `XDR`, …) — widen the definition
 *   deliberately if a deployment needs one, but never fall back to a regex.
 * - `iso_3166_alpha2` — an ISO 3166-1 alpha-2 country code (`US`, `GB`, `CN`).
 *   There is no standard-library oracle for this one: measured,
 *   `Intl.DisplayNames(…, { type: 'region' }).of()` returns a distinct name for
 *   `ZZ` ("Unknown Region" — the exact value this domain exists to reject) and
 *   for `UK` (a CLDR alias that is not an ISO 3166-1 code), so "the name
 *   differs from the input" is not a membership test. The enforcing side must
 *   carry an explicit alpha-2 code list; that list does not live here, because
 *   `packages/spec` holds no data tables (Prime Directive #2).
 */
export const SpecifierValueDomainSchema = z.enum([
  'iana_time_zone',
  'iso_4217_currency',
  'iso_3166_alpha2',
]);
export type SpecifierValueDomain = z.input<typeof SpecifierValueDomainSchema>;

// ---------------------------------------------------------------------------
// `visible` — the settings visibility grammar (NOT CEL)
// ---------------------------------------------------------------------------

/**
 * Comparison operators, longest-first so `>=` is never read as `>` plus a
 * stray `=`, and `!==` / `!=` win over the unary `!`. Mirrors
 * `COMPARISON_OPERATORS` in `visibility-eval.ts`.
 */
const VISIBILITY_COMPARISON_OPERATORS = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'] as const;

/**
 * The prescription every refusal carries. Stated as the grammar rather than
 * as "invalid", because the author's next question is always "then what DO I
 * write?" — and the honest answer is short enough to print.
 */
const VISIBILITY_GRAMMAR_PRESCRIPTION =
  'A settings `visible` predicate is not CEL: it is read by the save-time evaluator in ' +
  '`@objectstack/service-settings`, whose grammar is closed — a single root `data` with ' +
  'one-level member access (`data.some_key`), the operators `||` `&&` `!` and ' +
  '`===` `!==` `==` `!=` `>=` `<=` `>` `<`, parentheses, and string / number / `true` / ' +
  '`false` / `null` literals. The whole predicate may be wrapped in `${...}`, and both a ' +
  'bare string and a `{ dialect, source }` envelope are accepted. Rewrite CEL membership ' +
  'as an `||` chain (`${data.x === \'a\' || data.x === \'b\'}`); function calls, macros and ' +
  'member paths deeper than one level have no equivalent here.';

/** Thrown while walking a predicate; never escapes this module. */
class VisibilityGrammarViolation extends Error {}

const violate = (detail: string): never => {
  throw new VisibilityGrammarViolation(detail);
};

/**
 * Unwrap the three authored forms into the raw predicate source — the exact
 * unwrapping `visibilitySource()` performs before evaluating. Mirroring it
 * matters: `'${a} && ${b}'` starts with `${` and ends with `}`, so BOTH sides
 * strip it to `a} && ${b` and refuse, rather than one side quietly repairing
 * an expression the other cannot read.
 */
function unwrapVisibilitySource(value: unknown): string | undefined {
  let src: string | undefined;
  if (typeof value === 'string') src = value;
  else if (value && typeof value === 'object' && typeof (value as { source?: unknown }).source === 'string') {
    src = (value as { source: string }).source;
  }
  if (src === undefined) return undefined;
  const trimmed = src.trim();
  if (trimmed.startsWith('${') && trimmed.endsWith('}')) return trimmed.slice(2, -1).trim();
  return trimmed;
}

/**
 * Leaves (`data.x`, `'lit'`, `42`, `true`) are collapsed to one token kind:
 * the evaluator's `primary()` treats them identically, so distinguishing them
 * here could only make this side accept a different set than that side.
 */
type VisibilityToken = { kind: 'punct'; value: string } | { kind: 'value' };

function tokenizeVisibility(expr: string): VisibilityToken[] {
  const tokens: VisibilityToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')') { tokens.push({ kind: 'punct', value: ch }); i++; continue; }
    const op = [...VISIBILITY_COMPARISON_OPERATORS, '&&', '||'].find(o => expr.startsWith(o, i));
    if (op) { tokens.push({ kind: 'punct', value: op }); i += op.length; continue; }
    if (ch === '!') { tokens.push({ kind: 'punct', value: '!' }); i++; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) j += expr[j] === '\\' && j + 1 < expr.length ? 2 : 1;
      if (j >= expr.length) violate('unterminated string');
      tokens.push({ kind: 'value' });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(expr.slice(i))!;
      tokens.push({ kind: 'value' });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(expr.slice(i))![0];
      if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ kind: 'value' });
      } else if (word.startsWith('data.')) {
        // One level only: `data.a.b` and `data.` are both out.
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word.slice('data.'.length))) {
          violate(`unsupported reference "${word}" — the only root is \`data\`, with exactly one level of member access`);
        }
        tokens.push({ kind: 'value' });
      } else {
        violate(`unsupported identifier "${word}" — the only root is \`data\``);
      }
      i += word.length;
      continue;
    }
    violate(`unexpected character "${ch}"`);
  }
  return tokens;
}

/**
 * Parse-only walk of the same recursive descent `evaluateVisibility` runs:
 *
 *   orExpr  := andExpr ('||' andExpr)*
 *   andExpr := unary ('&&' unary)*
 *   unary   := '!' unary | compare
 *   compare := primary (COMPARISON primary)?
 *   primary := '(' orExpr ')' | literal | data.<ident>
 *
 * Returns the failure detail, or `undefined` when the source is in grammar.
 */
function visibilityGrammarViolation(src: string): string | undefined {
  try {
    const tokens = tokenizeVisibility(src);
    let pos = 0;
    const eat = (value: string): boolean => {
      const t = tokens[pos];
      if (t?.kind === 'punct' && t.value === value) { pos++; return true; }
      return false;
    };

    const primary = (): void => {
      const t = tokens[pos];
      if (!t) violate('unexpected end of expression');
      if (t.kind === 'punct' && t.value === '(') {
        pos++;
        orExpr();
        if (!eat(')')) violate('missing closing parenthesis');
        return;
      }
      if (t.kind !== 'value') violate(`unexpected token "${t.value}"`);
      pos++;
    };
    const compare = (): void => {
      primary();
      const t = tokens[pos];
      if (t?.kind === 'punct' && (VISIBILITY_COMPARISON_OPERATORS as readonly string[]).includes(t.value)) {
        pos++;
        primary();
      }
    };
    const unary = (): void => { if (eat('!')) unary(); else compare(); };
    const andExpr = (): void => { unary(); while (eat('&&')) unary(); };
    function orExpr(): void { andExpr(); while (eat('||')) andExpr(); }

    orExpr();
    if (pos !== tokens.length) violate('trailing tokens');
    return undefined;
  } catch (err) {
    if (err instanceof VisibilityGrammarViolation) return err.message;
    throw err;
  }
}

/**
 * `visible` on a settings manifest is **not** CEL, and this schema says so.
 *
 * Every other `visible` / `visibleWhen` in the spec is
 * `ExpressionInputSchema` — a bare string normalised to `dialect: 'cel'` and
 * handed to `@objectstack/formula`. The settings manifest slot never was:
 * its only evaluators are the console's client-side `new Function(...)` over
 * the raw string and, since #7169, the server-side `evaluateVisibility` in
 * `packages/services/service-settings/src/visibility-eval.ts`, which
 * implements a deliberately tiny closed grammar. The two spellings are not
 * compatible in either direction — the bundled manifests are written with
 * `===` / `!==`, which CEL does not have.
 *
 * #7169 measured the corpus and the maintainer ruled on 2026-08-10: 94
 * `visible` predicates across the 10 bundled manifests, of which routing them
 * through CEL would break 93, while narrowing the declaration to the grammar
 * actually evaluated breaks 0. So the declaration moves, not the evaluator
 * (and not `ExpressionInputSchema`, which #7071 settled stays CEL-only —
 * "each protocol keeps its own spelling").
 *
 * What this buys: an author who writes real CEL (`data.x in ['a','b']`,
 * `size(data.y) > 0`, `data.a.b == 1`) is refused **here**, at publish/parse,
 * with a message naming the grammar that would work — instead of authoring a
 * predicate that every gate accepts and that then fails the tenant's next
 * save. PR #7310's save-time refusal stays as defense in depth: this slot is
 * the producer-side check, that one is the consumer-side check, and they are
 * pinned against each other in
 * `packages/services/service-settings/src/settings-visibility-declaration.pin.test.ts`.
 *
 * The wire shape is untouched — bare string and `{ dialect, source }`
 * envelope are both still accepted, and the bare string still normalises to
 * the canonical envelope. Only the set of accepted `source` strings narrows.
 *
 * An `ast`-only envelope is passed through — the AST is opaque at this layer,
 * and the evaluator reads `source`.
 */
const SettingsVisibilityInputSchema = ExpressionInputSchema.superRefine((value, ctx) => {
  const source = unwrapVisibilitySource(value);
  // `undefined` is an `ast`-only envelope; `''` is `"${}"`, which the
  // evaluator answers with `true` rather than a parse error. Neither reaches
  // the grammar walk there, so neither reaches it here.
  if (!source) return;
  const detail = visibilityGrammarViolation(source);
  if (detail === undefined) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Unsupported \`visible\` predicate "${source}": ${detail}. ${VISIBILITY_GRAMMAR_PRESCRIPTION}`,
  });
});

/** Shared `.describe()` — the grammar, named, on both slots that carry it. */
const VISIBILITY_DESCRIBE_GRAMMAR =
  'Grammar is NOT CEL: root `data` with one-level member access, `||` `&&` `!`, ' +
  '`===` `!==` `==` `!=` `>=` `<=` `>` `<`, parentheses and string/number/bool/null ' +
  'literals, optionally wrapped in `${...}`; bare string or `{ dialect, source }` envelope.';

// ---------------------------------------------------------------------------
// Specifier schema (the unit of UI in a manifest)
// ---------------------------------------------------------------------------

/**
 * A single specifier in a manifest. The set of recognised fields is the
 * union of all specifier types' needs; type-specific cross-field
 * validation runs in the manifest superRefine below.
 */
export const SpecifierSchema = lazySchema(() => z.object({
  /** Specifier variant — drives renderer and validation rules. */
  type: SpecifierType.describe('Specifier variant'),

  /**
   * Stable identifier (snake_case) used for i18n translation lookup,
   * action routing, and test selectors. Orthogonal to `key` (which is
   * the storage path). Recommended for `group` and `action_button`
   * specifiers so their labels can be translated and so action
   * handlers have stable hook keys. Must be unique within a manifest.
   */
  id: SnakeCaseIdentifierSchema.optional().describe('Stable identifier (snake_case)'),

  /**
   * Storage key (snake_case). Required for all value-bearing specifiers;
   * MUST be omitted for layout-only specifiers (`group`, `info_banner`,
   * `child_pane`, `title_value`, `action_button`).
   */
  key: SnakeCaseIdentifierSchema.optional().describe('Storage key (snake_case)'),

  /** Display label. */
  label: I18nLabelSchema.describe('Display label'),

  /** Optional helper text shown beneath the field. */
  description: z.string().optional().describe('Help text'),

  /** Optional Lucide icon name (for groups, buttons, child panes). */
  icon: z.string().optional().describe('Icon name (Lucide)'),

  /** Default value used when neither env, tenant, nor user has a value set. */
  default: z.unknown().optional().describe('Default value'),

  /**
   * Visibility expression evaluated against the live namespace value map
   * (e.g. "${data.provider === 'smtp'}"). Hidden specifiers are not
   * rendered AND their values are not validated.
   *
   * Not CEL — see {@link SettingsVisibilityInputSchema}. `visible` is the
   * gate every other check on this specifier hangs off (`required`,
   * `options`, `pattern`, `valueDomain`, the value window), so a predicate
   * the evaluator cannot read is refused at parse rather than at save.
   */
  visible: SettingsVisibilityInputSchema.optional()
    .describe(`Visibility expression evaluated against the namespace value map, e.g. \`\${data.provider === 'smtp'}\`. Hidden specifiers are not rendered and their values are not validated. ${VISIBILITY_DESCRIBE_GRAMMAR}`),

  /** Mark the field required (renderer + server-side validation). */
  required: z.boolean().default(false).describe('Required field'),

  /**
   * Encrypt-at-rest hint to `SettingsService` and storage. Implicit
   * `true` for `password` specifiers; explicit on others (e.g. JSON
   * blobs that hold credentials).
   */
  encrypted: z.boolean().optional().describe('Encrypt value at rest (forced true for password)'),

  /** Scope of this value. Defaults to manifest-level scope. */
  scope: SpecifierScopeSchema.optional().describe('Override manifest scope for this key'),

  /**
   * Optional whitelist of scopes that may carry a row for this
   * specifier. When omitted, all scopes from `scope` downward through
   * the cascade are eligible. Tighten this to e.g. `['global']` for
   * platform-only knobs (mail provider, allowed login methods) so the
   * UI hides tenant/user override affordances. (Phase 2)
   */
  availableScopes: z
    .array(SpecifierScopeSchema)
    .optional()
    .describe('Scopes allowed to override this specifier'),

  /**
   * When true, a value at an upper scope (e.g. global) may be locked
   * to prevent lower scopes from shadowing it. Default `true` for
   * `global`/`tenant`-scoped specifiers, `false` for `user`. (Phase 2)
   */
  lockable: z.boolean().optional().describe('Allow upper-scope locking of this specifier'),

  /** Permission name required to read this specifier (defaults to manifest read). */
  readPermission: z.string().optional().describe('Permission required to read this specifier'),

  /** Permission name required to write this specifier (defaults to manifest write). */
  writePermission: z.string().optional().describe('Permission required to write this specifier'),

  /** Deprecation marker — renderer shows a warning chip. */
  deprecated: z.boolean().optional().describe('Mark deprecated'),

  /** When deprecated, the new key callers should migrate to. */
  replacedBy: z.string().optional().describe('Replacement key (used when deprecated=true)'),

  // ----- Type-specific options -------------------------------------------

  /** Options for `select` / `radio` / `multiselect`. */
  options: z.array(SpecifierOptionSchema).optional().describe('Options for select/radio/multiselect'),

  /**
   * Declares that this key's legal values are the members of a published
   * standard — see {@link SpecifierValueDomainSchema} for the vocabulary and
   * for each domain's definition of membership.
   *
   * **Declaring it moves the enforcement boundary.** When `valueDomain` is
   * present, the standard's membership is what a write is judged against, and
   * `options` degrades to a **UI convenience list**: a curated dropdown of the
   * values worth suggesting, no longer an exhaustive statement of what is
   * legal. A value outside `options` but inside the domain is accepted.
   *
   * When `valueDomain` is ABSENT nothing changes: `options` remains exhaustive
   * and the save path rejects anything the table does not list (#5131). That is
   * the right shape for tables the platform itself backs — `mail.provider`,
   * `sms.provider` — where "legal" means "this deployment ships an adapter for
   * it", not "some registrar published it". Do not add `valueDomain` to those.
   *
   * `pattern` / `minLength` / `maxLength` still apply and still narrow: they
   * constrain the *shape* of the string, the domain constrains its
   * *membership*. A value must satisfy both. Reach for `valueDomain` precisely
   * where `pattern` cannot help — `^[A-Za-z]{2}$` admits `ZZ`, and
   * `Mars/Olympus` is a shape-valid time zone that does not exist.
   *
   * Only meaningful on value-bearing, string-valued specifiers (`text`,
   * `select`, `radio`, `multiselect`); the parse refuses it on layout-only
   * specifiers, which carry no value to judge. For a `select`, `options` is
   * still required — a dropdown needs something to draw.
   *
   * The check itself runs in `service-settings` on the write path (#5712);
   * `packages/spec` only declares the domain.
   */
  valueDomain: SpecifierValueDomainSchema
    .optional()
    .describe('Standard value domain enforced on write (options degrade to a UI suggestion list)'),

  /** `number` / `slider`: numeric bounds and step. */
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),

  /** `text` / `textarea`: length and pattern constraints. */
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
  pattern: z.string().optional().describe('Regex pattern (text only)'),

  /** `textarea`: visual rows. */
  rows: z.number().int().min(1).optional(),

  /** `action_button`: handler invoked on click. */
  handler: SpecifierHandlerSchema.optional().describe('Action handler (action_button)'),

  /** `child_pane`: namespace of the sub-manifest to navigate to. */
  childNamespace: SnakeCaseIdentifierSchema.optional().describe('Sub-namespace (child_pane)'),

  /** `info_banner`: markdown body + severity. */
  bannerText: z.string().optional().describe('Markdown body (info_banner)'),
  bannerSeverity: z.enum(['info', 'success', 'warning', 'error']).optional(),
}).superRefine((spec, ctx) => {
  // Value-bearing specifiers must have a key.
  if (SPECIFIERS_REQUIRING_KEY.has(spec.type) && !spec.key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['key'],
      message: `Specifier of type '${spec.type}' requires a 'key'.`,
    });
  }
  // Layout-only specifiers must NOT have a key.
  if (!SPECIFIERS_REQUIRING_KEY.has(spec.type) && spec.key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['key'],
      message: `Specifier of type '${spec.type}' must not declare a 'key'.`,
    });
  }
  // A value domain judges a VALUE, so a specifier that carries none cannot
  // declare one. Caught here rather than left to the renderer because a
  // `valueDomain` on a `group` is a silent no-op otherwise — declared and never
  // enforced, which is the shape Prime Directive #10 exists to refuse.
  if (spec.valueDomain && !SPECIFIERS_REQUIRING_KEY.has(spec.type)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valueDomain'],
      message: `Specifier of type '${spec.type}' carries no value, so it must not declare a 'valueDomain'.`,
    });
  }
  // select/radio/multiselect require options.
  if (['select', 'radio', 'multiselect'].includes(spec.type)) {
    if (!spec.options || spec.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `Specifier of type '${spec.type}' requires non-empty 'options'.`,
      });
    }
  }
  // action_button requires a handler.
  if (spec.type === 'action_button' && !spec.handler) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['handler'],
      message: `Specifier of type 'action_button' requires a 'handler'.`,
    });
  }
  // child_pane requires a childNamespace.
  if (spec.type === 'child_pane' && !spec.childNamespace) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['childNamespace'],
      message: `Specifier of type 'child_pane' requires a 'childNamespace'.`,
    });
  }
  // info_banner requires bannerText.
  if (spec.type === 'info_banner' && !spec.bannerText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bannerText'],
      message: `Specifier of type 'info_banner' requires 'bannerText'.`,
    });
  }
  // min/max ordering.
  if (typeof spec.min === 'number' && typeof spec.max === 'number' && spec.min > spec.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['min'],
      message: `'min' must be ≤ 'max'.`,
    });
  }
  // minLength/maxLength ordering.
  if (typeof spec.minLength === 'number' && typeof spec.maxLength === 'number' && spec.minLength > spec.maxLength) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minLength'],
      message: `'minLength' must be ≤ 'maxLength'.`,
    });
  }
  // deprecated→replacedBy
  if (spec.deprecated && !spec.replacedBy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replacedBy'],
      message: `Deprecated specifiers should declare 'replacedBy'.`,
    });
  }
}));
export type Specifier = z.input<typeof SpecifierSchema>;
/** Post-parse shape of {@link Specifier} — defaults applied, transforms run (ADR-0122). */
export type SpecifierParsed = z.infer<typeof SpecifierSchema>;

// ---------------------------------------------------------------------------
// Settings manifest (the unit a plugin exports)
// ---------------------------------------------------------------------------

/**
 * A SettingsManifest describes a single configurable namespace
 * (e.g. `mail`, `branding`). Plugins export one or more manifests and
 * register them with the SettingsService at boot.
 *
 * Manifests are pure data: no React, no SQL DDL, no per-namespace
 * tables. The system-owned renderer turns them into a Settings page
 * and values persist into the shared `sys_setting` K/V table.
 */
export const SettingsManifestSchema = lazySchema(() => z.object({
  /** Namespace identifier (snake_case). Globally unique. */
  namespace: SnakeCaseIdentifierSchema.describe('Namespace (snake_case, globally unique)'),

  /** Manifest version. Increment when keys are renamed/removed. */
  version: z.number().int().min(1).default(1).describe('Manifest schema version'),

  /** Human label shown in the Settings hub and nav. */
  label: I18nLabelSchema.describe('Display label'),

  /** Optional Lucide icon for the hub card and nav row. */
  icon: z.string().optional().describe('Icon (Lucide)'),

  /** One-line description shown in the hub card. */
  description: z.string().optional().describe('Short description'),

  /** Long-form markdown shown at the top of the settings page. */
  helpText: z.string().optional().describe('Markdown help text shown above specifiers'),

  /**
   * Default scope for value-bearing specifiers. Per-specifier `scope`
   * overrides this. Most namespaces should use 'tenant' — only
   * personal preference namespaces should use 'user'.
   */
  scope: SpecifierScopeSchema.default('tenant').describe('Default scope for specifiers'),

  /** Permission required to view the page (default: setup.access). */
  readPermission: z.string().default('setup.access').describe('Permission required to read'),

  /** Permission required to save changes (default: setup.write). */
  writePermission: z.string().default('setup.write').describe('Permission required to write'),

  /**
   * Hub category — groups manifests on the Settings hub landing
   * page (e.g. "Workspace", "Communication", "Security", "Beta").
   */
  category: z.string().optional().describe('Settings hub category'),

  /** Display order within the hub category (lower first). */
  order: z.number().optional().describe('Display order'),

  /** The ordered list of specifiers that make up the page. */
  specifiers: z.array(SpecifierSchema).min(1).describe('Page contents (ordered)'),

  /**
   * Visibility predicate for the whole manifest (e.g. license gate).
   * Same grammar as the specifier-level slot — not CEL, see
   * {@link SettingsVisibilityInputSchema}.
   */
  visible: SettingsVisibilityInputSchema.optional()
    .describe(`Whole-manifest visibility. ${VISIBILITY_DESCRIBE_GRAMMAR}`),

  /**
   * Feature flag key that gates the manifest. When set, the renderer
   * hides the manifest unless the feature flag evaluates true. Useful
   * for shipping settings UI before the corresponding feature lands.
   */
  featureFlag: z.string().optional().describe('Gate manifest visibility on a feature flag'),

  /** Marker for namespaces that are still in beta. UI shows a chip. */
  beta: z.boolean().optional().describe('Show a Beta chip on the page'),
}).superRefine((manifest, ctx) => {
  // Specifier keys within a manifest must be unique.
  const seenKey = new Set<string>();
  manifest.specifiers.forEach((spec, idx) => {
    if (!spec.key) return;
    if (seenKey.has(spec.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specifiers', idx, 'key'],
        message: `Duplicate specifier key '${spec.key}' in manifest '${manifest.namespace}'.`,
      });
    } else {
      seenKey.add(spec.key);
    }
  });

  // Specifier ids within a manifest must be unique (used for i18n /
  // action routing).
  const seenId = new Set<string>();
  manifest.specifiers.forEach((spec, idx) => {
    if (!spec.id) return;
    if (seenId.has(spec.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specifiers', idx, 'id'],
        message: `Duplicate specifier id '${spec.id}' in manifest '${manifest.namespace}'.`,
      });
    } else {
      seenId.add(spec.id);
    }
  });

  // child_pane.childNamespace must differ from manifest.namespace.
  manifest.specifiers.forEach((spec, idx) => {
    if (spec.type === 'child_pane' && spec.childNamespace === manifest.namespace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specifiers', idx, 'childNamespace'],
        message: `child_pane cannot reference its own namespace ('${manifest.namespace}').`,
      });
    }
  });
}));
export type SettingsManifest = z.input<typeof SettingsManifestSchema>;
/** Post-parse shape of {@link SettingsManifest} — defaults applied, transforms run (ADR-0122). */
export type SettingsManifestParsed = z.infer<typeof SettingsManifestSchema>;

// ---------------------------------------------------------------------------
// Resolved value (returned by SettingsService.get / REST GET)
// ---------------------------------------------------------------------------

/**
 * The shape returned by `SettingsService.get(ns, key)` and by the
 * `GET /api/settings/:namespace` endpoint per key. Carries provenance
 * so the renderer can surface env-locked fields and distinguish
 * defaults from explicit values.
 */
export const ResolvedSettingValueSchema = lazySchema(() => z.object({
  /** The effective value (after resolution). May be null when unset. */
  value: z.unknown().describe('Effective value (post-resolution)'),

  /** Which layer of the cascade provided the value (env > global > tenant > user > default). */
  source: z.enum(['env', 'global', 'tenant', 'user', 'default']).describe('Resolution source'),

  /**
   * True when the value cannot be overridden from the UI. Today this
   * is exactly `source === 'env'`, but tenant-locking is a planned
   * extension (e.g. control-plane locks a tenant value).
   */
  locked: z.boolean().describe('Cannot be overridden from UI'),

  /** Optional human-readable reason when locked (shown in tooltip). */
  lockedReason: z.string().optional().describe('Reason for the lock (UI tooltip)'),

  /**
   * Full cascade trace from highest precedence (env) downward, listing
   * every layer that contributed (or could have contributed) a value.
   * Used by the UI to render "Inherited from Global" / "Overrides
   * tenant default" badges and let admins inspect *why* a value is
   * effective. Omitted by the lightweight resolver path; populated by
   * the inspection path used by the settings UI.
   *
   * The first entry where `value` is non-null is also the effective
   * `source` above. `locked: true` on an upper entry means writes to
   * lower entries are rejected (Phase 2 lock semantics).
   */
  cascadeChain: z
    .array(
      z.object({
        scope: z.enum(['env', 'global', 'tenant', 'user', 'default']),
        value: z.unknown(),
        locked: z.boolean().optional(),
        lockedReason: z.string().optional(),
        /** True when this layer is the one that supplied the effective value. */
        effective: z.boolean().optional(),
      }),
    )
    .optional()
    .describe('Full cascade trace (env → global → tenant → user → default)'),
}));
export type ResolvedSettingValue<T = unknown> = Omit<z.infer<typeof ResolvedSettingValueSchema>, 'value'> & { value: T };

/**
 * Bulk shape returned by `GET /api/settings/:namespace`. Carries the
 * manifest alongside the current values so the renderer needs exactly
 * one round-trip to draw the page.
 */
export const SettingsNamespacePayloadSchema = lazySchema(() => z.object({
  manifest: SettingsManifestSchema,
  values: z.record(z.string(), ResolvedSettingValueSchema).describe('Effective values keyed by specifier.key'),
}));
export type SettingsNamespacePayload = z.input<typeof SettingsNamespacePayloadSchema>;
/** Post-parse shape of {@link SettingsNamespacePayload} — defaults applied, transforms run (ADR-0122). */
export type SettingsNamespacePayloadParsed = z.infer<typeof SettingsNamespacePayloadSchema>;

/**
 * Action result returned by `POST /api/settings/:namespace/:actionId`.
 * Used for "Test connection" / "Send test email" / "Rotate key" etc.
 */
export const SettingsActionResultSchema = lazySchema(() => z.object({
  ok: z.boolean().describe('Success flag'),
  message: z.string().optional().describe('Toast message'),
  severity: z.enum(['info', 'success', 'warning', 'error']).optional(),
  details: z.unknown().optional().describe('Optional structured detail (renderer-defined)'),
}));
export type SettingsActionResult = z.input<typeof SettingsActionResultSchema>;
