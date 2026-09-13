// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0078] The page-component TYPE gate — the author-time rejection the open
 * `type` union never had (#12950, riding the #12183 ruling of 2026-08-26).
 *
 * ## What was missing
 *
 * `PageComponentSchema.type` is `z.union([PageComponentType, z.string()])`, so
 * an arbitrary string parses. The open arm is deliberate and load-bearing —
 * see `component-type-vocabulary.ts` for the measured inventory of what a
 * union collapse would break — but it also swallowed the spec's OWN
 * namespaces: `global:serch` parsed as happily as `global:search`, every
 * authoring command validated it clean, and the console drew the literal
 * "Component Placeholder" scaffold in front of an end user. The origin card
 * measured that in a real browser: two published pages whose entire content
 * was placeholder, with zero diagnostics anywhere on the authoring path.
 *
 * ## What this rule does
 *
 * One namespace-shaped judgment per authored component node: a `type` inside a
 * namespace the enum itself populates (derived, never restated) must be a type
 * the spec answers for — an enum member, a `ComponentPropsMap` row (which
 * carries the measured string-arm registrations, including the tombstoned
 * `element:filter` / `element:form`), or a `STRING_ARM_REGISTERED_TYPES`
 * ledger entry. Anything else is refused with `severity: 'error'` and the
 * closest declared spellings.
 *
 * Types OUTSIDE the reserved namespaces are untouched — plugin widgets
 * (`mcp:connect-agent`), kebab SDUI blocks (`flex`, `object-chart`,
 * `page-header`), dot shapes (`custom.widget`) all keep the open-arm contract.
 * This rule closes nothing the extension story declares open; it closes the
 * spec's own vocabulary, which nothing ever declared open — it was merely
 * unchecked.
 *
 * ## Why `error` from birth (contrast #5068's warning-first)
 *
 * The props gate launched advisory because the live corpus VIOLATED the
 * declarations it enforced. This rule's live corpus is clean, measured before
 * severity was chosen: across `examples/**` and `packages/**` page sources the
 * only reserved-namespace strings outside the accept set are conversion-fixture
 * stand-ins (`record:detail`, `record:list`, `element:custom` in
 * `conversions/registry.ts` — replayed by the conversion harness, never fed to
 * the authoring commands) and the ledgered `record:line_items`. An error gate
 * with zero live findings breaks no one and refuses the next `global:serch` at
 * the door instead of in front of a user.
 *
 * ## The EXACT-name arm: a retired type, reported with the spec's own words
 *
 * A type the vocabulary RETIRED is `isKnownComponentType` — deliberately, so
 * the kept `ComponentPropsMap` row keeps carrying the prescription at the props
 * door — and it was therefore the one reserved-namespace string this rule
 * walked past in silence, while `PageComponentSchema.type` refuses it by name
 * at the parse. Lint saying "the stack is fine" about a name the parser then
 * refuses is the declared-not-enforced shape inverted: the author's EARLIEST
 * feedback channel was the one that stayed quiet. So the arm below reports it,
 * and the reported text is `RETIRED_PAGE_COMPONENT_TYPES`'s own entry —
 * relayed verbatim, never re-authored, so this file cannot drift from the enum
 * error map and the kept props row that carry the same string. The pin is byte
 * equality against the map (`validate-component-types.test.ts`), which is also
 * what makes a member retired tomorrow arrive here already covered.
 *
 * ⛔ `isKnownComponentType` is NOT the seam for this. Flipping it would MOVE
 * the refusal out of the props door instead of ADDING a report here, and would
 * strip the retired row of the dispatch that makes its prescription reachable.
 *
 * ### Why the arm runs BEFORE the namespace guard
 *
 * `RESERVED_COMPONENT_TYPE_NAMESPACES` is derived from the enum, and a
 * retirement can take the namespace out with the member: `user:profile` was the
 * `user:` namespace's ONLY member, so since its removal
 * `hasReservedComponentNamespace('user:profile')` is `false` — measured, not
 * assumed — and a retired-type check placed after that guard would report the
 * two elements and stay silent on exactly the member that has been refused
 * longest. Retirement is an EXACT-name fact and needs no namespace claim to be
 * true, so it is judged first. The guard keeps its own job unchanged for every
 * other string: what is outside a reserved namespace and not retired is the
 * open arm's declared story and stays untouched.
 *
 * The corpus this arm landed on was measured the way severity was: zero
 * authored instances of any retirement-map member across the in-repo page
 * sources (`examples/**`, `packages/platform-objects/src/pages/**`), with live
 * types as the lit control in the same query. Every in-tree occurrence of a
 * retired name is the map itself, a tombstone prescription, conversion or
 * migration registry data, a test, or prose. ⚠️ That reading covers authored
 * config-file metadata only — the same scope limit the rule's `surfaceReason`
 * records for stored tenant rows.
 */

import {
  hasReservedComponentNamespace,
  isKnownComponentType,
  KNOWN_COMPONENT_TYPE_CANDIDATES,
  RETIRED_PAGE_COMPONENT_TYPES,
} from '@objectstack/spec/ui';
import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';
import { walkPageComponents, type AnyRec } from './page-walk.js';
import { recordsOf } from './object-graph.js';

/** A component `type` inside a spec-reserved namespace that the vocabulary does not declare. */
export const COMPONENT_TYPE_UNKNOWN = 'component-type-unknown';

export interface ComponentTypeFinding {
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `page "app_launcher" · global:serch`. */
  where: string;
  /** Config path, e.g. `pages[0].regions[1].components[0].type`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function validateComponentTypes(stack: AnyRec): ComponentTypeFinding[] {
  const findings: ComponentTypeFinding[] = [];
  if (!isRec(stack)) return findings;

  const pages = recordsOf(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!isRec(page)) continue;
    const pageName = strName(page.name) ?? `#${pi}`;

    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = strName(component.type);
      if (!type) continue;

      // EXACT-name arm, judged before the namespace guard (header: `user:`
      // stopped being a reserved namespace when its only member was retired).
      // The message IS the map's entry — relayed, never re-authored.
      const prescription = RETIRED_PAGE_COMPONENT_TYPES.get(type);
      if (prescription !== undefined) {
        findings.push({
          severity: 'error',
          rule: COMPONENT_TYPE_UNKNOWN,
          where: `page "${pageName}" · ${type}`,
          path: `${path}.type`,
          message: prescription,
          hint:
            `Apply the prescription above: \`${type}\` is a retired component type, refused by ` +
            'name at the parse door (`PageComponentSchema.type`), so this page cannot validate or ' +
            'publish while the node is present.',
        });
        continue;
      }

      if (!hasReservedComponentNamespace(type)) continue; // the open arm's half — deliberately untouched
      if (isKnownComponentType(type)) continue;

      const suggestions = findClosestMatches(type, KNOWN_COMPONENT_TYPE_CANDIDATES);
      const suggestion = formatSuggestion(suggestions);
      findings.push({
        severity: 'error',
        rule: COMPONENT_TYPE_UNKNOWN,
        where: `page "${pageName}" · ${type}`,
        path: `${path}.type`,
        message:
          `\`${type}\` is not a component type the platform vocabulary declares. Its namespace ` +
          `(\`${type.slice(0, type.indexOf(':'))}:\`) belongs to the standard component vocabulary, so nothing ` +
          'will ever render this node — the page would validate, publish, and then draw a placeholder ' +
          'scaffold in front of the end user.' +
          (suggestion ? ` ${suggestion}` : ''),
        hint: suggestions.length
          ? `Rename \`${type}\` → \`${suggestions[0]}\`.`
          : `Use a declared component type from the standard vocabulary, or — for a custom component ` +
            `registered by your own plugin — give it its own namespace (e.g. \`my-plugin:${type.slice(type.indexOf(':') + 1)}\`) ` +
            'so it cannot be mistaken for platform vocabulary.',
      });
    }
  }

  return findings;
}
