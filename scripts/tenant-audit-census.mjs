#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * tenant-audit-census -- the committed enumeration of every APPLICATION-SURFACE
 * write call site against a tenancy-enabled object.
 *
 *   node scripts/tenant-audit-census.mjs            # human summary
 *   node scripts/tenant-audit-census.mjs --json     # the whole census, machine-readable
 *   node scripts/tenant-audit-census.mjs --write    # rewrite both committed artefacts
 *
 * ⚠️ This module deliberately exposes NO `--self-test` flag of its own, and that
 * is a wiring decision rather than an omission. {@link selfTest} below is real
 * and is run on every CI pass -- `check-tenant-audit-census.mjs --self-test`
 * calls it. Giving it a flag would mean CI invoking this file directly, which
 * makes it a GATE FILE, and `scripts/pm/dispatch-gates.mjs` refuses to follow a
 * gate file: the 22 path literals this module spells would stop being inherited
 * by the gate that imports it, so a PR touching `packages/services/**` would
 * silently stop being told this gate reads its diff. Measured, by that tool's
 * own self-test, the first time this was wired the other way.
 *
 * `content/docs/permissions/tenant-audit-census.mdx` is the page this builds.
 * `check-tenant-audit-census.mjs` is the gate that holds the page to what this
 * reports. Together they are the `isSystem` census triple's shape applied to the
 * tenant-audit control (`SqlDriver.auditMissingTenant`).
 *
 * ## ⭐ Why this exists AS AN ARTEFACT, which is the whole point
 *
 * The measurement this replaces lived in a COMMENT on issue #13178. That issue
 * became unreachable -- it 404s on unauthenticated REST, on the rendered page and
 * on authenticated MCP alike, while its neighbours answer 200 -- and took the
 * census with it. Three open cards named it as their input. What survived did so
 * by luck: a changeset author had quoted two of the figures in prose
 * (`.changeset/tenant-audit-update-delete-half-repairs.md`), so "175 write call
 * sites, 24 of them carrying no tenant context" is still readable on `main` while
 * the list of 24 is not recoverable at all.
 *
 * ⇒ A census that decides a repair family's severity and a ruling's scope is not
 *   a comment. It is a re-runnable instrument plus a committed page, so that
 *   losing any issue costs nothing, and so the population can be RE-DERIVED
 *   rather than quoted.
 *
 * ## What the tenant-audit control actually is
 *
 * `SqlDriver.auditMissingTenant(object, op, options)` warns when a write targets
 * a tenancy-enabled object without `options.tenantId`. It is gated, in order, by
 * `OS_TENANT_AUDIT=0`, then `options.bypassTenantAudit`, then a present
 * `tenantId`, then the deployment posture, then the object having a tenant field.
 *
 * The engine sets `bypassTenantAudit` for every `ExecutionContext.isSystem` write
 * (ObjectQL's `buildDriverOptions`), and `options.tenantId` from
 * `execCtx.tenantId`. So what a CALL SITE controls is one thing: whether it
 * threads an execution context at all. That is what this census measures.
 *
 * ## The population, and the two ways a count goes wrong
 *
 * A site is a call to one of the three `IDataEngine` write doors -- `insert`,
 * `update`, `delete` -- on a receiver whose declared type is an engine, in
 * tracked non-test sources under `packages/services/` and `packages/plugins/`.
 *
 * ⛔ The identifier is not the signal. `.delete()` alone answers ~250 sites in
 * this corpus, and the overwhelming majority of them are `Map.delete`,
 * `Set.delete`, `Headers.delete`, a crypto `Hash.update`, an HTTP route
 * registration, a blob-storage delete-by-key, and a search-index de-index. A
 * census keyed on the verb name over-reports by more than it reports.
 *
 * So the receiver is TYPED, structurally: a corpus-declared interface or type
 * literal counts as an engine when it declares `insert` / `update` / `delete`
 * with a first parameter named `object` / `objectName` / `objectApiName` /
 * `name` and typed `string` -- the `IDataEngine` door signature. Interfaces that
 * EXTEND one (`IObjectQLEngine extends IDataEngine`) inherit it, and aliases that
 * NARROW one (`Partial<Pick<IDataEngine, 'insert' | …>>`) carry it. That found 56
 * engine-shaped types where a name list would have found the handful someone
 * remembered.
 *
 * ⭐ The second failure direction is the expensive one, and it is a KEYWORD.
 * Sites whose receiver the author typed `any` -- `ql: any`, `engine: any`,
 * `(engine as any)` -- have no type to read. There are 45 of them, better than a
 * fifth of the population, and they are concentrated in exactly the seed and
 * bootstrap paths this control exists for. Scoring an unreadable receiver as
 * "not an engine" would have dropped every one of them silently, with a clean
 * exit and a smaller number that reads exactly like a smaller truth.
 *
 * ⇒ `any` is NOT a classification here. It goes to the unreadable pile, and the
 *   unreadable pile is placed by facts about the tree rather than about the
 *   receiver:
 *
 *   1. the first argument is a string that NAMES A DECLARED OBJECT, or
 *   2. the first argument is a parameter declared `object: string` -- the same
 *      door signature the type index keys on, read at the argument instead of
 *      at the receiver, or
 *   3. an `UNTYPED_RECEIVERS` row says what the receiver is.
 *
 * An unreadable receiver that none of the three place is an ERROR, never a
 * default. That is the direction this census cannot survive being wrong in.
 *
 * ## Tenancy is enabled BY DEFAULT, so the registry only finds the opt-outs
 *
 * `isTenancyDisabled()` reads `tenancy.enabled === false` and nothing else, so an
 * object is tenancy-enabled unless it says otherwise. {@link declaredObjects}
 * walks every `*.object.ts` in the tree; of those, exactly two (`sys_api_key`,
 * `sys_sso_provider`) opt out. ⛔ The object COUNT is corpus scale and is not
 * quoted here -- it is emitted, dated and unenforced in the artefacts' own
 * corpus-scale block, and a number repeated into a comment is a number that
 * rots where nothing can see it.
 *
 * ## What is DECIDABLE, and why that is reported rather than smoothed over
 *
 * A site whose object name is an inline literal or a local `const` string is
 * statically decidable. A site whose name is a parameter or a field
 * (`objectName`, `this.objectName`) is not, and no amount of AST work makes it
 * so -- the object is chosen at run time. Those are reported as `undecidable`
 * rather than assumed either way, because a census that quietly guesses on 30%
 * of its own population is the "73% coverage that reads like full coverage"
 * failure the class-level control was warned about.
 *
 * ## ⭐ Two kinds of number, rendered apart
 *
 * Both artefacts carry the POPULATION this census certifies (`census.totals`:
 * every write call site and its tenancy/context verdict) and, separately, the
 * CORPUS SCALE it walked ({@link corpusScaleRows}: sources read, engine-shaped
 * types recognised, objects declared, same-named calls subtracted). The gate
 * enforces the first and deliberately does not enforce the second -- a
 * maintainer ruling of 2026-08-31 adopting the split the sibling `isSystem`
 * census had already proved.
 *
 * ⇒ That is why the scale numbers are rendered in their own DATED block rather
 *   than mixed in among the totals. An artefact whose unenforced numbers sit
 *   inside its enforced ones cannot tell a reader which is which, and the reader
 *   is the person the split is FOR. {@link renderCorpusScale} emits the block,
 *   {@link measuredAt} dates it, and `check-tenant-audit-census.mjs` carries the
 *   reasoning and the measurement that draws the line where it is drawn.
 *
 * ## ⭐ The index is TRACKED-ONLY, and the subtraction now says so
 *
 * Every enumeration here is `git ls-files` (see the criterion at
 * {@link CORPUS_TYPE_DECL}), so a declaration that is untracked -- a type file a
 * developer has not `git add`ed yet, a generated one, a dependency's -- is one the
 * engine type index does not hold. ⛔ That is the design: a census whose verdict
 * moved with the working tree would be measuring the working tree.
 *
 * What it cost, until this was written down: a receiver typed with such a
 * declaration resolved to `kind: 'other'`, was SUBTRACTED from the certified
 * population, and printed nothing. `I read this receiver's type and it is a Set`
 * and `I could not find this receiver's type at all` were the same row at the same
 * exit code -- so the population could shrink, and the part that shrank was
 * invisible. ⭐ The subtraction is not the defect; the two arms printing the same
 * thing is.
 *
 * ⇒ {@link NON_ENGINE_REASONS} is now a closed set of eight, five of which name a
 *   fact that DEFENDS the subtraction and three of which admit the census could not
 *   place the receiver's type. The undefended ones are printed per site on every
 *   run, carried per site in `--json`, and counted under ENFORCEMENT in both
 *   artefacts -- so a type that leaves the index lands in the diff by name instead
 *   of removing a site in silence. ⛔ No subtraction is withdrawn on this basis and
 *   ⛔ no exit code changed: one site on a clean tree is undefended today, and a
 *   gate that reds on arrival is a gate that gets weakened.
 *
 * ## ⭐ The door rule is applied to the TYPE, not to the type's NAME
 *
 * {@link memberIsEngineDoor} was applied to NAMED declarations only, so a receiver
 * whose declared type is an inline type literal had no name for the index to be
 * keyed on and was subtracted as `kind: 'other'` however plainly its own text
 * stated a write door. Two sites on a clean tree were exactly that, both writing
 * under an elevated context: `resolveInsertEngine()`'s
 * `{ insert: (name: string, …) => … } | null` in `plugin-auth`, and
 * `migrateLegacySsoClientSecrets`'s `engine as unknown as { find(object: string, …);
 * update(object: string, …) }`. The census PRINTED both -- `doorShaped` in
 * {@link nonEngineReason} is that diagnostic -- and subtracted them anyway. ⛔ A
 * diagnostic that names a subtraction as probably wrong and then takes it is not a
 * report, it is a deferral.
 *
 * ⇒ {@link inlineEngineDoorOrOther} closes it: when a declared type text names no
 *   indexed engine, the SAME door rule is read off the type text itself, and a
 *   write door there places the site. ⛔ Not a widening of the definition -- it IS
 *   the definition, applied where it had only been reported. The diagnostic stays,
 *   and its door-shaped count is now 0 BY CONSTRUCTION: a non-zero value there
 *   means a door-shaped receiver reached the subtraction anyway, i.e. this hole has
 *   reopened.
 *
 * ## ⭐ The census's OWN round trip is the census's own problem
 *
 * The door rule above is read off a declared type by re-parsing its text as a
 * synthetic alias (`type CensusReceiver = <the stored text>;`). That text used
 * to be stored whitespace-collapsed, and a type literal may separate its members
 * by a NEWLINE alone -- legal TypeScript, which a collapse turns into no
 * separator at all, so the synthesis did not parse. Through
 * {@link parseSourceFile} that did not fail the SITE: it ended the process, so
 * one receiver's unanswerable question became no answer for any site, under a
 * refusal naming `census-receiver-type.ts`, a file that does not exist in the
 * tree.
 *
 * ⇒ Two repairs, in that order, and the second is the one that removes the
 *   defect rather than localising it.
 *
 *   1. The synthesis goes through `parseDerivedText`, which hands the verdict
 *      back rather than ending the run -- and the verdict is ACTED ON, never
 *      swallowed. The site is classified `type-text-not-round-trippable`, an
 *      UNDEFENDED arm: printed against its own file and line with the parse
 *      failure under it, carried per site in `--json`, counted under
 *      ENFORCEMENT in both artefacts, and REFUSED by
 *      `check-tenant-audit-census.mjs` -- which is the reading CI takes, since
 *      `lint.yml` invokes the gate and never this generator.
 *   2. ⭐ The text is no longer collapsed when it is STORED. {@link declaredTypesIn}
 *      keeps a declared type exactly as the source spells it, so the newline
 *      separator survives and the alias parses. The collapse was never needed
 *      there: every reader of that text either scans it for identifiers or
 *      re-parses it, and the one place a single line is actually required -- the
 *      artefacts -- already collapses at the point of RENDER.
 *
 * ⚠️ So what remains on the refusing arm is a text this tool derived and cannot
 * read back for some reason OTHER than the collapse. ⛔ That is a defect in this
 * module, never a style to be corrected in the corpus: a refusal that told the
 * author to restyle legal TypeScript was asking the tree to work around the
 * instrument, and the arm is kept as the alarm for the next such defect rather
 * than as a standing instruction.
 *
 * ⛔ The exchange is a loud process exit for a loud per-site refusal, ⛔ never for
 * a quiet subtraction: localising the failure into an exit 0 would be the same
 * floor drop wearing the other costume. ⚠️ And the CORPUS door is untouched --
 * sources are still read through {@link parseSourceFile}, so a source that does
 * not parse still ends the run. Only text THIS PROCESS SYNTHESISED is returnable,
 * and only from an origin that door already certified.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * A corpus of zero sources, an object registry of zero declarations, a source
 * that cannot be read, a source that does not parse (`ts-parse.mjs` refuses), an
 * unreadable receiver with no placement, and a ledger row that matches nothing
 * are all non-zero exits naming what could not be read.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

import { isEntrypoint } from './invoked-as.mjs';
import { parseDerivedText, parseSourceFile } from './ts-parse.mjs';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const WRITE_VERBS = ['insert', 'update', 'delete'];
export const OBJECT_PARAM_NAMES = new Set(['object', 'objectName', 'objectApiName', 'name']);
export const SURFACE_ROOTS = ['packages/services', 'packages/plugins'];

export function isTestPath(relPath) {
  return /\.(test|spec)\./.test(relPath) || /(^|\/)(tests|__tests__|qa)\//.test(relPath);
}

export function trackedTs(root, roots) {
  return execFileSync('git', ['-C', root, 'ls-files', ...roots], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !f.includes('/dist/'));
}

export function collectSources(root = ROOT, roots = SURFACE_ROOTS) {
  const out = trackedTs(root, roots).filter((f) => !isTestPath(f));
  if (out.length === 0) throw new Error('tenant-audit-census: corpus resolved to ZERO source files');
  return out;
}

/**
 * ⭐ THE CRITERION, written down: this index is built from TRACKED files, and an
 * untracked declaration is deliberately NOT repository content.
 *
 * {@link trackedTs} shells `git ls-files`, so every enumeration in this module --
 * the corpus it censuses, the engine type index receivers resolve against, the
 * object registry, and the type-name set below -- sees what the repository
 * contains and nothing that exists only in somebody's working tree. That is the
 * design and not an oversight: a census whose verdict moved because a file had
 * not been `git add`ed yet would make the repository's answer a function of a temp
 * file, and a number that changes with the working tree is not a fact about the
 * repository. ⛔ So this module never reads an untracked file.
 *
 * The price of that choice is real and it lands in ONE place: while a declaration
 * is untracked, every receiver typed with it is a receiver whose type this module
 * cannot find.
 *
 * ⇒ What the choice therefore OBLIGES is that such a receiver be SAID OUT LOUD
 *   rather than folded into "not an engine". "I never saw a declaration of that
 *   type" and "I read that type's declaration and it is not an engine" are
 *   different facts, and until {@link nonEngineReason} existed the first one was
 *   spelled exactly like the second: `kind: 'other'`, subtracted from the
 *   population, exit 0, nothing said. Whether the missing declaration is
 *   untracked, generated or a dependency's, the honest report is the same
 *   sentence -- "I could not place this receiver's type" -- and it is produced
 *   there.
 *
 * {@link corpusTypeNames} is the other half of that answer, and it is keyed on the
 * SAME `trackedTs` call as the index ON PURPOSE. A diagnostic that could see more
 * of the tree than the index it reports on would answer "the corpus declares that
 * name" for a declaration the index was never able to read -- which is the one
 * answer that would make this quieter instead of louder.
 */
export const CORPUS_TYPE_DECL = /\b(?:interface|class|enum)\s+([A-Za-z_$][\w$]*)|\btype\s+([A-Za-z_$][\w$]*)\s*[=<]/g;

/**
 * Every type NAME the tracked corpus declares -- interface, class, enum and alias
 * names, and nothing else about them.
 *
 * Textual on purpose. The only question asked of this set is "does this repository
 * declare that name anywhere", it is asked of every non-engine receiver, and a
 * full parse of the tracked tree to collect identifiers the declaration keyword
 * already states would pay a hundredfold for an answer of the same quality.
 * Measured at 6520 files / 103 MB / 8154 names in 0.6 s, against the four sweeps
 * this module already makes over the same list.
 *
 * ⛔ It deliberately records neither WHERE nor WHAT SHAPE. "The door rule read
 * this declaration and said no" is what the index already answers; this set only
 * separates that from "no declaration of that name exists in the repository at
 * all".
 *
 * Zero names REFUSES (#4690): a sweep that read nothing would make every receiver
 * type look unplaceable, which is loud only by accident, and the accident would
 * read as a finding about the tree.
 */
export function corpusTypeNames(root = ROOT) {
  const names = new Set();
  for (const rel of trackedTs(root, ['packages', 'examples'])) {
    const text = readFileSync(join(root, rel), 'utf8');
    for (const m of text.matchAll(CORPUS_TYPE_DECL)) names.add(m[1] ?? m[2]);
  }
  if (names.size === 0) {
    throw new Error(
      'tenant-audit-census: the tracked corpus declares ZERO type names -- refusing to report '
      + 'every non-engine receiver as a type this census never saw. A sweep that read nothing '
      + 'and a corpus that declares nothing are different.',
    );
  }
  return names;
}

/**
 * When the corpus-scale numbers were true, and against which tree.
 *
 * ⛔ Read at CENSUS time, not at check time, and deliberately NOT compared by the
 * gate -- requiring it to be RECENT would re-introduce exactly the churn the
 * enforced/unenforced split removes. Its job is to tell a reader how old the
 * unenforced numbers are, not to be fresh.
 *
 * A tree whose HEAD cannot be read REFUSES rather than emitting a marker that
 * reads as a measurement and is not one (#4690).
 */
export function measuredAt(root = ROOT) {
  let ref;
  try {
    ref = execFileSync('git', ['-C', root, 'rev-parse', '--short=9', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(`tenant-audit-census: cannot read HEAD to date the corpus-scale numbers -- ${error.message}`);
  }
  if (!/^[0-9a-f]{7,40}$/.test(ref)) {
    throw new Error(`tenant-audit-census: HEAD did not resolve to a sha -- got ${JSON.stringify(ref)}`);
  }
  return { date: new Date().toISOString().slice(0, 10), ref };
}

/** Does this member declaration look like an ObjectQL data-engine door? */
function memberIsEngineDoor(member, sf) {
  const nm = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
  if (!nm) return false;
  const params = member.parameters ?? member.type?.parameters;
  if (!params || params.length === 0) return false;
  const p0 = params[0];
  if (!p0.name || !ts.isIdentifier(p0.name)) return false;
  if (!OBJECT_PARAM_NAMES.has(p0.name.text)) return false;
  const t = p0.type ? p0.type.getText(sf).replace(/\s+/g, '') : null;
  if (t !== 'string') return false;
  return { name: nm, isWrite: WRITE_VERBS.includes(nm) };
}

/** Every corpus-declared type whose shape is an ObjectQL data engine. */
export function buildEngineTypeIndex(root = ROOT) {
  const index = new Map(); // type name -> { decls, verbs }
  const files = trackedTs(root, ['packages', 'examples']);
  for (const rel of files) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (!/\b(insert|update|delete)\??\s*[(<]/.test(text)) continue;
    if (!/\b(object|objectName|objectApiName)\s*:\s*string/.test(text)) continue;
    const sf = parseSourceFile(rel, text);
    const visit = (node) => {
      let name = null;
      let members = null;
      if (ts.isInterfaceDeclaration(node)) {
        name = node.name.text;
        members = node.members;
      } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
        name = node.name.text;
        members = node.type.members;
      }
      if (name && members) {
        const verbs = [];
        let doors = 0;
        for (const m of members) {
          if (!ts.isMethodSignature(m) && !ts.isPropertySignature(m)) continue;
          const hit = memberIsEngineDoor(m, sf);
          if (!hit) continue;
          doors += 1;
          if (hit.isWrite) verbs.push(hit.name);
        }
        if (verbs.length > 0) {
          const prev = index.get(name);
          if (prev) prev.decls.push(rel);
          else index.set(name, { decls: [rel], verbs, doors });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // An interface that EXTENDS an engine-shaped interface inherits its doors
  // (`IObjectQLEngine extends IDataEngine`). Collected in its OWN sweep because
  // the derived declaration need not restate a single door, so the shape
  // prefilter above cannot see it -- and a receiver spelled with the derived
  // name is exactly the site a census must not lose.
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const rel of files) {
      const text = readFileSync(join(root, rel), 'utf8');
      if (!/\bextends\b/.test(text)) continue;
      let mentions = false;
      for (const known of index.keys()) if (text.includes(known)) { mentions = true; break; }
      if (!mentions) continue;
      const sf = parseSourceFile(rel, text);
      const visit = (node) => {
        if (ts.isInterfaceDeclaration(node) && !index.has(node.name.text)) {
          const bases = (node.heritageClauses ?? []).flatMap((h) => h.types
            .filter((t) => ts.isIdentifier(t.expression)).map((t) => t.expression.text));
          const engineBases = bases.filter((b) => index.has(b));
          if (engineBases.length > 0) {
            index.set(node.name.text, {
              decls: [rel],
              verbs: [...new Set(engineBases.flatMap((b) => index.get(b).verbs))],
              via: engineBases,
            });
            changed = true;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    if (!changed) break;
  }
  return index;
}


/** Type-reference names appearing anywhere inside a type node. */
function typeRefNames(node, sf) {
  const names = [];
  const walk = (n) => {
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) names.push(n.typeName.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return names;
}

/**
 * Aliases that NARROW an engine-shaped type -- `Partial<Pick<IDataEngine, ...>>`
 * and friends. Strict on purpose: every type reference in the alias must be
 * either an engine-shaped type or one of the mapped-type wrappers below, so an
 * alias that merely MENTIONS an engine type in some unrelated position is not
 * swept in. One pass, no transitive closure.
 */
const NARROWING_WRAPPERS = new Set(['Pick', 'Partial', 'Omit', 'Readonly', 'Required', 'NonNullable']);

export function widenIndexThroughAliases(index, root = ROOT) {
  const added = new Map();
  for (const rel of trackedTs(root, ['packages', 'examples'])) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (!/\btype\s+\w+\s*=/.test(text)) continue;
    let mentions = false;
    for (const known of index.keys()) if (text.includes(known)) { mentions = true; break; }
    if (!mentions) continue;
    const sf = parseSourceFile(rel, text);
    const visit = (node) => {
      if (ts.isTypeAliasDeclaration(node) && !ts.isTypeLiteralNode(node.type) && !index.has(node.name.text)) {
        const refs = typeRefNames(node.type, sf);
        const engineRefs = refs.filter((r) => index.has(r));
        const strayRefs = refs.filter((r) => !index.has(r) && !NARROWING_WRAPPERS.has(r));
        if (engineRefs.length > 0 && strayRefs.length === 0) {
          const picked = (node.type.getText(sf).match(/'(insert|update|delete)'/g) ?? []).map((q) => q.slice(1, -1));
          const verbs = picked.length > 0
            ? [...new Set(picked)]
            : [...new Set(engineRefs.flatMap((r) => index.get(r).verbs))];
          if (verbs.length > 0) added.set(node.name.text, { decls: [rel], verbs, via: engineRefs });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const [k, v] of added) index.set(k, v);
  return index;
}

/** Unwrap `x!`, `(x)`, `x as T`, `<T>x` down to the receiver expression. */
function unwrap(n) {
  if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) return unwrap(n.expression);
  if (ts.isAwaitExpression(n)) return unwrap(n.expression);
  if (ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n)) return n;
  return n;
}

/**
 * The node kinds that OPEN a lexical scope for the names declared under them.
 *
 * Deliberately the SYNTACTIC scopes rather than a resolver's idea of them: this
 * module has no type checker, and a chain of enclosing nodes is a fact it can
 * read off the tree it already parsed. `var` is the one binding this list is
 * wrong about -- it is function-scoped and recorded here at its block -- and the
 * file-wide tier in {@link scopedNames} is what keeps that from LOSING a site.
 */
function opensScope(node) {
  return ts.isSourceFile(node)
    || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)
    || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
    || ts.isCatchClause(node);
}

/**
 * The node kinds that own a `this` -- the scope a CLASS PROPERTY name lives in.
 *
 * A property is not a lexical name at all: `this.engine` inside a method of
 * class `B` means `B`'s `engine` and can mean nothing else, however many other
 * classes in the file spell the same property. So the chain for a property is
 * the chain of enclosing classes, and an arrow function or a block between the
 * site and its class is transparent to it -- exactly as `this` itself is.
 */
function opensClassScope(node) {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

/**
 * Where a CALLABLE'S OWN NAME is declared -- a RECORDING predicate, ⛔ not a
 * lookup one: the lexical scopes, plus every container whose members are NOT
 * lexical names -- the class, and the object literal.
 *
 * A method's name belongs to its class body, a function declaration's and a
 * `const fn = () => …`'s to the block or file that declares it -- so this is
 * {@link opensScope} with those containers added, and not either one alone.
 * ⛔ Not the same predicate as {@link opensClassScope}: a method named
 * `getEngine` is class-scoped, while a `function getEngine()` two lines above
 * the class is not, and a chain that saw only classes would lose the second one.
 *
 * ⭐ The object literal is on this list for the same reason the class is, and
 * omitting it cost the same site. `ts.isMethodDeclaration` is true for
 * `const o = { getEngine() {…} }` as well as for a class method, and an object
 * literal opens no lexical scope -- so such a method was recorded at the
 * enclosing BLOCK, and a bare `getEngine()` written in that block resolved to
 * it, which the language never does (the compiler reports `TS2304` for a name
 * declared only that way). ⇒ A member name is recorded under ITS CONTAINER, and
 * no lookup chain walks a container: {@link calleeScopeChain} reaches the class
 * for `this.m()` and nothing for the rest, so an object-literal method stays
 * reachable through the file-wide FLOOR exactly as it was before.
 *
 * ⭐ That reasoning answers WHERE A NAME IS DECLARED, and it is the whole
 * question only while a declaration is being recorded. A CALL SITE asks a
 * different question -- which declaration THIS call reaches -- and the answer
 * there is keyed on how the call is WRITTEN. ⛔ Reading a bare `getEngine()`
 * through this union is how a method came to shadow a file-level function that
 * the language would never let it shadow. {@link calleeScopeChain} is the
 * lookup-side predicate; the two are deliberately not the same function --
 * and BOTH halves are needed, because a chain that excludes a container cannot
 * help when the member was recorded outside that container in the first place.
 */
function opensCallableScope(node) {
  return opensScope(node) || opensClassScope(node) || ts.isObjectLiteralExpression(node);
}

/**
 * ⭐ The scope chain a CALL SITE resolves its callee through -- by how the call
 * is WRITTEN, which is not the question {@link opensCallableScope} answers.
 *
 * One map records every callable's name at the scope that declares it, and that
 * map is read from three different call shapes, each of which the language
 * resolves differently:
 *
 *   • `f()`      -- a BARE IDENTIFIER is a lexical name and nothing else. A
 *                    method lives on its prototype or its object, ⛔ never in
 *                    lexical scope, so no member container is on this chain: a
 *                    `class C { getEngine() {…} }` does not shadow a
 *                    `function getEngine()` for a call written `getEngine()`
 *                    inside `C`. Reading it through the class subtracted a real
 *                    engine write under the DEFENDED `platform-type` arm, which
 *                    prints nothing and is counted nowhere. ⚠️ Excluding the
 *                    container here is only half of that property: it also
 *                    depends on {@link opensCallableScope} RECORDING every
 *                    member name under its container, which is why an object
 *                    literal is on that predicate.
 *   • `this.m()` -- a method name, which belongs to the enclosing class exactly
 *                    as a property does, and to no lexical scope.
 *   • `x.m()`    -- a member of whatever `x` is, and this module has no index of
 *                    class members to read that off (interfaces and type-literal
 *                    aliases only, via {@link memberTypeOfShapes}, tried before
 *                    this chain). `null` ⇒ the file-wide FLOOR alone, which is
 *                    exactly what this receiver resolved through before there
 *                    were any scopes at all. ⛔ Not a placement this module can
 *                    justify -- it is the one it can defend as unchanged.
 */
function calleeScopeChain(callee) {
  if (ts.isIdentifier(callee)) return opensScope;
  if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return opensClassScope;
  }
  return null;
}

/**
 * The scopes enclosing a node, innermost first, under `opens`.
 *
 * A parameter's own scope is the FUNCTION (its `parent`), while a `const` in a
 * body belongs to that body's block -- so a receiver inside the body walks
 * block, then function, then outwards, and finds the parameter exactly where a
 * reader would look for it. `opens` is what makes the same walk answer for a
 * property (classes) and for a callable's name (both), because those names are
 * NOT scoped the way a local is and keying them as if they were is the defect.
 */
function scopeChainOf(node, opens = opensScope) {
  const chain = [];
  for (let p = node.parent; p; p = p.parent) if (opens(p)) chain.push(p);
  return chain;
}

/**
 * ⭐ Names declared in ONE file, resolved by SCOPE rather than by spelling.
 *
 * A bare-name map answers "what is `engine` in this file?", and a file may
 * contain several. Two parameters named `engine` in different functions are two
 * declarations; keyed on the identifier alone they are one, and the first typed
 * one decides for both. Measured, that is not one failure but three, and only
 * the first of them is loud:
 *
 *   • a `Map.delete(k)` in the second function scored as an ENGINE WRITE and
 *     admitted to the certified tenancy population -- an over-count,
 *   • the SAME pair in the other declaration order: a real engine write scored
 *     `platform-type` and subtracted under a DEFENDED arm, which prints nothing
 *     and is counted nowhere -- the silent direction this census must never
 *     fail in, and
 *   • both sites refused together when the winning entry is one the door rule
 *     cannot place.
 *
 * ⇒ Two tiers, in this order. The LEXICAL tier is the answer: the innermost
 *   enclosing scope that declares the name wins, which is what the language
 *   does. The FILE-WIDE tier is a floor, not a second opinion -- it holds
 *   exactly what the bare-name map held before, and it is consulted only when
 *   no enclosing scope declares the name at all. ⛔ So no receiver that resolved
 *   before stops resolving: a repair that traded a false placement for a LOST
 *   engine write would be the expensive direction wearing the other costume.
 */
function scopedNames(opens = opensScope) {
  const byScope = new Map(); // scope node -> Map<name, entry>
  const flat = new Map(); // name -> entry -- the file-wide tier
  const scopeMap = (declNode) => {
    const scope = scopeChainOf(declNode, opens)[0] ?? null;
    let m = byScope.get(scope);
    if (!m) { m = new Map(); byScope.set(scope, m); }
    return m;
  };
  return {
    /** Record a declaration, first TYPED spelling winning within each tier. */
    note(declNode, name, entry) {
      const m = scopeMap(declNode);
      if (!(m.has(name) && m.get(name).type)) m.set(name, entry);
      if (!(flat.has(name) && flat.get(name).type)) flat.set(name, entry);
    },
    /** Record a declaration that OVERRIDES whatever was there (destructuring). */
    set(declNode, name, entry) {
      scopeMap(declNode).set(name, entry);
      flat.set(name, entry);
    },
    /**
     * The declaration `name` refers to AT `node` -- lexical tier, then the floor.
     *
     * `chain` defaults to the predicate this map RECORDS under, which is the
     * right answer wherever the name is looked up the same way it is declared.
     * A callable's name is not: it is recorded where it is declared and read by
     * how the call is written, so {@link resolveReceiver} passes the chain from
     * {@link calleeScopeChain} instead. `null` asks for the FLOOR alone.
     */
    lookup(name, node, chain = opens) {
      if (node && chain) {
        for (const scope of scopeChainOf(node, chain)) {
          const hit = byScope.get(scope)?.get(name);
          if (hit) return hit;
        }
      }
      return flat.get(name);
    },
  };
}

/**
 * Declared types visible in ONE file, keyed the way a receiver spells itself.
 *
 * ⭐ THREE name maps, THREE scope notions -- and not one of them is "the file".
 * A class property belongs to its CLASS (`this.engine` in class `B` is `B`'s and
 * can be nothing else), a callable's name to whatever declares it (a class body
 * for a method, the enclosing block or file for a function), and a local to its
 * lexical scope. All three were once keyed on the bare identifier, which is one
 * defect stated three times: two classes in one file sharing a property name
 * were ONE entry, and the first TYPED one decided for both.
 *
 * ⇒ Each map is a {@link scopedNames} under the predicate that matches how the
 *   language scopes that kind of name, and each keeps that structure's file-wide
 *   FLOOR, so a name no enclosing scope declares resolves exactly where it used
 *   to. ⛔ The repair may not cost a single site that resolved before: a fix that
 *   traded a false placement for a LOST engine write would be the expensive
 *   direction wearing the other costume.
 */
export function declaredTypesIn(sf) {
  const thisProps = scopedNames(opensClassScope);
  const locals = scopedNames();
  const fnReturns = scopedNames(opensCallableScope);
  // `TypeName -> member -> declared type` for shapes declared in THIS file, so
  // `deps.getDataEngine()` and `opts.engine` resolve without a type checker.
  const shapes = new Map();
  // Identifiers imported from a `node:` builtin -- never an engine.
  const builtins = new Set();
  // ⭐ The declared type text is stored EXACTLY as the source spells it. It is
  // re-parsed later as a synthetic type alias to read the door rule off it, and
  // a type literal may separate its members by a newline alone -- legal
  // TypeScript, which a whitespace collapse turns into no separator at all. The
  // collapse belongs at the PRESENTATION boundary, where `runCensus` and
  // `cell()` already apply it, never at the one where the text is stored to be
  // read back. `init` is a different thing and keeps its collapse: it is a
  // diagnostic, truncated to 120 characters, and nothing ever re-parses it.
  const entryOf = (typeNode, initializer) => ({
    type: typeNode ? typeNode.getText(sf) : null,
    init: initializer ? initializer.getText(sf).replace(/\s+/g, ' ').slice(0, 120) : null,
    node: initializer ?? null,
    literal: initializer && ts.isStringLiteralLike(initializer) ? initializer.text : null,
  });
  // ⛔ There is no bare-key spelling left to reach for. Every one of the three
  // maps is recorded AT THE NODE that declares the name, because that node is
  // the only thing that says which scope the name belongs to -- and a helper
  // that could still be called without it is a helper the next author will call
  // without it.
  const note = (map, declNode, key, typeNode, initializer) => {
    map.note(declNode, key, entryOf(typeNode, initializer));
  };
  const noteLocal = (declNode, key, typeNode, initializer) => note(locals, declNode, key, typeNode, initializer);
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)
        && /^node:/.test(n.moduleSpecifier.text)) {
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const el of b.elements) builtins.add(el.name.text);
      if (n.importClause?.name) builtins.add(n.importClause.name.text);
    }
    if (ts.isInterfaceDeclaration(n) || (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type))) {
      const members = ts.isInterfaceDeclaration(n) ? n.members : n.type.members;
      const m = new Map();
      for (const mem of members) {
        if (!mem.name || !ts.isIdentifier(mem.name)) continue;
        const t = ts.isMethodSignature(mem) ? mem.type : mem.type;
        if (t) m.set(mem.name.text, t.getText(sf));
      }
      shapes.set(n.name.text, m);
    }
    if (ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name)) note(thisProps, n, n.name.text, n.type, n.initializer);
    if (ts.isParameter(n) && ts.isIdentifier(n.name)) {
      if (ts.isConstructorDeclaration(n.parent) && n.modifiers?.length) note(thisProps, n, n.name.text, n.type, n.initializer);
      noteLocal(n, n.name.text, n.type, n.initializer);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      // `const getData = (): IDataEngine | undefined => …` -- the RETURN type is
      // what a caller of `getData()` receives, not what `getData` itself is.
      const init = n.initializer;
      if (!n.type && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.type) {
        note(fnReturns, n, n.name.text, init.type, null);
      }
      noteLocal(n, n.name.text, n.type, n.initializer);
    }
    // `const { engine, cryptoProvider } = deps;` -- the member's declared type on
    // the base's own shape. Losing these loses REAL engine sites, which is the
    // one direction a census must never fail in.
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name)) {
      const baseText = n.type ? n.type.getText(sf)
        : (n.initializer && ts.isIdentifier(n.initializer) ? locals.lookup(n.initializer.text, n)?.type : null);
      for (const el of n.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        const mt = memberTypeOfShapes(baseText, prop, shapes);
        if (mt) locals.set(n, el.name.text, { type: mt, init: null, node: null });
        else if (n.initializer && ts.isAwaitExpression(n.initializer)
                 && ts.isCallExpression(n.initializer.expression)
                 && n.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword
                 && ts.isStringLiteralLike(n.initializer.expression.arguments[0])
                 && /^node:/.test(n.initializer.expression.arguments[0].text)) {
          builtins.add(el.name.text);
        }
      }
    }
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
      note(fnReturns, n, n.name.text, n.type, null);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { thisProps, locals, fnReturns, shapes, builtins };
}

/** The declared type of `<base>.<member>` when `base`'s shape is in this file. */
function memberTypeOfShapes(baseTypeText, member, shapes) {
  if (!baseTypeText) return null;
  for (const id of baseTypeText.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    const shape = shapes.get(id);
    if (shape?.has(member)) return shape.get(member);
  }
  return null;
}

function memberTypeOf(baseTypeText, member, decls) {
  return memberTypeOfShapes(baseTypeText, member, decls.shapes);
}

/** How a receiver spells itself, for ledger keys and diagnostics. */
export function receiverKey(node, sf) {
  return node.getText(sf).replace(/\s+/g, ' ');
}

/** Resolve a receiver expression to an engine-shaped type name, or a reason it is not one. */
export function resolveReceiver(recvNode, sf, decls, index, depth = 0) {
  const r = unwrap(recvNode);
  if (depth > 4) return { kind: 'unresolved', how: 'depth' };
  const nameOf = (typeText) => {
    if (!typeText) return null;
    for (const id of typeText.match(/[A-Za-z_$][\w$]*/g) ?? []) if (index.has(id)) return id;
    return null;
  };
  const fromEntry = (entry, how) => {
    if (!entry) return { kind: 'unresolved', how };
    const t = nameOf(entry.type);
    if (t) return { kind: 'engine', type: t, how };
    // ⛔ `any` / `unknown` is NOT a classification. A receiver the author erased
    // is a receiver this census could not read, and a census must never score
    // what it could not read as "nothing to report" -- it goes to the ledger.
    if (entry.type && /^(any|unknown)$/.test(entry.type.trim())) {
      return { kind: 'unresolved', how: `${how}:any`, detail: entry.type };
    }
    if (entry.type) return inlineEngineDoorOrOther(entry.type, how, sf);
    if (entry.init) {
      const t2 = nameOf(entry.init);
      if (t2) return { kind: 'engine', type: t2, how: `${how}/init` };
      const ctor = /^new\s+([A-Za-z_$][\w$.]*)/.exec(entry.init);
      if (ctor) {
        const t3 = nameOf(ctor[1]);
        if (t3) return { kind: 'engine', type: t3, how: `${how}/new` };
        return { kind: 'other', type: `new ${ctor[1]}`, how: `${how}/new` };
      }
      if (entry.node) {
        const via = resolveReceiver(entry.node, sf, decls, index, depth + 1);
        if (via.kind !== 'unresolved') return { ...via, how: `${how}/${via.how}` };
      }
      return { kind: 'unresolved', how: `${how}/init`, detail: entry.init };
    }
    return { kind: 'unresolved', how };
  };
  if (ts.isAsExpression(r)) {
    const t = nameOf(r.type.getText(sf));
    if (t) return { kind: 'engine', type: t, how: 'as' };
    // `as any` / `as unknown` erase nothing about the VALUE -- keep walking the
    // operand, or a cast would hide a real engine receiver from the census.
    const erasing = /^(any|unknown)$/.test(r.type.getText(sf).trim());
    if (erasing) {
      const via = resolveReceiver(r.expression, sf, decls, index, depth + 1);
      if (via.kind !== 'unresolved') return { ...via, how: `as-any/${via.how}` };
      return { kind: 'unresolved', how: 'as-any', detail: receiverKey(r.expression, sf) };
    }
    return inlineEngineDoorOrOther(r.type.getText(sf), 'as', sf);
  }
  if (ts.isPropertyAccessExpression(r) && r.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return fromEntry(decls.thisProps.lookup(r.name.text, r), `this.${r.name.text}`);
  }
  if (ts.isIdentifier(r)) {
    if (decls.builtins.has(r.text)) return { kind: 'other', type: `node: builtin ${r.text}`, how: 'node-import' };
    return fromEntry(decls.locals.lookup(r.text, r), r.text);
  }
  // `opts.engine`, `this.options.persistence` -- resolved through the shape the
  // base's own declared type gives the member.
  if (ts.isPropertyAccessExpression(r)) {
    const baseText = ts.isPropertyAccessExpression(r.expression) && r.expression.expression.kind === ts.SyntaxKind.ThisKeyword
      ? decls.thisProps.lookup(r.expression.name.text, r.expression)?.type
      : ts.isIdentifier(r.expression) ? decls.locals.lookup(r.expression.text, r.expression)?.type : null;
    const mt = memberTypeOf(baseText, r.name.text, decls);
    if (mt) {
      const t = nameOf(mt);
      if (t) return { kind: 'engine', type: t, how: `member ${r.name.text}` };
      return inlineEngineDoorOrOther(mt, `member ${r.name.text}`, sf);
    }
  }
  if (ts.isCallExpression(r)) {
    const callee = r.expression;
    const fname = ts.isIdentifier(callee) ? callee.text
      : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
    const generic = r.typeArguments?.length ? nameOf(r.typeArguments[0].getText(sf)) : null;
    if (generic) return { kind: 'engine', type: generic, how: `${fname}<>` };
    if (ts.isIdentifier(callee) && decls.builtins.has(callee.text)) {
      return { kind: 'other', type: `node: builtin ${callee.text}()`, how: 'node-import' };
    }
    // `deps.getDataEngine()` / `service.getAdapter(...)` -- the member's declared
    // RETURN type, read off the base's own shape.
    if (ts.isPropertyAccessExpression(callee)) {
      const baseText = callee.expression.kind === ts.SyntaxKind.ThisKeyword
        ? null
        : ts.isIdentifier(callee.expression) ? decls.locals.lookup(callee.expression.text, callee.expression)?.type : null;
      const mt = memberTypeOf(baseText, callee.name.text, decls);
      if (mt) {
        const t = nameOf(mt);
        if (t) return { kind: 'engine', type: t, how: `${fname}() return` };
        return inlineEngineDoorOrOther(mt, `${fname}() return`, sf);
      }
    }
    const entry = fname ? decls.fnReturns.lookup(fname, callee, calleeScopeChain(callee)) : null;
    if (entry) return fromEntry(entry, `${fname}()`);
    return { kind: 'unresolved', how: 'call', detail: receiverKey(r, sf) };
  }
  if (r.kind === ts.SyntaxKind.ThisKeyword) return { kind: 'unresolved', how: 'this' };
  return { kind: 'unresolved', how: ts.SyntaxKind[r.kind], detail: receiverKey(r, sf) };
}

/**
 * Names whose DECLARATION belongs to the language, not to this corpus.
 *
 * A receiver typed `Map<string, X>` is not a type this census failed to place: it
 * is a language global, and the reason it is not a data engine is that nothing in
 * this repository could make it one. Listing them keeps them OUT of the undefended
 * pile, and the undefended pile is only useful while it is small enough that a
 * real entry is visible in it.
 *
 * ⛔ This is NOT a list of "types that are fine". It is a list of names this
 * corpus cannot declare. A DEPENDENCY's type is deliberately absent: this module
 * cannot read `node_modules`, so a dependency's type is one it could not place,
 * and saying so is the honest answer rather than an inconvenience to suppress.
 */
export const PLATFORM_TYPES = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'ReadonlyArray', 'Promise', 'PromiseLike',
  'Date', 'RegExp', 'Error', 'Function', 'Object', 'String', 'Number', 'Boolean', 'Symbol',
  'BigInt', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Float32Array',
  'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer', 'Blob', 'File',
  'Headers', 'Request', 'Response', 'FormData', 'URL', 'URLSearchParams', 'AbortSignal',
  'Iterable', 'AsyncIterable', 'Iterator', 'IteratorResult', 'Generator', 'AsyncGenerator',
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'Parameters', 'ReturnType', 'Awaited', 'InstanceType', 'ThisType',
]);

/** Type-syntax words a type text can contain that are not type NAMES. */
const TYPE_SYNTAX_WORDS = new Set([
  'string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'any', 'unknown', 'never',
  'void', 'null', 'undefined', 'this', 'readonly', 'keyof', 'typeof', 'infer', 'in', 'is',
  'asserts', 'extends', 'new', 'import', 'true', 'false', 'unique', 'declare', 'abstract',
]);

/**
 * ⭐ WHY a write call was subtracted as non-engine -- a CLOSED set in which exactly
 * three arms admit the census could not tell.
 *
 * The subtraction itself is old and correct: a same-named call on something that is
 * not a data engine must not enter a tenancy population, and `.delete()` alone
 * answers ~250 sites in this corpus. What was missing is that ONE of these eight
 * answers was reaching the count for two incompatible reasons. `kind: 'other'` was
 * produced both by "I read the receiver's declared type and it is a `Set`" and by
 * "I looked the receiver's declared type up and the index does not hold it" -- and
 * an index built from tracked files alone does not hold a type whose declaration is
 * untracked, generated, or a dependency's. Same row, same exit code, no diagnostic:
 * the population shrank, and the part that shrank was invisible.
 *
 * ⇒ Five arms name a fact that DEFENDS the subtraction. Three -- `type-not-in-corpus`,
 *   `anonymous-type` and `type-text-not-round-trippable` -- say the census could not
 *   place the receiver's type, and those are reported per site, in both artefacts, by
 *   receiver and by the type text it could not place. ⛔ A subtraction is never *withdrawn* on this basis: that
 *   would be the census guessing in the other direction. It is DECLARED.
 *
 * ⚠️ `anonymous-type` is now the RESIDUE of a rule that runs first: an inline type
 * literal whose own text states a write door is placed by
 * {@link inlineEngineDoorOrOther} and never reaches here, so what lands on this arm
 * is an unnamed type the door rule read and rejected. Its `doorShaped` flag is
 * therefore 0 in both artefacts by construction, and is kept as that invariant's
 * alarm rather than as a running count.
 */
export const NON_ENGINE_REASONS = Object.freeze({
  'builtin-import': 'the receiver is an identifier imported from a `node:` builtin',
  'constructed-locally': "the receiver's own initializer is a `new X` this corpus can read",
  'platform-type': 'the declared type is a language global, which this corpus cannot declare',
  'corpus-type': 'the declared type names a type THIS CORPUS DECLARES -- the door rule read that declaration and said no',
  'ledger-row': 'an `UNTYPED_RECEIVERS` row says what the receiver is',
  'type-not-in-corpus': '⚠️ UNDEFENDED -- no declaration of that name exists in the TRACKED corpus (untracked, generated, or a dependency\'s)',
  'anonymous-type': '⚠️ UNDEFENDED -- the declared type is an inline literal, so there is no name for the index to be keyed on',
  'type-text-not-round-trippable': '⚠️ UNDEFENDED -- this tool derived a type text it cannot re-parse as a type alias, so the door rule could not be read off it at all -- a defect in the census, not a fact about the corpus',
});

/**
 * The three arms that admit the census could not place the receiver's type.
 *
 * ⭐ The third is not a variant of the first two. They say the type could not be
 * looked UP; it says the census could not READ BACK its own stored spelling of
 * that type, which is a fact about this tool rather than about the corpus -- and
 * it is the one arm `censusRefusals` in `check-tenant-audit-census.mjs` REFUSES
 * on, because the alternative to a process-wide exit must be a loud per-site
 * verdict and never a quiet subtraction.
 */
export const UNDEFENDED_REASONS = Object.freeze([
  'type-not-in-corpus', 'anonymous-type', 'type-text-not-round-trippable',
]);

/**
 * The subtractions whose stored type text did not round-trip, in ONE spelling.
 *
 * Read by this module's `main()` for its diagnostics and exit code and by
 * `check-tenant-audit-census.mjs` for its refusal, because two spellings of
 * "which sites are these" is how the generator and its gate drift apart.
 */
export function notRoundTrippableSites(census) {
  return (census.undefendedSubtractions ?? []).filter((u) => u.reason === 'type-text-not-round-trippable');
}

/**
 * Does this receiver's type text itself declare an ObjectQL write door?
 *
 * The same rule as {@link memberIsEngineDoor}, applied to a type that has no name
 * -- deliberately the same function rather than a second reading of the same rule,
 * because two spellings of "what an engine door looks like" is how the two drift.
 *
 * ⭐ A `true` here is the sharpest thing this diagnostic can say: the census
 * subtracted a write call whose receiver type satisfies its OWN definition of an
 * engine, and the only reason it did is that the definition was applied to NAMED
 * declarations while this type is spelled inline. It is now ACTED ON --
 * {@link inlineEngineDoorOrOther} places such a receiver instead of subtracting it
 * -- and this predicate is kept as that invariant's alarm: a door-shaped
 * subtraction reaching the artefacts means the placement rule has a hole again.
 */
export function typeTextDeclaresEngineDoor(typeText, origin) {
  return readTypeTextDoor(typeText, origin).door;
}

/**
 * The door rule read off a type text, with the ROUND TRIP reported separately.
 *
 * Three verdicts, not two: the text states a write door, it states none, or the
 * census could not read back the text it stored -- and the third is the one this
 * reader exists to keep distinguishable. The source the text came from parsed
 * and this module read it, so a synthesis of it that does not parse is a fact
 * about THIS TOOL's re-serialisation and never about the corpus. The collapse
 * that used to make it fail on a newline-separated type literal is gone --
 * {@link declaredTypesIn} stores the text as written -- and the verdict stays
 * because "this tool could not read its own derived text" needs somewhere to
 * land whatever the next cause turns out to be.
 *
 * ⇒ so the synthesis goes through `parseDerivedText`, whose failure comes BACK
 *   ({@link https://github.com/objectstack-ai/objectstack/issues/19077}). ⛔ It is
 *   not a `false`: a `false` here is "read it, no write door", and answering that
 *   about text nobody could read is the quiet subtraction this card refuses.
 *   Callers branch on `failure` and the census declares the site.
 *
 * ⚠️ The verb gate runs FIRST and is unchanged, so a type text naming no write
 * verb is never synthesised, never parsed, and cannot reach this arm -- the
 * repair's reach is exactly the defect's reach.
 *
 * @param {string} typeText  The declared type text, as {@link declaredTypesIn} stored it.
 * @param {ts.SourceFile} origin  The tree that text was read out of, as
 *   `parseSourceFile` returned it. `parseDerivedText` refuses an origin this
 *   process never certified, so an unreadable SOURCE cannot reach the returnable
 *   door -- by construction, not by review.
 * @returns {{ door: boolean, failure: null|{ message: string, line: number,
 *   column: number, count: number, report: string } }}
 */
export function readTypeTextDoor(typeText, origin) {
  if (typeof typeText !== 'string' || !/\b(insert|update|delete)\b/.test(typeText)) {
    return { door: false, failure: null };
  }
  const derived = parseDerivedText(origin, 'census-receiver-type.ts', `type CensusReceiver = ${typeText};\n`);
  if (derived.failure) return { door: false, failure: derived.failure };
  const sf = derived.sourceFile;
  let door = false;
  const visit = (node) => {
    if (ts.isTypeLiteralNode(node)) {
      for (const m of node.members) {
        if (!ts.isMethodSignature(m) && !ts.isPropertySignature(m)) continue;
        const hit = memberIsEngineDoor(m, sf);
        if (hit && hit.isWrite) door = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { door, failure: null };
}

/**
 * What {@link runCensus} records as the engine type of a receiver placed by its
 * own inline type literal rather than by a name in the index.
 *
 * Deliberately a SENTENCE and not a type name, because there is no name -- the
 * index is keyed on names and this receiver has none. `--json` is where a reader
 * navigating one site learns which rule placed it; the enforced artefacts
 * aggregate by (file, verb, object, tenancy, context posture) and never render
 * this text, so its wording cannot move a count.
 */
const INLINE_ENGINE_TYPE = 'inline type literal stating an engine door';

/**
 * A declared type text that names no indexed engine, judged ONE more time -- by
 * the door rule read off the text itself.
 *
 * {@link buildEngineTypeIndex} is keyed on declaration NAMES, so an inline type
 * literal cannot be in the index however plainly it declares a write door.
 * Answering `kind: 'other'` on that basis is the census answering "not an engine"
 * to a question it never asked, and it fails in the expensive direction: the site
 * is SUBTRACTED from the certified population. Two sites on a clean tree were
 * exactly that, both writing under `{ context: { isSystem: true } }`.
 *
 * ⛔ This is not a second reading of "what an engine door looks like". It calls
 * {@link typeTextDeclaresEngineDoor}, which calls {@link memberIsEngineDoor} -- the
 * one function that answers that question for a named declaration too. Two
 * spellings of the rule is how the two drift.
 *
 * ⚠️ Reached ONLY after {@link resolveReceiver} has failed to find an indexed name
 * in the type text, so a named engine type still wins and still reports its own
 * name. The `how` gains an `/inline-door` suffix for anyone tracing a resolution;
 * ⛔ `how` is not carried onto a PLACED site, so what `--json` shows for one of
 * these is its `engineType`, the sentence above.
 */
function inlineEngineDoorOrOther(typeText, how, origin) {
  if (typeTextDeclaresEngineDoor(typeText, origin)) {
    return { kind: 'engine', type: INLINE_ENGINE_TYPE, how: `${how}/inline-door` };
  }
  return { kind: 'other', type: typeText, how };
}

/**
 * Which arm of {@link NON_ENGINE_REASONS} this non-engine verdict rests on.
 *
 * Reads only what {@link resolveReceiver} already returned plus the tracked
 * corpus's type-name set, so it cannot reach a fact the classifier itself could
 * not reach, and it can never move a verdict -- it explains one.
 */
export function nonEngineReason(res, typeNames, origin) {
  const raw = typeof res?.type === 'string' ? res.type : '';
  if (raw.startsWith('node: builtin')) return { reason: 'builtin-import', names: [], doorShaped: false, failure: null };
  if (/^new\s/.test(raw) || /\/new$/.test(String(res?.how ?? ''))) {
    return { reason: 'constructed-locally', names: [], doorShaped: false, failure: null };
  }
  // ⭐ The door rule is read ONCE here, and its round-trip verdict is read BEFORE
  // any arm is chosen. A type text this census stored and cannot read back is not
  // an index miss and not "an inline literal the door rule rejected" -- both of
  // those are answers about a text somebody read. ⛔ Folding it into either would
  // subtract the site under a reason that is false about it, which is the silent
  // half of the failure this arm exists to make loud.
  const read = readTypeTextDoor(raw, origin);
  if (read.failure) {
    return { reason: 'type-text-not-round-trippable', names: [], doorShaped: false, failure: read.failure };
  }
  // String literals inside a type (an `import('…')` specifier, a literal union)
  // carry no type NAMES, and their words would read as unplaceable identifiers.
  const text = raw.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
  if (text.includes('{')) {
    return { reason: 'anonymous-type', names: [], doorShaped: read.door, failure: null };
  }
  const ids = [...new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])]
    .filter((id) => !PLATFORM_TYPES.has(id) && !TYPE_SYNTAX_WORDS.has(id));
  if (ids.length === 0) return { reason: 'platform-type', names: [], doorShaped: false, failure: null };
  const unseen = ids.filter((id) => !typeNames.has(id));
  if (unseen.length === 0) return { reason: 'corpus-type', names: ids, doorShaped: false, failure: null };
  return { reason: 'type-not-in-corpus', names: unseen, doorShaped: false, failure: null };
}

/**
 * ⭐ WHAT COUNTS AS A DECLARED OBJECT -- the definition, written down here
 * because the walk that preceded it had none.
 *
 * A declared object is a **top-level object declaration** in a `*.object.ts(x)`
 * file: a `const` / `export const` whose initializer is an object literal, or a
 * call whose first object-literal argument is one -- `ObjectSchema.create({…})`,
 * the only spelling in this corpus today -- and that literal carries a `name:`
 * string literal. ⛔ A literal NESTED inside that declaration is never one, at
 * any depth.
 *
 * ## Why DEPTH is the whole rule
 *
 * `name:` is not this corpus's object-identity key alone. It is also the grid
 * column identity (`inlineColumns: [{ name: 'quantity' }, …]`), the validation
 * rule id (`validationRules: [{ name: 'discount_cap' }, …]`), the action name,
 * the list-view name and the index name. The walk this replaces recursed into
 * every object literal unconditionally and recorded every `name:` matching
 * `/^[a-z][a-z0-9_]*$/`, so it recorded all of those too: 300 "declared
 * objects" out of 112 object files that declare 117 (#17663).
 *
 * ⭐⭐ The damage was NOT confined to a printed figure. This name set is the
 * census's discriminator for `any`-typed receivers: {@link runCensus}'s RESCUE
 * promotes an `unresolved` write call to `engine` -- that is, to PLACED --
 * exactly when its first argument names something in this set. Over-matching
 * therefore WIDENS the predicate that decides whether a write call site is
 * placed at all, and `quantity`, `amount`, `receipt` and `discount_cap` were in
 * it. The same set answers each placed site's tenancy posture
 * (`enabled` / `disabled` / `undeclared-name`), so a name in the set by accident
 * answers that question by accident too.
 *
 * ⇒ The rule is the DECLARATION SITE, not a callee name. Keying on
 *   `ObjectSchema.create` would make the registry a function of one helper's
 *   identifier; keying on the top-level declaration keeps it a fact about the
 *   file's shape, which is what "declares an object" means.
 *
 * ⛔ A `*.object.ts(x)` file this finds nothing in REFUSES rather than
 * contributing nothing -- see {@link declaredObjects}. Silently contributing
 * nothing is the direction that shrinks the RESCUE set, and a shrunk set
 * un-places live write call sites; absence has to be loud here.
 */
export function topLevelObjectDeclarations(sf) {
  const found = [];
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      let init = decl.initializer;
      while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)
             || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(init)))) init = init.expression;
      if (init && ts.isCallExpression(init)) init = init.arguments.find((a) => ts.isObjectLiteralExpression(a));
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      const entry = readDeclarationLiteral(init);
      if (entry) found.push(entry);
    }
  }
  return found;
}

/**
 * The two facts a declaration literal carries: its `name` and whether it opts
 * out of tenancy. ⛔ Reads the literal's OWN properties and does not descend --
 * descending is the defect {@link topLevelObjectDeclarations} exists to stop.
 */
function readDeclarationLiteral(lit) {
  let name = null;
  let tenancyDisabled = false;
  for (const prop of lit.properties) {
    if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : null;
    if (key === 'name' && ts.isStringLiteralLike(prop.initializer)) name = prop.initializer.text;
    if (key === 'tenancy' && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const q of prop.initializer.properties) {
        if (ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && q.name.text === 'enabled'
            && q.initializer.kind === ts.SyntaxKind.FalseKeyword) tenancyDisabled = true;
      }
    }
  }
  return name ? { name, tenancyDisabled } : null;
}

/**
 * Every object the tree DECLARES, with its tenancy posture.
 *
 * {@link topLevelObjectDeclarations} is the definition of "declares"; this
 * applies it to every `*.object.ts(x)` in the tree and keeps the machine names.
 *
 * The name set doubles as the census's discriminator for `any`-typed receivers
 * -- see {@link runCensus}.
 */
export function declaredObjects(root = ROOT) {
  const objects = new Map();
  for (const rel of trackedTs(root, ['packages', 'examples'])) {
    if (!/\.object\.tsx?$/.test(rel)) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    const sf = parseSourceFile(rel, text);
    const declarations = topLevelObjectDeclarations(sf);
    if (declarations.length === 0) {
      throw new Error(
        `tenant-audit-census: ${rel} is named *.object.ts(x) but declares no TOP-LEVEL object -- `
        + 'refusing to walk past it. Every object file in this corpus declares its objects as '
        + '`export const X = ObjectSchema.create({ name: … })` at file scope; a declaration this '
        + 'cannot see is one the RESCUE in runCensus() can no longer place, which un-places live '
        + 'write call sites rather than merely lowering a count. Either declare the object at file '
        + 'scope, or teach topLevelObjectDeclarations() the new spelling in the same change.',
      );
    }
    for (const { name, tenancyDisabled } of declarations) {
      if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
      if (!objects.has(name)) objects.set(name, { file: rel, tenancyDisabled });
      else if (tenancyDisabled) objects.set(name, { file: rel, tenancyDisabled: true });
    }
  }
  if (objects.size === 0) {
    throw new Error(
      'tenant-audit-census: the object registry resolved to ZERO declarations -- refusing to '
      + 'classify tenancy against nothing (a walk that found no objects and a tree with no '
      + 'objects are different).',
    );
  }
  return objects;
}

/**
 * What execution context, if any, this write call threads -- and whether that
 * context is ELEVATED.
 *
 * ## ⛔ Three answers, because "I could not read it" is not "there is none"
 *
 * `carries` is `true` / `false` / `'undecidable'`, and the third value is
 * load-bearing. The first edition had two, and folded an unreadable options
 * argument -- `engine.update(object, data, options)` inside a forwarding shim,
 * `{ ...opts }`, a variable -- into `false`. That published **84 sites
 * "carrying NO tenant context at all"** when only 17 of them said so; the other
 * 67 were arguments the walker could not read.
 *
 * ⭐ That is an over-claim in the ALARMING direction, on the one figure this page
 * tells other cards to cite. It is the same failure this whole artefact exists
 * to stop, wearing the opposite hat: not a population under-counted into
 * silence, but an unknown published as a finding. A number that cannot tell
 * "provably unscoped" from "unread" is not evidence of anything.
 *
 * So:
 *   - `false`        -- the options argument was READ and holds no context: an
 *                       object literal with no `context` / `tenantId` key, or no
 *                       options argument at all. This is the control's real
 *                       yield surface.
 *   - `'undecidable'` -- an options argument this cannot read. It may carry a
 *                       context; a static reading cannot say.
 *   - `true`         -- a `context` or `tenantId` key is there.
 *
 * A spread inside an otherwise readable literal makes the answer undecidable for
 * the same reason it does in {@link elevationOf}: the spread may carry the key
 * the literal never names.
 */
export function tenantContextOf(node, sf, decls) {
  const args = node.arguments.slice(1);
  if (args.length === 0) return { carries: false, how: 'no-options-argument', system: false };
  let opaque = null;
  let spread = null;
  for (const a of args) {
    if (ts.isObjectLiteralExpression(a)) {
      for (const prop of a.properties) {
        if (ts.isSpreadAssignment(prop)) { spread = prop.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 40); continue; }
        const key = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) ? prop.name.text : null;
        if (key === 'context') {
          const value = ts.isPropertyAssignment(prop) ? prop.initializer : null;
          return { carries: true, how: 'options.context', system: elevationOf(value, sf, decls) };
        }
        if (key === 'tenantId') return { carries: true, how: 'options.tenantId', system: false };
      }
    } else if (!ts.isStringLiteralLike(a) && !ts.isNumericLiteral(a)
               && a.kind !== ts.SyntaxKind.TrueKeyword && a.kind !== ts.SyntaxKind.FalseKeyword) {
      opaque = a.getText(sf).replace(/\s+/g, ' ').slice(0, 60);
    }
  }
  if (opaque) return { carries: 'undecidable', how: 'options-argument-unreadable', opaque, system: 'undecidable' };
  if (spread) return { carries: 'undecidable', how: 'options-spread-unreadable', opaque: spread, system: 'undecidable' };
  return { carries: false, how: 'no-context-key', system: false };
}

/**
 * Is this context expression an ELEVATED (`isSystem: true`) one?
 *
 * ## ⛔ A SPREAD is not evidence of absence
 *
 * The first edition of this walked an object literal's named properties looking
 * for `isSystem`, skipped anything that was not a `PropertyAssignment`, and
 * returned `false` when the loop ended. A `SpreadAssignment` carries no `name`,
 * so `{ ...SYSTEM_CTX }` fell through every branch and was reported as
 * **decidably NOT elevated** -- the exact opposite of the truth, since every
 * `SYSTEM_CTX` in the tree is `{ isSystem: true, … }`.
 *
 * That is the worst direction a classifier can fail in, and it is this repo's
 * recurring shape: a thing the walker could not read, scored as a thing with
 * nothing to report. It was measured, not reasoned about -- six sites across
 * `service-storage` were published as "decidably not elevated" while all six
 * spread an elevated context.
 *
 * So a spread is resolved, and an unresolvable one makes the whole answer
 * `undecidable`. It can never contribute `false`.
 *
 * `as const` is unwrapped on the way: the constants this has to read are
 * declared `{ isSystem: true } as const`, which is an `AsExpression` wrapping
 * the literal, not a literal.
 */
function elevationOf(value, sf, decls, depth = 0) {
  if (value == null || depth > 4) return 'undecidable';

  /** `{ … } as const` / `({ … })` down to the literal. */
  const unwrapLiteral = (n) => {
    if (!n) return null;
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n)) return unwrapLiteral(n.expression);
    return n;
  };

  /** The object literal an expression resolves to in this file, or null. */
  const literalFor = (n) => {
    const bare = unwrapLiteral(n);
    if (!bare) return null;
    if (ts.isObjectLiteralExpression(bare)) return bare;
    if (ts.isIdentifier(bare)) return unwrapLiteral(decls?.locals.lookup(bare.text, bare)?.node) ?? null;
    return null;
  };

  const readLiteral = (node, d) => {
    const lit = literalFor(node);
    if (!lit || !ts.isObjectLiteralExpression(lit)) return null;
    let sawUnresolvableSpread = false;
    // Later properties win in an object literal, so the LAST answer decides.
    let verdict = false;
    for (const prop of lit.properties) {
      if (ts.isSpreadAssignment(prop)) {
        if (d > 4) { sawUnresolvableSpread = true; continue; }
        const inner = readLiteral(prop.expression, d + 1);
        // ⛔ `null` here means "could not read it", NOT "it said no".
        if (inner === null || inner === 'undecidable') sawUnresolvableSpread = true;
        else verdict = inner;
        continue;
      }
      if (!ts.isPropertyAssignment(prop) || !prop.name || !ts.isIdentifier(prop.name)) continue;
      if (prop.name.text !== 'isSystem') continue;
      if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) verdict = true;
      else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) verdict = false;
      else return 'undecidable';
    }
    // An unread spread can only be resolved DOWNWARD to uncertainty: it may have
    // carried the flag this literal never mentions.
    if (sawUnresolvableSpread && verdict !== true) return 'undecidable';
    return verdict;
  };

  const answer = readLiteral(value, depth);
  return answer === null ? 'undecidable' : answer;
}

/**
 * ⛔ SHRINK-ONLY, and keyed by (file, receiver) -- never by line.
 *
 * The write calls whose receiver has no readable type AND that neither placement
 * rule reaches. Each row says what the receiver really is, and `engine` says
 * whether it is one of ours. A row that matches nothing in the tree FAILS: its
 * reason has outlived the code it described.
 *
 * ⚠️ Deliberately NOT keyed by line. A ledger of line numbers rots exactly like
 * the page anchors this mechanism exists to stop rotting, and it rots INVISIBLY,
 * because a stale row still excuses a site.
 *
 * ⭐ `engine: true` rows are COUNTED into the census: the sites they name are
 * real engine writes reached through an `any`, and they are a percent-scale
 * share of this population -- a ledger that could only subtract would be a
 * ledger that can only shrink the truth. ⛔ The share is not quoted as a figure
 * here, for the reason the corpus-scale split gives: a number repeated into a
 * comment rots where nothing can see it, and this ledger shrinks every time the
 * classifier learns to read a receiver it used to need a row for.
 */
export const UNTYPED_RECEIVERS = [
  // ── Real engine writes, reached through an erased receiver ──────────────────
  {
    file: 'packages/plugins/plugin-auth/src/member-role-canonical.ts',
    receiver: 'ql',
    engine: true,
    what: '`ql: any` seed helper writing `MEMBER_OBJECT` (= `SystemObjectName.MEMBER`, an enum member, so the name is not a readable literal)',
  },
  {
    file: 'packages/plugins/plugin-security/src/claim-seed-ownership.ts',
    receiver: 'ql',
    engine: true,
    what: '`ql: any` seed helper writing `schema.name` -- a runtime object name off the registered schema',
  },
  {
    file: 'packages/services/service-settings/src/settings-service-plugin.ts',
    receiver: 'eng',
    engine: true,
    what: 'the settings service\'s engine facade forwarding to `eng: any`; its own `objectName` parameter carries no annotation to read',
  },

  // ── Not the data engine. Same three verb names, different mechanism ─────────
  {
    file: 'packages/plugins/plugin-auth/src/auth-manager.ts',
    receiver: 'db',
    engine: false,
    what: 'the better-auth adapter the vendor bound to the SCIM transaction (`const db = context.database`) -- `update({ model, where, update })`, a keyword object, not `(object, data, options)`',
  },
  {
    file: 'packages/plugins/plugin-auth/src/two-factor-reenrollment-verified-reset.ts',
    receiver: 'adapter',
    engine: false,
    what: 'the better-auth adapter -- `update({ model, update, where })`, a keyword object, not `(object, data, options)`',
  },
  {
    file: 'packages/services/service-automation/src/builtin/map-node.ts',
    receiver: 'variables',
    engine: false,
    what: 'the flow run\'s variable Map -- `delete(`${node.id}.$mapItemDone`)` clears a handoff key',
  },
  {
    file: 'packages/services/service-cluster-redis/src/pubsub.ts',
    receiver: 'b',
    engine: false,
    what: 'a `Set` of subscriber handlers read out of `this.subs`',
  },
  {
    file: 'packages/services/service-cluster/src/memory/pubsub.ts',
    receiver: 'b',
    engine: false,
    what: 'the in-memory sibling of the redis pubsub Set above',
  },
  {
    file: 'packages/services/service-cluster/src/memory/lock.ts',
    receiver: 'self.holders',
    engine: false,
    what: 'the lock\'s holder Map, dropping a released holder',
  },
  {
    file: 'packages/services/service-cluster/src/testing.ts',
    receiver: 'kv',
    engine: false,
    what: 'the cluster KV under the shared conformance suite this module EXPORTS -- `kv.delete(\'k\')` deletes a key, and the file is a suite factory rather than a test by path',
  },
  {
    file: 'packages/services/service-knowledge/src/knowledge-reap-guard.ts',
    receiver: 'adapter',
    engine: false,
    what: 'a knowledge search-index adapter -- `delete([documentId], { source })` de-indexes documents',
  },
  {
    file: 'packages/services/service-messaging/src/memory-http-outbox.ts',
    receiver: 'this',
    engine: false,
    what: 'the outbox class\'s OWN `private insert(...)`, which takes a delivery record and no object name',
  },
  {
    file: 'packages/services/service-messaging/src/sql-http-outbox.ts',
    receiver: 'this',
    engine: false,
    what: 'the SQL outbox\'s own `private insert(...)`, same shape as its in-memory sibling',
  },
  {
    file: 'packages/services/service-realtime/src/in-memory-realtime-adapter.ts',
    receiver: 'channelSubs',
    engine: false,
    what: 'a `Set` of channel subscriptions read out of `this.channelIndex`',
  },
  {
    file: 'packages/services/service-storage/src/attachment-lifecycle.ts',
    receiver: 'storage',
    engine: false,
    what: 'the blob-storage backend -- `delete(row.key)` removes BYTES by storage key, not a row by object name',
  },
];

/**
 * What the FIRST argument of a write call names.
 *
 * `literal` and `const-literal` are the statically decidable halves -- a `const`
 * object name is as decidable as an inline one, and reading it that way is what
 * keeps the undecidable bucket honest about being genuinely undecidable rather
 * than merely unread. 37 of this census's sites name their object through a
 * `const`.
 */
export function resolveObjectNameArg(a0, sf, decls) {
  if (a0 == null) return { kind: 'absent', name: null };
  if (ts.isStringLiteralLike(a0)) return { kind: 'literal', name: a0.text };
  if (ts.isIdentifier(a0)) {
    const entry = decls.locals.lookup(a0.text, a0);
    if (entry?.literal) return { kind: 'const-literal', name: entry.literal };
    if (OBJECT_PARAM_NAMES.has(a0.text) && entry?.type?.trim() === 'string') {
      return { kind: 'object-name-parameter', name: a0.getText(sf) };
    }
  }
  return { kind: 'runtime', name: a0.getText(sf).replace(/\s+/g, ' ') };
}

/** Run the census. */
export function runCensus({ root = ROOT, roots = SURFACE_ROOTS } = {}) {
  const index = widenIndexThroughAliases(buildEngineTypeIndex(root), root);
  const typeNames = corpusTypeNames(root);
  const objects = declaredObjects(root);
  const sources = collectSources(root, roots);
  const sites = [];
  const unresolved = [];
  const usedRows = new Set();
  let nonEngineCalls = 0;
  const nonEngineReasons = new Map();
  const undefendedSubtractions = [];

  for (const rel of sources) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (error) {
      throw new Error(`tenant-audit-census: cannot read ${rel} -- ${error.message}`);
    }
    if (!/\.(insert|update|delete)\s*[(<]/.test(text)) continue;
    const sf = parseSourceFile(rel, text);
    const decls = declaredTypesIn(sf);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const verb = node.expression.name.text;
        const res = resolveReceiver(node.expression.expression, sf, decls, index);
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const a0 = node.arguments[0];
        const arg = resolveObjectNameArg(a0, sf, decls);
        const decided = arg.kind === 'literal' || arg.kind === 'const-literal';
        const objectName = arg.name;
        const where = {
          file: rel, line: line + 1,
          receiver: receiverKey(node.expression.expression, sf),
        };

        let kind = res.kind;
        let engineType = res.type ?? null;
        let placedBy = 'declared-type';
        // ⭐ THE RESCUE. A receiver the author typed `any` carries no type to
        // read, and 44 of this census's sites are spelled that way. Their write
        // calls are still placeable, because the FIRST ARGUMENT names a declared
        // object -- a fact about the tree, not about the receiver's name. Without
        // this the census silently loses a quarter of its own population to a
        // keyword.
        if (kind === 'unresolved' && decided && objects.has(objectName)) {
          kind = 'engine';
          engineType = 'untyped receiver, placed by object name';
          placedBy = 'object-name';
        } else if (kind === 'unresolved' && arg.kind === 'object-name-parameter') {
          // The second half of the same rescue. These are the RUNTIME-NAME
          // sites: `ql.insert(object, …)` inside a `(ql: any, object: string)`
          // helper. The receiver is erased AND the object is a parameter, so
          // neither the type nor the name places them -- but the argument is
          // declared with exactly the door signature the type index keys on
          // (`object: string` in first position), which is a fact about the
          // declaration rather than a guess about the identifier.
          kind = 'engine';
          engineType = 'untyped receiver, placed by object-name parameter';
          placedBy = 'object-name-parameter';
        }

        let byLedger = false;
        if (kind === 'unresolved') {
          const row = UNTYPED_RECEIVERS.find((r) => r.file === rel && r.receiver === where.receiver);
          if (row) {
            usedRows.add(row);
            if (row.engine) { kind = 'engine'; engineType = 'untyped receiver, placed by ledger'; placedBy = 'ledger'; }
            else { kind = 'other'; byLedger = true; }
          }
        }

        if (kind === 'other') {
          nonEngineCalls += 1;
          // ⭐ The subtraction is unchanged; what is new is that it now SAYS what
          // it rests on. Three of the eight arms admit the census could not place
          // the receiver's type -- those are the ones that used to be spelled
          // exactly like "read it, not an engine", and they are reported per site.
          // ⚠️ The source's own tree goes in as the ORIGIN: the door rule re-parses
          // a text derived from it, and a verdict about a synthesis must be
          // attributable to the site it was synthesised from.
          const why = byLedger
            ? { reason: 'ledger-row', names: [], doorShaped: false, failure: null }
            : nonEngineReason(res, typeNames, sf);
          nonEngineReasons.set(why.reason, (nonEngineReasons.get(why.reason) ?? 0) + 1);
          if (UNDEFENDED_REASONS.includes(why.reason)) {
            undefendedSubtractions.push({
              ...where, verb,
              type: String(res.type ?? '').replace(/\s+/g, ' ').trim(),
              how: res.how ?? null,
              reason: why.reason,
              names: why.names,
              doorShaped: why.doorShaped === true,
              // The located parse verdict for the one arm that has one, so the
              // run can print it against THIS site. ⛔ Not part of any artefact
              // key: `undefendedRows` aggregates on (file, receiver, verb,
              // reason, type, doorShaped), so a diagnostic cannot move a count.
              derivedFailure: why.failure ?? null,
            });
          }
        }
        else if (kind === 'unresolved') {
          unresolved.push({ ...where, verb, how: res.how, detail: res.detail ?? null, ledgered: false });
        } else {
          const ctx = tenantContextOf(node, sf, decls);
          const decl = decided ? objects.get(objectName) : null;
          sites.push({
            ...where, verb, engineType, placedBy,
            objectName,
            objectNameKind: arg.kind,
            objectDeclared: decided ? Boolean(decl) : null,
            tenancy: decided
              ? (decl ? (decl.tenancyDisabled ? 'disabled' : 'enabled') : 'undeclared-name')
              : 'undecidable',
            carriesTenantContext: ctx.carries,
            contextHow: ctx.how,
            elevatedContext: ctx.system,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  undefendedSubtractions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const tenancyEnabled = sites.filter((s) => s.tenancy === 'enabled');
  return {
    sites,
    unresolved,
    unledgered: unresolved.filter((u) => !u.ledgered),
    staleLedgerRows: UNTYPED_RECEIVERS.filter((r) => !usedRows.has(r)),
    nonEngineCalls,
    // The subtraction, broken out by the fact each one rests on. Kept OUT of the
    // enforced artefacts on purpose: `new Map().delete(k)` moves these counts on
    // any commit that adds a Map, which is the ambient churn with no safety
    // content that the enforced/unenforced split exists to keep out. The two arms
    // that carry safety content are per-site, in `undefendedSubtractions`, and
    // those move only when the population's own boundary moves.
    nonEngineReasons: Object.fromEntries([...nonEngineReasons].sort((a, b) => a[0].localeCompare(b[0]))),
    undefendedSubtractions,
    totals: {
      writeCallSites: sites.length,
      staticallyDecidableObjectName: sites.filter((s) => s.tenancy !== 'undecidable').length,
      undecidableObjectName: sites.filter((s) => s.tenancy === 'undecidable').length,
      objectNameInline: sites.filter((s) => s.objectNameKind === 'literal').length,
      objectNameConst: sites.filter((s) => s.objectNameKind === 'const-literal').length,
      objectNameParameter: sites.filter((s) => s.objectNameKind === 'object-name-parameter').length,
      objectNameRuntime: sites.filter((s) => s.objectNameKind === 'runtime').length,
      tenancyEnabled: tenancyEnabled.length,
      tenancyDisabled: sites.filter((s) => s.tenancy === 'disabled').length,
      provablyNoTenantContext: sites.filter((s) => s.carriesTenantContext === false).length,
      tenantContextUnreadable: sites.filter((s) => s.carriesTenantContext === 'undecidable').length,
      carriesTenantContext: sites.filter((s) => s.carriesTenantContext === true).length,
      tenancyEnabledProvablyNoContext: tenancyEnabled.filter((s) => s.carriesTenantContext === false).length,
      tenancyEnabledContextUnreadable: tenancyEnabled.filter((s) => s.carriesTenantContext === 'undecidable').length,
      placedByObjectName: sites.filter((s) => s.placedBy === 'object-name').length,
      placedByObjectNameParameter: sites.filter((s) => s.placedBy === 'object-name-parameter').length,
      placedByLedger: sites.filter((s) => s.placedBy === 'ledger').length,
      elevatedContext: sites.filter((s) => s.elevatedContext === true).length,
      nonElevatedContext: sites.filter((s) => s.carriesTenantContext && s.elevatedContext === false).length,
      elevationUndecidable: sites.filter((s) => s.elevatedContext === 'undecidable').length,
    },
    engineTypes: index.size,
    declaredObjects: objects.size,
    scannedSources: sources.length,
    measuredAt: measuredAt(root),
  };
}

export const PAGE = 'content/docs/permissions/tenant-audit-census.mdx';
export const COUNTS = 'docs/audits/2026-08-tenant-audit-write-call-sites.counts.md';
export const BEGIN_MARKER = '{/* BEGIN GENERATED: tenant-audit-census (scripts/tenant-audit-census.mjs) — DO NOT EDIT */}';
export const END_MARKER = '{/* END GENERATED: tenant-audit-census */}';

/**
 * ⛔ NEITHER artefact carries LINE NUMBERS, and that is the design rather than an
 * omission.
 *
 * An artefact keyed to line numbers reds on a pure DISPLACEMENT -- an inserted
 * import above the site is enough -- so it churns on edits that changed nothing
 * it measures, and its repair arm then has to tell displacement apart from a
 * population change. That is a defect the sibling `isSystem` gate is carrying
 * right now (a false "the POPULATION changed" refusal when only ledger-excused
 * citations shifted), and inheriting its anchor scheme into a brand-new gate on
 * day one would be a choice rather than an accident.
 *
 * So the rows are AGGREGATED: one per (file, verb, object name, tenancy, context
 * posture), with a count. That key is invariant under displacement, so the only
 * thing that can move these files is the population itself -- which is the only
 * thing they claim to describe. `--json` still carries every site's `file:line`
 * for anyone navigating to one.
 *
 * ## Why the rows live in `docs/audits/` and not on the page
 *
 * Same split, and the same reason, as `packages/spec`'s strictness ledger and its
 * generated `.counts.md`: the page has prose to preserve and the row table has
 * none, so the table is regenerated WHOLE while the page keeps a small generated
 * region for the figures its prose reasons about. A reader gets a page they can
 * read; a re-deriver gets a ledger they can diff.
 *
 * It also keeps 140-odd rows of machine output out of the published docs site,
 * and out of `content/docs`-scoped prose ratchets that have no way to tell an
 * emitted source path from an author's sentence -- `check-role-word` already
 * excludes `content/docs/references/` for exactly that reason, and a hybrid page
 * is a shape its directory-level exclusion cannot express.
 */
function aggregate(census) {
  const groups = new Map();
  for (const site of census.sites) {
    const posture = site.carriesTenantContext === true
      ? (site.elevatedContext === true ? 'elevated'
        : site.elevatedContext === false ? 'tenant-scoped'
        : 'context, elevation undecidable')
      : site.carriesTenantContext === false ? 'PROVABLY NONE'
      : 'options unreadable';
    const key = JSON.stringify([site.file, site.verb, site.objectName, site.tenancy, posture]);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ cells: JSON.parse(key), count }))
    .sort((a, b) => a.cells[0].localeCompare(b.cells[0])
      || a.cells[2].localeCompare(b.cells[2])
      || a.cells[1].localeCompare(b.cells[1]));
}

/**
 * The undefended subtractions, aggregated the way every other row here is: by a
 * key that a pure DISPLACEMENT cannot move.
 *
 * ⛔ No line numbers, for the same reason the site table carries none -- an
 * inserted import above the call must not move an artefact that measures the
 * population. `--json` carries `file:line` for anyone navigating to one.
 *
 * ⭐ This table is ENFORCED, and that is the point of it. A corpus-scale row moves
 * on ambient churn (any commit that adds a `Map`), so the split puts those beyond
 * comparison; this one moves only when a receiver's type stops being placeable,
 * which is exactly when the population's own boundary moves and exactly what used
 * to happen in silence. A type that leaves the index -- because its declaration
 * was untracked, moved out of `packages/`/`examples/`, or renamed -- now lands
 * here BY NAME, in the diff, instead of subtracting a site at exit 0.
 */
export function undefendedRows(census) {
  const groups = new Map();
  for (const u of census.undefendedSubtractions ?? []) {
    const key = JSON.stringify([u.file, u.receiver, u.verb, u.reason, u.type, u.doorShaped === true]);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ cells: JSON.parse(key), count }))
    .sort((a, b) => a.cells[0].localeCompare(b.cells[0])
      || a.cells[1].localeCompare(b.cells[1])
      || a.cells[2].localeCompare(b.cells[2]));
}

/** A type text in one markdown cell: one line, and no cell-splitting pipe. */
function cell(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

/**
 * The undefended-subtraction block, identical in both artefacts apart from
 * heading depth. Renders a row per subtraction the census could not defend, and
 * says so explicitly when there are none -- an empty section is a measurement,
 * while a missing section is indistinguishable from a check that stopped running.
 */
export function renderUndefendedSubtractions(census, heading, { withRows = true } = {}) {
  const rows = undefendedRows(census);
  const doorShaped = rows.filter((r) => r.cells[5]).reduce((n, r) => n + r.count, 0);
  const out = [];
  out.push(`${heading} Subtractions the census could NOT defend — enforced`, '');
  out.push('A same-named call on something that is not a data engine is subtracted, and the');
  out.push('subtraction is DEFENSIBLE when this census can name why: the receiver is a `node:`');
  out.push('builtin, a value it watched being constructed, a language global, a type THIS');
  out.push('corpus declares and the door rule rejected, or an `UNTYPED_RECEIVERS` row.');
  out.push('');
  out.push('⚠️ Counted below are the subtractions it can name no such fact for — the');
  out.push('receiver carries a declared type the engine type index does not hold, and that');
  out.push('index is built from TRACKED sources only, deliberately. An untracked, generated');
  out.push('or dependency-owned declaration is one this census never saw, and «never saw it»');
  out.push('must not be spelled the same way as «read it, not an engine».');
  out.push('');
  out.push('⚠️ One arm here says something else again: `type-text-not-round-trippable` is a');
  out.push('receiver whose declared type THIS TOOL derived and then could not read back —');
  out.push('the source parsed, the re-serialisation of it did not, so the door rule could');
  out.push('never be read off it. That is a fault in this tool rather than a fact about the');
  out.push('corpus, and it is the one row here that also fails the gate.');
  out.push('');
  out.push('| what | count |', '| :--- | ---: |');
  out.push(`| write calls subtracted with no defensible reason | **${rows.reduce((n, r) => n + r.count, 0)}** |`);
  out.push(`| …whose declared type text states an engine door anyway | **${doorShaped}** |`);
  out.push('');
  out.push('⛔ The second row is **0 by construction**, not a tally that happens to be low.');
  out.push('An inline type literal stating a write door has no name for the engine type index');
  out.push('to be keyed on, so the door rule is read off the type text itself and the site is');
  out.push('PLACED — it is in the population above rather than subtracted here. A non-zero');
  out.push('value on that row means a door-shaped receiver reached the subtraction anyway.');
  out.push('');
  if (rows.length === 0) {
    out.push('None: every non-engine subtraction in this census rests on a named fact.');
    return out;
  }
  // ⛔ The ROWS stay off the published page, the same split the site table
  // follows: machine output belongs in `docs/audits/`, and a type text carrying
  // braces and angle brackets is MDX-hostile besides. The page states the two
  // counts and points here.
  if (!withRows) {
    out.push(`Every one of them is listed, by receiver and by the type text that could not be`);
    out.push(`placed, in [\`${COUNTS}\`](https://github.com/objectstack-ai/objectstack/blob/main/${COUNTS}).`);
    return out;
  }
  out.push('| file | receiver | verb | why | declared type | door | n |');
  out.push('|---|---|---|---|---|---|---:|');
  for (const r of rows) {
    const [file, receiver, verb, reason, type, door] = r.cells;
    out.push(`| \`${file}\` | \`${cell(receiver)}\` | \`${verb}\` | ${reason} | \`${cell(type)}\` | ${door ? '⚠️ yes' : 'no'} | ${r.count} |`);
  }
  return out;
}

/**
 * The CORPUS-SCALE numbers: how big the haystack was, not what was found in it.
 *
 * ## ⭐ Why these four are rendered apart from the totals
 *
 * `census.totals` is the POPULATION this artefact certifies -- the write call
 * sites and the tenancy/context verdict on each. These four are properties of the
 * CORPUS the instrument walked: how many sources it read, how many engine-shaped
 * types it recognised, how many objects the registry declares, and how many
 * same-named calls on a non-engine receiver it declined to count. None of them is
 * a property of the population. That is the line the enforced/unenforced split
 * follows, and the code already drew it: everything inside `totals` is enforced,
 * these four are not. `scripts/check-tenant-audit-census.mjs` carries the reason
 * and the measurement.
 *
 * ⛔ They are still EMITTED and still DATED. "Not enforced" must not decay into
 * "not there": a number nobody checks and nobody dates reads as current, which is
 * the disease this whole artefact exists to treat one level down.
 */
export function corpusScaleRows(census) {
  return [
    ['tracked non-test sources scanned', census.scannedSources],
    ['engine-shaped types recognised', census.engineTypes],
    ['declared objects in the registry', census.declaredObjects],
    ['same-named calls subtracted as non-engine', census.nonEngineCalls],
  ];
}

/** The corpus-scale block, identical in both artefacts apart from heading depth. */
export function renderCorpusScale(census, heading) {
  const out = [];
  out.push(`${heading} Corpus scale — present and dated, ⛔ NOT enforced`, '');
  out.push('⛔ These four describe the CORPUS this census walked, not the population it');
  out.push('certifies, and the gate deliberately does not hold them to the tree — a source');
  out.push('file arriving anywhere under the two roots moves them while every verdict above');
  out.push('holds still. They are required to be HERE and to say WHEN they were true;');
  out.push('their values are not compared. The reasoning, and the measurement behind it,');
  out.push('are in `scripts/check-tenant-audit-census.mjs`.', '');
  out.push(`Measured on ${census.measuredAt.date} at \`${census.measuredAt.ref}\`.`, '');
  out.push('| corpus scale (not enforced) | count |', '| :--- | ---: |');
  for (const [label, value] of corpusScaleRows(census)) out.push(`| ${label} | ${value} |`);
  return out;
}

/** The page's generated region: the figures its prose reasons about. */
export function renderGeneratedRegion(census) {
  const t = census.totals;
  const out = [];
  out.push(BEGIN_MARKER, '');
  out.push('## The measurement', '');
  out.push('| what | count |', '| :--- | ---: |');
  out.push(`| write call sites on the application surface | **${t.writeCallSites}** |`);
  out.push(`| …whose object name is statically decidable | ${t.staticallyDecidableObjectName} |`);
  out.push(`| …whose object name is chosen at run time | ${t.undecidableObjectName} |`);
  out.push(`| …against an object with tenancy ENABLED | ${t.tenancyEnabled} |`);
  out.push(`| …against an object that declares tenancy off | ${t.tenancyDisabled} |`);
  out.push(`| threading a tenant context | ${t.carriesTenantContext} |`);
  out.push(`| PROVABLY carrying none (options read, no context key) | **${t.provablyNoTenantContext}** |`);
  out.push(`| …of those, against a decidably tenancy-enabled object | **${t.tenancyEnabledProvablyNoContext}** |`);
  out.push(`| options argument UNREADABLE — may or may not carry one | ${t.tenantContextUnreadable} |`);
  out.push(`| …of those, against a decidably tenancy-enabled object | ${t.tenancyEnabledContextUnreadable} |`);
  out.push(`| threading a decidably ELEVATED (\`isSystem\`) context | ${t.elevatedContext} |`);
  out.push(`| threading a context that is decidably NOT elevated | ${t.nonElevatedContext} |`);
  out.push(`| threading a context whose elevation is a run-time fact | ${t.elevationUndecidable} |`);
  out.push('');
  out.push('| how the instrument reached the site | count |', '| :--- | ---: |');
  out.push(`| receiver carried a readable engine type | ${t.writeCallSites - t.placedByObjectName - t.placedByObjectNameParameter - t.placedByLedger} |`);
  out.push(`| receiver erased, placed by the object NAME | ${t.placedByObjectName} |`);
  out.push(`| receiver erased, placed by an \`object: string\` PARAMETER | ${t.placedByObjectNameParameter} |`);
  out.push(`| receiver erased, placed by an \`UNTYPED_RECEIVERS\` row | ${t.placedByLedger} |`);
  out.push('');
  out.push(`| object name spelled inline | ${t.objectNameInline} |`);
  out.push(`| object name spelled through a \`const\` | ${t.objectNameConst} |`);
  out.push(`| object name is an \`object: string\` parameter | ${t.objectNameParameter} |`);
  out.push(`| object name is some other run-time expression | ${t.objectNameRuntime} |`);
  out.push('');
  out.push(...renderUndefendedSubtractions(census, '###', { withRows: false }));
  out.push('');
  out.push(`The corpus walked is every tracked non-test source under \`packages/services/\``);
  out.push(`and \`packages/plugins/\`; calls to a same-named method on something that is not`);
  out.push(`a data engine were subtracted. Every site is listed in`);
  out.push(`[\`${COUNTS}\`](https://github.com/objectstack-ai/objectstack/blob/main/${COUNTS}),`);
  out.push(`regenerated by the same command.`);
  out.push('');
  out.push(...renderCorpusScale(census, '###'));
  out.push('');
  out.push(END_MARKER);
  return out.join('\n');
}

/**
 * The audit ledger: every site, regenerated WHOLE.
 *
 * No prose to preserve, so nothing here is spliced -- the file is rewritten. Two
 * branches that each add a write call site produce rows that git merges cleanly and
 * a header that merges cleanly and WRONG, so the correct resolution is always
 * "recompute from the merged tree" -- `node scripts/tenant-audit-census.mjs --write`,
 * which is what the header this function emits tells a merging author to do.
 *
 * That resolution is not delegated to a merge driver: no `.gitattributes` entry
 * covers this path, so `git check-attr merge` over it reads `unspecified` and git
 * text-merges it like any other file. `scripts/check-tenant-audit-census.mjs` is the
 * backstop -- a wrongly merged file fails the build loudly instead of landing
 * silently.
 */
export function renderCountsFile(census) {
  const t = census.totals;
  const out = [];
  out.push('<!-- GENERATED — DO NOT EDIT BY HAND. -->');
  out.push('<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->');
  out.push('');
  out.push('# Tenant-audit census — every write call site (generated)');
  out.push('');
  out.push('Every application-surface write call site against a tenancy-enabled object, as');
  out.push('`scripts/tenant-audit-census.mjs` derives it from the tree. **The prose, the');
  out.push('method and the deviations from the figures this replaced are on the page**');
  out.push('(`content/docs/permissions/tenant-audit-census.mdx`); this file has no prose to');
  out.push('preserve and is regenerated whole.');
  out.push('');
  out.push('⛔ **Never hand-patch a row or a number here** — fix the code, or the census, and');
  out.push('regenerate. `scripts/check-tenant-audit-census.mjs` fails the build when this file');
  out.push('and the tree disagree.');
  out.push('');
  out.push('Rows are aggregated by (file, verb, object, tenancy, context posture) and carry no');
  out.push('line numbers, so a pure displacement cannot move them. Run the generator with');
  out.push('`--json` for per-site `file:line`.');
  out.push('');
  out.push('⚠️ **On a merge conflict here, regenerate — never resolve by hand.** Two branches');
  out.push('that each add a write call site produce rows git merges cleanly and totals that');
  out.push('merge cleanly and WRONG. This file is NOT `merge=os-regen`: no `.gitattributes`');
  out.push('row names it, so `git check-attr merge` over it reads `unspecified`. Routing it');
  out.push('would take a `REGEN_ARTIFACTS` row whose `gen:`/`check:` names exist in the');
  out.push('manifest that row declares as owner, and no manifest declares such a pair for');
  out.push('this census — the gate runs straight from the lint workflow. Root-level tooling');
  out.push('is no obstacle by itself: the driver resolves those names in whichever manifest');
  out.push('the row names, the root one included. The gate is the backstop — a wrongly');
  out.push('merged file fails `check-tenant-audit-census`, so the error is loud rather than');
  out.push('silent, and `node scripts/tenant-audit-census.mjs --write` is the resolution.');
  out.push('');
  out.push('## Totals');
  out.push('');
  out.push('| Measure | Value |');
  out.push('|---|---:|');
  out.push(`| Write call sites | ${t.writeCallSites} |`);
  out.push(`| Object name statically decidable | ${t.staticallyDecidableObjectName} |`);
  out.push(`| Object name chosen at run time | ${t.undecidableObjectName} |`);
  out.push(`| Against a tenancy-enabled object | ${t.tenancyEnabled} |`);
  out.push(`| Against an object declaring tenancy off | ${t.tenancyDisabled} |`);
  out.push(`| Threading a tenant context | ${t.carriesTenantContext} |`);
  out.push(`| Provably carrying none | ${t.provablyNoTenantContext} |`);
  out.push(`| …and decidably tenancy-enabled | ${t.tenancyEnabledProvablyNoContext} |`);
  out.push(`| Options argument unreadable | ${t.tenantContextUnreadable} |`);
  out.push(`| …and decidably tenancy-enabled | ${t.tenancyEnabledContextUnreadable} |`);
  out.push(`| Threading a decidably elevated context | ${t.elevatedContext} |`);
  out.push(`| Threading a decidably non-elevated context | ${t.nonElevatedContext} |`);
  out.push(`| Threading a context of undecidable elevation | ${t.elevationUndecidable} |`);
  out.push('');
  out.push(...renderUndefendedSubtractions(census, '##'));
  out.push('');
  out.push(...renderCorpusScale(census, '##'));
  out.push('');
  out.push('## Every site');
  out.push('');
  out.push('| file | verb | object | tenancy | tenant context | n |');
  out.push('|---|---|---|---|---|---:|');
  for (const r of aggregate(census)) {
    const [file, verb, object, tenancy, context] = r.cells;
    out.push(`| \`${file}\` | \`${verb}\` | \`${object}\` | ${tenancy} | ${context} | ${r.count} |`);
  }
  out.push('');
  return out.join('\n');
}

/** Splice the generated region into the page text. */
export function spliceRegion(pageText, region) {
  const begin = pageText.indexOf(BEGIN_MARKER);
  const end = pageText.indexOf(END_MARKER);
  if (begin === -1 || end === -1) {
    throw new Error(
      `tenant-audit-census: ${PAGE} has no generated region -- expected the marker pair `
      + '`BEGIN GENERATED: tenant-audit-census` / `END GENERATED: tenant-audit-census`. '
      + 'Refusing to guess where the census belongs.',
    );
  }
  return pageText.slice(0, begin) + region + pageText.slice(end + END_MARKER.length);
}

// ---------------------------------------------------------------------------
// Self-test -- the only instrument on the classifiers. Run by the GATE's
// `--self-test`, never by a flag of this module's own (see the header).
// ---------------------------------------------------------------------------

/**
 * The classifier's defect class is a MATCHING RULE over shapes a clean tree
 * contains only by accident, so a production run cannot tell a working rule from
 * a weakened one: green means "no unplaceable receiver", and the elevation
 * verdicts are not part of that verdict at all. They are published, and nothing
 * else reads them.
 *
 * These cases are the shapes that were measured wrong. The first edition scored
 * `{ ...SYSTEM_CTX }` as decidably NOT elevated and every `context: SYSTEM_CTX`
 * as undecidable -- 51 sites' verdicts, six of them inverted outright -- because
 * it skipped spreads and never unwrapped `as const`. Both are pinned here in the
 * direction that failed, plus the direction that must NOT be over-claimed: a
 * spread this cannot read makes the answer `undecidable`, never `false`.
 */
export function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push({
    name, ok: String(actual) === String(expected), detail: `got ${actual}, want ${expected}`,
  });

  /** Classify the `context:` of the single write call in a synthetic source. */
  const classify = (src) => {
    const sf = parseSourceFile('selftest.ts', src);
    const decls = declaredTypesIn(sf);
    let out = 'NO-CALL';
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const ctx = tenantContextOf(node, sf, decls);
        out = ctx.carries ? String(ctx.system) : 'NO-CONTEXT';
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };

  const call = (opts) => `declare const e: any;\ne.insert('o', {}, ${opts});\n`;

  // ── the shapes that were measured WRONG ────────────────────────────────────
  t('a `const … as const` context resolves through the assertion',
    classify(`const SYSTEM_CTX = { isSystem: true } as const;\n${call('{ context: SYSTEM_CTX }')}`), true);
  t('a SPREAD of an elevated const is elevated -- not "no isSystem key, so false"',
    classify(`const SYSTEM_CTX = { isSystem: true } as const;\n${call('{ context: { ...SYSTEM_CTX } }')}`), true);
  t('a spread of an elevated const survives extra keys beside it',
    classify(`const S = { isSystem: true } as const;\n${call('{ context: { ...S, raw: true } }')}`), true);

  // ── the direction that must not be OVER-claimed ────────────────────────────
  t('an UNRESOLVABLE spread is undecidable, never false',
    classify(`${call('{ context: { ...someImportedThing } }')}`), 'undecidable');
  t('an unresolvable spread beside an unrelated key is still undecidable',
    classify(`${call('{ context: { ...whatever, raw: true } }')}`), 'undecidable');
  t('a spread of a const that does NOT mention the flag is undecidable, not false',
    classify(`const C = { raw: true } as const;\n${call('{ context: { ...C, ...other } }')}`), 'undecidable');

  // ── the ordinary verdicts, so the fix did not swallow them ─────────────────
  t('an inline elevated literal is elevated',
    classify(call('{ context: { isSystem: true } }')), true);
  t('an inline literal that names the flag false is NOT elevated',
    classify(call('{ context: { isSystem: false } }')), false);
  t('an inline literal with no flag and no spread is NOT elevated',
    classify(call('{ context: { userId: "u1" } }')), false);
  t('a context from a helper CALL is undecidable',
    classify(call('{ context: systemWriteContext(orgId) }')), 'undecidable');
  t('a later key wins over an earlier spread',
    classify(`const S = { isSystem: true } as const;\n${call('{ context: { ...S, isSystem: false } }')}`), false);
  t('a write with no options argument carries no context',
    classify(`declare const e: any;\ne.insert('o', {});\n`), 'NO-CONTEXT');
  t('an options object with no context key carries no context',
    classify(call('{ raw: true }')), 'NO-CONTEXT');

  // ── the three-valued `carries`, whose middle value was the second over-claim ──
  const carries = (opts) => {
    const src = `declare const e: any;\ne.insert('o', {}, ${opts});\n`;
    const sf = parseSourceFile('selftest.ts', src);
    const decls = declaredTypesIn(sf);
    let out = 'NO-CALL';
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) out = String(tenantContextOf(node, sf, decls).carries);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };
  t('an UNREADABLE options argument is undecidable, never "carries no context"',
    carries('opts'), 'undecidable');
  t('an options literal carrying only a SPREAD is undecidable',
    carries('{ ...opts }'), 'undecidable');
  t('a READ options literal with no context key provably carries none',
    carries('{ raw: true }'), 'false');
  t('no options argument at all provably carries none',
    (() => {
      const sf = parseSourceFile('selftest.ts', "declare const e: any;\ne.insert('o', {});\n");
      const decls = declaredTypesIn(sf);
      let out = 'NO-CALL';
      const visit = (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && WRITE_VERBS.includes(n.expression.name.text)) out = String(tenantContextOf(n, sf, decls).carries);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out;
    })(), 'false');
  t('a context key still reads as carried', carries('{ context: ctx }'), 'true');

  // ── ⭐ THE DECLARED-OBJECT REGISTRY: depth is the rule (#17663) ────────────
  // A smaller number proves nothing on its own, so each case is a CONTROL PAIR:
  // the declaration that must still be counted, beside the nested `name:` in the
  // same file that must not be. The fixtures are cut down from the two files the
  // card measured -- `expense-report.object.ts` (two declarations) and
  // `invoice.object.ts` (`inlineColumns`, whose `name` is the grid's column
  // identity, not an object's).
  const declaredIn = (src) =>
    topLevelObjectDeclarations(parseSourceFile('selftest.object.ts', src)).map((d) => d.name).join(',');

  t('a single top-level declaration is counted',
    declaredIn("export const A = ObjectSchema.create({ name: 'showcase_account' });\n"),
    'showcase_account');
  t('⭐ a file that genuinely declares TWO objects still counts two',
    declaredIn(
      "export const ExpenseReport = ObjectSchema.create({ name: 'showcase_expense_report' });\n"
      + "export const ExpenseLine = ObjectSchema.create({ name: 'showcase_expense_line' });\n"),
    'showcase_expense_report,showcase_expense_line');
  t('⭐ `inlineColumns` entries are grid COLUMN identities, not declared objects',
    declaredIn(
      "export const Invoice = ObjectSchema.create({\n"
      + "  name: 'showcase_invoice_line',\n"
      + "  fields: {\n"
      + "    invoice: Field.lookup('showcase_invoice', {\n"
      + "      inlineColumns: [{ name: 'product' }, { name: 'quantity' }, { name: 'amount' }],\n"
      + "    }),\n"
      + '  },\n'
      + '});\n'),
    'showcase_invoice_line');
  t('validation-rule names are not declared objects',
    declaredIn(
      "export const Account = ObjectSchema.create({\n"
      + "  name: 'showcase_account',\n"
      + "  validationRules: [{ name: 'tax_id_format' }, { name: 'discount_cap' }],\n"
      + '});\n'),
    'showcase_account');
  t('action / list-view / index names are not declared objects',
    declaredIn(
      "export const User = ObjectSchema.create({\n"
      + "  name: 'sys_user',\n"
      + "  actions: [{ name: 'invite_user' }, { name: 'ban_user' }],\n"
      + "  listViews: [{ name: 'all_users' }],\n"
      + "  indexes: [{ name: 'idx_sys_user_org' }],\n"
      + '});\n'),
    'sys_user');
  t('a declaration nested inside a function is NOT top-level',
    declaredIn("function make() { return ObjectSchema.create({ name: 'nested_object' }); }\n"), '');
  t('a bare top-level object literal declaration is counted',
    declaredIn("const A = { name: 'bare_object' };\n"), 'bare_object');
  t('a declaration behind an `as` assertion is counted',
    declaredIn("export const A = ObjectSchema.create({ name: 'asserted_object' }) as never;\n"),
    'asserted_object');
  t('⛔ a file with no top-level declaration yields NOTHING to declare -- the shape declaredObjects() refuses on',
    declaredIn("export default ObjectSchema.create({ name: 'default_exported' });\n"), '');

  // The tenancy posture rides on the same literal, and only on the TOP-LEVEL one.
  const disabledIn = (src) =>
    topLevelObjectDeclarations(parseSourceFile('selftest.object.ts', src)).map((d) => String(d.tenancyDisabled)).join(',');
  t('a top-level `tenancy.enabled: false` is read as an opt-out',
    disabledIn("export const K = ObjectSchema.create({ name: 'sys_api_key', tenancy: { enabled: false } });\n"), 'true');
  t('an object with no tenancy block is tenancy-ENABLED by default',
    disabledIn("export const K = ObjectSchema.create({ name: 'sys_user' });\n"), 'false');
  t('⛔ a NESTED literal cannot opt anything out -- it is not a declaration at all',
    declaredIn(
      "export const K = ObjectSchema.create({\n"
      + "  name: 'sys_user',\n"
      + "  actions: [{ name: 'ban_user', tenancy: { enabled: false } }],\n"
      + '});\n'),
    'sys_user');

  // ── ⭐ THE CRITERION IN BOTH DIRECTIONS: tracked-only, said out loud ───────
  // The index is built from `git ls-files` and nothing else, on purpose (see
  // CORPUS_TYPE_DECL above). What that obliges is a DIAGNOSTIC, and a diagnostic
  // asserted only in prose is one nothing holds. So both directions are pinned
  // here: membership of the tracked corpus is the ONLY difference between the two
  // cases in each pair, and the verdicts must differ.
  // The door rule re-parses a text DERIVED from a source, so every probe hands
  // it the tree that source was read into -- the same thing `runCensus` hands it.
  // ⛔ Not a formality: `parseDerivedText` refuses an origin this process never
  // certified, which is what keeps an unreadable SOURCE out of the returnable
  // door, so a probe that could skip the origin would not be exercising the door
  // the census actually uses.
  const probeOrigin = parseSourceFile('selftest-origin.ts', 'export const x = 1;\n');
  const reasonOf = (type, how, names) =>
    nonEngineReason({ kind: 'other', type, how }, new Set(names), probeOrigin).reason;
  const namesOf = (type, how, names) =>
    nonEngineReason({ kind: 'other', type, how }, new Set(names), probeOrigin).names.join(',');

  t('⭐ a receiver type the TRACKED corpus declares is one the door rule READ and rejected',
    reasonOf('IProbeEngine', 'probe', ['IProbeEngine']), 'corpus-type');
  t('⭐ the SAME receiver type, declared where the tracked enumeration cannot see it, is UNDEFENDED',
    reasonOf('IProbeEngine', 'probe', ['SomethingElse']), 'type-not-in-corpus');
  t('⛔ and it is NAMED rather than folded into "not an engine"',
    namesOf('IProbeEngine', 'probe', ['SomethingElse']), 'IProbeEngine');
  t('a union naming one unseen type reports that one',
    namesOf('IProbeEngine | undefined', 'probe', []), 'IProbeEngine');

  // The defensible arms, so the diagnostic cannot decay into "everything is
  // undefended" -- a pile that flags all 146 subtractions hides the three that
  // matter exactly as effectively as flagging none.
  t('a `node:` builtin receiver is a NAMED fact, not a type-index miss',
    reasonOf('node: builtin crypto', 'node-import', []), 'builtin-import');
  t('a receiver placed by its own `new X` is a named fact',
    reasonOf('new Map', 'cache/new', []), 'constructed-locally');
  t('a language global is a named fact -- this corpus cannot declare `Map`',
    reasonOf('Map<string, string>', 'm', []), 'platform-type');
  t('an `import("…").Name` type reads its NAME, not the words in its specifier',
    reasonOf("import('./settings.types.js').SecretStore", 'this.secretStore', ['SecretStore']),
    'corpus-type');

  // An inline type literal has no name for the index to be keyed on, and the
  // door rule is keyed on names -- so the census must say "I could not place it"
  // rather than "not an engine", and must say when the literal itself declares a
  // door.
  t('an anonymous type literal is undefended -- there is no name to look up',
    reasonOf('{ delete(key: string): void }', 'e/as', []), 'anonymous-type');
  t('⭐ an anonymous literal whose own text declares a write door says so',
    String(nonEngineReason({ kind: 'other', type: '{ update(object: string, data: unknown): Promise<void> }', how: 'e/as' }, new Set(), probeOrigin).doorShaped),
    'true');
  t('⛔ …and one that declares no door does NOT claim one',
    String(nonEngineReason({ kind: 'other', type: '{ delete(key: string): void }', how: 'e/as' }, new Set(), probeOrigin).doorShaped),
    'false');
  t('a door named `find` is not a WRITE door',
    String(nonEngineReason({ kind: 'other', type: '{ find(object: string): Promise<void> }', how: 'e/as' }, new Set(), probeOrigin).doorShaped),
    'false');

  // ⭐⭐ The whole card in one pair: ONE source text, ONE receiver, and the index
  // as the only variable. In the index the site is an ENGINE write; out of the
  // index it is a subtraction -- which is what an untracked declaration produces,
  // because the index and the corpus name set are the same `git ls-files`
  // enumeration. The failure was never that the subtraction happens; it was that
  // both arms printed the same thing.
  const resolveIn = (indexNames) => {
    const src = "declare const e: IProbeEngine;\ne.insert('sys_user', {}, { context: { isSystem: true } });\n";
    const sf = parseSourceFile('selftest.ts', src);
    const decls = declaredTypesIn(sf);
    const index = new Map(indexNames.map((n) => [n, { decls: ['probe.ts'], verbs: ['insert'] }]));
    let out = 'NO-CALL';
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const res = resolveReceiver(node.expression.expression, sf, decls, index);
        out = res.kind === 'other'
          ? `other/${nonEngineReason(res, new Set(), sf).reason}`
          : `${res.kind}/${res.type ?? ''}`;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };
  t('⭐ a receiver whose type IS in the index is an engine write',
    resolveIn(['IProbeEngine']), 'engine/IProbeEngine');
  t('⭐ the same receiver, type NOT in the index, is a subtraction that says WHY',
    resolveIn([]), 'other/type-not-in-corpus');

  // ⭐⭐ THE DOOR RULE ON A TYPE WITH NO NAME. Same source shape, same index; the
  // only variable is whether the receiver's inline type literal states a WRITE
  // door. The index is keyed on names and an inline literal has none, so before
  // `inlineEngineDoorOrOther` every one of these read `other/anonymous-type` --
  // including the two real sites, which the diagnostic printed as probably wrong
  // and the classifier subtracted anyway. Pinned in BOTH directions, because a
  // rule that places every inline literal would be the same failure mirrored.
  const resolveInline = (typeText, indexNames = []) => {
    const src = `declare const e: ${typeText};\ne.insert('sys_user', {}, { context: { isSystem: true } });\n`;
    const sf = parseSourceFile('selftest.ts', src);
    const decls = declaredTypesIn(sf);
    const index = new Map(indexNames.map((n) => [n, { decls: ['probe.ts'], verbs: ['insert'] }]));
    let out = 'NO-CALL';
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const res = resolveReceiver(node.expression.expression, sf, decls, index);
        out = res.kind === 'other'
          ? `other/${nonEngineReason(res, new Set(), sf).reason}`
          : `${res.kind}/${res.type ?? ''}`;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };
  t('⭐ an inline type literal stating a write door is PLACED, with no name in the index',
    resolveInline('{ insert(object: string, data: unknown): Promise<void> }'),
    `engine/${INLINE_ENGINE_TYPE}`);
  t('⭐ …through a property-signature door in a union, which is how one real site is spelled',
    resolveInline('{ insert: (name: string, data: any, options?: any) => Promise<unknown> } | null'),
    `engine/${INLINE_ENGINE_TYPE}`);
  t('⛔ an inline literal whose only door is a READ door is still a subtraction',
    resolveInline('{ find(object: string, query: unknown): Promise<void> }'), 'other/anonymous-type');
  t('⛔ a same-named method whose first parameter is not an object name is no door',
    resolveInline('{ delete(key: string): void }'), 'other/anonymous-type');
  t('⛔ an indexed NAME beside an inline literal still wins and reports itself',
    resolveInline('IProbeEngine | { insert(object: string): Promise<void> }', ['IProbeEngine']),
    'engine/IProbeEngine');

  // ── ⭐⭐ THE CENSUS'S OWN ROUND TRIP, in both directions (#19077) ──────────
  // A type literal may separate its members by a NEWLINE alone -- legal
  // TypeScript. The census USED TO store a declared type whitespace-collapsed,
  // so that separator became NOTHING and the synthetic alias it re-parses was
  // not a parseable type alias. Through `parseSourceFile` that did not fail this
  // receiver: it ended the process, and every other site in the corpus lost its
  // verdict with it. ⭐ Both cases below run the REAL round trip -- the source is
  // parsed, `declaredTypesIn` stores the declared type exactly as the census
  // does, and the resolver reads the door off the stored text. The NEWLINE case
  // is the one that MOVED: it is placed now, on the same rule and off the same
  // text, because the separator survives storage.
  const NEWLINE_DOOR = '{\n'
    + '  insert(object: string, data: unknown): Promise<void>\n'
    + '  find(object: string, query: unknown): Promise<void>\n'
    + '}';
  const SEMICOLON_DOOR = '{ insert(object: string, data: unknown): Promise<void>;'
    + ' find(object: string, query: unknown): Promise<void>; }';
  t('⭐⭐ a receiver whose inline literal separates its members by a NEWLINE is PLACED -- storage no longer eats the separator',
    resolveInline(NEWLINE_DOOR), `engine/${INLINE_ENGINE_TYPE}`);
  t('⭐ LIT CONTROL: the SEMICOLON spelling of the SAME literal is PLACED too -- the collapse was the defect, not the shape',
    resolveInline(SEMICOLON_DOOR), `engine/${INLINE_ENGINE_TYPE}`);
  t('⛔ the arm is DECLARED undefended, so the site lands in both artefacts instead of dropping out in silence',
    String(UNDEFENDED_REASONS.includes('type-text-not-round-trippable')), 'true');
  t('⛔ CONTROL: a DEFENSIBLE arm is not in that set -- "declared" and "undefended" are not the same word',
    String(UNDEFENDED_REASONS.includes('corpus-type')), 'false');

  // The verdict has to be ATTRIBUTABLE, or localising the failure only moves the
  // mystery: the report names the source the text was derived from, not just the
  // synthetic `census-receiver-type.ts` that never existed in the tree.
  const roundTrip = nonEngineReason(
    { kind: 'other', type: NEWLINE_DOOR.replace(/\s+/g, ' '), how: 'e/as' }, new Set(), probeOrigin,
  );
  t('⭐ the failure is carried as DATA, located, so the run can print it against the site',
    String(roundTrip.failure !== null && roundTrip.failure.count >= 1 && roundTrip.failure.line === 1), 'true');
  t('⭐ …and it names the SOURCE the text was derived from, not only the synthetic file name',
    String(roundTrip.failure?.report.includes('selftest-origin.ts') === true), 'true');
  t('⛔ a site on this arm claims NO door -- an unreadable text is never scored as "read it, no door"',
    String(roundTrip.doorShaped), 'false');

  // ⛔ THE OTHER HALF OF ACCEPTANCE: a GENUINELY unparseable text is still
  // refused. Without it, "the round trip is repaired" and "the door rule was
  // switched off" are the same green.
  const GARBAGE_DOOR = '{ insert(object: string, data: unknown): Promise<void> ]]] )';
  t('⛔ a genuinely unparseable type text is REFUSED on the same arm, never read as a door',
    reasonOf(GARBAGE_DOOR, 'e/as', []), 'type-text-not-round-trippable');
  t('⛔ …and no door is read off it: text that did not parse cannot place a site',
    String(readTypeTextDoor(GARBAGE_DOOR, probeOrigin).door), 'false');

  // ⚠️ THE BOUNDARY, so the arm cannot quietly widen: the verb gate runs first,
  // so a newline-separated literal naming no WRITE verb is never synthesised and
  // never parsed. The repair's reach is exactly the defect's reach.
  t('⛔ a newline-separated literal with no write verb never reaches the synthesis',
    reasonOf('{\n  find(object: string): Promise<void>\n  count(object: string): Promise<number>\n}'.replace(/\s+/g, ' '), 'e/as', []),
    'anonymous-type');

  // ── ⭐⭐ ROUTE ①, AT EVERY STORAGE SITE ────────────────────────────────────
  // `resolveInline` above drives ONE of the sites that store a declared type.
  // These drive the other two shapes a receiver reaches its type through -- a
  // parameter annotation, and a member of an interface declared in the same file
  // -- because a repair applied at one storage site and not the other is a
  // repair whose reach nobody measured.
  /** Every write call's receiver verdict in a synthetic source, in source order. */
  const verdictsIn = (source, indexNames = []) => {
    const sf = parseSourceFile('selftest.ts', source);
    const decls = declaredTypesIn(sf);
    const index = new Map(indexNames.map((n) => [n, { decls: ['probe.ts'], verbs: ['insert', 'update', 'delete'] }]));
    const out = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const res = resolveReceiver(node.expression.expression, sf, decls, index);
        out.push(res.kind === 'other'
          ? `other/${nonEngineReason(res, new Set(), sf).reason}`
          : `${res.kind}/${res.type ?? ''}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out.join(' | ');
  };
  const WRITE = "insert('sys_user', {}, { context: { isSystem: true } })";
  t('⭐⭐ a NEWLINE-separated literal on a PARAMETER annotation is placed -- a storage site the inline probe never reaches',
    verdictsIn(`export function w(e: ${NEWLINE_DOOR}) {\n  e.${WRITE};\n}\n`),
    `engine/${INLINE_ENGINE_TYPE}`);
  t('⭐⭐ …and the same literal reached through an interface MEMBER, the other one',
    verdictsIn(`interface Deps {\n  engine: ${NEWLINE_DOOR};\n}\nexport function w(d: Deps) {\n  d.engine.${WRITE};\n}\n`),
    `engine/${INLINE_ENGINE_TYPE}`);
  t('⛔ a NEWLINE literal whose write verb is NOT a door is READ and rejected, never refused as unreadable',
    verdictsIn('export function w(e: {\n  delete(key: string): void\n  find(object: string): Promise<void>\n}) {\n'
      + "  e.delete('k');\n}\n"),
    'other/anonymous-type');

  // ── ⭐⭐ ONE NAME, TWO DECLARATIONS ────────────────────────────────────────
  // `locals` was keyed on the bare identifier, so a file's several `engine`s
  // were ONE entry and the first TYPED one decided for all of them. Measured,
  // that is three failures rather than one, and which one you get depends on
  // declaration order -- so all three are pinned, not just the refusal the card
  // was filed on. The quiet one is the expensive one: a real engine write
  // subtracted under `platform-type`, an arm that DEFENDS the subtraction, so it
  // prints nothing and is counted nowhere.
  const twoEngines = (first, second) =>
    `export function a(engine: ${first}) {\n  engine.${WRITE};\n}\n`
    + `export function b(engine: ${second}) {\n  engine.delete('k');\n}\n`;
  t('⭐⭐ two parameters sharing a name in different scopes are TWO declarations -- the Map is not scored an engine write',
    verdictsIn(twoEngines('IProbeEngine', 'Map<string, number>'), ['IProbeEngine']),
    'engine/IProbeEngine | other/platform-type');
  t('⭐⭐ …and in the other declaration order, the real engine write is no longer subtracted as a language global',
    verdictsIn(`export function a(engine: Map<string, number>) {\n  engine.delete('k');\n}\n`
      + `export function b(engine: IProbeEngine) {\n  engine.${WRITE};\n}\n`, ['IProbeEngine']),
    'other/platform-type | engine/IProbeEngine');
  t('⛔ FLOOR: a name NO enclosing scope declares still resolves file-wide, so nothing that resolved before stops',
    verdictsIn(`function shape(engine: IProbeEngine) { return engine; }\nexport function w() {\n  engine.${WRITE};\n}\n`,
      ['IProbeEngine']),
    'engine/IProbeEngine');

  // ── ⭐⭐ ONE NAME, TWO CLASSES -- AND ONE NAME, TWO CALLABLES ─────────────
  // The lexical tier above does not reach either of these, because neither name
  // is a lexical one. `this.engine` in class `B` is `B`'s property however many
  // other classes in the file spell it, and `getEngine` declared inside `b()` is
  // `b`'s. Keyed on the bare identifier both were ONE entry and the first TYPED
  // one decided for every site in the file -- the same three failures, at two
  // storage sites, and the quiet one is still the expensive one: a real engine
  // write subtracted under `platform-type`, an arm that DEFENDS the subtraction
  // and so prints nothing and is counted nowhere.
  t('⭐⭐ two CLASSES sharing a property name are TWO declarations -- the Map is not scored an engine write',
    verdictsIn(`class A {\n  constructor(private readonly engine: IProbeEngine) {}\n  w() { this.engine.${WRITE}; }\n}\n`
      + `class B {\n  constructor(private readonly engine: Map<string, number>) {}\n  w() { this.engine.delete('k'); }\n}\n`,
      ['IProbeEngine']),
    'engine/IProbeEngine | other/platform-type');
  t('⭐⭐ …and in the other declaration order, the real engine write is no longer subtracted as a language global',
    verdictsIn(`class A {\n  constructor(private readonly engine: Map<string, number>) {}\n  w() { this.engine.delete('k'); }\n}\n`
      + `class B {\n  constructor(private readonly engine: IProbeEngine) {}\n  w() { this.engine.${WRITE}; }\n}\n`,
      ['IProbeEngine']),
    'other/platform-type | engine/IProbeEngine');
  t('⭐⭐ …and at the OTHER storage site a property reaches its type through: a property DECLARATION',
    verdictsIn(`class A {\n  private readonly engine: IProbeEngine;\n  w() { this.engine.${WRITE}; }\n}\n`
      + `class B {\n  private readonly engine: Map<string, number>;\n  w() { this.engine.delete('k'); }\n}\n`,
      ['IProbeEngine']),
    'engine/IProbeEngine | other/platform-type');
  t('⛔ FLOOR: a `this.<prop>` NO enclosing class declares still resolves file-wide',
    verdictsIn('class A {\n  constructor(private readonly engine: IProbeEngine) {}\n}\n'
      + `class B {\n  w() { this.engine.${WRITE}; }\n}\n`, ['IProbeEngine']),
    'engine/IProbeEngine');
  t('⭐ the `this.<base>.<member>` receiver reads its base from the SITE\'s own class, not from the file',
    verdictsIn('interface Deps {\n  engine: IProbeEngine;\n}\ninterface Other {\n  engine: Map<string, number>;\n}\n'
      + `class A {\n  constructor(private readonly deps: Deps) {}\n  w() { this.deps.engine.${WRITE}; }\n}\n`
      + `class B {\n  constructor(private readonly deps: Other) {}\n  w() { this.deps.engine.delete('k'); }\n}\n`,
      ['IProbeEngine']),
    'engine/IProbeEngine | other/platform-type');
  t('⭐⭐ two same-named LOCAL FUNCTIONS are two declarations -- the Map is not scored an engine write',
    verdictsIn('export function a() {\n  function getEngine(): IProbeEngine { return null as never; }\n'
      + `  getEngine().${WRITE};\n}\n`
      + 'export function b() {\n  function getEngine(): Map<string, number> { return new Map(); }\n'
      + "  getEngine().delete('k');\n}\n", ['IProbeEngine']),
    'engine/IProbeEngine | other/platform-type');
  t('⭐⭐ …and in the other declaration order, the real engine write survives',
    verdictsIn('export function a() {\n  function getEngine(): Map<string, number> { return new Map(); }\n'
      + "  getEngine().delete('k');\n}\n"
      + 'export function b() {\n  function getEngine(): IProbeEngine { return null as never; }\n'
      + `  getEngine().${WRITE};\n}\n`, ['IProbeEngine']),
    'other/platform-type | engine/IProbeEngine');
  t('⛔ FLOOR: a METHOD name is scoped to its class, and still resolves from a call OUTSIDE it',
    verdictsIn('class Deps {\n  getEngine(): IProbeEngine { return null as never; }\n}\n'
      + `export function w(d: Deps) {\n  d.getEngine().${WRITE};\n}\n`, ['IProbeEngine']),
    'engine/IProbeEngine');

  // ── ⭐⭐ ONE MAP, THREE CALL SHAPES ────────────────────────────────
  // The cases above all read the callable map the way its name was DECLARED.
  // These four read it the way the call is WRITTEN, which is the other question
  // and the one the lookup site actually asks. A single chain answering both is
  // wrong for one of them: reading a BARE `getEngine()` through the enclosing
  // class body lets a method shadow a file-level function that the language
  // would never let it shadow -- and in this instrument that is the quiet
  // direction again, a real engine write subtracted under `platform-type`, an
  // arm that DEFENDS the subtraction and so prints nothing and is counted
  // nowhere. ⛔ Pinned in BOTH declaration orders, because the floor decides the
  // one the lexical tier does not reach and the two orders disagree there.
  t('⭐⭐ a BARE call resolves lexically -- a method never shadows a file-level function of the same name',
    verdictsIn('function getEngine(): IProbeEngine { return null as never; }\n'
      + 'class C {\n  getEngine(): Map<string, number> { return new Map(); }\n'
      + `  w() { getEngine().${WRITE}; }\n}\n`, ['IProbeEngine']),
    'engine/IProbeEngine');
  t('⭐⭐ …and in the other declaration order, where the file-wide floor would have answered the method',
    verdictsIn('class C {\n  getEngine(): Map<string, number> { return new Map(); }\n'
      + `  w() { getEngine().${WRITE}; }\n}\n`
      + 'function getEngine(): IProbeEngine { return null as never; }\n', ['IProbeEngine']),
    'engine/IProbeEngine');
  t('⭐ a `this.<method>()` call DOES read the enclosing class, so its own method wins over a same-named function',
    verdictsIn('function getEngine(): IProbeEngine { return null as never; }\n'
      + 'class C {\n  getEngine(): Map<string, number> { return new Map(); }\n'
      + "  w() { this.getEngine().delete('k'); }\n}\n", ['IProbeEngine']),
    'other/platform-type');
  t('⛔ FLOOR: an `x.<method>()` call is not the enclosing class\'s method -- the site\'s own class does not capture it',
    verdictsIn('class A {\n  getEngine(): IProbeEngine { return null as never; }\n}\n'
      + 'class B {\n  constructor(private readonly x: A) {}\n'
      + '  getEngine(): Map<string, number> { return new Map(); }\n'
      + `  w() { this.x.getEngine().${WRITE}; }\n}\n`, ['IProbeEngine']),
    'engine/IProbeEngine');

  // ── ⭐⭐ A MEMBER NAME IS NOT A LEXICAL ONE ON THE RECORDING SIDE EITHER ───
  // Keeping the class body off a bare call's chain is only half of "a bare
  // `f()` is never shadowed by a method". A name is reachable through whatever
  // scope it was RECORDED at, so a member name recorded at a LEXICAL scope is
  // found by a bare call however careful the chain is. `ts.isMethodDeclaration`
  // is true of an OBJECT LITERAL's method too, and an object literal opens no
  // lexical scope -- so one was recorded at the enclosing BLOCK, and a bare
  // `getEngine()` in that block resolved to the object's method. The compiler
  // never does that: declared ONLY that way, the name is `TS2304: Cannot find
  // name`. Quiet direction again -- a real engine write subtracted under
  // `platform-type`, an arm that DEFENDS the subtraction and so prints nothing
  // and is counted nowhere. ⛔ Pinned in BOTH declaration orders: the floor
  // decides the order the lexical tier does not reach, and the two disagree
  // there, so one order alone can pass on the floor's answer by luck.
  const objectLiteralMethod = 'export function w() {\n'
    + '  const o = { getEngine(): Map<string, number> { return new Map(); } };\n'
    + '  void o;\n'
    + `  getEngine().${WRITE};\n}\n`;
  const fileLevelGetEngine = 'function getEngine(): IProbeEngine { return null as never; }\n';
  t('⭐⭐ a BARE call is not shadowed by an OBJECT LITERAL method of the same name in the same block',
    verdictsIn(fileLevelGetEngine + objectLiteralMethod, ['IProbeEngine']),
    'engine/IProbeEngine');
  t('⭐⭐ …and in the other declaration order, where the floor would have answered the OBJECT LITERAL\'s method',
    verdictsIn(objectLiteralMethod + fileLevelGetEngine, ['IProbeEngine']),
    'engine/IProbeEngine');

  // The same conflation decided two OTHER questions, and both are verdicts the
  // artefacts carry: WHICH object a site writes, and whether it is elevated.
  /** Every write call's object-name verdict, in source order. */
  const objectNamesIn = (source) => {
    const sf = parseSourceFile('selftest.ts', source);
    const decls = declaredTypesIn(sf);
    const out = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const a = resolveObjectNameArg(node.arguments[0], sf, decls);
        out.push(`${a.kind}:${a.name}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out.join(' | ');
  };
  t('⭐ an object name held in a const is read from the scope the SITE is in, not from the last one in the file',
    objectNamesIn('declare const e: any;\n'
      + "export function a() {\n  const object = 'sys_user';\n  e.insert(object, {}, {});\n}\n"
      + "export function b() {\n  const object = 'sys_role';\n  e.insert(object, {}, {});\n}\n"),
    'const-literal:sys_user | const-literal:sys_role');

  /** Every write call's elevation verdict, in source order. */
  const elevationsIn = (source) => {
    const sf = parseSourceFile('selftest.ts', source);
    const decls = declaredTypesIn(sf);
    const out = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const ctx = tenantContextOf(node, sf, decls);
        out.push(ctx.carries ? String(ctx.system) : 'NO-CONTEXT');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out.join(' | ');
  };
  t('⭐ an elevation const is read from the scope the SITE is in -- two context consts are two contexts',
    elevationsIn('declare const e: any;\n'
      + "export function a() {\n  const CTX = { isSystem: true } as const;\n  e.insert('o', {}, { context: CTX });\n}\n"
      + "export function b() {\n  const CTX = { isSystem: false } as const;\n  e.insert('o', {}, { context: CTX });\n}\n"),
    'true | false');

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name} -- ${c.detail}`);
  if (failed.length > 0) {
    console.error(`✗ tenant-audit-census self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ tenant-audit-census self-test: ${cases.length} cases pass (an \`as const\` context, an `
    + 'elevated SPREAD, an unresolvable spread refusing to answer `false`, an unreadable '
    + 'options argument refusing to answer "carries no context", the ordinary verdicts -- plus '
    + 'the declared-object registry in BOTH directions: a file declaring two objects still '
    + 'counts two, while `inlineColumns`, validation-rule, action, list-view and index names '
    + 'in the same file count none -- and the TRACKED-ONLY criterion in both directions: one '
    + 'receiver, one source text, and index membership the only variable, reading `engine` in '
    + 'the index and a subtraction that NAMES the unplaceable type out of it -- and the door '
    + 'rule read off a type with no NAME at all, placing an inline literal that states a write '
    + 'door while still subtracting one that states none -- and the census\'s OWN round trip in both '
    + 'directions: a receiver whose inline literal separates its members by a NEWLINE is PLACED at '
    + 'every storage site, on the same rule as the semicolon spelling of the same literal, while a '
    + 'genuinely unparseable text is still refused and still places nothing -- and one NAME with two '
    + 'declarations is two declarations in every direction it used to be one: the Map is not scored '
    + 'an engine write, the real engine write is not subtracted as a language global, the object '
    + 'name and the elevation are read from the site\'s own scope, and a name no enclosing scope '
    + 'declares still resolves file-wide so nothing that resolved before stops -- and the same in the '
    + 'two places a name is NOT lexical: two classes sharing a property name are two properties at both '
    + 'storage sites and through a `this.<base>.<member>` base, two same-named local functions are two '
    + 'callables, each in both declaration orders, while a `this.<prop>` no enclosing class declares and '
    + 'a method called from outside its class both still resolve file-wide -- and the callable map read '
    + 'by how the CALL is written rather than by where the name was declared: a bare `f()` resolves '
    + 'lexically and is never shadowed by a same-named method -- neither one on the enclosing class, '
    + 'which the lookup chain excludes, nor one on an OBJECT LITERAL in the same block, which is kept '
    + 'off that chain by being recorded under the literal -- in both declaration orders each, while '
    + '`this.m()` does read that class and `x.m()` reads neither).',
  );
  return 0;
}

function main(argv) {

  const c = runCensus();
  if (argv.includes('--write')) {
    for (const [rel, next] of [
      [PAGE, spliceRegion(readFileSync(join(ROOT, PAGE), 'utf8'), renderGeneratedRegion(c))],
      [COUNTS, renderCountsFile(c)],
    ]) {
      const abs = join(ROOT, rel);
      const before = readFileSync(abs, 'utf8');
      if (before === next) { process.stdout.write(`tenant-audit-census: ${rel} already current\n`); continue; }
      writeFileSync(abs, next);
      process.stdout.write(`tenant-audit-census: rewrote ${rel}\n`);
    }
    return 0;
  }
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(c, null, 2)}\n`);
  } else {
    const t = c.totals;
    process.stdout.write([
      `tenant-audit-census: ${t.writeCallSites} engine write call sites on the application surface`,
      `  sources scanned ${c.scannedSources} · engine-shaped types ${c.engineTypes} · declared objects ${c.declaredObjects}`,
      `  object name decidable ${t.staticallyDecidableObjectName} · undecidable ${t.undecidableObjectName}`,
      `    inline literal ${t.objectNameInline} · const ${t.objectNameConst} · name parameter ${t.objectNameParameter} · other runtime ${t.objectNameRuntime}`,
      `  tenancy enabled ${t.tenancyEnabled} · declared off ${t.tenancyDisabled}`,
      `  tenant context: carried ${t.carriesTenantContext} · provably absent ${t.provablyNoTenantContext} · unreadable ${t.tenantContextUnreadable}`,
      `    provably absent AND tenancy-enabled ${t.tenancyEnabledProvablyNoContext} · unreadable AND tenancy-enabled ${t.tenancyEnabledContextUnreadable}`,
      `  threads a context: elevated ${t.elevatedContext} · not elevated ${t.nonElevatedContext} · undecidable ${t.elevationUndecidable}`,
      `  untyped receivers placed: by object name ${t.placedByObjectName} · by name parameter ${t.placedByObjectNameParameter} · by ledger ${t.placedByLedger}`,
      `  non-engine calls subtracted ${c.nonEngineCalls} · unresolved receivers ${c.unresolved.length}`,
      `    ${Object.entries(c.nonEngineReasons).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
      `    ⚠️ subtractions the census could NOT defend ${c.undefendedSubtractions.length}`
      + ` · of those, type text states an engine door ${c.undefendedSubtractions.filter((u) => u.doorShaped).length}`,
      '',
    ].join('\n'));
  }
  for (const u of c.unledgered) {
    process.stderr.write(`::error::[untyped-receiver] ${u.file}:${u.line} \`${u.receiver}\`.${u.verb}() -- `
      + `receiver type unreadable [${u.how}] and the object name is not a literal declared object. `
      + `Add an UNTYPED_RECEIVERS row saying what it is.\n`);
  }
  // ⚠️ A WARNING, deliberately, and the exit code below is deliberately unchanged.
  // This class is NOT empty on a clean tree (three sites today, two of them with a
  // door signature in their own type text), so refusing here would red `main` for
  // findings nobody has ruled on yet -- and a gate that reds on arrival gets
  // weakened, which is the opposite of what this card asked for. What the census
  // owes is to stop being SILENT: every run now names the receiver and the type it
  // could not place, and both artefacts carry the count under enforcement.
  for (const u of c.undefendedSubtractions) {
    // ⛔ The round-trip arm is NOT printed here: every word of the sentence below
    // ("not in the engine type index", "TRACKED sources only") is false about it.
    // It gets its own ERROR, with the located parse verdict under it.
    if (u.reason === 'type-text-not-round-trippable') continue;
    process.stderr.write(`::warning::[receiver-type-not-placed] ${u.file}:${u.line} \`${u.receiver}\`.${u.verb}() -- `
      + `SUBTRACTED from the certified population: its declared type \`${u.type}\` is not in the engine `
      + `type index [${u.reason}${u.names.length > 0 ? `: ${u.names.join(', ')}` : ''}]. The index is built from `
      + `TRACKED sources only -- an untracked, generated or dependency-owned declaration is one this census `
      + `never saw.${u.doorShaped ? ' ⚠️ That type text states an ObjectQL write door, so this subtraction is'
        + ' probably WRONG -- the door rule is keyed on named declarations and this type is spelled inline.' : ''}\n`);
  }
  for (const r of c.staleLedgerRows) {
    process.stderr.write(`::error::[stale-ledger-row] UNTYPED_RECEIVERS names ${r.file} (receiver `
      + `\`${r.receiver}\`) but no such write call exists -- delete the row.\n`);
  }
  // ⭐ An ERROR, and it counts toward the exit code below -- the deliberate
  // opposite of the warning above it. Before this repair such a site ended the
  // whole process through `parseSourceFile`, so a localisation that let the run
  // exit 0 would have traded a loud takedown for a quiet subtraction. What
  // changed is the BLAST RADIUS: every other site is classified and reported,
  // and this one is named, located, and carries the parse verdict under it.
  // ⚠️ CI reads `check-tenant-audit-census.mjs`, never this generator, so the
  // same class is refused there too -- through `notRoundTrippableSites`, the one
  // spelling both of them import.
  for (const u of notRoundTrippableSites(c)) {
    process.stderr.write(`::error::[type-text-not-round-trippable] ${u.file}:${u.line} \`${u.receiver}\`.${u.verb}() -- `
      + `SUBTRACTED from the certified population: this tool cannot re-parse the declared type it derived `
      + `for this receiver, so the door rule could not be read off it and the census cannot say whether `
      + `this site is an engine write at all. The SOURCE parsed; what did not is this tool's own `
      + `re-serialisation of \`${u.type}\`. ⛔ Nothing is wrong with the code at this site and nothing `
      + `here asks you to restyle it -- this is a defect in the census's own reading, and the parse `
      + `verdict below is the report to file against it.\n`);
    if (u.derivedFailure?.report) process.stderr.write(u.derivedFailure.report);
  }
  return c.unledgered.length === 0 && c.staleLedgerRows.length === 0
    && notRoundTrippableSites(c).length === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
