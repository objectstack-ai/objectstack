// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { strictObject } from '../shared/strict-object';

/**
 * ## The override declaration (ADR-0146 D2)
 *
 * A customization of an installed base package (HotCRM) is an item of the
 * base's paired writable package `<base>.custom` (ADR-0146 D3). An item of that
 * package that bears a base item's name and carries
 *
 * ```ts
 * overrides: { package: '<base package id>', basedOn: '<the base package's manifest.version>' }
 * ```
 *
 * replaces the base's item WHOLE for every read that serves the base's name
 * (ADR-0146 D8). The declaration lives in the item body, so it travels with the
 * item through export and git: what a developer writes into `hotcrm.custom` in a
 * repository and what an administrator does in Studio produce the same
 * document. Only the paired `<base>.custom` package declares an override (the
 * ruling recorded on #28390, ruling A); the pairing helpers in
 * `customization-package.ts` are what a door asks.
 *
 * ### Why a leaf module
 *
 * It imports nothing but zod and `strictObject`, on purpose. Every overridable
 * type's schema spreads {@link OverrideDeclarationFields}, and some of those
 * schemas are imported by `manifest.zod.ts` (`ui/app.zod.ts`); importing the
 * manifest or the registry from here would close a module cycle that the eager
 * schema build (`OS_EAGER_SCHEMAS=1`) evaluates in temporal-dead-zone order.
 * The helpers that need the manifest grammar live in `customization-package.ts`,
 * which no schema imports.
 *
 * ### What this module does NOT do
 *
 * It declares the shape. Admitting a declared override, refusing an undeclared
 * same-named item, refusing a declaration from a package that is not the pair,
 * and serving the declared document are the doors' (ADR-0146 Rollout, P1:
 * the write gate, the effective read, the ensure door). Which types may carry
 * the declaration is the closed list `OVERRIDE_TYPE_CLASSIFICATION`, never a
 * judgement a door makes.
 */

/**
 * The suffix that names a base package's paired customization package:
 * `hotcrm` → `hotcrm.custom`, `com.example.showcase` →
 * `com.example.showcase.custom` (ADR-0146 D3; maintainer, verbatim:
 * 「同意 后缀改成 .custom」).
 *
 * Declared here, in the leaf the schemas import, so the declaration's own
 * refusal ("a pair is never a base") and the pairing helpers in
 * `customization-package.ts` read one spelling. ⛔ Never spell `'.custom'`
 * anywhere else: import this constant or ask a helper.
 */
export const CUSTOMIZATION_PACKAGE_SUFFIX = '.custom';

/** {@link CUSTOMIZATION_PACKAGE_SUFFIX}, escaped for a regular expression. */
const ESCAPED_CUSTOMIZATION_PACKAGE_SUFFIX = CUSTOMIZATION_PACKAGE_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Any non-empty string that does not end in {@link CUSTOMIZATION_PACKAGE_SUFFIX}. */
const NOT_A_CUSTOMIZATION_PACKAGE_ID = new RegExp(`^(?![\\s\\S]*${ESCAPED_CUSTOMIZATION_PACKAGE_SUFFIX}$)[\\s\\S]+$`);

/**
 * The override declaration's body: which base package's item this item
 * replaces, and which version of that item the author started from.
 *
 * Closed: an unknown key is refused by name, because a misspelt `basedon`
 * dropped in silence would leave a declaration that records nothing.
 */
export const OverrideDeclarationSchema = strictObject({
  surface: 'this override declaration',
  history:
    'New with ADR-0146: the shape was closed from its first release, so a misspelt key is '
    + 'refused instead of dropped.',
  aliases: { packageId: 'package', base: 'package', basePackage: 'package', version: 'basedOn', baseVersion: 'basedOn' },
}, {
  package: z.string()
    .min(1)
    // A pattern, not a `.refine()`: a pattern publishes into the JSON Schema
    // (`json-schema/**`), so a document the file accepts is one the parse
    // accepts. Built from the constant, so the suffix has one spelling.
    .regex(NOT_A_CUSTOMIZATION_PACKAGE_ID, {
      message:
        `\`overrides.package\` names the BASE package whose item this item replaces, never a \`${CUSTOMIZATION_PACKAGE_SUFFIX}\` package: `
        + `the declaring item lives in the base's paired \`<base>${CUSTOMIZATION_PACKAGE_SUFFIX}\` package and names the base it overrides `
        + `(write \`com.acme.crm\`, not \`com.acme.crm${CUSTOMIZATION_PACKAGE_SUFFIX}\`).`,
    })
    .describe(
      'The base package id whose same-named item this item replaces whole (e.g. "com.acme.crm"). '
      + 'Only an item of the base\'s paired "<base>.custom" package declares an override.',
    ),
  basedOn: z.string()
    .min(1)
    .describe(
      'Recorded, never judged: the base package\'s `manifest.version` this override was taken from (e.g. "3.2.0"), '
      + 'not a history version of the item. '
      + 'No door compares it with the installed base, no upgrade diff is produced from it, and nothing is '
      + 'refused on it; it tells a person re-basing the override where it started (ADR-0146 D2).',
    ),
}).describe(
  'Override declaration (ADR-0146 D2): this item, of the base\'s paired "<base>.custom" package and bearing a '
  + 'base item\'s name, replaces that base item whole for every read that serves the name.',
);

export type OverrideDeclaration = z.input<typeof OverrideDeclarationSchema>;
/** Post-parse shape of {@link OverrideDeclaration}. */
export type OverrideDeclarationParsed = z.infer<typeof OverrideDeclarationSchema>;

/**
 * Raw shape spliced into the schema of every type whose
 * `OVERRIDE_TYPE_CLASSIFICATION` disposition is `'overridable'`, in the style of
 * `MetadataProtectionFields`.
 *
 * ⛔ Not spread into `MetadataProtectionFields`, and deliberately so: that
 * envelope is spread into types ADR-0146 excludes (`permission`, `position`,
 * `capability`, the code-only types, `object`), and it is the set the
 * registration and clone paths strip as loader-stamped state
 * (`Object.keys(MetadataProtectionFields)`). The declaration is AUTHORED — it
 * must survive registration and export — so it is its own spread, on the
 * overridable types only.
 *
 * @example
 * ```ts
 * // An item of `com.acme.crm.custom`:
 * {
 *   name: 'crm_account_welcome',
 *   subject: 'Welcome aboard',
 *   // …the whole document…
 *   overrides: { package: 'com.acme.crm', basedOn: '3.2.0' },
 * }
 * ```
 */
export const OverrideDeclarationFields = {
  /**
   * Declares that this item replaces the base package's item of the same name
   * (ADR-0146 D2). `basedOn` is recorded and never judged.
   */
  overrides: OverrideDeclarationSchema.optional().describe(
    'Override declaration (ADR-0146 D2): `{ package, basedOn }` — this item of "<base>.custom" replaces the '
    + 'base package\'s same-named item whole. `basedOn` is recorded and never judged.',
  ),
} as const;
