// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The author-time judge of a picklist REFERENCE: a field's `picklist`, and a
 * `picklistExtensions` entry's `extend`. One that names a shared option list no
 * package in the stack declares is refused, loudly, naming the field (or the
 * extension) and the list it names.
 *
 * ## The defect
 *
 * `Field.select({ picklist: 'industry' })` takes its options from the
 * `picklist` item it names (`data/picklist.zod.ts`). `FieldSchema` checks the
 * NAME's spelling (lowercase snake_case) and nothing else — the reference is
 * resolved against the stack's picklists by nobody at author time. So a typo
 * (`picklist: 'industy'`) parsed, `os validate` exited 0, `os build` wrote the
 * artifact, and the field reached the runtime as a choice with nothing to
 * choose. A named list exists precisely so a wrong reference is a refusal
 * instead of a silently empty control.
 *
 * A `picklistExtensions` entry is the same reference one key over: its
 * `extend` names the list it adds options to, and `PicklistExtensionSchema`
 * checks that name's spelling and nothing else. An `extend: 'industy'` beside
 * `picklists: [{ name: 'industry', … }]` parsed, validated and built the same
 * way, and the artifact shipped an extension of a list nobody declares — the
 * silence this module exists to remove, for a second collection.
 *
 * ## The walk is the boot path's
 *
 * The same reading `view-container-names.ts` makes, for the same reason —
 * what is judged is what boot registers:
 *
 *   - no `packages[]` → the top-level `objects` / `objectExtensions` fields
 *     and `picklistExtensions`, bounded by the top-level
 *     `manifest.dependencies`;
 *   - `packages[]`    → each body's own `objects` / `objectExtensions` /
 *     `picklistExtensions`, bounded by that body's own `dependencies`, and
 *     ⛔ NOT the top level, which the load path does not register from.
 *
 * ## A reference resolves the way the runtime resolves it (ADR-0150 D3)
 *
 * The holders of a list are the bodies that declare it in `picklists` — every
 * `packages[]` body, or the top level when there is no `packages[]`. A field's
 * `picklist` resolves from the package that declares the field: that package's
 * own list, then the unique holder in its declared dependency closure
 * (ADR-0141, plus `sys`), else it is refused naming every candidate. A sibling
 * package of the same artifact is in that closure only when the referring
 * package's manifest declares it, and the author's fix is that one
 * `dependencies` entry: the release artifact is ADR-0130's co-ownership
 * boundary, not a resolution scope (maintainer ruling N1, record 6729820123;
 * ADR-0130's dated note under D1). A `picklistExtensions` entry's `extend` is a
 * contribution to another package's list, not a reference its package reads,
 * so it resolves with no caller: the unique holder in the stack (epic-seat
 * ruling X on the E6 card, ADR-0150 D3).
 *
 * The rule is the runtime's own, not a copy: `resolvePackageScopedHolders`
 * (`@objectstack/core`) over the artifact's holders, with the closure from
 * `packageResolutionClosure` (`@objectstack/metadata-core`) — the calls the
 * registry's `picklistReferenceVerdict` makes, so the refusal here is the
 * sentence the boot warns with and the install judge refuses with.
 *
 * ## A composed stack's top-level picklist that nothing names: refused
 *
 * The boot keeps a composed stack's residual picklist (a top-level one no
 * body declares) as metadata only, and refuses the stack when no object field
 * the engine registers names it (ADR-0130 D4). This door gives the same
 * refusal as {@link PICKLIST_RESIDUAL_UNREFERENCED}, read from the boot's own
 * judgement (`unreferencedResidualPicklists`), so `os validate` and `os build`
 * foretell it in the boot's words. See `findUnreferencedResidualPicklists`.
 *
 * ## Declared dependencies outside the stack: reported, never refused
 *
 * A package may use a picklist another package owns — `picklistExtensions`
 * exists because one package adds values to a list it does not own. When that
 * owner is a declared dependency INSIDE this artifact, its picklists are in
 * the closure above. When it is a dependency OUTSIDE the artifact, this
 * command cannot read it: `manifest.dependencies` maps package IDS to version
 * ranges, which the installer resolves, and nothing maps such an id to a file
 * the CLI could open. So a reference that resolves to no list here — nothing
 * in the stack holds it, or only packages outside the declaring package's
 * closure do — is:
 *
 *   - REFUSED (`severity: 'error'`) when the declaring package names no
 *     dependency outside this stack — nothing else could provide the list;
 *   - REPORTED (`severity: 'info'`, never gating, not even under `--strict`)
 *     when it does — the reference could be right, and a refusal here would
 *     reject a stack that is correct. The notice names the dependencies, so the
 *     skipped judgement is said out loud rather than read as a pass.
 *
 * A reference that reaches TWO holders — two packages of the declaring
 * package's closure for a field, two packages of the stack for an extension —
 * is refused whatever the outside dependencies: an outside package can add a
 * holder, never remove one, and the boot refuses the same ambiguity.
 *
 * A field and an extension take the SAME verdict and the same two rule ids:
 * what is judged is one fact — a name that resolves to no list from where it
 * is written — and the finding's `where`, `path` and message say which key
 * carried it. The extension is where the outside-dependency arm is most at
 * home, since an extension is how a package adds to a list it does not own.
 *
 * ## Why this is not an `@objectstack/lint` registry rule
 *
 * The verdict depends on WHICH package declares the reference: that package's
 * declared dependencies decide between a refusal and a notice. A registry rule
 * is handed one stack, and on the union run that stack is the flattened top
 * level, which carries no package provenance. The walk above is the artifact's
 * package reading, the same class as `findViewContainerNameRefusals`, and both
 * doors call it (`validate.ts` step 2d, `compile.ts` step 3a-bis).
 *
 * The runtime metadata write path (a field saved through Studio or REST
 * `/meta`) is not judged here: the metadata save and publish doors judge it
 * against the engine's registry (`unknownPicklistBindingSaveRefusal`,
 * `@objectstack/metadata-protocol`).
 *
 * Reads the PARSED stack — what `defineStack()` hands the boot wrap, and what
 * `os build` serializes.
 */

import chalk from 'chalk';
import {
  packageScopedHolderSource,
  resolvePackageScopedHolders,
  type PackageScopedRefusal,
  type PackageScopedResolution,
} from '@objectstack/core';
import type { AuthoringFinding } from '@objectstack/lint';
import { packageResolutionClosure, type PackageClosureRegistry } from '@objectstack/metadata-core';
import { unclaimedTopLevel } from '@objectstack/metadata';
import { unreferencedResidualPicklists } from '@objectstack/objectql';

import { artifactPackages } from './artifact-packages.js';
import { printInfo } from './format.js';

/**
 * A field's `picklist`, or a picklist extension's `extend`, names no picklist
 * the stack declares, and nothing outside it could.
 */
export const PICKLIST_REFERENCE_UNKNOWN = 'picklist-reference-unknown';

/** Same, but the declaring package names dependencies outside the stack, which this command cannot read. */
export const PICKLIST_REFERENCE_UNVERIFIED = 'picklist-reference-unverified';

/**
 * A composed stack's top-level picklist that no package body declares and no
 * object field the boot registers names: the boot refuses the stack.
 */
export const PICKLIST_RESIDUAL_UNREFERENCED = 'picklist-residual-unreferenced';

/** What {@link judgePicklistReferences} hands both doors. */
export interface PicklistReferenceJudgement {
  /** `severity: 'error'` — the door exits 1 with these as its `errors`. */
  readonly refusals: readonly AuthoringFinding[];
  /** `severity: 'info'` — carried in `warnings`, never gating. */
  readonly notices: readonly AuthoringFinding[];
}

type AnyRec = Record<string, unknown>;

const asRec = (v: unknown): AnyRec | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRec) : undefined;

/** How many declared names the refusal quotes before it counts the rest. */
const MAX_QUOTED_NAMES = 10;

/** How many outside dependencies the notice quotes before it counts the rest. */
const MAX_QUOTED_DEPENDENCIES = 2;

function dependencyList(quoted: readonly string[]): string {
  return quoted.length <= MAX_QUOTED_DEPENDENCIES
    ? quoted.join(', ')
    : `${quoted.slice(0, MAX_QUOTED_DEPENDENCIES).join(', ')} and ${quoted.length - MAX_QUOTED_DEPENDENCIES} more`;
}

/** One body the boot path registers, with the dependencies that bound it. */
interface JudgedBody {
  /** Path prefix of this body in the parsed stack: `''` or `packages[1].manifest.`. */
  prefix: string;
  body: AnyRec;
  /** The package this body is: the one that holds its `picklists` and writes its fields' references. */
  packageId: string;
  /** What the closure walk reads of it: `dependencies`, `namespace`, `id`. */
  manifest: AnyRec;
  /** Declared dependency ids this artifact does not carry. */
  outside: string[];
}

/**
 * The package a stack with no `packages[]` is, when its manifest names no id.
 * It is the only holder there, so it is never named in a refusal.
 */
const UNNAMED_STACK_PACKAGE = 'this stack';

function declaredDependencyIds(manifestLike: AnyRec | undefined): string[] {
  const declared = asRec(manifestLike?.dependencies);
  return declared ? Object.keys(declared) : [];
}

function bodiesOf(parsed: AnyRec): JudgedBody[] {
  // The resolver's own branch test (`declared === undefined`). On the PARSED
  // stack a present `packages` is an array — `null` and every non-array were
  // refused at the parse.
  if (parsed.packages !== undefined) {
    const packages = artifactPackages(parsed);
    const inside = new Set(packages.map((pkg) => pkg.id));
    return packages.map((pkg) => ({
      prefix: `packages[${pkg.index}].manifest.`,
      body: pkg.body,
      packageId: pkg.id,
      manifest: pkg.body,
      outside: declaredDependencyIds(pkg.body).filter((id) => !inside.has(id)),
    }));
  }
  const manifest = asRec(parsed.manifest);
  const self = typeof manifest?.id === 'string' && manifest.id !== '' ? manifest.id : undefined;
  return [{
    prefix: '',
    body: parsed,
    packageId: self ?? UNNAMED_STACK_PACKAGE,
    manifest: manifest ?? {},
    outside: declaredDependencyIds(manifest).filter((id) => id !== self),
  }];
}

/**
 * The artifact as the one closure walk (`packageResolutionClosure`) reads an
 * installed registry: each body answers `getPackage` for its own id with its
 * manifest — the first body of an id, as a holder holds a name once — and
 * the bodies are every installed package. A declared dependency the artifact
 * does not carry is still in the closure (the walk keeps a declared id it
 * cannot produce); it holds nothing here, which is why it is reported, not
 * judged (module header).
 */
function artifactRegistry(bodies: readonly JudgedBody[]): PackageClosureRegistry {
  const byId = new Map<string, { manifest: AnyRec }>();
  for (const judged of bodies) {
    if (!byId.has(judged.packageId)) byId.set(judged.packageId, { manifest: judged.manifest });
  }
  return {
    getPackage: (id) => byId.get(id),
    getAllPackages: () => [...byId.values()],
  };
}

/**
 * R's verdict on one reference (ADR-0150 D3), from the package that wrote it
 * — `null` for an extension's `extend`, which resolves with no caller (module
 * header) — over the holders the artifact declares.
 */
type ReferenceVerdict = PackageScopedResolution<true>;

function referenceResolver(bodies: readonly JudgedBody[]): (callerPackageId: string | null, picklist: string) => ReferenceVerdict {
  const holdersOf = new Map<string, string[]>();
  for (const judged of bodies) {
    for (const name of picklistNamesOf(judged.body)) {
      const holders = holdersOf.get(name) ?? [];
      if (!holders.includes(judged.packageId)) holders.push(judged.packageId);
      holdersOf.set(name, holders);
    }
  }
  const registry = artifactRegistry(bodies);
  const closureOf = (callerPackageId: string) => packageResolutionClosure(registry, callerPackageId);
  return (callerPackageId, picklist) => resolvePackageScopedHolders<true>(
    { type: 'picklist', name: picklist, callerPackageId },
    packageScopedHolderSource((holdersOf.get(picklist) ?? []).map((id) => [id, true] as const)),
    closureOf,
  );
}

function picklistNamesOf(body: AnyRec): string[] {
  const declared = body.picklists;
  if (!Array.isArray(declared)) return [];
  return declared
    .map((entry) => asRec(entry)?.name)
    .filter((name): name is string => typeof name === 'string' && name !== '');
}

/** One place a body names a picklist, located. */
interface PicklistReference {
  /** The key that carries the name: a field's `picklist`, or an extension's `extend`. */
  site: 'field' | 'extension';
  where: string;
  path: string;
  picklist: string;
}

/**
 * Every picklist a body names, located: the `picklist` of each field its
 * `objects` / `objectExtensions` declare, then the `extend` of each
 * `picklistExtensions` entry.
 */
function referencesOf(judged: JudgedBody): PicklistReference[] {
  const out: PicklistReference[] = [];
  const walkFields = (collection: 'objects' | 'objectExtensions', ownerKey: 'name' | 'extend') => {
    const entries = judged.body[collection];
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, index) => {
      const rec = asRec(entry);
      const fields = asRec(rec?.fields);
      if (!rec || !fields) return;
      const owner = typeof rec[ownerKey] === 'string' ? (rec[ownerKey] as string) : `${collection}[${index}]`;
      for (const [fieldName, def] of Object.entries(fields)) {
        const picklist = asRec(def)?.picklist;
        if (typeof picklist !== 'string' || picklist === '') continue;
        out.push({
          site: 'field',
          where: `field "${owner}.${fieldName}"`,
          path: `${judged.prefix}${collection}[${index}].fields.${fieldName}.picklist`,
          picklist,
        });
      }
    });
  };
  walkFields('objects', 'name');
  walkFields('objectExtensions', 'extend');

  // An extension has no name of its own: the list it extends is its identity,
  // as an `objectExtensions` entry's `extend` is the owner its fields are
  // quoted under above.
  const extensions = judged.body.picklistExtensions;
  if (Array.isArray(extensions)) {
    extensions.forEach((entry, index) => {
      const extend = asRec(entry)?.extend;
      if (typeof extend !== 'string' || extend === '') return;
      out.push({
        site: 'extension',
        where: `picklist extension "${extend}"`,
        path: `${judged.prefix}picklistExtensions[${index}].extend`,
        picklist: extend,
      });
    });
  }
  return out;
}

/** The sentences that differ between a field's reference and an extension's. */
function wordingOf(ref: PicklistReference, declared: readonly string[]): {
  names: string;
  consequence: string;
  refusalHint: string;
  noticeHint: string;
} {
  const key = ref.site === 'field' ? 'picklist' : 'extend';
  const names = `\`${key}: '${ref.picklist}'\` names no picklist this stack declares`;
  const declare = `\`picklists: [{ name: '${ref.picklist}', label, options }]\``;
  if (ref.site === 'field') {
    return {
      names,
      consequence: `${names} (${quoteNames(declared)}), so the field has no list to take its options from.`,
      refusalHint:
        `Declare the list — ${declare} in the stack, or a ` +
        '`*.picklist.ts` file the stack imports — or correct `picklist` to a list the stack declares. ' +
        'Or drop `picklist` and give the field inline `options` of its own.',
      noticeHint:
        `If one of those packages declares '${ref.picklist}', nothing is wrong. Otherwise declare the list ` +
        'in this stack or correct the name.',
    };
  }
  return {
    names,
    consequence: `${names} (${quoteNames(declared)}), so the options it adds have no list to join.`,
    refusalHint:
      'Correct `extend` to the picklist this entry adds options to, or declare that list — ' +
      `${declare} in the package that owns it, or a \`*.picklist.ts\` file the stack imports. ` +
      'Or remove the entry: it adds options to nothing.',
    noticeHint:
      `If one of those packages declares '${ref.picklist}', nothing is wrong. Otherwise declare the list ` +
      'in this stack or correct `extend`.',
  };
}

function quoteNames(names: readonly string[]): string {
  if (names.length === 0) return 'this stack declares no picklist';
  const quoted = names.slice(0, MAX_QUOTED_NAMES).map((n) => `'${n}'`).join(', ');
  const rest = names.length - MAX_QUOTED_NAMES;
  return `declared: ${quoted}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/** A version range a `dependencies` entry on `packageId` could carry: its declared version, caret-ranged. */
function rangeOf(packageId: string, bodies: readonly JudgedBody[]): string {
  const version = bodies.find((b) => b.packageId === packageId)?.manifest.version;
  return typeof version === 'string' && version !== '' ? `^${version}` : '*';
}

/**
 * The fix for a reference R refused (ADR-0150 D3): for a holder outside the
 * declaring package's closure, the one `dependencies` entry that brings it in
 * — the author's one-line fix (ruling N1); for two holders one reference
 * reaches, keeping the list in one of them.
 */
function refusedReferenceHint(refusal: PackageScopedRefusal, bodies: readonly JudgedBody[]): string {
  const holders = refusal.candidates.flatMap((c) => (c.kind === 'package' ? [c.packageId] : []));
  const caller = refusal.callerPackageId;
  if (refusal.reason === 'outside-closure' && caller !== null) {
    // [#32967] A holder that already depends on the caller (a module of the
    // app whose field names it) cannot be declared back: the kernel refuses
    // the cycle at boot. Read off the artifact, so the hint names the open fix.
    const registry = artifactRegistry(bodies);
    const declarable = holders.filter((id) => !packageResolutionClosure(registry, id).has(caller));
    if (holders.length > 0 && declarable.length === 0) {
      return `${holders.length === 1 ? `'${holders[0]}' already depends` : `${holders.map((id) => `'${id}'`).join(' and ')} already depend`} ` +
        `on '${caller}', so declaring a holder back would be a dependency cycle: declare the list in '${caller}' itself, ` +
        `or move the field into the package that holds the list. ` +
        'Until then the installed field serves no options and its values are refused.';
    }
    const declare = declarable.length === 1
      ? `add \`'${declarable[0]}': '${rangeOf(declarable[0], bodies)}'\` to the \`dependencies\` of package '${caller}'`
      : `add the one package whose list the field means (${declarable.map((id) => `'${id}'`).join(' or ')}) ` +
        `to the \`dependencies\` of package '${caller}'`;
    return `Declare the dependency: ${declare}. Or declare the list in '${caller}' itself. ` +
      'Until then the installed field serves no options and its values are refused.';
  }
  return `Keep '${refusal.name}' in one of ${holders.map((id) => `'${id}'`).join(', ')}: rename or remove the others' list, ` +
    'so the reference reaches one list.';
}

/**
 * The notice's verdict and fix for a reference R refused as held only OUTSIDE
 * the declaring package's closure, when that package also depends on a
 * package this stack does not carry: short, because a notice is one line
 * ({@link printPicklistReferenceNotices}) and `os explain` carries the why.
 */
function outsideClosureNotice(
  ref: PicklistReference,
  refusal: PackageScopedRefusal,
  outside: readonly string[],
): { notice: string; noticeHint: string } {
  const holders = dependencyList(refusal.candidates.flatMap((c) => (c.kind === 'package' ? [`'${c.packageId}'`] : [])));
  return {
    notice: `${ref.where}: '${ref.picklist}' is only in ${holders}, undeclared — not judged: ` +
      `${dependencyList(outside.map((id) => `'${id}'`))} may hold it`,
    noticeHint: `If one of those packages declares '${ref.picklist}', nothing is wrong. Otherwise declare a dependency ` +
      `on ${holders} in package '${refusal.callerPackageId}'.`,
  };
}

/**
 * Every picklist reference in this stack — a field's `picklist`, an
 * extension's `extend` — that resolves to no list from where it is written
 * (ADR-0150 D3): refused, or reported when the declaring package names
 * dependencies outside the stack and an outside package could still supply
 * the list. See the module header for the walk, the rule and the two
 * verdicts.
 *
 * Returns two empty lists for a stack whose every reference resolves.
 */
export function judgePicklistReferences(parsed: AnyRec): PicklistReferenceJudgement {
  const bodies = bodiesOf(parsed);
  const declared = [...new Set(bodies.flatMap((b) => picklistNamesOf(b.body)))];
  const verdictOf = referenceResolver(bodies);

  const refusals: AuthoringFinding[] = [];
  const notices: AuthoringFinding[] = [];
  for (const judged of bodies) {
    for (const ref of referencesOf(judged)) {
      const verdict = verdictOf(ref.site === 'extension' ? null : judged.packageId, ref.picklist);
      if (verdict.status === 'resolved') continue;
      // Nothing in the stack holds the name (`not-found`), or R refused it,
      // naming every holder: the runtime's sentence, verbatim.
      const unknown = wordingOf(ref, declared);
      const wording = verdict.status === 'refused'
        ? {
            refusal: verdict.message,
            refusalHint: refusedReferenceHint(verdict, bodies),
            ...(verdict.reason === 'outside-closure' ? outsideClosureNotice(ref, verdict, judged.outside) : { notice: '', noticeHint: '' }),
          }
        : {
            refusal: unknown.consequence,
            refusalHint: unknown.refusalHint,
            notice:
              `${ref.where}: ${unknown.names} — not judged: it may come from ` +
              `${dependencyList(judged.outside.map((id) => `'${id}'`))}, ` +
              `${judged.outside.length === 1 ? 'a dependency' : 'dependencies'} this stack does not carry`,
            noticeHint: unknown.noticeHint,
          };
      // An outside package can only SUPPLY a list: it softens a name nothing
      // here holds, or holds only outside the closure, to a notice. Two
      // holders one reference reaches stay two whatever else is installed,
      // so an ambiguity is refused even then — as the boot refuses it.
      const outsideCouldSupply = verdict.status === 'not-found' || verdict.reason === 'outside-closure';
      if (judged.outside.length === 0 || !outsideCouldSupply) {
        // `where` names the field (or the extension) and every printer leads
        // the line with it, so the message does not repeat it.
        refusals.push({
          severity: 'error',
          rule: PICKLIST_REFERENCE_UNKNOWN,
          where: ref.where,
          path: ref.path,
          message: wording.refusal,
          hint: wording.refusalHint,
        });
      } else {
        notices.push({
          severity: 'info',
          rule: PICKLIST_REFERENCE_UNVERIFIED,
          where: ref.where,
          path: ref.path,
          // The notice printer shows no `where`, so this message names the field or the extension.
          // [#22161] One verdict sentence; why a dependency outside the stack
          // cannot be read is this rule's `RULE_EXPLANATIONS` entry
          // (`os explain picklist-reference-unverified`).
          message: wording.notice,
          hint: wording.noticeHint,
        });
      }
    }
  }
  refusals.push(...findUnreferencedResidualPicklists(parsed));
  return { refusals, notices };
}

/**
 * [ADR-0130 D4] Every top-level picklist of a composed stack (one that carries
 * `packages[]`) that no package body declares and no object field the boot
 * registers names — each one the boot refuses (`INVALID_METADATA`) before
 * anything of the stack registers. `[]` for a stack without `packages[]`,
 * whose top level IS its one package.
 *
 * Which items are residual is the residual rule's answer (`unclaimedTopLevel`,
 * `@objectstack/metadata`); which of its lists nothing names, and the words,
 * are the boot's own judgement, `unreferencedResidualPicklists` (re-exported by
 * `@objectstack/objectql`), which the `manifest` service throws as one
 * sentence. This door only reports it, one finding per list, located at the
 * list's top-level index. ⛔ Never re-derived or re-worded here.
 *
 * A residual picklist that a field DOES name is not this judge's: a residual
 * object's field makes that object listed and not served at boot, and a
 * body's field is {@link PICKLIST_REFERENCE_UNKNOWN} above.
 */
function findUnreferencedResidualPicklists(parsed: AnyRec): AuthoringFinding[] {
  if (parsed.packages === undefined) return [];
  const unreferenced = unreferencedResidualPicklists(
    unclaimedTopLevel(parsed),
    artifactPackages(parsed).map((pkg) => pkg.body),
  );
  return (unreferenced?.picklists ?? []).map((list) => ({
    severity: 'error' as const,
    rule: PICKLIST_RESIDUAL_UNREFERENCED,
    where: `picklist "${list.name}"`,
    path: `${list.field}[${list.index}]`,
    message: list.wording.judgement,
    hint: list.wording.prescription,
  }));
}

/**
 * The text face of the notices for `os validate` and `os build`, printed at the
 * step that computes them so they show on the failing paths too.
 */
export function printPicklistReferenceNotices(notices: readonly AuthoringFinding[]): void {
  for (const n of notices) {
    printInfo(`[${n.rule}] ${n.message}`);
    console.log(chalk.dim(`      → ${n.hint}`));
  }
}

/**
 * The text face's heading over {@link judgePicklistReferences}'s refusals, for
 * `os validate` and `os build` alike: one line naming what was refused, by the
 * rules that refused it.
 */
export function picklistRefusalHeading(refusals: readonly AuthoringFinding[]): string {
  const residual = refusals.filter((r) => r.rule === PICKLIST_RESIDUAL_UNREFERENCED).length;
  const references = refusals.length - residual;
  const parts: string[] = [];
  if (references > 0) {
    parts.push(
      'a picklist reference names a picklist this stack does not declare, or one only a package outside its ' +
      `package's declared dependencies holds (${references} reference${references > 1 ? 's' : ''})`,
    );
  }
  if (residual > 0) {
    parts.push(`a top-level picklist of this composed stack is one the boot refuses: no package body declares it and no object field the engine registers names it (${residual} picklist${residual > 1 ? 's' : ''})`);
  }
  const line = parts.join('; and ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
