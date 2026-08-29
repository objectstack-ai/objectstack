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
 */

import {
  hasReservedComponentNamespace,
  isKnownComponentType,
  KNOWN_COMPONENT_TYPE_CANDIDATES,
} from '@objectstack/spec/ui';
import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';
import { walkPageComponents, type AnyRec } from './page-walk.js';

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

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

export function validateComponentTypes(stack: AnyRec): ComponentTypeFinding[] {
  const findings: ComponentTypeFinding[] = [];
  if (!isRec(stack)) return findings;

  const pages = asArray(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!isRec(page)) continue;
    const pageName = strName(page.name) ?? `#${pi}`;

    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = strName(component.type);
      if (!type) continue;
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
