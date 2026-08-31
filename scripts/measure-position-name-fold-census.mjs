#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// measure-position-name-fold-census -- the #13419 census instrument.
//
//   node scripts/measure-position-name-fold-census.mjs               # census (要点 1)
//   node scripts/measure-position-name-fold-census.mjs --json        # machine
//   node scripts/measure-position-name-fold-census.mjs --self-test   # controls only
//   node scripts/measure-position-name-fold-census.mjs --audit FILE  # report (要点 4)
//   node scripts/measure-position-name-fold-census.mjs --audit-schema
//
// It is NOT a gate: not wired into any workflow, exits 0 on any membership
// count, and deliberately not named `check:*` or `gen:*` so the #4203 script
// ledger has nothing to classify -- the shape
// `measure-durability-swallow-family.mjs` established. The only non-zero exits
// are a failing self-test and an unreadable `--audit` input.
//
// ## Why it exists
//
// #13419, maintainer ruling of 2026-08-31 (verbatim 「同意」). The ruling
// retires the name-fold channel in favour of the governed
// `sys_position_permission_set` junction, and orders the work 「顺序即依赖」:
//
//   1. 普查先行 -- census every binding that depends on name-based resolution,
//      WITH POSITIVE CONTROLS. (This script's default mode.)
//   2. 物化 -- materialise the legitimate ones as junction rows. ⛔ 不物化不删折叠.
//   3. 删折叠 -- delete the fold, warn on collisions.
//   4. 隐式授予审计报告 -- per organization, the grants actually in effect via
//      name-match with NO junction row. (This script's `--audit` mode.)
//
// This script is step 1 and the generator for step 4. It changes no resolution
// behaviour and reads no source file it does not print a citation for.
//
// ## The mechanism being measured (re-located by SYMBOL, never by line number)
//
// `SecurityPlugin.resolvePermissionSetsForContextUnmemoized`
// (packages/plugins/plugin-security/src/security-plugin.ts):
//
//     const positions = context?.positions ?? [];
//     const explicitPermissionSets = context?.permissions ?? [];
//     const requested = [...positions, ...explicitPermissionSets];
//
// `requested` is then handed to `PermissionEvaluator.resolvePermissionSets`,
// which matches NAMES against (a) `metadataService.list('permission')`,
// (b) the plugin-owned `bootstrapPermissionSets`, (c) a `sys_permission_set`
// db loader. So a position NAME that equals a permission set NAME grants that
// set -- with no junction row, no declaration, no audit trail.
//
// The upstream deactivation sweep documents the same fold from the other side
// (packages/core/src/security/resolve-authz-context.ts, step 6a): a deactivated
// position's NAME is dropped from `grants.positions` too, "because
// resolvePermissionSetsForContext requests positions as permission-set NAMES
// (position names are commonly reused as set names)". That comment is the
// ruling's 「上游停用清扫的注释自证知情」.
//
// The GOVERNED channel is the other half of step 6a: active `sys_position` ids
// -> `sys_position_permission_set` rows -> `sys_permission_set` rows -> names.
//
// ## The predicate, stated so it can be argued with
//
// A declared position name N is a NAME-FOLD DEPENDENCY when both hold:
//
//   1. COLLISION -- some permission set is declared under the same name N.
//   2. NO JUNCTION -- nothing in this repository creates a
//      `sys_position_permission_set` row binding position N to set N.
//
// Then every principal holding position N resolves permission set N, and the
// junction table shows nothing. Delete the fold without materialising that
// row (要点 2) and the grant disappears silently -- which is the whole reason
// the ruling put the census first.
//
// Two collision SCOPES are reported separately, because they answer different
// questions for 要点 2:
//
//   - `intra_scope`  -- one artifact declares both halves. A fold in EVERY
//                       deployment of that artifact.
//   - `cross_scope`  -- position from artifact X, set from artifact Y. A fold
//                       in every deployment where BOTH are installed. The fold
//                       matches a bare name with no namespace and no app
//                       scoping, so this is a real channel, not a modelling
//                       artefact -- it is the ruling's 「建一个与既有 position
//                       同名的 permission set,即可让持有该 position 的所有主体
//                       获得它」 spelled as two packages instead of one.
//
// ## What this instrument CANNOT see, stated up front
//
// Positions and permission sets are RUNTIME rows. This census reads
// DECLARATIONS in this repository. An operator who creates a position in Setup
// named after an existing permission set produces a name-fold that no static
// census can ever see. That population is measurable only against a real
// deployment -- which is exactly what `--audit` consumes, and why `--audit`
// refuses to call an empty input "zero".
//
// ⚠️ A zero from the static census is a zero over DECLARATIONS, never over a
// deployment. The report prints that sentence next to every zero it emits.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache', '.next']);

/* ------------------------------------------------------------------------- *
 *  Corpus scan
 * ------------------------------------------------------------------------- */

/** Every file under `root` whose extension is in `exts`, repo-relative. */
function walk(root, exts, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, exts, out);
    } else if (exts.has(path.extname(e.name))) {
      out.push(path.relative(REPO_ROOT, full));
    }
  }
  return out;
}

/**
 * The declaring ARTIFACT a file belongs to -- the unit that gets installed
 * together, and therefore the unit a collision is `intra_scope` within.
 */
function scopeOf(relFile) {
  if (relFile.startsWith('examples/')) return relFile.split('/').slice(0, 2).join('/');
  if (relFile.includes('__fixtures__/hotcrm')) return 'artifact:hotcrm';
  if (relFile.startsWith('packages/spec/') || relFile.startsWith('packages/plugins/plugin-security/')) return 'platform';
  return relFile.split('/').slice(0, 2).join('/');
}

/** `export const IDENT = 'literal';` across the two packages that own the names. */
function scanStringConstants() {
  const consts = new Map();
  const files = [
    ...walk(path.join(REPO_ROOT, 'packages/spec/src'), new Set(['.ts'])),
    ...walk(path.join(REPO_ROOT, 'packages/plugins/plugin-security/src'), new Set(['.ts'])),
  ];
  for (const rel of files) {
    if (rel.includes('.test.')) continue;
    const src = read(rel);
    const re = /export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(src)) !== null) consts.set(m[1], m[2]);
  }
  return consts;
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/**
 * The text of the balanced object literal whose `{` is at or after `from`.
 *
 * ⚠️ A fixed-size window is NOT good enough here, and the first run of this
 * script proved it: a 4000-character look-ahead from `showcase_ops` reached the
 * `isDefault: true` belonging to `showcase_member_default` ~90 lines later, and
 * the census reported two junction bindings (`everyone -> showcase_ops`,
 * `everyone -> showcase_client_liaison`) that no code creates. Over-collection
 * on the JUNCTION side is the dangerous direction: it marks a pair governed and
 * suppresses the name-fold that would otherwise be reported.
 *
 * Strings and comments are skipped so a brace inside either cannot unbalance
 * the count.
 */
function objectLiteralAt(src, from) {
  const start = src.indexOf('{', from);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      for (let j = i + 1; j < src.length; j += 1) {
        if (src[j] === '\\') { j += 1; continue; }
        if (src[j] === ch) { i = j; break; }
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

/**
 * The first `name:` inside the declaration's own object literal.
 * Both `definePosition`/`definePermissionSet` and the platform's
 * `PermissionSetSchema.parse({...})` put it first, and a nested `name:`
 * (an RLS rule inside a permission set) is therefore never the first one.
 */
function firstNameAfter(src, from, consts) {
  const m = /name:\s*(?:'([^']*)'|"([^"]*)"|([A-Z][A-Z0-9_]*))/.exec(objectLiteralAt(src, from));
  if (!m) return null;
  if (m[1] ?? m[2]) return m[1] ?? m[2];
  return consts.get(m[3]) ?? null;
}

/** Whether the declaration's OWN object literal declares `isDefault: true`. */
function isDefaultAfter(src, from) {
  return /isDefault:\s*true/.test(objectLiteralAt(src, from));
}

function scanDeclarations(consts) {
  const positions = new Map();
  const permissionSets = new Map();
  const add = (map, name, entry) => {
    if (!name) return;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(entry);
  };

  // 1. Built-in identities and audience anchors -- the platform's own roster.
  for (const ident of ['BUILTIN_IDENTITY_PLATFORM_ADMIN', 'BUILTIN_IDENTITY_ORG_OWNER',
    'BUILTIN_IDENTITY_ORG_ADMIN', 'BUILTIN_IDENTITY_ORG_MEMBER', 'EVERYONE_POSITION', 'GUEST_POSITION']) {
    add(positions, consts.get(ident), {
      scope: 'platform', kind: 'builtin',
      file: 'packages/spec/src/identity (BUILTIN_IDENTITY_NAMES / AUDIENCE_ANCHOR_POSITIONS)', line: 0,
    });
  }

  // 2. `definePosition` / `definePermissionSet` call sites, anywhere.
  const tsFiles = [
    ...walk(path.join(REPO_ROOT, 'packages'), new Set(['.ts'])),
    ...walk(path.join(REPO_ROOT, 'examples'), new Set(['.ts'])),
    ...walk(path.join(REPO_ROOT, 'apps'), new Set(['.ts'])),
  ];
  for (const rel of tsFiles) {
    if (rel.includes('.test.') || rel.includes('.d.ts')) continue;
    const src = read(rel);
    for (const [needle, map, kind] of [
      ['definePosition({', positions, 'declared'],
      ['definePermissionSet({', permissionSets, 'declared'],
    ]) {
      let i = src.indexOf(needle);
      while (i !== -1) {
        const name = firstNameAfter(src, i, consts);
        add(map, name, {
          scope: scopeOf(rel), kind, file: rel, line: lineOf(src, i),
          ...(map === permissionSets ? { isDefault: isDefaultAfter(src, i) } : {}),
        });
        i = src.indexOf(needle, i + 1);
      }
    }
  }

  // 3. The platform's shipped permission sets.
  const dps = 'packages/plugins/plugin-security/src/objects/default-permission-sets.ts';
  const dpsSrc = read(dps);
  let j = dpsSrc.indexOf('PermissionSetSchema.parse({');
  while (j !== -1) {
    add(permissionSets, firstNameAfter(dpsSrc, j, consts), {
      scope: 'platform', kind: 'builtin', file: dps, line: lineOf(dpsSrc, j),
      isDefault: isDefaultAfter(dpsSrc, j),
    });
    j = dpsSrc.indexOf('PermissionSetSchema.parse({', j + 1);
  }

  // 4. Composed app artifacts -- a built app as it ships, the shape the
  //    #13419 observation came from. In-repo these are metadata fixtures;
  //    the marketplace's own artifacts are NOT here (see NOT MEASURED).
  for (const rel of walk(path.join(REPO_ROOT, 'packages'), new Set(['.json']))) {
    if (!rel.includes('artifact')) continue;
    let doc;
    try {
      doc = JSON.parse(read(rel));
    } catch {
      continue;
    }
    for (const [key, map, kind] of [
      ['positions', positions, 'artifact'],
      ['permissions', permissionSets, 'artifact'],
    ]) {
      if (!Array.isArray(doc?.[key])) continue;
      for (const item of doc[key]) {
        add(map, item?.name, {
          scope: scopeOf(rel), kind, file: rel, line: 0,
          ...(map === permissionSets ? { isDefault: item?.isDefault === true } : {}),
        });
      }
    }
  }

  return { positions, permissionSets };
}

/**
 * Junction rows this repository creates. Two producers exist, both located by
 * reading the code (never by name-matching):
 *
 *  - an app's imperative binder, exporting a `[position, set]` tuple list
 *    (`examples/app-showcase/src/security/bind-position-sets.ts`);
 *  - `SecurityPlugin`'s `bindBaselineToEveryone` (ADR-0090 D5), which binds the
 *    configured baseline set(s) to each organization's `everyone` anchor, plus
 *    the same auto-bind for an app's own `isDefault` set.
 */
function scanJunctionBindings(consts, permissionSets) {
  const bindings = [];
  const everyone = consts.get('EVERYONE_POSITION') ?? 'everyone';

  // ⚠️ Anchored on the tuple TYPE, not on the constant's NAME. The first
  // version of this scan looked for the identifier
  // `POSITION_PERMISSION_SET_BINDINGS` -- which is what app-showcase happens to
  // call its list. app-crm calls the identical structure `BINDINGS`, so three
  // real junction rows (sales_rep / sales_manager / finance_approver ->
  // crm_sales_user) were invisible, and `finance_approver` was reported INERT
  // while it is in fact bound. Under-collection on the junction side is how a
  // census hands 要点 2 a worklist that deletes a live grant.
  //
  // The labelled tuple `[position: string, permissionSet: string]` is what both
  // binders actually share, and it is a declaration a new binder cannot omit
  // without also giving up the type.
  const TUPLE_TYPE = /\[\s*position:\s*string\s*,\s*permissionSet:\s*string\s*\]/;
  for (const rel of [
    ...walk(path.join(REPO_ROOT, 'examples'), new Set(['.ts'])),
    ...walk(path.join(REPO_ROOT, 'packages'), new Set(['.ts'])),
    ...walk(path.join(REPO_ROOT, 'apps'), new Set(['.ts'])),
  ]) {
    if (rel.includes('.test.')) continue;
    const src = read(rel);
    const typed = TUPLE_TYPE.exec(src);
    const named = src.indexOf('POSITION_PERMISSION_SET_BINDINGS');
    const anchor = typed ? typed.index : named;
    if (anchor === -1 || anchor === undefined) continue;
    const open = src.indexOf('[', src.indexOf('=', anchor));
    const close = src.indexOf('];', open);
    if (open === -1 || close === -1) continue;
    const re = /\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g;
    let m;
    while ((m = re.exec(src.slice(open, close))) !== null) {
      bindings.push({
        position: m[1], set: m[2], scope: scopeOf(rel), file: rel,
        line: lineOf(src, anchor), via: 'app binder (kernel:bootstrapped)',
      });
    }
  }

  // The ADR-0090 D5 baseline auto-bind. `PLATFORM_BASELINE_PERMISSION_SET` is
  // the configured default; a deployment may configure others, which is why the
  // audit report never assumes this is the only junction row it will meet.
  const baseline = consts.get('PLATFORM_BASELINE_PERMISSION_SET');
  if (baseline) {
    bindings.push({
      position: everyone, set: baseline, scope: 'platform',
      file: 'packages/plugins/plugin-security/src/security-plugin.ts',
      line: 0, via: 'bindBaselineToEveryone (ADR-0090 D5)',
    });
  }
  for (const [name, decls] of permissionSets) {
    for (const d of decls) {
      if (d.isDefault !== true) continue;
      bindings.push({
        position: everyone, set: name, scope: d.scope, file: d.file, line: d.line,
        via: 'isDefault auto-bind / audience-binding suggestion (ADR-0090 D5/D9)',
      });
    }
  }
  return bindings;
}

/* ------------------------------------------------------------------------- *
 *  The census
 * ------------------------------------------------------------------------- */

function census() {
  const consts = scanStringConstants();
  const { positions, permissionSets } = scanDeclarations(consts);
  const bindings = scanJunctionBindings(consts, permissionSets);
  const bound = new Set(bindings.map((b) => `${b.position}::${b.set}`));

  const nameFolds = [];
  const junctionOnSameName = [];
  for (const [name, posDecls] of positions) {
    const setDecls = permissionSets.get(name);
    if (!setDecls) continue;
    const record = {
      name,
      positions: posDecls.map((d) => ({ scope: d.scope, kind: d.kind, file: d.file, line: d.line })),
      permissionSets: setDecls.map((d) => ({ scope: d.scope, kind: d.kind, file: d.file, line: d.line })),
      collision: posDecls.some((p) => setDecls.some((s) => s.scope === p.scope)) ? 'intra_scope' : 'cross_scope',
    };
    if (bound.has(`${name}::${name}`)) junctionOnSameName.push(record);
    else nameFolds.push(record);
  }

  // A declared position that neither carries a junction binding nor collides
  // with a set name grants nothing beyond the baseline. Not a name-fold -- but
  // it IS the population 要点 3's warning must not fire on, so the census
  // reports it rather than dropping it.
  const inert = [];
  for (const [name, decls] of positions) {
    if (permissionSets.has(name)) continue;
    if (bindings.some((b) => b.position === name)) continue;
    inert.push({ name, declarations: decls.map((d) => ({ scope: d.scope, file: d.file, line: d.line })) });
  }

  return {
    positions, permissionSets, bindings, nameFolds, junctionOnSameName, inert,
    stats: {
      positionNames: positions.size,
      permissionSetNames: permissionSets.size,
      junctionBindings: bindings.length,
      nameFolds: nameFolds.length,
      inertPositions: inert.length,
    },
  };
}

/* ------------------------------------------------------------------------- *
 *  要点 4 -- the implicit-grant audit report
 * ------------------------------------------------------------------------- */

const AUDIT_SCHEMA = `Input for \`--audit\` -- one export per deployment, organizations kept apart:

{
  "source": "REQUIRED provenance: which deployment, which pin, who exported it",
  "organizations": [
    {
      "id": "org_...",
      "name": "optional label",
      "positions":      [ { "id": "pos_...", "name": "sales_manager", "active": true } ],
      "permissionSets": [ { "id": "ps_...",  "name": "sales_manager", "active": true } ],
      "junction":       [ { "position_id": "pos_...", "permission_set_id": "ps_..." } ],
      "assignments":    [ { "user_id": "u_...", "position_id": "pos_..." } ]
    }
  ]
}

positions      <- SELECT id, name, active FROM sys_position          WHERE organization_id = :org
permissionSets <- SELECT id, name, active FROM sys_permission_set    WHERE organization_id = :org
junction       <- SELECT position_id, permission_set_id FROM sys_position_permission_set
assignments    <- SELECT user_id, position_id FROM sys_user_position   (OPTIONAL: blast radius)

\`assignments\` is optional. Without it the report still names every implicit
grant; with it, each one carries how many principals hold it today.

⚠️ An organization whose \`positions\` or \`permissionSets\` is empty is reported
NOT_MEASURED, never "zero implicit grants" -- an empty dev database and a clean
deployment are indistinguishable at the query, and reading one as the other is
the failure #12775 is stuck on.`;

/**
 * The report. Mirrors the runtime exactly:
 *   - a DEACTIVATED position grants nothing (ADR-0049, resolve-authz-context 6a
 *     drops its name from `grants.positions` as well as its junction rows);
 *   - a DEACTIVATED permission set grants nothing (ADR-0049, step 6b);
 *   - `everyone` is held implicitly by every authenticated member (step 5), so
 *     an implicit grant on `everyone` reaches the whole organization.
 */
function auditImplicitGrants(input) {
  const orgs = Array.isArray(input?.organizations) ? input.organizations : null;
  if (!orgs) {
    return { status: 'NOT_MEASURED', reason: 'input has no `organizations` array', organizations: [] };
  }
  if (orgs.length === 0) {
    return {
      status: 'NOT_MEASURED',
      reason: 'input carries ZERO organizations -- an export that reached no tenant, not a deployment without implicit grants',
      organizations: [],
    };
  }

  const results = orgs.map((org) => {
    const positions = Array.isArray(org?.positions) ? org.positions : [];
    const sets = Array.isArray(org?.permissionSets) ? org.permissionSets : [];
    const junction = Array.isArray(org?.junction) ? org.junction : [];
    const assignments = Array.isArray(org?.assignments) ? org.assignments : null;

    if (positions.length === 0 || sets.length === 0) {
      return {
        organization: org?.id ?? '(unidentified)',
        status: 'NOT_MEASURED',
        reason: `export carries ${positions.length} position row(s) and ${sets.length} permission-set row(s)`
          + ' -- at least one table came back empty, so a zero here would be indistinguishable from an empty database',
        implicitGrants: [],
      };
    }

    const isActive = (r) => r?.active !== false && r?.is_active !== false;
    const boundPairs = new Set(junction.map((r) => `${r?.position_id}::${r?.permission_set_id ?? r?.permissionSetId}`));
    const holders = assignments
      ? assignments.reduce((m, a) => m.set(a?.position_id, (m.get(a?.position_id) ?? 0) + 1), new Map())
      : null;

    const implicitGrants = [];
    for (const p of positions) {
      if (!isActive(p)) continue;
      for (const s of sets) {
        if (s?.name !== p?.name || !isActive(s)) continue;
        if (boundPairs.has(`${p.id}::${s.id}`)) continue;
        implicitGrants.push({
          name: p.name,
          positionId: p.id,
          permissionSetId: s.id,
          channel: 'name-fold (requested = [...positions, ...explicitPermissionSets])',
          ...(p.name === 'everyone'
            ? { reach: 'EVERY authenticated member of this organization (everyone is held implicitly)' }
            : {}),
          ...(holders ? { principalsHolding: holders.get(p.id) ?? 0 } : {}),
        });
      }
    }

    return {
      organization: org?.id ?? '(unidentified)',
      status: 'MEASURED',
      counted: { positions: positions.length, permissionSets: sets.length, junctionRows: junction.length },
      blastRadiusMeasured: Boolean(assignments),
      implicitGrants,
    };
  });

  const measured = results.filter((r) => r.status === 'MEASURED');
  return {
    status: measured.length === 0 ? 'NOT_MEASURED' : 'MEASURED',
    ...(measured.length === 0 ? { reason: 'no organization in this export was measurable' } : {}),
    source: input?.source ?? null,
    organizations: results,
  };
}

/* ------------------------------------------------------------------------- *
 *  Declared controls -- asserted before ANY reading is printed
 * ------------------------------------------------------------------------- */

/**
 * The two anchors the ruling names, plus the parse-integrity controls that stop
 * a drifted scanner from reporting a quiet zero.
 *
 * Chosen by reading the code before the instrument was first run: a control
 * read off the output would only prove the instrument agrees with itself.
 */
const CONTROLS = {
  /** Ruling anchor A: HAS a junction row -- must NOT be reported as a name-dependency. */
  junctionAnchor: {
    position: 'everyone',
    set: 'member_default',
    why: 'ADR-0090 D5. `bindBaselineToEveryone` in security-plugin.ts inserts this'
      + ' `sys_position_permission_set` row per organization. It is the one row the #13419'
      + ' observation found in the junction table, and the census must classify it as a JUNCTION'
      + ' binding. It must also never appear as a name-fold -- and not merely because the two'
      + ' names differ: the pair must be present in the junction output.',
  },
  /**
   * Ruling anchor B: relies on the NAME -- must be DETECTED.
   *
   * ⚠️ TO WHOEVER LANDS 要点 2. This control pins TODAY's state: `sales_manager`
   * is a name-fold *because nothing binds it yet*. The moment you materialise
   * its junction row, the pair moves from `nameFolds` to `junctionOnSameName`
   * and this control goes RED -- correctly. That is the ledger noticing the
   * world changed, not a broken instrument. Measured both directions before
   * this shipped: deleting the artifact's set half makes the control fail and
   * the census refuse to print; adding `['sales_rep','sales_rep']` to an app
   * binder moves `sales_rep` out of `nameFolds` (2 -> 1) and into
   * `junctionOnSameName`. Re-point this anchor at a pair still on the fold, or
   * retire it with the fold itself in 要点 3.
   */
  nameFoldAnchor: {
    name: 'sales_manager',
    why: 'The #13419 observation: a principal holding the `sales_manager` POSITION resolves the'
      + ' `sales_manager` PERMISSION SET with no junction row. In-repo both halves are declared --'
      + ' the position by examples/app-crm, the set by the composed HotCRM artifact fixture -- so'
      + ' the detector fires on real declarations, not on a fixture written to make it fire.',
  },
  /** Negative: junction-bound under DIFFERENT names -- must not be a name-fold. */
  negative: {
    position: 'contributor',
    set: 'showcase_contributor',
    why: 'app-showcase binds every persona through `POSITION_PERMISSION_SET_BINDINGS`, and its sets'
      + ' are prefixed so no name collides. If this pair ever shows up as a name-fold, the'
      + ' collision predicate has stopped requiring a collision.',
  },
  /** Parse integrity: a drifted scanner must go red, not quiet. */
  builtinPositions: ['everyone', 'guest', 'platform_admin', 'org_member'],
  builtinPermissionSets: ['admin_full_access', 'organization_admin', 'member_default', 'viewer_readonly'],
  /**
   * Regression control -- the `isDefault` window bug this instrument shipped
   * with and its first run exposed. `showcase_member_default` is the ONLY
   * app-showcase set declaring `isDefault: true`; a look-ahead that is not
   * bounded by the declaration's own object literal reaches it from
   * `showcase_ops` ~90 lines earlier and invents an `everyone -> showcase_ops`
   * junction binding. Over-collection on the junction side marks a pair
   * governed and SUPPRESSES a name-fold, so it must stay red-able.
   */
  isDefaultBleed: { bound: 'showcase_member_default', unbound: ['showcase_ops', 'showcase_client_liaison'] },
  /**
   * Second binder control -- a DIFFERENT app, whose binding list is named
   * `BINDINGS`, not `POSITION_PERMISSION_SET_BINDINGS`. The first version of the
   * binder scan keyed on that identifier and silently missed all three of
   * app-crm's rows, reporting `finance_approver` as an INERT position while it
   * is bound. One binder is not a population: if this control ever goes red,
   * the scan has gone back to recognising one app's spelling.
   *
   * It also pins the distinction 要点 2 turns on: `sales_manager` IS junction
   * bound (to `crm_sales_user`) and is STILL a name-fold, because the fold is
   * about the pair (position N, set N) -- binding N to some other set does not
   * retire it.
   */
  secondBinder: { position: 'finance_approver', set: 'crm_sales_user' },
};

/** Synthetic inputs -- they exercise the `--audit` GENERATOR, never a reading. */
const AUDIT_CONTROLS = [
  {
    label: 'collision with no junction row => one implicit grant',
    input: {
      source: 'self-test fixture',
      organizations: [{
        id: 'org_a',
        positions: [{ id: 'p1', name: 'sales_manager', active: true }],
        permissionSets: [{ id: 's1', name: 'sales_manager', active: true }],
        junction: [],
        assignments: [{ user_id: 'u1', position_id: 'p1' }, { user_id: 'u2', position_id: 'p1' }],
      }],
    },
    expect: (r) => r.status === 'MEASURED'
      && r.organizations[0].implicitGrants.length === 1
      && r.organizations[0].implicitGrants[0].principalsHolding === 2,
  },
  {
    label: 'same collision WITH a junction row => governed, zero implicit grants',
    input: {
      source: 'self-test fixture',
      organizations: [{
        id: 'org_b',
        positions: [{ id: 'p1', name: 'sales_manager', active: true }],
        permissionSets: [{ id: 's1', name: 'sales_manager', active: true }],
        junction: [{ position_id: 'p1', permission_set_id: 's1' }],
      }],
    },
    expect: (r) => r.status === 'MEASURED' && r.organizations[0].implicitGrants.length === 0,
  },
  {
    label: 'DEACTIVATED position grants nothing (ADR-0049)',
    input: {
      source: 'self-test fixture',
      organizations: [{
        id: 'org_c',
        positions: [{ id: 'p1', name: 'sales_manager', active: false }],
        permissionSets: [{ id: 's1', name: 'sales_manager', active: true }],
        junction: [],
      }],
    },
    expect: (r) => r.status === 'MEASURED' && r.organizations[0].implicitGrants.length === 0,
  },
  {
    label: 'EMPTY export reads NOT_MEASURED, never "zero implicit grants" (the #12775 shape)',
    input: { source: 'self-test fixture', organizations: [{ id: 'org_d', positions: [], permissionSets: [], junction: [] }] },
    expect: (r) => r.status === 'NOT_MEASURED' && r.organizations[0].status === 'NOT_MEASURED',
  },
  {
    label: 'export with zero organizations reads NOT_MEASURED',
    input: { source: 'self-test fixture', organizations: [] },
    expect: (r) => r.status === 'NOT_MEASURED',
  },
];

function selfTest({ quiet = false } = {}) {
  const problems = [];
  const c = census();

  for (const name of CONTROLS.builtinPositions) {
    if (!c.positions.has(name)) {
      problems.push(`parse-integrity: built-in POSITION \`${name}\` was not found. The scanner has drifted`
        + ' off the declaration shape; every number below it would be an under-count.');
    }
  }
  for (const name of CONTROLS.builtinPermissionSets) {
    if (!c.permissionSets.has(name)) {
      problems.push(`parse-integrity: built-in PERMISSION SET \`${name}\` was not found. Same failure, other axis.`);
    }
  }

  const a = CONTROLS.junctionAnchor;
  if (!c.bindings.some((b) => b.position === a.position && b.set === a.set)) {
    problems.push(`positive control (junction) NOT classified as a junction binding: `
      + `${a.position} -> ${a.set}\n    ${a.why}`);
  }
  if (c.nameFolds.some((f) => f.name === a.position)) {
    problems.push(`positive control (junction) was reported as a NAME-DEPENDENCY: ${a.position}\n    ${a.why}`);
  }

  const b = CONTROLS.nameFoldAnchor;
  const fold = c.nameFolds.find((f) => f.name === b.name);
  if (!fold) {
    problems.push(`positive control (name-fold) NOT detected: ${b.name}\n    ${b.why}`);
  } else if (!fold.permissionSets.some((s) => s.kind === 'artifact')) {
    problems.push(`positive control (name-fold) ${b.name} was detected, but its permission-set half is not`
      + ' the composed artifact -- the control is passing for the wrong reason.');
  }

  const n = CONTROLS.negative;
  if (c.nameFolds.some((f) => f.name === n.position)) {
    problems.push(`negative control reported as a name-fold: ${n.position}\n    ${n.why}`);
  }
  if (!c.bindings.some((x) => x.position === n.position && x.set === n.set)) {
    problems.push(`negative control ${n.position} -> ${n.set} was not seen as a junction binding at all;`
      + ' the binder scan is blind, so every junction-bound pair would be misfiled as unbound.');
  }

  const sb = CONTROLS.secondBinder;
  if (!c.bindings.some((x) => x.position === sb.position && x.set === sb.set)) {
    problems.push(`second-binder control missed: \`${sb.position} -> ${sb.set}\` is a junction binding declared by`
      + ' a binder whose list is NOT named POSITION_PERMISSION_SET_BINDINGS. The scan is recognising one app\'s'
      + ' spelling again, so other apps\' junction rows are invisible and their positions read as inert.');
  }
  if (c.inert.some((i) => i.name === sb.position)) {
    problems.push(`second-binder control: \`${sb.position}\` was reported INERT while a binder binds it.`);
  }
  if (!c.nameFolds.some((f) => f.name === 'sales_manager')) {
    problems.push('a position junction-bound to a DIFFERENT set must still count as a name-fold on its own name'
      + ' (sales_manager is bound to crm_sales_user and still folds onto the HotCRM `sales_manager` set).'
      + ' Losing this would tell 要点 2 the pair is already governed.');
  }

  const bleed = CONTROLS.isDefaultBleed;
  if (!c.bindings.some((x) => x.position === 'everyone' && x.set === bleed.bound)) {
    problems.push(`regression control: \`${bleed.bound}\` declares \`isDefault: true\` and must appear as an`
      + ' `everyone` auto-bind. It does not, so the isDefault scan has stopped seeing declarations it owns.');
  }
  for (const set of bleed.unbound) {
    if (c.bindings.some((x) => x.position === 'everyone' && x.set === set)) {
      problems.push(`regression control fired again: \`everyone -> ${set}\` was reported as a junction binding,`
        + ` but ${set} declares no \`isDefault\`. The isDefault look-ahead is reading past the declaration's own`
        + ' object literal again -- see CONTROLS.isDefaultBleed.');
    }
  }

  for (const ac of AUDIT_CONTROLS) {
    let result;
    try {
      result = auditImplicitGrants(ac.input);
    } catch (e) {
      problems.push(`audit control threw: ${ac.label} -- ${e?.message}`);
      continue;
    }
    if (!ac.expect(result)) {
      problems.push(`audit control FAILED: ${ac.label}\n    got: ${JSON.stringify(result)}`);
    }
  }

  if (problems.length > 0) {
    process.stderr.write(`x  measure-position-name-fold-census self-test FAILED\n\n${
      problems.map((p) => `  - ${p}`).join('\n\n')}\n\n`);
    return 1;
  }
  if (!quiet) {
    process.stdout.write(
      `✓ measure-position-name-fold-census self-test: junction anchor (${a.position} -> ${a.set}) classified as`
      + ` a junction binding and absent from the name-dependency list; name-fold anchor (${b.name}) detected`
      + ` against the composed artifact; negative control (${n.position}) clear; second-binder control`
      + ` (${sb.position} -> ${sb.set}) seen and not inert; ${CONTROLS.builtinPositions.length}`
      + ` + ${CONTROLS.builtinPermissionSets.length} parse-integrity anchors present;`
      + ` ${AUDIT_CONTROLS.length} audit-generator controls pass\n`,
    );
  }
  return 0;
}

/* ------------------------------------------------------------------------- *
 *  Reporting
 * ------------------------------------------------------------------------- */

function cite(d) {
  return d.line ? `${d.file}:${d.line}` : d.file;
}

function report() {
  const c = census();
  const out = [];
  out.push('# Position -> permission-set NAME-FOLD census (#13419 执行要点 1)');
  out.push('');
  out.push(`Declared position names: ${c.stats.positionNames}`);
  out.push(`Declared permission-set names: ${c.stats.permissionSetNames}`);
  out.push(`Junction bindings created in-repo: ${c.stats.junctionBindings}`);
  out.push('');

  out.push('## NAME-FOLD DEPENDENCIES -- grants in force with NO junction row');
  out.push('');
  if (c.nameFolds.length === 0) {
    out.push('  (none over DECLARATIONS in this repository -- see NOT MEASURED below;');
    out.push('   this is not a statement about any deployment.)');
  }
  for (const f of c.nameFolds) {
    out.push(`  ${f.name}  [${f.collision}]`);
    for (const p of f.positions) out.push(`    position ${p.scope} ${p.kind} -- ${cite(p)}`);
    for (const s of f.permissionSets) out.push(`    set      ${s.scope} ${s.kind} -- ${cite(s)}`);
    out.push('');
  }

  out.push('## JUNCTION BINDINGS -- the governed channel, already materialised');
  out.push('');
  for (const b of c.bindings) {
    out.push(`  ${b.position} -> ${b.set}  (${b.via})`);
    out.push(`    ${cite(b)}`);
  }
  out.push('');

  out.push('## INERT POSITIONS -- no junction row, no name collision, no grant');
  out.push('');
  out.push('  要点 3\'s collision warning must NOT fire on these.');
  out.push('');
  for (const i of c.inert) {
    out.push(`  ${i.name} -- ${i.declarations.map(cite).join(', ')}`);
  }
  out.push('');

  out.push('## NOT MEASURED -- the half this instrument cannot reach');
  out.push('');
  out.push('  1. Positions and permission sets created at RUNTIME (Setup, admin UI,');
  out.push('     `sys_position` / `sys_permission_set` rows) are invisible to a static');
  out.push('     census. An operator naming a position after an existing permission set');
  out.push('     creates a name-fold no scan of this repository can see.');
  out.push('  2. Marketplace app artifacts that are not vendored here. The in-repo HotCRM');
  out.push('     artifact carries that app\'s PERMISSION SETS only -- its POSITION roster is');
  out.push('     not in this repository, so the four HotCRM sets with no in-repo position of');
  out.push('     the same name are NOT MEASURED, not zero.');
  out.push('  3. Per-organization state of any kind. Organizations are a deployment concept.');
  out.push('');
  out.push('  Both gaps are measurable only against a real deployment: `--audit FILE`');
  out.push('  consumes that export and refuses to read an empty one as a zero.');
  out.push('  `--audit-schema` prints the export shape and the SQL for each table.');
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

function reportAudit(file) {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    process.stderr.write(`x  --audit could not read \`${file}\`: ${e?.message}\n`
      + '   Run --audit-schema for the expected shape.\n');
    return 2;
  }
  const result = auditImplicitGrants(input);
  const out = [];
  out.push('# Implicit-grant audit report (#13419 执行要点 4)');
  out.push('');
  out.push(`Source: ${result.source ?? '(UNDECLARED -- an export with no provenance)'}`);
  out.push(`Overall: ${result.status}${result.reason ? ` -- ${result.reason}` : ''}`);
  out.push('');
  for (const org of result.organizations) {
    out.push(`## organization ${org.organization} -- ${org.status}`);
    if (org.status === 'NOT_MEASURED') {
      out.push(`  ${org.reason}`);
      out.push('');
      continue;
    }
    out.push(`  read ${org.counted.positions} position(s), ${org.counted.permissionSets} permission set(s),`
      + ` ${org.counted.junctionRows} junction row(s)`);
    if (org.implicitGrants.length === 0) {
      out.push('  MEASURED ZERO implicit grants -- every name collision in this organization is');
      out.push('  carried by a junction row, or there is no collision.');
    }
    for (const g of org.implicitGrants) {
      out.push(`  IMPLICIT GRANT  ${g.name}`);
      out.push(`    position ${g.positionId} -> permission set ${g.permissionSetId}, no junction row`);
      if (g.reach) out.push(`    reach: ${g.reach}`);
      if (g.principalsHolding !== undefined) out.push(`    principals holding the position today: ${g.principalsHolding}`);
    }
    if (!org.blastRadiusMeasured) {
      out.push('  (no `assignments` in the export -- grants are named, blast radius is NOT MEASURED)');
    }
    out.push('');
  }
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

function main(argv) {
  if (argv.includes('--audit-schema')) {
    process.stdout.write(`${AUDIT_SCHEMA}\n`);
    return 0;
  }
  if (argv.includes('--self-test')) return selfTest();

  // ⚠️ Every reading is gated on the controls. The ruling asked for a census
  // WITH positive controls, and a number printed by an instrument that has not
  // just proven it fires on known samples is not a reading -- it is a number.
  const gate = selfTest({ quiet: true });
  if (gate !== 0) {
    process.stderr.write('   Refusing to report: the controls above must pass before any number is printed.\n');
    return gate;
  }

  const auditIdx = argv.indexOf('--audit');
  if (auditIdx !== -1) {
    const file = argv[auditIdx + 1];
    if (!file) {
      process.stderr.write('x  --audit needs a file. Run --audit-schema for the expected shape.\n');
      return 2;
    }
    return reportAudit(file);
  }
  if (argv.includes('--json')) {
    const c = census();
    process.stdout.write(`${JSON.stringify({
      stats: c.stats,
      nameFolds: c.nameFolds,
      junctionBindings: c.bindings,
      junctionOnSameName: c.junctionOnSameName,
      inertPositions: c.inert,
    }, null, 2)}\n`);
    return 0;
  }
  return report();
}

process.exitCode = main(process.argv.slice(2));
