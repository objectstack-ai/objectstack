/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8253 / objectui#8841 — `TreeViewConfig`'s key census is total over
 * the PROTOCOL, its readers agree with it, and the module-local copy it
 * replaced is GONE rather than shadowed.
 *
 * ## The card
 *
 * `tree` is a host-composition-only view type (objectui#5321 ruling B): on
 * neither authored union, reached only when a host passes a `views` prop. The
 * per-view `tree` block that path reads had NO exported type — its only
 * description was the module-local `interface TreeConfig` in
 * `plugin-tree/src/ObjectTree.tsx`. The live host is the console, which stores
 * view records and passes them as `views`, so a real consumer wrote this block
 * against nothing and a misspelled key was stored, dropped and never reported.
 * Ruled option (a) on objectui#8253 (decision batch #78, 2026-09-07, maintainer
 * 「同意」): export the config, import it at the reader, ⛔ no second copy.
 *
 * ## What this file owns, and what it deliberately does not
 *
 * It owns the DERIVED half — the part a type-level pin cannot see:
 *
 *   - the private interface is gone from the reader;
 *   - the reader imports the exported name instead;
 *   - the resolver's local `ResolvedTreeConfig` is `Pick`ed off the one
 *     declaration rather than hand-written beside it;
 *   - all four reader sites are where this census says they are.
 *
 * It does NOT own reachability through the published `exports` map. That is
 * unassertable from inside this package — `tsconfig.test.json` here sets
 * `"paths": {}` AND there is no self-link in `packages/types/node_modules`, so
 * `@object-ui/types` is not a specifier this project can resolve at all. It is
 * pinned from a CONSUMER instead, in
 * `plugin-tree/src/ObjectTree.hostConfigExported-8253.test.ts`, whose own
 * `"paths": {}` sends the specifier through the workspace dependency to
 * `packages/types/dist/index.d.ts`. Two files, two halves, neither redundant.
 *
 * ## What objectui#8841 changed (and why the census stopped being a list)
 *
 * objectui#8253's export was a hand-written INTERFACE — the protocol's
 * `ListView.tree` block, copied under a second name — and it declared a fifth
 * key, `titleField`, that `@objectstack/spec@17.4.0` refuses on that block by
 * name. The pins here did not catch it because `DECLARED` was AUTHORED beside
 * the type: the list was written to match the drift, so it agreed with the
 * defect and stayed green. objectui#8841 derives the type from the protocol and
 * checks `DECLARED` against `TreeConfigSchema`'s own shape in both directions,
 * so the list can no longer drift silently — only loudly.
 *
 * ## Every zero below has a firing control
 *
 * A `not.toMatch` is worth nothing until the same instrument is shown matching
 * something that IS there. Each negative assertion is paired with a positive
 * one on the same regex family and the same file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TreeConfigSchema } from '@objectstack/spec/ui';
import type { ListView as SpecListView } from '@objectstack/spec/ui';

import type { TreeViewConfig } from '../index';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const RESOLVER = 'packages/plugin-tree/src/ObjectTree.tsx';
const VIEW_BRANCH = 'packages/plugin-view/src/ObjectView.tsx';
const LIST_BRANCH = 'packages/plugin-list/src/ListView.tsx';
const CONSOLE_COMPOSITION = 'packages/app-shell/src/views/ObjectView.tsx';

/**
 * The declared keys, as a value — `it.each` needs one, and a failure named
 * `reads \`labelField\`` is worth more than a failure named `reads keys[1]`.
 *
 * ⚠️ objectui#8841: this list is no longer AUTHORED here. It is checked against
 * `@objectstack/spec`'s own `TreeConfigSchema` in both directions below, and
 * that check is the reason the list is allowed to exist at all. The previous
 * spelling was authored here, carried a fifth key (`titleField`) the protocol
 * refuses on `ListView.tree`, and stayed green precisely because the list and
 * the type were maintained together — a census cannot be total over something
 * it also authors.
 */
const DECLARED = [
  'parentField',
  'labelField',
  'fields',
  'defaultExpandedDepth',
] as const;

/* -------------------------------------------------------------------------- */
/* Compile-time: the value list above IS the type's key set, not a copy of it. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// Without this, `DECLARED` is a second hand-maintained key list — the exact
// artefact this card removed from `ObjectTree.tsx`. It is checked in BOTH
// directions, so a key added to the interface without being added here fails
// as loudly as the reverse.
type _CensusMatchesType = Assert<Equal<(typeof DECLARED)[number], keyof TreeViewConfig>>;

// objectui#8841 — and the type itself is the PROTOCOL's block, so the chain
// closes: list ≡ type ≡ spec. Structural equality rather than `extends`; a
// hand-written twin satisfies assignability in both directions and would
// defeat the derivation.
type SpecTreeConfig = NonNullable<SpecListView['tree']>;
type _TypeIsTheProtocolBlock = Assert<Equal<TreeViewConfig, SpecTreeConfig>>;
// FIRING CONTROL: the instrument above must be able to say `false`, and the
// near-miss it is shown is the one that actually shipped.
type _ParityCanFail = Assert<Equal<Equal<TreeViewConfig, SpecTreeConfig & { titleField?: string }>, false>>;

describe('the census is the protocol\'s key set, not a copy of it (objectui#8841)', () => {
  const specKeys = Object.keys(TreeConfigSchema.shape).sort();

  it('list ≡ protocol, both directions', () => {
    expect([...DECLARED].sort()).toEqual(specKeys);
  });

  it('CONTROL: the comparison can fail — the key that shipped is the one it rejects', () => {
    // Without this, an `toEqual` between two lists that were both derived from
    // the same place would be indistinguishable from one that cannot fail.
    expect([...DECLARED, 'titleField'].sort()).not.toEqual(specKeys);
    expect(specKeys).not.toContain('titleField');
    // FIRING CONTROL on the zero above: a key the protocol DOES declare.
    expect(specKeys).toContain('parentField');
  });
});

describe('the module-local copy is gone, not shadowed (objectui#8253)', () => {
  const src = read(RESOLVER);

  // ⚠️ Anchored at the start of a line, and that is load-bearing rather than
  // tidy. The first spelling of this pin was an unanchored
  // `/interface\s+TreeConfig\b/`, and it went RED on a green tree: the
  // replacement docblock in `ObjectTree.tsx` says the words "interface
  // TreeConfig" while EXPLAINING that the interface is gone. An unanchored
  // regex over a source file cannot tell a declaration from prose about a
  // declaration. A declaration starts its line; a docblock line starts with
  // ` * `.
  const DECLARATION = (name: string) =>
    new RegExp(String.raw`^\s*(export\s+)?interface\s+${name}\b`, 'm');

  it('declares no private `TreeConfig` interface any more', () => {
    expect(src).not.toMatch(DECLARATION('TreeConfig'));
  });

  it('CONTROL: the same instrument still finds an interface that IS there', () => {
    // `TreeNode` is declared in the same file, two statements from where
    // `TreeConfig` stood. If the regex family has stopped matching interface
    // declarations at all, this fails and the negative above stops counting.
    expect(src).toMatch(DECLARATION('TreeNode'));
  });

  it('CONTROL: and the anchor is what does the work', () => {
    // Pins the trap itself, so the next person to "simplify" this regex is
    // told why it is shaped this way: the prose IS in the file, and only the
    // anchor keeps it from reading as a declaration.
    expect(src).toMatch(/interface TreeConfig/);
    expect(src).not.toMatch(DECLARATION('TreeConfig'));
  });

  it('imports the exported type from the package entry', () => {
    expect(src).toContain("TreeViewConfig } from '@object-ui/types'");
  });

  it('derives its resolved form from the one declaration instead of restating it', () => {
    // `ResolvedTreeConfig` may add REQUIREDNESS (the resolver floors
    // `labelField` and `fields`) but must not respell a key or a key's type —
    // a structurally-equal hand-written twin type-checks fine and would defeat
    // the export entirely.
    expect(src).toMatch(/Required<Pick<TreeViewConfig,\s*'labelField' \| 'fields'>>/);
    expect(src).toMatch(/Pick<TreeViewConfig,\s*'parentField' \| 'defaultExpandedDepth'>/);
  });

  it('CONTROL: and the resolver still returns that type', () => {
    // Proves the derived type is WIRED IN, not merely declared and orphaned.
    //
    // ⚠️ The RETURN type is what this control is about; the PARAMETER is matched
    // loosely on purpose. It read `schema: any` until objectui#8655, which typed
    // it at the node so `checker.getPropertyOfType` could answer for the six keys
    // read in the body — pinning that spelling here would make an unrelated
    // package's type repair red this file for no reason it is about.
    expect(src).toMatch(/function getTreeConfig\(schema: \w+\): ResolvedTreeConfig/);
  });

  it('CONTROL: …and that parameter is NOT `any` any more (objectui#8655)', () => {
    // The loosened matcher above must not read as indifference: `any` is the one
    // spelling that makes the census below unanswerable, so it is named and
    // refused rather than merely not required.
    expect(src).not.toMatch(/function getTreeConfig\(schema: any\)/);
  });
});

describe('every declared key has a reader (objectui#8253)', () => {
  const resolver = read(RESOLVER);
  /** `getTreeConfig`'s body — the block the ruling scoped the census to. */
  const fn = (() => {
    const from = resolver.slice(resolver.indexOf('function getTreeConfig'));
    return from.slice(0, from.indexOf('\n}\n') + 3);
  })();

  it('the resolver body was actually located', () => {
    // The slice above is derived from source text; if the function is renamed
    // the slice silently becomes the whole file and every assertion under it
    // passes for the wrong reason. Bound it explicitly.
    expect(fn.length).toBeGreaterThan(80);
    expect(fn.length).toBeLessThan(resolver.length / 2);
    expect(fn).toContain('function getTreeConfig');
  });

  it.each(DECLARED)('reads `%s`', (key) => {
    expect(fn).toContain(key);
  });

  it('CONTROL: a key that is neither declared nor read is absent', () => {
    // If this ever appears in the resolver, the census has stopped being total
    // and the type owes a decision — declare the key, or delete the read. That
    // is the card's own rule, applied to itself.
    expect(fn).not.toContain('sortField');
  });
});

describe('`titleField` is NOT declared — the reads that survived were tolerance (objectui#8841), retired by objectui#6152 round 14', () => {
  // objectui#8253 put this key to a measurement — declare it if the console
  // WRITES it, else delete the read — and then declared it on READ-side
  // evidence instead. `@objectstack/spec@17.4.0` settles it: `TreeConfigSchema`
  // is a `strictObject` and REFUSES `titleField` on `ListView.tree` by name, so
  // the declaration published a key the protocol rejects and an author who
  // followed `@object-ui/types` was refused at publish. 协议为基准.
  //
  // What this block owns now is the SHAPE OF THE REMAINDER, so the next session
  // does not read "the key is gone" as "every read is gone":
  //
  //   - the resolver's `schema.titleField` rung is DELETED (it read the flattened
  //     NODE, and `titleField` is declared on neither the node face nor the
  //     block's);
  //   - the three `labelField || titleField` dual-reads in plugin-view,
  //     plugin-list and app-shell SURVIVE as undeclared tolerant fallbacks, so
  //     already-stored view records keep resolving. They are recorded here for a
  //     follow-up, ⛔ not declared anywhere — re-declaring a renderer-side alias
  //     is the AGENTS.md #0.1 defect this card undoes.

  it('the protocol refuses it on `ListView.tree`, measured on the installed artifact', () => {
    const refused = TreeConfigSchema.safeParse({ titleField: 'name' });
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain('titleField');

    // FIRING CONTROL: the same schema accepts what it declares, so the refusal
    // is about the KEY and not about a schema (or an import) that refuses
    // everything.
    expect(TreeConfigSchema.safeParse({ labelField: 'name' }).success).toBe(true);
  });

  it('the resolver no longer reads it', () => {
    const resolver = read(RESOLVER);
    const from = resolver.slice(resolver.indexOf('function getTreeConfig'));
    const fn = from.slice(0, from.indexOf('\n}\n') + 3);

    // Bound the slice, exactly as the census above does: a renamed function
    // silently turns this into "the whole file" and the negative below would
    // then be a statement about nothing.
    expect(fn).toContain('function getTreeConfig');
    expect(fn.length).toBeLessThan(resolver.length / 2);

    expect(fn).not.toContain('titleField');

    // FIRING CONTROL: the same slice, the same instrument, on the rung that IS
    // there. Without this, a slice that had become empty would pass the line
    // above.
    expect(fn).toContain('labelField');
  });

  it('CONTROL: the explanation of the deleted rung is in the file, just not in the body', () => {
    // The prose-vs-declaration trap this file already documents for `interface
    // TreeConfig`, in its second instance. `ObjectTree.tsx` explains the removal
    // ABOVE `getTreeConfig` precisely so the slice above stays a reading about
    // the code. If someone moves that prose inside the function, the negative
    // above starts failing for the wrong reason — this line is what tells them
    // which of the two happened.
    expect(read(RESOLVER)).toContain('titleField');
  });

  it('the three tolerant dual-reads are RETIRED (objectui#6152 round 14)', () => {
    // This card left them as a RECORD, not an endorsement: each read a key the
    // protocol refuses and no face declares, through `any`, and retiring them
    // touched three packages, so it was a decision rather than a rider here.
    // objectui#6152 round 14 took that decision, in all three at once.
    expect(read(VIEW_BRANCH)).not.toContain('viewOptions.tree?.titleField');
    expect(read(LIST_BRANCH)).not.toContain('treeCfg.titleField');
    // CONTROL: the same instrument finds the canonical rung in both.
    expect(read(VIEW_BRANCH)).toContain('viewOptions.tree?.labelField');
    expect(read(LIST_BRANCH)).toContain('treeCfg.labelField');

    const rung = read(CONSOLE_COMPOSITION)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('labelField:') && l.includes('viewDef') && /\btree\b/.test(l));
    expect(rung, 'the console composition has no `viewDef` tree `labelField` rung').toBeDefined();
    expect(rung).not.toContain('titleField');

    // The canonical rung on the same line stays typed.
    expect(rung).toContain("(viewDef.tree as TreeViewConfig | undefined)?.labelField");
  });

  it("objectui#6557's pin on the rung followed the retirement", () => {
    // That file pinned the tolerant console rung while it lived; since
    // objectui#6152 round 14 it pins that the retired rung answers nothing.
    expect(read('packages/app-shell/src/views/ObjectView.titleFieldConvergence.test.tsx'))
      .toContain("the tree's retired `tree.titleField` rung answers nothing");
  });

  it("CONTROL: the console's create-view dialog still does NOT offer it for `tree`", () => {
    // The half of objectui#8253's own measurement that argued for deleting the
    // read, re-measured on this base rather than carried over: `titleField` IS
    // collected — for calendar, timeline and gantt — so a zero for the `tree`
    // slot is a reading about the tree slot and not about a broken instrument.
    const dialog = read('packages/app-shell/src/views/CreateViewDialog.tsx');
    const treeSlot = (() => {
      const from = dialog.slice(dialog.indexOf('\n  tree: ['));
      return from.slice(0, from.indexOf('\n  ],') + 5);
    })();

    expect(treeSlot).toContain("key: 'parentField'");
    expect(treeSlot).not.toContain("key: 'titleField'");
    // FIRING CONTROL: the same instrument, on a slot that does collect it.
    expect(dialog).toContain("key: 'titleField'");
  });
});
