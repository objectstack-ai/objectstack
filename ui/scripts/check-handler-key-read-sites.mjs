#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `on*` handler key a REGISTERED renderer reads off the authored document
 * must be a DECLARED member of the zod arm for the type it is registered under.
 *
 * Run:  node scripts/check-handler-key-read-sites.mjs   (also `pnpm check:handler-key-reads`)
 *       node scripts/check-handler-key-read-sites.mjs --list   (every read site this gate judged)
 * Exit: 0 = every reachable `schema.onX` / `props.onX` read is a declared arm member,
 *       1 = at least one is not, or the census collapsed.
 *
 * ## The gap this closes (objectui#7753, the class card of objectui#7664 / PR #7743)
 *
 * `BaseSchema` is `.passthrough()`. A key that LEAVES an arm is therefore not
 * refused — it stops being judged and the value is KEPT. Measured on the built
 * dist at the head that carried it:
 *
 *   { type: 'kanban', columns: [], onCardClick: { action: 'toast' } }
 *     before the deletion : REFUSED
 *     after the deletion  : ACCEPTED, with {"action":"toast"} surviving into
 *                           the parsed output — and `KanbanRenderer` still
 *                           forwarding `schema.onCardClick` into the board.
 *
 * Every gate stayed green. The #6124 ledger
 * (`packages/types/src/__tests__/handler-keys-json-refusal-6124.test.ts`) is two
 * hand-written arrays of `[file, schema, key, mirror]` tuples plus a length
 * assertion, so its POPULATION IS A LITERAL: the change re-keyed the arm by
 * SUBSTITUTION (an `onQuickAdd` tuple replacing the `onCardClick` one), which
 * held `RUNTIME_SLOT` at 44 and `ALL_SITES` at 66. A count ratchet could not
 * have seen it, and the type-level `KeepsFunction` / `RetiredIsNever` blocks are
 * written per key, so a deleted pair simply stops being asserted.
 *
 * That file's own docblock warns about this hazard — but its counter-probe pins
 * the passthrough BEHAVIOUR on a fixture. Nothing pinned the ledger's MEMBERSHIP
 * to the renderers. This gate is that missing derivation, generalised off
 * `packages/plugin-kanban/src/__tests__/kanban-handler-slots-7664.test.tsx`,
 * whose suite 3 does exactly this for one arm and whose population is derived.
 *
 * ## Why it lives in `scripts/` and not in `@object-ui/types`
 *
 * The read-site half is spread across `@object-ui/plugin-*` and
 * `packages/components`. `@object-ui/types` may not import them —
 * `pnpm check:phantom-deps` rejects the dependency and it would close a cycle —
 * so the only place that can read both halves at once is a repo-level script.
 *
 * ## The census, stated as a rule
 *
 * Both populations are DERIVED. Nothing here is a list a re-key can hold
 * constant.
 *
 *   ARMS      every `type: z.literal('<t>')` object literal reachable from an
 *             exported `const` in `packages/types/src/zod/*.zod.ts`, with the
 *             members it declares (unioned along `.extend()` bases resolved in
 *             the same directory) and, for members built by
 *             `handlerKeyRefusal(key, disposition, …)`, that disposition.
 *   READS     for every real `ComponentRegistry.register('<t>', C, …)` CALL in
 *             `packages/<pkg>/src`: the `schema.onX` / `<props>.onX` property
 *             accesses inside `C`'s body, plus those inside every component `C`
 *             RENDERS that is declared in the same package (JSX element names,
 *             resolved through same-file declarations and static relative
 *             imports, transitively, with a visited set). A TYPE-ONLY wrapper on
 *             the expression that hands the document over — `schema={bound as
 *             DetailViewSchema}` — does not close that hop (objectui#9700): it
 *             erases, so the child is handed the same object either way.
 *   KEYING    a registration is keyed on the type keys it CLAIMS, which is what
 *             the third argument decides and ⛔ not what the type string spells
 *             (objectui#9573): `register()` in `@object-ui/core`'s `Registry`
 *             sets `ns:type`, and sets the bare `type` key only when a
 *             namespaced registration omits `skipFallback`. A namespaced-only
 *             alias is therefore judged against the arm of `ns:type` — never the
 *             bare arm, which is the key `skipFallback` exists to leave alone.
 *   FINDING   a read key at a type that HAS an arm, where the arm does not
 *             declare that key (`undeclared`), or declares it with the RETIRED
 *             disposition while a renderer still reads it (`retired-but-read`).
 *
 * The transitive hop is not a flourish: it is the shape of the very instance
 * this gate exists for. `'kanban'` registers `ObjectKanbanRenderer`, which
 * renders `ObjectKanban`, which renders `KanbanRenderer` — and `KanbanRenderer`
 * is where `schema.onCardClick` is read. A gate reading only the registered
 * component's own body is green on objectui#7664's deletion, which is the one
 * reading that would make it worthless.
 *
 * ⚠️ And a hop lost is worse than a read lost, which is why objectui#9700 is a
 * card of its own rather than a second helping of objectui#9344. A read this
 * gate cannot see still leaves its component in the census; a HOP it cannot take
 * removes the component entirely — no finding, no census row, no ledger row —
 * and the green then reads as "no undeclared reads" over a file never opened.
 * objectui#9447 stood in exactly that state: `register('detail-view',
 * DetailViewRenderer)` stopped at the data-source gate because the render-prop
 * child is handed `bound as DetailViewSchema`, and two undeclared keys were read
 * on a live call path while this gate exited 0 over them.
 *
 * ## What it deliberately does NOT answer
 *
 * Each of these is a boundary, not an oversight:
 *
 *   1. **Keys that reach a renderer ONLY through a `{...props}` spread onto a
 *      Radix root or a DOM listener slot.** The seven `onOpenChange` overlays,
 *      `accordion` / `collapsible` / `toggle-group` / `tabs`, `button`'s
 *      `toFormControlDomProps` whitelist and `card`'s `<Card {...cardProps}>`
 *      reach the element without ever naming the key. There is no read site to
 *      derive from, so this gate says nothing about them; the #6124 ledger and
 *      `check-action-forward-parity.mjs` are what cover that channel.
 *   2. **The 22 RETIRED tombstones.** A tombstone exists precisely because
 *      nothing reads the key — it has no read site BY CONSTRUCTION, so it
 *      cannot be derived from one. What this gate does add there is the other
 *      direction: if a renderer ever starts reading a tombstoned key, that is a
 *      `retired-but-read` finding.
 *   3. **Types with no zod arm.** `'kanban-ui'`, `'kanban-enhanced'`,
 *      `'notifications'`, `'approvals'` and the rest of the app-shell surface
 *      are registered without a mirror. An arm that does not exist cannot have
 *      lost a member, and inventing an obligation there would be a different
 *      card. ⚠️ A namespaced-only alias over a type whose BARE key does have an
 *      arm falls here too — `view:list` (and `page:tabs`, `action:button` and
 *      `action:icon` until objectui#10872 gave each its own arm) — and
 *      because that is the shape objectui#9573 was mis-judging, its reads are
 *      still REPORTED, as UNMIRRORED-ALIAS census rows carrying the bare arm
 *      they are not. They are countable and `--list`-able; they are ⛔ not
 *      findings, and the way to bring them into judgement is to mirror the
 *      namespaced key, ⛔ never to declare the key on the bare arm.
 *   4. **Whether a declared key's TYPE is right.** That is the #6124 ledger's
 *      `KeepsFunction` / `RetiredIsNever` blocks, and it needs a type checker.
 *   5. **Lazy chunks.** `React.lazy(() => import('./KanbanImpl'))` is a dynamic
 *      import, not a statically resolvable component reference. Following it
 *      would mean guessing at a module graph the type checker owns.
 *
 * ## Rollout
 *
 * `KNOWN_UNDECLARED_READS` below is an EXEMPTION list, never the population, and
 * it only shrinks. ⚠️ Its size is a LOWER BOUND on the defects this gate can
 * see, never a measure of them: a read that passes for a coincidental reason
 * leaves no row at all, which is how `'form' FormSchema.onCancel` passed until
 * objectui#9573 re-keyed the census. Every row is a live defect with a card, not a waiver: a row
 * naming a read site this gate can no longer find FAILS the gate, the same
 * `KNOWN_HAND_SPELLINGS` rule PR #7789 landed. Its rows are the gate's own first
 * findings — arms whose renderer reads a key the mirror never declared, which is
 * the same passthrough exposure objectui#7753 names, standing on `main` before
 * this gate could see it. They are ledgered rather than fixed here because every
 * fix is a `packages/<pkg>/src` change and this card is Clause-② `no`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { TOOLING_FILE, listSourceFiles } from './check-phantom-dependencies.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * Read sites known to name a key their arm does not declare, each with the card
 * that owns the fix.
 *
 * An entry is an admission that a document authoring that key is ACCEPTED and
 * KEPT by the passthrough today — not a decision that it is fine — so it carries
 * a card and it comes out when that card lands. The key is `type::Schema.key`.
 */
export const KNOWN_UNDECLARED_READS = new Map([
  // objectui#7804 — this gate's own first run. Every row is a key a registered
  // renderer reads off the authored document that its arm never declared, so an
  // authored `onX: { action: 'toast' }` parses GREEN today and is then handed to
  // a call site expecting a function. `AlertDialogSchema.onAction` was exactly
  // this shape until objectui#7104 declared it. Each fix is a `packages/PKG/src`
  // change and each disposition has to be MEASURED per key, so they were
  // ledgered here rather than guessed at in the change that added the
  // instrument.
  //
  // ⭐ ALL SEVEN `data-table::DataTableSchema` rows, the one
  // `tree-view::TreeViewSchema.onNodeClick` row, all five
  // `object-form::ObjectFormSchema` rows, `object-grid::ObjectGridSchema.onNavigate`,
  // all three `object-kanban::ObjectKanbanSchema` rows, all five
  // `list-view::ListViewSchema` rows, both `object-gallery::ObjectGallerySchema`
  // rows and `object-view::ObjectViewSchema.onNavigate` LANDED and are gone.
  // They are objectui#6124 RUNTIME SLOTS on their arms, each measured at its OWN
  // channel rather than assumed from its siblings — which is why the slices
  // could not be co-disposed: `onColumnResize` has NO host prop anywhere
  // (`ObjectGrid` supplies its own closure), `onStepChange` has no in-repo
  // supplier at all while its channel is wired end to end, and `onRowClick` has
  // three suppliers at once. `object-kanban::ObjectKanbanSchema.onCardMove` went
  // with objectui#9342 the other way: its disposition IS `'retired'`, and this
  // gate refused that spelling while `KanbanRenderer` still read the key, so the
  // read moved to an explicit React prop first and the arm then took the
  // tombstone. Draining a row is part of the landing, not cleanup after it: a
  // row that outlived its read reddens `staleExemptions()` below.
  //
  // ⭐⭐ THE THIRTEEN ALIAS-SHAPE ROWS LEFT THIS LEDGER WITH objectui#9573, and
  // ⛔ none of them left by being declared. They left because they were never
  // this component's rows: `button::ButtonSchema.onSuccess`,
  // `icon::IconSchema.onSuccess`, `tabs::TabsSchema.onTabChange`, the four
  // `form::FormSchema` rows, `grid::GridSchema.onNavigate` and the five
  // `list::ListSchema` rows were produced by a census that keyed a registration
  // on its RAW TYPE STRING. Each of the six registrations behind them carries
  // `skipFallback: true` under a namespace — `action:button`, `action:icon`,
  // `page:tabs`, `view:form`, `view:grid`, `view:list` — and `skipFallback` is
  // precisely what stops a namespaced alias claiming the bare key, as
  // `@object-ui/plugin-list`'s own registration comment says: "the bare `list`
  // key belongs to the bullet/numbered list DISPLAY primitive (`ui:list` in
  // `@object-ui/components`)". So the arm each row named — a bullet list, a
  // Shadcn button, the `ui:tabs` container — belonged to a DIFFERENT component,
  // and declaring the key there would have published a density handler on a
  // bullet list and an action's post-success navigation block on a plain button.
  // The registry's rule is in `register()` in `@object-ui/core`'s `Registry`,
  // and `registrationsIn` now reads it: the bare key is claimed only when a
  // namespaced registration omits `skipFallback`.
  //
  // ⚠️ The ten `form` / `grid` / `list` reads did NOT leave the census. Those
  // same read sites are still judged, under the registration that claims a
  // MIRRORED key — `object-form`, `object-grid`, `list-view` — where they are
  // declared runtime slots. What left is a SECOND, wrong scoring of them. The
  // other three (`action:button`, `action:icon`, `page:tabs`) have no second
  // registration, so their reads are now reported as UNMIRRORED-ALIAS census
  // rows: real reads under a type key no mirror carries an arm for, which is
  // boundary 3 above and ⛔ not a finding this gate can make.
  //
  // ⚠️ AMENDED (objectui#10872) — `page:tabs` has since LEFT that trio the way
  // boundary 3 above says an alias should: the namespaced key was mirrored.
  // `PageTabsBlockSchema` (`public-blocks.zod.ts`) is its own arm and declares
  // `onTabChange` as an objectui#6124 runtime slot, so its read is judged there
  // like any armed read. `action:button` and `action:icon` left the same way in
  // objectui#10872 batch 4: `ActionButtonBlockSchema` / `ActionIconBlockSchema`
  // declare `onClick` as a runtime slot and refuse a flat `onSuccess` by name,
  // pointing at the row's `properties.onSuccess`, so their reads are judged
  // there. The alias population left is `view:form`, `view:grid`, `view:list`.
  //
  // ⚠️ And the same re-keying removed a FALSE GREEN the ledger could never have
  // shown, because a wrongly-passing read leaves no row: `'form'
  // FormSchema.onCancel` passed only because `FormSchema` — the `ui:form`
  // primitive's arm — mints its own `onCancel` for its own destructure, and the
  // two spellings coincided. It is now scored once, on `object-form`, where the
  // read actually lives.
  //
  // ⛔ `detail::DetailSchema.onTabChange` is NOT that shape and stays. Its
  // registration is `register('detail', DetailView, { namespace: 'view',
  // category: 'view' })` — ⛔ no `skipFallback`, so it DOES claim the bare
  // `detail` key and `DetailSchema` IS its arm. Its disposition is still
  // UNDECIDED and owned by objectui#7804, the card the row carries, which is the
  // only owner anything in this map routes to. It was objectui#9344's item ②
  // while that card was open; objectui#9344 closed `completed` on 2026-09-13
  // having landed its item ① (the cast receiver this census now peels) and not
  // its item ②, so prose sending a reader there sends them to a closed card —
  // the defect objectui#9456 repaired. ⛔ Nothing here says it is decided, and
  // deciding it lands in the zod arm, not in this file.
  ['detail::DetailSchema.onTabChange', 'objectui#7804'],

  // ⭐ objectui#9700 — THE ROW THE BLIND SPOT WAS HIDING, and ⚠️ the ONE row in
  // this map that arrived by the gate seeing MORE rather than by a renderer
  // gaining a read. It is the SAME read site as the row above,
  // `DetailView.tsx`'s `(schema as any).onTabChange`, scored a second time
  // — correctly — under the OTHER registration that reaches that component:
  // `register('detail-view', DetailViewRenderer, { namespace: 'plugin-detail' })`
  // omits `skipFallback`, so it claims the bare `detail-view` key and
  // `DetailViewSchema` IS its arm. Until objectui#9700 peeled the cast off the
  // hop, the walk stopped at `ElementDataSourceGate` and this component was
  // never opened under that registration at all.
  //
  // ⛔ It is NOT a waiver bought to make a widening quiet, and the difference is
  // checkable rather than asserted: the defect this row names is the authored
  // `onTabChange` that `BaseSchemaCore`'s `.passthrough()` KEEPS on a
  // `detail-view` node and hands to a read site typing it
  // `((value: string) => void) | undefined`. objectui#9447's own measurement is
  // why the channel is known to survive the wrapper: `useElementDataSourceSchema`
  // returns the node unchanged when there is no composed binding and otherwise
  // shallow-spreads it, overwriting only the binding keys — `onTabChange` is not
  // one of them.
  //
  // ⚠️ The number of live undeclared READ SITES did not move: it is one line,
  // and it was one line before. What moved is how many of the two registrations
  // that reach it this gate can score — one, now both. The fix is the same fix,
  // owned by the same card: objectui#7804 decides the disposition, and deciding
  // it lands in the zod arm, never in this file.
  ['detail-view::DetailViewSchema.onTabChange', 'objectui#7804'],
]);

/**
 * A ledger row naming a read site this gate no longer finds is worse than no
 * ledger: it reads as a live waiver for a defect that is gone, and the next
 * person to fix a real one cannot tell the two apart. So every row must still
 * correspond to something the census reports, and `analyze` returns the stale
 * ones for the CLI and the pin to fail on.
 */
export function staleExemptions(rawFindings) {
  const live = new Set(rawFindings.map((finding) => finding.key));
  return [...KNOWN_UNDECLARED_READS.keys()].filter((key) => !live.has(key));
}

export function parseSource(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** `onX` — the handler-key spelling objectui#6124 ledgers and this gate judges. */
export function isHandlerKey(name) {
  return /^on[A-Z][A-Za-z0-9]*$/.test(String(name));
}

/**
 * Every arm in the zod mirrors, keyed by the `type` literal that selects it.
 *
 * The population is every `type: z.literal('…')` object literal reachable from
 * an exported `const` — so an arm minted tomorrow is in the census the moment it
 * is written, and one deleted leaves it. Members are unioned along `.extend()`
 * bases resolved within the same directory, because an arm may inherit a
 * declaration it does not restate.
 */
export function collectArms(root) {
  const zodDir = resolve(root, 'packages/types/src/zod');
  let files;
  try {
    files = readdirSync(zodDir).filter((name) => name.endsWith('.zod.ts')).sort();
  } catch {
    return { arms: new Map(), schemas: new Map(), constInits: new Map() };
  }

  /** Schema-const name -> the shape facts its initializer states. */
  const schemas = new Map();
  /** Every top-level `const X = <expr>` in the directory, for spread resolution. */
  const constInits = new Map();

  // Two passes over the same parse: every `const` is indexed BEFORE any shape is
  // read, so a member built by a nullary helper (`onClear: chatbotOnClearArm()`)
  // can be followed one hop to the `handlerKeyRefusal()` inside it.
  const parsed = [];
  for (const file of files) {
    const abs = join(zodDir, file);
    const sourceFile = parseSource(readFileSync(abs, 'utf8'), abs);
    parsed.push({ file, sourceFile });
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        constInits.set(declaration.name.text, { file, node: declaration.initializer });
      }
    }
  }

  const context = { schemas, constInits };

  for (const { file, sourceFile } of parsed) {
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const record = emptyRecord(file);
        readShape(declaration.initializer, record, context);
        if (record.own.size || record.bases.length || record.spreads.length) {
          schemas.set(declaration.name.text, record);
        }
      }
    }
  }
  const arms = new Map();
  for (const [name, record] of schemas) {
    if (!record.typeLiteral) continue;
    const resolved = membersOf(name, context, new Set());
    arms.set(record.typeLiteral, {
      schema: name,
      file: record.file,
      members: resolved.members,
      unresolved: resolved.unresolved,
    });
  }
  return { arms, schemas, constInits };
}

function emptyRecord(file) {
  return { file, own: new Map(), bases: [], spreads: [], typeLiteral: null };
}

/**
 * The shape facts one initializer states: the members its own literal writes,
 * the schemas it `.extend()`s, and the shapes it spreads.
 *
 * Read along the CALL SPINE only — `BaseSchema.extend({ … })` and
 * `z.object({ … })`, walking down the receiver — never into arbitrary nested
 * arguments. A `z.object({ … })` nested inside a member's own definition
 * describes that member's sub-shape, and folding its keys into the arm would
 * make the arm look like it declares names it does not, which is the direction
 * that produces a silent GREEN.
 */
function readShape(expression, record, context) {
  let node = expression;
  const seen = new Set();

  // `export const BaseSchema = BaseSchemaCore;` — a bare alias. Missing this
  // left `BaseSchema` unresolvable, which marked all 106 arms incomplete and
  // turned the whole gate into a green that judged 23 of 62 read sites. Only the
  // ROOT initializer counts: the spine of `z.object({ … })` also ends on an
  // identifier, and treating `z` as a base would do the same damage.
  if (ts.isIdentifier(node)) {
    record.bases.push(node.text);
    return;
  }

  while (node && !seen.has(node)) {
    seen.add(node);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        if (method === 'extend' || method === 'object' || method === 'merge') {
          const [argument] = node.arguments;
          if (argument && ts.isObjectLiteralExpression(argument)) collectMembers(argument, record, context);
        }
        if ((method === 'extend' || method === 'merge') && ts.isIdentifier(callee.expression)) {
          record.bases.push(callee.expression.text);
        }
        node = callee.expression;
        continue;
      }
      node = callee;
      continue;
    }
    if (ts.isPropertyAccessExpression(node)) {
      node = node.expression;
      continue;
    }
    if (ts.isObjectLiteralExpression(node)) {
      collectMembers(node, record, context);
      break;
    }
    break;
  }
}

function collectMembers(objectLiteral, record, context) {
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      record.spreads.push(ts.isIdentifier(property.expression) ? property.expression.text : null);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (!name) continue;

    if (name === 'type') {
      const literal = literalOfTypeMember(property.initializer);
      if (literal) record.typeLiteral = literal;
    }
    record.own.set(name, dispositionOf(property.initializer, context));
  }
}

/** `z.literal('kanban')` -> `'kanban'`. Anything else selects no single arm. */
function literalOfTypeMember(initializer) {
  if (!ts.isCallExpression(initializer)) return null;
  const callee = initializer.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'literal') return null;
  const [argument] = initializer.arguments;
  return argument && ts.isStringLiteral(argument) ? argument.text : null;
}

/**
 * `handlerKeyRefusal('onCardClick', 'runtime-slot', …)` -> `'runtime-slot'`.
 *
 * Read off the CALL, not off the rendered `description` string, so a reworded
 * message cannot silently change what this gate believes about a key. A member
 * built by a nullary helper (`chatbotOnClearArm()`) is followed one hop into
 * that helper, which is how the two chatbot siblings spell their slots.
 */
function dispositionOf(initializer, context, depth = 0) {
  let found = null;
  const walk = (node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (callee === 'handlerKeyRefusal') {
        const [, disposition] = node.arguments;
        if (disposition && ts.isStringLiteral(disposition)) found = disposition.text;
        return;
      }
      if (callee === 'retirementTombstone') {
        found = 'retired';
        return;
      }
      const helper = depth < 2 ? context?.constInits.get(callee) : undefined;
      if (helper) {
        const inner = dispositionOf(helper.node, context, depth + 1);
        if (inner) {
          found = inner;
          return;
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(initializer);
  return found;
}

/**
 * The declared members of a named schema: its `.extend()` bases, then the shapes
 * it spreads, then its own literal, in that precedence.
 *
 * `unresolved` names every spread this reader could not follow — a shape from
 * another package, say. An arm carrying one has an INCOMPLETE member set, so the
 * census refuses to call anything on it undeclared rather than reporting a
 * finding it cannot stand behind.
 */
export function membersOf(name, context, seen = new Set()) {
  if (seen.has(name)) return { members: new Map(), unresolved: [] };
  seen.add(name);
  const record = context.schemas.get(name);
  if (!record) return { members: new Map(), unresolved: [name] };
  return resolveRecord(record, context, seen);
}

function resolveRecord(record, context, seen) {
  const members = new Map();
  const unresolved = [];
  for (const base of record.bases) {
    const resolved = membersOf(base, context, seen);
    for (const [member, disposition] of resolved.members) members.set(member, disposition);
    unresolved.push(...resolved.unresolved);
  }
  for (const spread of record.spreads) {
    const resolved = spread === null ? null : spreadMembers(spread, context, seen);
    if (!resolved) {
      unresolved.push(spread ?? '<computed spread>');
      continue;
    }
    for (const [member, disposition] of resolved.members) members.set(member, disposition);
    unresolved.push(...resolved.unresolved);
  }
  for (const [member, disposition] of record.own) members.set(member, disposition);
  return { members, unresolved };
}

/**
 * `...ChatbotSharedMirrorShape` -> the members that shape carries.
 *
 * The three forms this directory writes are a plain object literal,
 * `X.shape`, and `X.pick({ … }).shape` / `X.omit({ … }).shape`. Anything else is
 * left unresolved on purpose: guessing at a shape would put members into an arm
 * that are not there, and this gate's failure direction has to be a false RED it
 * can be told about, never a silent GREEN.
 */
function spreadMembers(name, context, seen) {
  const entry = context.constInits.get(name);
  if (!entry) return null;
  const node = entry.node;

  if (ts.isObjectLiteralExpression(node)) {
    const record = emptyRecord(entry.file);
    collectMembers(node, record, context);
    return resolveRecord(record, context, seen);
  }

  if (ts.isPropertyAccessExpression(node) && node.name.text === 'shape') {
    const inner = node.expression;
    if (ts.isIdentifier(inner)) return membersOf(inner.text, context, seen);
    if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
      const method = inner.expression.name.text;
      const target = inner.expression.expression;
      if (!ts.isIdentifier(target)) return null;
      if (method !== 'pick' && method !== 'omit') return null;
      const [argument] = inner.arguments;
      if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
      const selected = new Set();
      for (const property of argument.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
        if (key) selected.add(key);
      }
      const base = membersOf(target.text, context, seen);
      const kept = new Map(
        [...base.members].filter(([member]) => (method === 'pick' ? selected.has(member) : !selected.has(member))),
      );
      return { members: kept, unresolved: base.unresolved };
    }
  }
  return null;
}

/** Every `packages/<pkg>/src` file that ships, by package. */
export function populationFiles(root) {
  const packagesDir = resolve(root, 'packages');
  const byPackage = new Map();
  let entries;
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return byPackage;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const src = join(packagesDir, entry.name, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    const files = [];
    for (const file of listSourceFiles(src)) {
      const rel = relative(root, file).split(sep).join('/');
      if (TOOLING_FILE.test(rel)) continue;
      if (rel.endsWith('.d.ts')) continue;
      files.push(file);
    }
    if (files.length) byPackage.set(entry.name, files);
  }
  return byPackage;
}

/**
 * The registration MECHANICS `ComponentRegistry.register` reads off its third
 * argument, resolved to literals — `{ namespace, skipFallback, resolved }`.
 *
 * A same-file `const` and a spread of one are resolved, because the tree uses
 * both: the five page registrations hand over a shared `pageMeta` identifier and
 * four of them spread it (`{ ...pageMeta, label: 'App Page' }`). Anything else —
 * an imported meta, a call, a computed value — is `resolved: false`, which the
 * census treats as a registration it cannot key rather than one it may guess at.
 *
 * Later properties win, as they do at runtime, so a spread followed by an
 * explicit `skipFallback` reads the explicit one.
 */
function registrationOptions(expression, declarationsOf, seen = new Set()) {
  const unresolved = { namespace: undefined, skipFallback: false, resolved: false };
  if (!expression) return { namespace: undefined, skipFallback: false, resolved: true };

  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return unresolved;
    seen.add(expression.text);
    const declaration = declarationsOf().get(expression.text);
    if (!declaration) return unresolved;
    return registrationOptions(declaration, declarationsOf, seen);
  }
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return registrationOptions(expression.expression, declarationsOf, seen);
  }
  if (!ts.isObjectLiteralExpression(expression)) return unresolved;

  const options = { namespace: undefined, skipFallback: false, resolved: true };
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = registrationOptions(property.expression, declarationsOf, seen);
      if (!spread.resolved) return unresolved;
      options.namespace = spread.namespace;
      options.skipFallback = spread.skipFallback;
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      // A shorthand or a computed name could carry either key; a census that
      // ignored it would key the registration on a meta it did not read.
      const name = ts.isShorthandPropertyAssignment(property) ? property.name.text : null;
      if (name === 'namespace' || name === 'skipFallback') return unresolved;
      continue;
    }
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (name === 'namespace') {
      if (!ts.isStringLiteral(property.initializer)) return unresolved;
      options.namespace = property.initializer.text;
    } else if (name === 'skipFallback') {
      const kind = property.initializer.kind;
      if (kind === ts.SyntaxKind.TrueKeyword) options.skipFallback = true;
      else if (kind === ts.SyntaxKind.FalseKeyword) options.skipFallback = false;
      else return unresolved;
    }
  }
  return options;
}

/**
 * The type keys a registration CLAIMS, in the registry's own order of
 * specificity — the namespaced key first, then the bare-name fallback when the
 * registration still claims it.
 *
 * This mirrors `register()` in `@object-ui/core`'s `Registry`, which sets
 * `fullType = namespace ? `${namespace}:${type}` : type` and then sets the bare
 * `type` key only `if (meta?.namespace && !meta?.skipFallback)`.
 */
export function claimedTypeKeys({ type, namespace, skipFallback }) {
  if (!namespace) return [type];
  return skipFallback ? [`${namespace}:${type}`] : [`${namespace}:${type}`, type];
}

/**
 * Every real `ComponentRegistry.register('<type>', C, …)` call in a file, with
 * the type keys that call CLAIMS.
 *
 * Read off the AST rather than the text, because `packages/types/src/complex.ts`
 * NAMES that call in prose eleven times and registers nothing — a text scan
 * attributes every `on*` mentioned in that file's interfaces to three chatbot
 * arms, which was 13 of the 36 findings the first, coarser cut produced.
 *
 * ⭐ The third argument is part of the KEY, not decoration (objectui#9573). A
 * census keyed on the raw type string judges
 * `register('list', ListViewRenderer, { namespace: 'view', skipFallback: true })`
 * against the arm of the bare `list` key — the key `skipFallback` exists to stop
 * that alias claiming, as the registration's own comment in `@object-ui/plugin-list`
 * says ("the bare `list` key belongs to the bullet/numbered list DISPLAY
 * primitive"). So the census asked its question of a schema minted for a
 * different component, and every row it produced there was addressed wrongly.
 */
export function registrationsIn(sourceFile) {
  const found = [];
  let declarations = null;
  const declarationsOf = () => (declarations ??= declarationsIn(sourceFile));
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'register' &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'ComponentRegistry'
      ) {
        const [typeArgument, componentArgument, optionsArgument] = node.arguments;
        if (typeArgument && ts.isStringLiteral(typeArgument) && componentArgument) {
          const options = registrationOptions(optionsArgument, declarationsOf);
          const registration = {
            type: typeArgument.text,
            component: componentArgument,
            namespace: options.namespace,
            skipFallback: options.skipFallback,
            keyable: options.resolved,
          };
          registration.claims = options.resolved ? claimedTypeKeys(registration) : [];
          found.push(registration);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * Top-level component-ish declarations in a file, by name.
 *
 * "Component-ish" is deliberately loose — a `const X = elementDataSourceBlock(…)`
 * is a component here — because the question this map answers is only "does this
 * JSX element name resolve to something in this file whose body I should keep
 * reading".
 */
export function declarationsIn(sourceFile) {
  const declarations = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) declarations.set(node.name.text, node.body);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return declarations;
}

/** Imported binding name -> the relative specifier it came from. */
export function relativeImportsIn(sourceFile) {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) bindings.set(clause.name.text, specifier);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) bindings.set(element.name.text, specifier);
      }
    }
  }
  return bindings;
}

/**
 * Every TYPE-ONLY wrapper peeled off an expression, leaving the node that is
 * actually there at runtime. `erasedReceiverName` names it when it is an
 * identifier; `carriesDocument` asks what it is.
 *
 * A cast is erasure: `(schema as any).onTabChange` and `schema.onTabChange` emit
 * the same property access on the same object, so a census that sees one and not
 * the other is not describing the runtime. This gate saw only the second until
 * objectui#9344 measured two live reads it had never counted — the
 * `(schema as any).onTabChange` in `plugin-detail`'s `DetailView` (registered
 * `detail` / `detail-view`) and the `(schema as any)?.onTabChange` in
 * `components`' layout `containers` (registered `tabs`). Both are the exact
 * passthrough exposure this file exists to find, and neither was among the
 * boundaries above: the five things this gate declares it does not answer are
 * about channels it cannot DERIVE a read site from, and a cast is not one of
 * them — the read site is right there in the AST, one node deeper.
 *
 * Only wrappers that vanish at runtime are peeled, so this widens what the gate
 * SEES without widening what it JUDGES: the identifier underneath still has to
 * be `schema` or the component's own props parameter.
 */
function peelErasure(expression) {
  let current = expression;
  // Bounded rather than `while (true)`: these nest (`((schema as any)!)`), but a
  // real source never stacks them deeply, and a bound cannot loop on a cycle.
  for (let hop = 0; hop < 8; hop += 1) {
    // ⚠️ The angle-bracket assertion `(<any>schema)` is deliberately NOT
    // here, and its absence is measured rather than assumed: `parseSource`
    // hard-codes `ts.ScriptKind.TSX` for EVERY file, and under TSX `<any>schema`
    // parses as JSX — the expression does not survive the parse at all, in a
    // `.ts` source as much as a `.tsx` one. A branch for it would be dead code,
    // not coverage.
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
  return current;
}

function erasedReceiverName(expression) {
  const peeled = peelErasure(expression);
  return ts.isIdentifier(peeled) ? peeled.text : null;
}

/**
 * The `schema.onX` / `<props>.onX` property accesses inside one node.
 *
 * `schema` is the authored document as every renderer in this repository spells
 * it; the second half is the props parameter's own name, so a renderer written
 * `(props) => props.onChange(…)` counts and an unrelated local object does not.
 * The receiver is read through type-only wrappers (see `erasedReceiverName`), so
 * a cast does not hide a read from this census.
 */
export function handlerReadsIn(node) {
  const objects = new Set(['schema', ...propsParameterNames(node)]);
  const reads = new Map();
  const walk = (current) => {
    if (
      ts.isPropertyAccessExpression(current) &&
      objects.has(erasedReceiverName(current.expression)) &&
      isHandlerKey(current.name.text)
    ) {
      const line = current.getSourceFile().getLineAndCharacterOfPosition(current.getStart()).line + 1;
      if (!reads.has(current.name.text)) reads.set(current.name.text, line);
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return reads;
}

/**
 * The `props` half: the parameter names of the component's OWN outermost
 * functions — a plain `(props)` parameter and the `...props` rest of a
 * destructured one — and nothing nested inside them.
 *
 * Scoping this to the outermost functions is the second narrowing this gate
 * needed. Taking every nested arrow's parameters instead made `menubar`'s
 * `{items.map((child) => … child.onClick …)}` read as a document read of
 * `'menubar'.onClick`, which is a menu ITEM's handler and not the board's — a
 * named false positive of the coarser cut.
 */
function propsParameterNames(node) {
  const names = new Set();
  for (const fn of outermostFunctions(node)) {
    for (const parameter of fn.parameters) {
      if (ts.isIdentifier(parameter.name)) {
        names.add(parameter.name.text);
        continue;
      }
      if (ts.isObjectBindingPattern(parameter.name)) {
        for (const element of parameter.name.elements) {
          if (element.dotDotDotToken && ts.isIdentifier(element.name)) names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

/** Functions reachable from `node` without crossing another function boundary. */
function outermostFunctions(node) {
  const functions = [];
  const walk = (current) => {
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      functions.push(current);
      return;
    }
    ts.forEachChild(current, walk);
  };
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return [node];
  walk(node);
  return functions;
}

/** `./ObjectKanban` from `<pkg>/src/index.tsx` -> that file, if it is in the walk. */
function resolveRelative(fromFile, specifier, filesInPackage) {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    if (filesInPackage.has(candidate)) return candidate;
  }
  // `./index.js` is how ESM-correct sources name a `.ts` sibling.
  const rewritten = base.replace(/\.(m?js)$/, '');
  for (const candidate of [`${rewritten}.tsx`, `${rewritten}.ts`]) {
    if (candidate !== base && filesInPackage.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every handler key reachable from one registration: the registered component's
 * own reads, plus those of every component it renders that is declared in the
 * same package, transitively.
 *
 * Bounded by a visited set of `file::name`, so a cyclic import graph — which
 * `plugin-kanban` genuinely has, `index.tsx` <-> `ObjectKanban.tsx` — terminates.
 */
export function reachableReads(startFile, startNode, packageIndex) {
  const reads = new Map();
  const visited = new Set();
  const queue = [];

  const enqueue = (file, name) => {
    const resolved = resolveComponent(file, name, packageIndex, visited);
    if (resolved) queue.push(resolved);
  };

  // `ComponentRegistry.register('kanban', ObjectKanbanRenderer, …)` hands over a
  // NAME, not a body. A walk that starts at the identifier finds nothing at all —
  // the first cut of this gate did exactly that, reported ten read sites, and was
  // GREEN on objectui#7664's own deletion.
  if (ts.isIdentifier(startNode)) enqueue(startFile, startNode.text);
  else queue.push({ file: startFile, node: startNode });

  while (queue.length) {
    const { file, node } = queue.shift();
    if (!packageIndex.get(file)) continue;

    for (const [key, line] of handlerReadsIn(node)) {
      if (!reads.has(key)) reads.set(key, { file, line });
    }

    for (const name of documentCarryingChildren(node)) enqueue(file, name);
  }
  return reads;
}

/**
 * A component NAME, in the file that uses it, resolved to the body to keep
 * reading — through same-file declarations, static relative imports, one-level
 * aliases (`const X = Y`) and the HOC spelling (`const X = wrap(Inner)`).
 *
 * `visited` is keyed by resolved file and name, so the cyclic import
 * `plugin-kanban/src/index.tsx` <-> `ObjectKanban.tsx` terminates.
 */
function resolveComponent(file, name, packageIndex, visited, hops = 0) {
  if (hops > 4) return null;
  const parsed = packageIndex.get(file);
  if (!parsed) return null;

  let targetFile = file;
  let node = parsed.declarations.get(name);
  if (node === undefined) {
    const specifier = parsed.imports.get(name);
    if (!specifier) return null;
    const resolvedFile = resolveRelative(file, specifier, packageIndex.filesInPackage.get(file));
    if (!resolvedFile) return null;
    const remote = packageIndex.get(resolvedFile);
    if (!remote || !remote.declarations.has(name)) return null;
    targetFile = resolvedFile;
    node = remote.declarations.get(name);
  }

  const key = `${targetFile}::${name}`;
  if (visited.has(key)) return null;
  visited.add(key);

  // `const KanbanBoard = KanbanRenderer` — an alias is not a body.
  if (ts.isIdentifier(node)) return resolveComponent(targetFile, node.text, packageIndex, visited, hops + 1);
  // `const ObjectKanbanRenderer = elementDataSourceBlock(Inner)` — a wrapper whose
  // body is named rather than written inline. An inline argument is already part
  // of this node and needs no hop.
  if (ts.isCallExpression(node)) {
    for (const argument of node.arguments) {
      if (ts.isIdentifier(argument) && /^[A-Z]/.test(argument.text)) {
        const inner = resolveComponent(targetFile, argument.text, packageIndex, visited, hops + 1);
        if (inner) return inner;
      }
    }
  }
  return { file: targetFile, node };
}

/**
 * The child components this body hands THE SAME DOCUMENT to.
 *
 * This is the narrowing that makes a transitive walk sound. A renderer renders
 * plenty of components, and most are handed a DIFFERENT document — the widgets a
 * dashboard lays out each get their own `schema`, and `ObjectDataTable`'s
 * `schema.onRowClick` is a read of the WIDGET's document, not the dashboard's.
 * Following every JSX child attributed 46 reads to arms that never see them.
 *
 * So a hop is taken only when the document flows into the child: the child's
 * `schema=` attribute must name the parent's own document, an object literal
 * spreading it, a local `const` derived from it, or the parameter a
 * document-carrying element hands its render-prop child. That last clause is not
 * a special case for one plugin — it is how objectui#7664's own chain is
 * spelled:
 *
 *   ObjectKanbanRenderer  <ElementDataSourceGate schema={schema}>{(bound) =>
 *     ObjectKanban        <KanbanRenderer schema={{ ...effectiveSchema, … }} />
 *     KanbanRenderer      schema.onCardClick
 */
export function documentCarryingChildren(node) {
  const documents = documentIdentifiers(node);
  const names = new Set();
  const walk = (current) => {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      const attribute = schemaAttributeOf(current);
      if (attribute && carriesDocument(attribute, documents) && ts.isIdentifier(current.tagName)) {
        if (/^[A-Z]/.test(current.tagName.text)) names.add(current.tagName.text);
      }
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return names;
}

/** The expression a JSX element's `schema=` attribute is given, if any. */
function schemaAttributeOf(element) {
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText() !== 'schema') continue;
    const initializer = attribute.initializer;
    if (initializer && ts.isJsxExpression(initializer) && initializer.expression) return initializer.expression;
  }
  return null;
}

/**
 * Is this expression the parent's own document, or built out of it?
 *
 * Read through TYPE-ONLY wrappers (`peelErasure`), for the same reason the READ
 * side peels them: `<DetailView schema={bound as DetailViewSchema} />` and
 * `<DetailView schema={bound} />` hand the child the SAME object at runtime, so
 * a census that follows one and not the other is not describing the runtime.
 * That asymmetry is what objectui#9700 measured. The cast peeling objectui#9344
 * landed reached `erasedReceiverName` only, so a cast could no longer hide a
 * READ — but it could still hide the HOP that gets the walk to the read at all,
 * which is strictly worse: a lost read site leaves no row anywhere, and the
 * gate's green then reads as "no undeclared reads" over a component it never
 * opened. `plugin-detail`'s `DetailViewRenderer` is the measured instance —
 * `register('detail-view', DetailViewRenderer)` reached `ElementDataSourceGate`
 * and stopped, because the render-prop child hands `DetailView` its document
 * through `bound as DetailViewSchema`. objectui#9447's two keys were read there
 * and declared by no arm, and this gate exited 0 over them.
 *
 * ⚠️ Peeling widens what the walk SEES, never what it FOLLOWS: the node
 * underneath still has to be a document identifier, a spread of one, or one of
 * the expression shapes below. A cast over an unrelated value stays unfollowed.
 */
function carriesDocument(expression, documents) {
  const peeled = peelErasure(expression);
  if (ts.isIdentifier(peeled)) return documents.has(peeled.text);
  if (ts.isObjectLiteralExpression(peeled)) {
    if (declaresOwnType(peeled)) return false;
    return peeled.properties.some(
      (property) => ts.isSpreadAssignment(property) && carriesDocument(property.expression, documents),
    );
  }
  if (ts.isBinaryExpression(peeled) || ts.isConditionalExpression(peeled)) {
    return mentionsAny(peeled, documents);
  }
  return false;
}

/**
 * Every local name that holds the document inside one body: `schema` itself, the
 * `const`s derived from it, and the parameters a document-carrying element hands
 * its render-prop child. Iterated to a fixpoint, because each of those can feed
 * the next.
 */
function documentIdentifiers(node) {
  const documents = new Set(['schema']);
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    const walk = (current) => {
      if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && current.initializer) {
        if (
          !documents.has(current.name.text) &&
          mentionsAny(current.initializer, documents) &&
          !constructsNewDocument(current.initializer)
        ) {
          documents.add(current.name.text);
          changed = true;
        }
      }
      if (ts.isJsxElement(current) && schemaAttributeOf(current.openingElement)) {
        if (carriesDocument(schemaAttributeOf(current.openingElement), documents)) {
          for (const child of current.children) {
            if (!ts.isJsxExpression(child) || !child.expression) continue;
            const callback = child.expression;
            if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) continue;
            for (const parameter of callback.parameters) {
              if (ts.isIdentifier(parameter.name) && !documents.has(parameter.name.text)) {
                documents.add(parameter.name.text);
                changed = true;
              }
            }
          }
        }
      }
      ts.forEachChild(current, walk);
    };
    walk(node);
    if (!changed) break;
  }
  return documents;
}

/**
 * Does this expression BUILD a new document rather than carry the parent's?
 *
 * An object literal that writes its own `type` member is a new node, whatever it
 * read out of the parent to build it. `ObjectView` composes
 * `{ type: 'view-switcher', …, storageKey: `view-pref-${schema.objectName}` }`
 * and hands it to `<ViewSwitcher schema={…} />`; without this test the mention of
 * `schema` inside made that read as the parent's document, and `ViewSwitcher`'s
 * `schema.onViewChange` was reported against `ObjectViewSchema` — a named false
 * positive, and one whose arm is not even the one being read.
 */
function constructsNewDocument(expression) {
  let hit = false;
  const walk = (current) => {
    if (hit) return;
    if (ts.isObjectLiteralExpression(current) && declaresOwnType(current)) {
      hit = true;
      return;
    }
    ts.forEachChild(current, walk);
  };
  walk(expression);
  return hit;
}

function declaresOwnType(objectLiteral) {
  return objectLiteral.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'type',
  );
}

/** Does this expression read any of these identifiers? */
function mentionsAny(expression, names) {
  let hit = false;
  const walk = (current) => {
    if (hit) return;
    if (ts.isIdentifier(current) && names.has(current.text)) {
      hit = true;
      return;
    }
    ts.forEachChild(current, walk);
  };
  walk(expression);
  return hit;
}

/** Parse every file once; the walk revisits components, never files. */
function indexPackages(root) {
  const byPackage = populationFiles(root);
  const parsed = new Map();
  const filesInPackage = new Map();
  for (const [, files] of byPackage) {
    const set = new Set(files);
    for (const file of files) {
      filesInPackage.set(file, set);
      const sourceFile = parseSource(readFileSync(file, 'utf8'), file);
      parsed.set(file, {
        sourceFile,
        declarations: declarationsIn(sourceFile),
        imports: relativeImportsIn(sourceFile),
      });
    }
  }
  return {
    byPackage,
    filesInPackage,
    get: (file) => parsed.get(file),
    size: parsed.size,
  };
}

export function analyze(root) {
  const { arms } = collectArms(root);
  const packageIndex = indexPackages(root);

  const counters = {
    arms: arms.size,
    files: packageIndex.size,
    registrations: 0,
    armed: 0,
    reads: 0,
    judged: 0,
    unjudgeable: 0,
    aliasRegistrations: 0,
    aliasReads: 0,
    unkeyable: 0,
  };
  const census = [];
  const raw = [];
  const findings = [];
  const unkeyable = [];

  for (const [, files] of packageIndex.byPackage) {
    for (const file of files) {
      const parsed = packageIndex.get(file);
      if (!parsed) continue;
      const registrations = registrationsIn(parsed.sourceFile);
      if (!registrations.length) continue;
      counters.registrations += registrations.length;

      for (const registration of registrations) {
        const registeredIn = relative(root, file).split(sep).join('/');

        // A registration whose mechanics this reader could not resolve to
        // literals cannot be keyed AT ALL: "claims the bare key" and "is a
        // namespaced-only alias" are different questions of the same document,
        // and guessing either way is the objectui#9573 defect in a narrower
        // shape. It is collected and reported rather than assumed.
        if (!registration.keyable) {
          if (!arms.get(registration.type)) continue;
          counters.unkeyable += 1;
          unkeyable.push({ type: registration.type, registeredIn });
          continue;
        }

        // The key the REGISTRY would resolve this registration under, most
        // specific first. A namespaced-only alias claims `ns:type` and nothing
        // else, so the bare arm is not its arm.
        const armKey = registration.claims.find((claim) => arms.has(claim));
        const arm = armKey ? arms.get(armKey) : undefined;

        if (!arm) {
          // ⭐ The objectui#9573 population, kept VISIBLE rather than dropped.
          // A namespaced-only alias over a type whose BARE key does have an arm
          // is the exact shape this census used to mis-judge: the reads are
          // real, the arm it was judged against belonged to another component,
          // and no mirror carries the namespaced key it actually claims. They
          // are reported as census rows so the surface stays countable, and are
          // NOT findings — an arm that does not exist cannot have lost a member,
          // which is boundary 3 above.
          if (!registration.skipFallback || !registration.namespace) continue;
          const bare = arms.get(registration.type);
          if (!bare) continue;
          const aliasReads = reachableReads(file, registration.component, packageIndex);
          counters.aliasRegistrations += 1;
          for (const [key, where] of [...aliasReads].sort((a, b) => a[0].localeCompare(b[0]))) {
            counters.aliasReads += 1;
            census.push({
              type: registration.claims[0],
              schema: null,
              key,
              declared: undefined,
              disposition: undefined,
              unmirroredAlias: { bareType: registration.type, bareSchema: bare.schema },
              file: relative(root, where.file).split(sep).join('/'),
              line: where.line,
            });
          }
          continue;
        }
        counters.armed += 1;

        const reads = reachableReads(file, registration.component, packageIndex);
        for (const [key, where] of [...reads].sort((a, b) => a[0].localeCompare(b[0]))) {
          counters.reads += 1;
          const disposition = arm.members.has(key) ? arm.members.get(key) : undefined;
          const declared = arm.members.has(key);
          const rel = relative(root, where.file).split(sep).join('/');

          // An arm whose shape spreads something this reader could not follow has
          // an INCOMPLETE member set, so "not declared" would be a claim about a
          // member list that is not fully known. Reporting it anyway is the one
          // way this gate could produce a red nobody can act on, so it does not.
          if (!declared && arm.unresolved.length) {
            counters.unjudgeable += 1;
            census.push({
              type: armKey,
              schema: arm.schema,
              key,
              declared: false,
              disposition,
              unjudgeable: arm.unresolved,
              file: rel,
              line: where.line,
            });
            continue;
          }

          counters.judged += 1;
          census.push({ type: armKey, schema: arm.schema, key, declared, disposition, file: rel, line: where.line });
          if (declared && disposition !== 'retired') continue;

          const finding = {
            key: `${armKey}::${arm.schema}.${key}`,
            kind: declared ? 'retired-but-read' : 'undeclared',
            type: armKey,
            schema: arm.schema,
            armFile: arm.file,
            member: key,
            file: rel,
            line: where.line,
            registeredIn,
          };
          raw.push(finding);
          if (!KNOWN_UNDECLARED_READS.has(finding.key)) findings.push(finding);
        }
      }
    }
  }

  return { findings, raw, stale: staleExemptions(raw), counters, census, arms, unkeyable };
}

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));
  const { findings, stale, counters, census, unkeyable } = analyze(root);

  if (process.argv.includes('--list')) {
    for (const entry of census) {
      const state = entry.unmirroredAlias
        ? `UNMIRRORED-ALIAS (skipFallback, so the bare '${entry.unmirroredAlias.bareType}' arm ` +
          `${entry.unmirroredAlias.bareSchema} is another component's)`
        : entry.unjudgeable
          ? `UNJUDGEABLE (unresolved spread: ${entry.unjudgeable.join(', ')})`
          : entry.declared
            ? (entry.disposition ?? 'declared')
            : 'UNDECLARED';
      const schema = entry.schema ? `${entry.schema}.${entry.key}` : entry.key;
      console.log(`'${entry.type}' ${schema}  [${state}]  ${entry.file}:${entry.line}`);
    }
  }

  // A refactor that quietly emptied the census would satisfy every assertion in
  // the pin while checking nothing — the same size guard the sibling gates open
  // with, and the reason a green here always carries its counts.
  if (counters.arms < 50 || counters.files < 200 || counters.armed < 10 || counters.reads < 10) {
    console.error(
      `The census collapsed: ${counters.arms} arm(s), ${counters.files} source file(s), ` +
        `${counters.armed} registration(s) with an arm, ${counters.reads} handler read(s). ` +
        'An empty census would pass while asserting nothing.',
    );
    process.exit(1);
  }

  // A registration whose `namespace` / `skipFallback` this reader cannot resolve
  // to literals is one the census cannot KEY, and an unkeyed registration is how
  // objectui#9573 happened: its reads were judged against an arm minted for a
  // different component. So it is refused rather than guessed at — and because
  // every registration resolving as unkeyable is what a broken resolver looks
  // like, this doubles as the floor under the keying itself.
  if (unkeyable.length) {
    console.error(
      `x  ${unkeyable.length} registration(s) whose type has an arm could not be KEYED — this reader ` +
        'could not resolve their `namespace` / `skipFallback` to literals:\n' +
        unkeyable.map((entry) => `      '${entry.type}' registered in ${entry.registeredIn}`).join('\n') +
        '\n\nThe registry claims the bare type key only when a namespaced registration omits ' +
        '`skipFallback`, so an unresolved meta leaves the census unable to say which arm judges these ' +
        'reads. Spell `namespace` / `skipFallback` inline, or as a same-file `const` this reader can ' +
        'follow.',
    );
    process.exit(1);
  }

  if (stale.length) {
    console.error(
      `x  ${stale.length} KNOWN_UNDECLARED_READS row(s) name a read site this gate no longer finds:\n` +
        stale.map((key) => `      ${key}`).join('\n') +
        '\n\nThe defect the row waives is gone, so the row is now a live waiver for nothing. Delete it.',
    );
    process.exit(1);
  }

  if (!findings.length) {
    console.log(
      `OK  ${counters.arms} arm(s), ${counters.registrations} registration(s) ` +
        `(${counters.armed} keyed onto an arm), ${counters.reads} reachable handler read(s), ` +
        `${counters.judged} judged, ${counters.unjudgeable} left unjudged on an arm with an ` +
        `unresolved spread, ${counters.aliasReads} read(s) under ${counters.aliasRegistrations} ` +
        'namespaced-only alias(es) no mirror carries an arm for, ' +
        `${KNOWN_UNDECLARED_READS.size} exempted by ledger — every judged read ` +
        'is a declared member of its arm.',
    );
    process.exit(0);
  }

  console.error(`x  ${findings.length} handler key(s) a registered renderer reads are not declared by their arm:\n`);
  for (const finding of findings) {
    const why =
      finding.kind === 'undeclared'
        ? `${finding.schema} (${finding.armFile}) does not declare it`
        : `${finding.schema} (${finding.armFile}) declares it RETIRED, but a renderer still reads it`;
    console.error(
      `      '${finding.type}'.${finding.member}  read at ${finding.file}:${finding.line}\n` +
        `          registered in ${finding.registeredIn}; ${why}.`,
    );
  }
  console.error(
    '\n`BaseSchema` is .passthrough(), so a key that is not declared is not refused — it stops being\n' +
      'judged and the value is KEPT, then reaches the renderer that reads it (objectui#7664, objectui#7753).\n' +
      'Declare the key on its arm with handlerKeyRefusal(), or stop reading it — or, if the fix belongs to\n' +
      'another card, add the key to KNOWN_UNDECLARED_READS in\n' +
      'scripts/check-handler-key-read-sites.mjs with the card that owns it.',
  );
  process.exit(1);
}
