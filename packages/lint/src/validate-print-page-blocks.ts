// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The PRINTABLE BLOCK SUBSET gate — card ① (#22158) of the ruling of record on
 * #8346 (letter B′, 6051470224): "A document is a page with a print
 * declaration … A printable block subset is defined and linted: a block that
 * virtualises rows or lays out responsively is refused inside a print page,
 * with pins."
 *
 * ## What this rule does
 *
 * A page that declares `print` is a document, and a document prints only what
 * it draws in full. So inside such a page — at any depth the shared page walk
 * reaches (`walkPageComponents`: every region, every container's `children`,
 * a card's `footer`, a tab or accordion panel's `children`) — every component
 * `type` must be a member of `@objectstack/spec`'s
 * `PRINTABLE_PAGE_COMPONENT_TYPES`. Anything else is refused with
 * `severity: 'error'`, at the node's `type`, with the reason
 * `PRINT_REFUSED_PAGE_COMPONENT_TYPES` records for that type (it draws a window
 * of its rows, it lays itself out to the screen, or it has nothing printable of
 * its own) and the printable list as the fix.
 *
 * The subset is an ALLOW list. A type the platform vocabulary does not declare
 * at all — a plugin widget, a kebab SDUI layout block — is refused too: nothing
 * answers for how it prints. Both lists live in the spec, beside the `print`
 * declaration, so the console's print rendering (card ②) reads the same set this
 * rule enforces; this file restates neither.
 *
 * A page without `print` is not judged at all. The parse already refuses
 * `print` on a page that does not print its own authored blocks (`slotted`,
 * source-authored and `list` pages, a `full` page with no regions —
 * `checkPagePrintComposition`), so the regions this walk visits are the whole
 * printed body. A source-authored page yields nothing from the walk by design.
 *
 * A RETIRED type (`RETIRED_PAGE_COMPONENT_TYPES`) is skipped here: the parse
 * refuses it by name, and `component-type-unknown` reports it with the
 * retirement prescription. A second finding at the same node would only repeat
 * a refusal the author already has, with a weaker fix.
 *
 * ## Why `error` from birth, and on the save door from birth
 *
 * Every page this rule can speak about carries `print`, a key the spec did not
 * declare before this rule landed — `PageSchema` is closed, so no stored page
 * row and no authored config file could carry it. The population of print
 * pages is therefore EMPTY at landing, in the repo and in every tenant's
 * stored rows alike: the false-refusal budget the sibling
 * `validateComponentTypes` is still waiting on (measured over stored tenant
 * rows) is zero by construction here, not by sampling. And the judgment is
 * page-local, so a `page` write's per-write snapshot — exactly one page, its
 * own — is all it reads. Hence `surfaces: CLI_AND_RUNTIME` with
 * `runtimeTypes: ['page']` in the registry: Studio, REST `/meta` and MCP
 * authors meet the same refusal `os build` gives.
 */

import {
  PRINTABLE_PAGE_COMPONENT_TYPES,
  PRINT_REFUSED_PAGE_COMPONENT_TYPES,
  RETIRED_PAGE_COMPONENT_TYPES,
} from '@objectstack/spec/ui';
import { walkPageComponents, type AnyRec } from './page-walk.js';
import { recordsOf } from './object-graph.js';

/** A block inside a print page that the printable block subset does not admit. */
export const PRINT_PAGE_BLOCK_UNPRINTABLE = 'print-page-block-unprintable';

export interface PrintPageBlockFinding {
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `page "invoice_print" · object-grid`. */
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

/** The printable types, spelled for the fix line — derived from the spec's set, never restated. */
function printableList(): string {
  return [...PRINTABLE_PAGE_COMPONENT_TYPES].map((t) => `\`${t}\``).join(', ');
}

export function validatePrintPageBlocks(stack: AnyRec): PrintPageBlockFinding[] {
  const findings: PrintPageBlockFinding[] = [];
  if (!isRec(stack)) return findings;

  const pages = recordsOf(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!isRec(page) || !isRec(page.print)) continue; // only a print page is judged
    const pageName = strName(page.name) ?? `#${pi}`;

    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = strName(component.type);
      if (!type) continue;
      if (PRINTABLE_PAGE_COMPONENT_TYPES.has(type)) continue;
      // Refused by name at the parse, reported by `component-type-unknown` (header).
      if (RETIRED_PAGE_COMPONENT_TYPES.has(type)) continue;

      const reason = PRINT_REFUSED_PAGE_COMPONENT_TYPES.get(type);
      findings.push({
        severity: 'error',
        rule: PRINT_PAGE_BLOCK_UNPRINTABLE,
        where: `page "${pageName}" · ${type}`,
        path: `${path}.type`,
        message:
          `\`${type}\` cannot be placed in a print page (this page declares \`print\`): ` +
          (reason !== undefined
            ? `it ${reason}.`
            : 'it is not in the printable block subset, and nothing answers for how it prints — a ' +
              'custom or registered block, or an SDUI layout block, declares no printed form.') +
          ' A print page prints exactly the blocks it draws, in full, so every block in it must come ' +
          'from the printable block subset.',
        hint:
          `Replace or remove the block. The printable blocks are ${printableList()}. ` +
          'If the page is not a document, delete its `print` declaration instead.',
      });
    }
  }

  return findings;
}
