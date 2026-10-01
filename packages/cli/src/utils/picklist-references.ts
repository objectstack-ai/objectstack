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
 * A reference RESOLVES against every picklist the stack declares — every
 * `packages[]` body's `picklists`, or the top-level `picklists` when there is
 * no `packages[]`. The release artifact is the co-ownership boundary
 * (ADR-0130), so a list a SIBLING package in the same artifact owns resolves
 * here exactly as one the declaring package owns.
 *
 * ## Declared dependencies outside the stack: reported, never refused
 *
 * A package may use a picklist another package owns — `picklistExtensions`
 * exists because one package adds values to a list it does not own. When that
 * owner is a declared dependency INSIDE this artifact, its picklists are in
 * the resolution set above. When it is a dependency OUTSIDE the artifact, this
 * command cannot read it: `manifest.dependencies` maps package IDS to version
 * ranges, which the installer resolves, and nothing maps such an id to a file
 * the CLI could open. So a reference that resolves nowhere here is:
 *
 *   - REFUSED (`severity: 'error'`) when the declaring package names no
 *     dependency outside this stack — nothing else could provide the list;
 *   - REPORTED (`severity: 'info'`, never gating, not even under `--strict`)
 *     when it does — the reference could be right, and a refusal here would
 *     reject a stack that is correct. The notice names the dependencies, so the
 *     skipped judgement is said out loud rather than read as a pass.
 *
 * A field and an extension take the SAME verdict and the same two rule ids:
 * what is judged is one fact — a name that resolves to no picklist the stack
 * declares — and the finding's `where`, `path` and message say which key
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
 * ⚠️ Bound, stated rather than hidden: the runtime metadata write path (a field
 * saved through Studio or REST `/meta`) is not judged here.
 *
 * Reads the PARSED stack — what `defineStack()` hands the boot wrap, and what
 * `os build` serializes.
 */

import chalk from 'chalk';
import type { AuthoringFinding } from '@objectstack/lint';

import { artifactPackages } from './artifact-packages.js';
import { printInfo } from './format.js';

/**
 * A field's `picklist`, or a picklist extension's `extend`, names no picklist
 * the stack declares, and nothing outside it could.
 */
export const PICKLIST_REFERENCE_UNKNOWN = 'picklist-reference-unknown';

/** Same, but the declaring package names dependencies outside the stack, which this command cannot read. */
export const PICKLIST_REFERENCE_UNVERIFIED = 'picklist-reference-unverified';

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

/** One body the boot path registers, with the dependencies that bound it. */
interface JudgedBody {
  /** Path prefix of this body in the parsed stack: `''` or `packages[1].manifest.`. */
  prefix: string;
  body: AnyRec;
  /** Declared dependency ids this artifact does not carry. */
  outside: string[];
}

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
      outside: declaredDependencyIds(pkg.body).filter((id) => !inside.has(id)),
    }));
  }
  const manifest = asRec(parsed.manifest);
  const self = typeof manifest?.id === 'string' ? manifest.id : undefined;
  return [{
    prefix: '',
    body: parsed,
    outside: declaredDependencyIds(manifest).filter((id) => id !== self),
  }];
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
  /** What the notice calls the thing the declaring package declares. */
  declarer: string;
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
      declarer: 'the field',
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
    declarer: 'the extension',
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

/**
 * Every picklist reference in this stack — a field's `picklist`, an
 * extension's `extend` — that resolves to no picklist the stack declares:
 * refused, or reported when the declaring package names dependencies outside
 * the stack. See the module header for the walk and the two verdicts.
 *
 * Returns two empty lists for a stack whose every reference resolves.
 */
export function judgePicklistReferences(parsed: AnyRec): PicklistReferenceJudgement {
  const bodies = bodiesOf(parsed);
  const declared = [...new Set(bodies.flatMap((b) => picklistNamesOf(b.body)))];
  const known = new Set(declared);

  const refusals: AuthoringFinding[] = [];
  const notices: AuthoringFinding[] = [];
  for (const judged of bodies) {
    for (const ref of referencesOf(judged)) {
      if (known.has(ref.picklist)) continue;
      const wording = wordingOf(ref, declared);
      if (judged.outside.length === 0) {
        // `where` names the field (or the extension) and every printer leads
        // the line with it, so the message does not repeat it.
        refusals.push({
          severity: 'error',
          rule: PICKLIST_REFERENCE_UNKNOWN,
          where: ref.where,
          path: ref.path,
          message: wording.consequence,
          hint: wording.refusalHint,
        });
      } else {
        notices.push({
          severity: 'info',
          rule: PICKLIST_REFERENCE_UNVERIFIED,
          where: ref.where,
          path: ref.path,
          // The notice printer shows no `where`, so this message names the field or the extension.
          message:
            `${ref.where}: ${wording.names} — not judged: the package declaring ${wording.declarer} depends on ` +
            `${judged.outside.map((id) => `'${id}'`).join(', ')}, which this stack does not carry, ` +
            'and whose picklists this command cannot read.',
          hint: wording.noticeHint,
        });
      }
    }
  }
  return { refusals, notices };
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
