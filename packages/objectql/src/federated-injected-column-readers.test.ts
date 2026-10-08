// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21918] The closing pin of the federated injected-anchor family: every
 * engine reader of an injected column, each with its disposition toward a
 * federated object, and a failure the day a reader appears without one.
 *
 * ## The family
 *
 * The registry injects the platform's columns into every object, ADR-0015
 * `external` ones included (the #7865 ruling, direction B), and the platform
 * provisions no storage for a federated object. Each engine reader that read
 * one of those columns as real storage failed on a federated object, one at a
 * time: the read path (#7738), the cascade scan on the tenant anchor (#21910),
 * then the cascade scan on every other anchor (#21918). Each fix found the
 * next face only when a door refused. This file turns the remaining faces
 * into a table, so the next one is a review question instead of an outage.
 *
 * ## The mechanism: a source scan over named seams
 *
 * An engine reader reaches an injected column of an arbitrary registered
 * object through a small, closed set of seams, and this file scans every
 * non-test source of `@objectstack/objectql` for each use of one:
 *
 *  1. the federated decisions and the provenance they read:
 *     `isFederatedObject`, `isFederatedUnprovisionedInjectedColumn`,
 *     `resolveInjectedColumnProvenance`, `unprovisionedInjectedColumns`,
 *     `platformProvisionsStorage`;
 *  2. the relation-carrier arbiters, which are how engine code finds a relation
 *     field, and so how it reaches an injected lookup: `referenceCarrierOf`,
 *     `referenceTargetOf`;
 *  3. the tenant-column resolver, `resolveTenantFieldName`, and the constant
 *     it resolves to, `DEFAULT_TENANT_FIELD`;
 *  4. every spelling of an injected column's NAME: a string literal, an object
 *     literal key, or a `SystemFieldName` member. The names are not listed
 *     here. They are `injectedSystemColumnDefs` (`@objectstack/spec/data`)
 *     answered for a federated document, the same table the registry spreads.
 *
 * Each use is keyed `<file>#<enclosing function> :: <seam>`, which survives line
 * churn and moves only when the code that reads moves. Every key the scan finds
 * must have a row in {@link READERS}, and every row must still be found. A row
 * whose disposition says the site ASKS a federated predicate is checked against
 * the source: the site's own function calls it, or calls the one same-file
 * helper the row names, which calls it.
 *
 * Why a scan and not a registry the readers call into: a registry only lists
 * the readers that remembered to register, which is the population that was
 * never the problem. The failures in this family were readers that did not
 * know the question existed. A scan finds them by the seam they cannot avoid.
 *
 * What it cannot see, stated rather than implied: a reader that reaches an
 * injected column through none of these seams, such as a column name built
 * from a template or read out of a field map without a carrier arbiter. Such a
 * reader is also one no other check in this package can find, and it adds no
 * hole this file pretends to close.
 *
 * ## The dispositions
 *
 * Closed, in {@link Disposition}. Only the first three say what the site does
 * on a federated object by asking a predicate, and they are the ones checked
 * against the source. The rest say why the seam is not a storage read of a
 * federated object's injected column at all, and their `why` is the claim a
 * reviewer checks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import ts from 'typescript';
import { injectedSystemColumnDefs, ObjectSchema } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

type Disposition =
  /** Asks `isFederatedUnprovisionedInjectedColumn` and does not read the column on a federated object. */
  | 'skips'
  /** Asks `isFederatedObject` and issues no injected-column predicate against a federated object. */
  | 'exempt'
  /** Asks the provenance (`unprovisionedInjectedColumns`) and leaves unprovisioned columns out. */
  | 'excludes'
  /** A column VALUE read off a row in hand selects the TARGET object's rows by id. */
  | 'target-by-id'
  /** Reads the column's value off a row already in hand. No storage read. */
  | 'row-value'
  /** Lowers, validates or evaluates a predicate the caller or the author wrote. */
  | 'caller-predicate'
  /** Reads a relation an author's own declaration names (and infers from it). */
  | 'author-declared'
  /** The column is the declared lifecycle policy's own subject, not a partition of it. */
  | 'policy-subject'
  /** Stamps the column onto a record the caller writes. */
  | 'writer'
  /** Names the column without reading any row: a vocabulary, an injection, a sync route, refusal text. */
  | 'not-a-read'
  /** The predicate or resolver itself. */
  | 'definition';

/** The dispositions whose claim is a call in the source, and the calls that satisfy it. */
const ASKS: Partial<Record<Disposition, readonly string[]>> = {
  skips: ['isFederatedUnprovisionedInjectedColumn'],
  exempt: ['isFederatedObject'],
  excludes: ['unprovisionedInjectedColumns', 'resolveInjectedColumnProvenance'],
};

interface Row {
  disposition: Disposition;
  why: string;
  /** For an ASKS disposition: the same-file function the site calls, which asks. */
  via?: string;
}

/** The calls that are seams by name. */
const SEAM_CALLS = new Set([
  'isFederatedObject',
  'isFederatedUnprovisionedInjectedColumn',
  'resolveInjectedColumnProvenance',
  'unprovisionedInjectedColumns',
  'platformProvisionsStorage',
  'referenceCarrierOf',
  'referenceTargetOf',
  'resolveTenantFieldName',
]);

const VOCABULARY = 'names the column in a name vocabulary; it reads no row';
const SYNC_ROUTE = 'routes a federated object to the DDL-free binding; it reads no row';
const PLATFORM_ROW = 'stamps a row of a platform table the engine itself writes';
const VALIDATION_RULE = "a validation rule's own relation path, which the author wrote";

const READERS: Record<string, Row> = {
  // ── The readers this family fixed, and the one decision they ask ─────────
  'engine.ts#cascadeDeleteRelations :: isFederatedUnprovisionedInjectedColumn()': {
    disposition: 'skips',
    why: 'the dependents probe never filters a federated object on a column it does not provision',
  },
  'engine.ts#cascadeDeleteRelations :: referenceCarrierOf()': {
    disposition: 'skips',
    why: 'finds the relations a delete probes; the skip above follows the reference match',
  },
  'engine.ts#planCascadeAtomicity :: isFederatedUnprovisionedInjectedColumn()': {
    disposition: 'skips',
    why: "the participant test is the scan's own, so the plan and the scan agree",
  },
  'engine.ts#planCascadeAtomicity :: referenceCarrierOf()': {
    disposition: 'skips',
    why: 'finds the participants the scan would probe; the same skip follows the reference match',
  },
  'lifecycle/lifecycle-service.ts#tenantWindowsFor :: isFederatedUnprovisionedInjectedColumn()': {
    disposition: 'skips',
    why: 'a federated object whose organization_id is the injection has no tenant partition',
  },
  'lifecycle/lifecycle-service.ts#tenantWindowsFor :: organization_id': {
    disposition: 'skips',
    why:
      'the column the partition predicates name, asked about before any partition is built; the reap and ' +
      'archive passes name only the column this decision returns (#15207), so they hold no seam of their own',
  },
  'lifecycle/lifecycle-service.ts#tenantWindowsFor :: resolveInjectedColumnProvenance()': {
    disposition: 'skips',
    why:
      "an object with no organization_id at all (provenance 'absent': no injection, no declaration), " +
      'federated or local, has no tenant partition either',
  },

  // ── Readers that already asked whether the object is federated ──────────
  'engine.ts#buildDriverOptions :: isFederatedObject()': {
    disposition: 'exempt',
    why: 'the organization wall a read carries is withheld from a federated object',
  },
  'engine.ts#buildDriverOptions :: resolveTenantFieldName()': {
    disposition: 'exempt',
    why: 'resolves the wall column only after the federated exemption',
  },
  'engine.ts#resolvePredicateRelated :: isFederatedObject()': {
    disposition: 'exempt',
    why: "a federated related object is read through the caller's own read, never through a wall",
  },
  'engine.ts#resolvePredicateRelated :: referenceTargetOf()': {
    disposition: 'exempt',
    why: 'reads the related object by id; a federated one is routed through the caller',
  },
  'engine.ts#resolvePredicateRelated :: resolveTenantFieldName()': {
    disposition: 'exempt',
    why: 'decides the routing beside the federated test, on the related object, never as a filter',
  },
  'engine.ts#resolveSystemInsertOrganization :: isFederatedObject()': {
    disposition: 'exempt',
    why: 'a system insert into a federated object is never stamped with an organization',
  },
  'engine.ts#resolveSystemInsertOrganization :: resolveTenantFieldName()': {
    disposition: 'exempt',
    why: 'resolves the stamp column only after the federated exemption',
  },

  // ── Readers that read the provenance directly ───────────────────────────
  'integrity/dangling-reference-audit.ts#auditableReferenceFields :: referenceTargetOf()': {
    disposition: 'excludes',
    why: 'the audit never counts an unprovisioned injected lookup as a reference',
  },
  'integrity/dangling-reference-audit.ts#auditableReferenceFields :: unprovisionedInjectedColumns()': {
    disposition: 'excludes',
    why: 'the provenance the exclusion reads',
  },
  'integrity/dangling-reference-audit.ts#organizationFieldOf :: resolveTenantFieldName()': {
    disposition: 'excludes',
    why: 'the audit partitions by organization only on a provisioned tenant column',
  },
  'integrity/dangling-reference-audit.ts#organizationFieldOf :: unprovisionedInjectedColumns()': {
    disposition: 'excludes',
    why: 'the provenance the exclusion reads',
  },

  // ── Seams that are not a storage read of a federated object's column ─────
  'engine.ts#assertReferencesResolve :: referenceTargetOf()': {
    disposition: 'target-by-id',
    why: "the id a caller wrote into a reference field is looked up on the TARGET object",
  },
  'engine.ts#expandRelatedRecords :: referenceTargetOf()': {
    disposition: 'target-by-id',
    why: 'the ids read off the rows in hand load the TARGET rows; a federated row carries none',
  },
  'record-title.ts#resolveRelatedTitleTarget :: referenceTargetOf()': {
    disposition: 'target-by-id',
    why: "resolves which object a related record's title is read from",
  },
  'engine.ts#eventOrganizationId :: resolveTenantFieldName()': {
    disposition: 'row-value',
    why: 'reads the tenant column off the written row; a federated row has none, so the event omits it',
  },
  'relation-filter-lowering.ts#admitRelationCondition :: referenceTargetOf()': {
    disposition: 'caller-predicate',
    why: "lowers a relation condition the caller wrote; it names an injected column only when the caller did",
  },
  'validation/rule-validator.ts#collectPredicateRelationships :: referenceTargetOf()': {
    disposition: 'caller-predicate',
    why: VALIDATION_RULE,
  },
  'validation/rule-validator.ts#readsAnOwnColumnItLacks :: referenceTargetOf()': {
    disposition: 'caller-predicate',
    why: VALIDATION_RULE,
  },
  'validation/rule-validator.ts#referentialClearRefusal :: referenceTargetOf()': {
    disposition: 'caller-predicate',
    why: VALIDATION_RULE,
  },
  'validation/rule-validator.ts#resolveTraversalScope :: referenceTargetOf()': {
    disposition: 'caller-predicate',
    why: VALIDATION_RULE,
  },
  'validation/rule-validator.ts#unevaluableFieldRuleError :: referenceTargetOf()': {
    disposition: 'caller-predicate',
    why: VALIDATION_RULE,
  },
  'engine.ts#buildSummaryIndex :: referenceCarrierOf()': {
    disposition: 'author-declared',
    why:
      "infers the foreign key of a roll-up an author declared, from the child's first relation to the " +
      'parent. Injected anchors point only at sys_organization, sys_business_unit and sys_user, so it can ' +
      'meet one only for a roll-up declared on one of those over a federated child with no relationshipField',
  },
  'lifecycle/lifecycle-service.ts#reapObject :: created_at': {
    disposition: 'policy-subject',
    why:
      'the age a declared retention reaps by. On a federated object the registry injects it, so a remote ' +
      "without it refuses the filter and the sweep reports the object in its errors, loudly, every sweep",
  },
  'lifecycle/lifecycle-service.ts#archiveObject :: created_at': {
    disposition: 'policy-subject',
    why: "the age a declared archive selects by (when no ttl names another column), and the cold store's keep prune",
  },
  'plugin.ts#registerAuditHooks :: created_by': {
    disposition: 'writer',
    why: 'stamps the acting user onto a record the caller writes; it reads nothing',
  },
  'plugin.ts#registerAuditHooks :: updated_by': {
    disposition: 'writer',
    why: 'stamps the acting user onto a record the caller writes; it reads nothing',
  },
  'engine.ts#encryptSecretFields :: created_at': { disposition: 'not-a-read', why: PLATFORM_ROW },
  'engine.ts#recordObservedDeviation :: updated_at': { disposition: 'not-a-read', why: PLATFORM_ROW },
  'engine.ts#retractCreationAttestation :: updated_at': { disposition: 'not-a-read', why: PLATFORM_ROW },
  'engine.ts#syncObjectSchema :: isFederatedObject()': { disposition: 'not-a-read', why: SYNC_ROUTE },
  'engine.ts#syncSchemas :: isFederatedObject()': { disposition: 'not-a-read', why: SYNC_ROUTE },
  'plugin.ts#reconcileFederatedBindings :: isFederatedObject()': { disposition: 'not-a-read', why: SYNC_ROUTE },
  'plugin.ts#registerSchemasWithoutDdl :: isFederatedObject()': { disposition: 'not-a-read', why: SYNC_ROUTE },
  'plugin.ts#syncRegisteredSchemas :: isFederatedObject()': { disposition: 'not-a-read', why: SYNC_ROUTE },
  'declared-read-columns.ts#<module> :: created_at': { disposition: 'not-a-read', why: VOCABULARY },
  'declared-read-columns.ts#<module> :: updated_at': { disposition: 'not-a-read', why: VOCABULARY },
  'having-filter.ts#declaredReferenceNames :: created_at': { disposition: 'not-a-read', why: VOCABULARY },
  'having-filter.ts#declaredReferenceNames :: updated_at': { disposition: 'not-a-read', why: VOCABULARY },
  'no-operator-object-door.ts#<module> :: created_at': { disposition: 'not-a-read', why: VOCABULARY },
  'no-operator-object-door.ts#<module> :: updated_at': { disposition: 'not-a-read', why: VOCABULARY },
  'validation/record-validator.ts#<module> :: created_at': { disposition: 'not-a-read', why: VOCABULARY },
  'validation/record-validator.ts#<module> :: created_by': { disposition: 'not-a-read', why: VOCABULARY },
  'validation/record-validator.ts#<module> :: updated_at': { disposition: 'not-a-read', why: VOCABULARY },
  'validation/record-validator.ts#<module> :: updated_by': { disposition: 'not-a-read', why: VOCABULARY },
  'util.ts#convertIntrospectedSchemaToObjects :: created_at': {
    disposition: 'not-a-read',
    why: "drafts objects from a datasource's introspected tables, skipping the platform's own columns",
  },
  'util.ts#convertIntrospectedSchemaToObjects :: updated_at': {
    disposition: 'not-a-read',
    why: "drafts objects from a datasource's introspected tables, skipping the platform's own columns",
  },
  'no-operator-object-door.ts#relationWords :: referenceTargetOf()': {
    disposition: 'not-a-read',
    why: 'names the related object in refusal text',
  },
  'registry.ts#<module> :: organization_id': {
    disposition: 'not-a-read',
    why: 'the tenant index the registry declares on a provisioned tenant column',
  },
  'registry.ts#<module> :: owning_business_unit_id': {
    disposition: 'not-a-read',
    why: 'the name the injection writes the ADR-0117 D1 anchor under',
  },
  'registry.ts#declaresTenantIndex :: organization_id': {
    disposition: 'not-a-read',
    why: 'reads an index declaration, not a row',
  },
  'registry.ts#applyDeploymentTenancy :: organization_id': {
    disposition: 'not-a-read',
    why:
      "drops the platform's own injected definition from a declared object's schema (ADR-0131 D7); " +
      'it reads a definition, never a row',
  },
  'registry.ts#setDeploymentPlatformGlobalObjects :: organization_id': {
    disposition: 'not-a-read',
    why:
      'tells an authored organization_id from the injection while re-planning registered schemas ' +
      '(ADR-0131 D7); it reads definitions, never a row',
  },
  'tenancy/system-write-organization.ts#<module> :: organization_id': {
    disposition: 'not-a-read',
    why: 'the declaration of the default tenant column name',
  },
  'tenancy/system-write-organization.ts#buildRefusalMessage :: organization_id': {
    disposition: 'not-a-read',
    why: 'names the column in refusal text',
  },
  'tenancy/system-write-organization.ts#resolveTenantFieldName :: organization_id': {
    disposition: 'definition',
    why: 'the tenant-column resolver every tenant reader above asks; it reads a schema, never a row',
  },
  'federated-object.ts#isFederatedUnprovisionedInjectedColumn :: isFederatedObject()': {
    disposition: 'definition',
    why: 'the general predicate',
  },
  'federated-object.ts#isFederatedUnprovisionedInjectedColumn :: resolveInjectedColumnProvenance()': {
    disposition: 'definition',
    why: 'the general predicate reads the registry provenance and names no column',
  },
};

// ── The scan ─────────────────────────────────────────────────────────────

interface Scan {
  /** Every seam use, keyed `<file>#<site> :: <seam>`. */
  seams: Set<string>;
  /** Every callee name each `<file>#<site>` calls. */
  calls: Map<string, Set<string>>;
  files: string[];
  columns: ReadonlySet<string>;
}

/**
 * The injected column names, read from the spec's own definition table for a
 * federated document: the same table `applySystemFields` spreads, so a column
 * the registry starts injecting tomorrow is scanned for tomorrow.
 */
function injectedColumnNames(): ReadonlySet<string> {
  return new Set(Object.keys(injectedSystemColumnDefs({ name: 'probe', external: { remoteName: 'probe' }, fields: {} })));
}

/**
 * The name a node gives the code inside it when it is a function-like
 * container, or `undefined` when it is not. A node's site is the name of its
 * NEAREST such ancestor, or `<module>` for top-level code. The walk below
 * hands that name down as it descends, so each node's site costs nothing.
 * The first version asked for every node by climbing to the root: O(nodes x
 * depth) over 2.8 MB of source, about 1.5 s a scan and three scans a run.
 * Under the CPU contention a Test Core shard runs at (four suites of three
 * workers on four cores), two of those scans measured past vitest's 5 s
 * default timeout.
 */
function containerName(p: ts.Node, sf: ts.SourceFile): string | undefined {
  if (
    (ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) &&
    p.name
  ) {
    return p.name.getText(sf);
  }
  if (ts.isConstructorDeclaration(p)) return 'constructor';
  const fnInit = (init: ts.Expression | undefined) => !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
  if (ts.isPropertyDeclaration(p) && fnInit(p.initializer)) return p.name.getText(sf);
  if (
    ts.isVariableDeclaration(p) &&
    fnInit(p.initializer) &&
    ts.isVariableDeclarationList(p.parent) &&
    ts.isVariableStatement(p.parent.parent) &&
    ts.isSourceFile(p.parent.parent.parent)
  ) {
    return p.name.getText(sf);
  }
  return undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return undefined;
}

/** The one scan this file makes: every test reads the same answer. */
let scanned: Scan | undefined;

/**
 * Parsing the package source is the one costly step in this file, so a test
 * that may be the first to call this declares {@link SCAN_BUDGET_MS} rather
 * than borrowing vitest's 5 s default, which is a budget for a unit, not for a
 * parse of the whole package on a shared runner.
 */
const SCAN_BUDGET_MS = 30_000;

function scanObjectqlSources(): Scan {
  if (scanned) return scanned;
  // Located from THIS test file's own path, as `engine-middleware-operation-vocabulary.test.ts`
  // does: the package's build config targets CommonJS, where `import.meta` is TS1470.
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('vitest reported no testPath, so the reader scan cannot locate src/.');
  const srcDir = dirname(testPath);
  const columns = injectedColumnNames();
  const fieldNameOf = SystemFieldName as unknown as Record<string, string>;

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts')) files.push(path);
    }
  };
  walk(srcDir);

  const seams = new Set<string>();
  const calls = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = relative(srcDir, file).split(sep).join('/');
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node, siteName: string): void => {
      const site = `${rel}#${siteName}`;
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        if (name) {
          if (!calls.has(site)) calls.set(site, new Set());
          calls.get(site)!.add(name);
          if (SEAM_CALLS.has(name)) seams.add(`${site} :: ${name}()`);
        }
      }
      if (
        (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
        columns.has(n.text) &&
        !ts.isImportDeclaration(n.parent) &&
        !ts.isExportDeclaration(n.parent)
      ) {
        seams.add(`${site} :: ${n.text}`);
      }
      if (ts.isIdentifier(n) && columns.has(n.text) && ts.isPropertyAssignment(n.parent) && n.parent.name === n) {
        seams.add(`${site} :: ${n.text}`);
      }
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'SystemFieldName' &&
        columns.has(fieldNameOf[n.name.text])
      ) {
        seams.add(`${site} :: ${fieldNameOf[n.name.text]}`);
      }
      if (
        ts.isIdentifier(n) &&
        n.text === 'DEFAULT_TENANT_FIELD' &&
        !ts.isImportSpecifier(n.parent) &&
        !ts.isExportSpecifier(n.parent) &&
        !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)
      ) {
        seams.add(`${site} :: organization_id`);
      }
      const inner = containerName(n, sf) ?? siteName;
      ts.forEachChild(n, (child) => visit(child, inner));
    };
    visit(sf, '<module>');
  }
  scanned = { seams, calls, files: files.map((f) => relative(srcDir, f).split(sep).join('/')), columns };
  return scanned;
}

const siteKeyOf = (seamKey: string): string => seamKey.slice(0, seamKey.indexOf(' :: '));

describe('[#21918] every engine reader of an injected column has a disposition toward a federated object', () => {
  it('scans the population it claims: the whole package source, for the injected columns the spec declares', () => {
    const scan = scanObjectqlSources();
    expect(scan.files).toEqual(
      expect.arrayContaining(['engine.ts', 'federated-object.ts', 'lifecycle/lifecycle-service.ts', 'registry.ts']),
    );
    expect(scan.files.some((f) => f.endsWith('.test.ts'))).toBe(false);
    // The column names come from the spec, so a vacuous answer would be empty or tenant-only.
    expect([...scan.columns]).toEqual(
      expect.arrayContaining(['organization_id', 'owning_business_unit_id', 'owner_id', 'created_by', 'updated_by']),
    );
  }, SCAN_BUDGET_MS);

  it('has a row for every seam use in the source, and no row for a use that is gone', () => {
    const scan = scanObjectqlSources();
    const unlisted = [...scan.seams].filter((k) => !(k in READERS)).sort();
    const stale = Object.keys(READERS).filter((k) => !scan.seams.has(k)).sort();
    expect(
      unlisted,
      'An engine reader of an injected column has no disposition. Decide what it does on a federated object ' +
        '(ADR-0015 `external`), whose injected columns the platform does not provision: ask ' +
        '`isFederatedUnprovisionedInjectedColumn` and skip, or record why the seam reads no such column. Then add ' +
        'its row to READERS in this file.',
    ).toEqual([]);
    expect(stale, 'A READERS row names a seam use the source no longer has: delete or re-key the row.').toEqual([]);
  }, SCAN_BUDGET_MS);

  it('a disposition that says the site asks a federated predicate is true of the source', () => {
    const scan = scanObjectqlSources();
    for (const [key, row] of Object.entries(READERS)) {
      const asks = ASKS[row.disposition];
      if (!asks) {
        expect(row.via, `${key}: only an asking disposition names a via`).toBeUndefined();
        continue;
      }
      const site = siteKeyOf(key);
      const own = scan.calls.get(site) ?? new Set<string>();
      if (row.via) {
        const file = site.slice(0, site.indexOf('#'));
        const helper = scan.calls.get(`${file}#${row.via}`) ?? new Set<string>();
        expect(own.has(row.via), `${key}: the site does not call ${row.via}`).toBe(true);
        expect(asks.some((p) => helper.has(p)), `${key}: ${row.via} asks none of ${asks.join(', ')}`).toBe(true);
      } else {
        expect(asks.some((p) => own.has(p)), `${key}: the site asks none of ${asks.join(', ')}`).toBe(true);
      }
    }
  }, SCAN_BUDGET_MS);

  it('the sites that skip are exactly the cascade scan, its plan, and the lifecycle tenant partition', () => {
    const skipping = new Set(
      Object.entries(READERS)
        .filter(([, row]) => row.disposition === 'skips')
        .map(([key]) => siteKeyOf(key)),
    );
    expect([...skipping].sort()).toEqual([
      'engine.ts#cascadeDeleteRelations',
      'engine.ts#planCascadeAtomicity',
      'lifecycle/lifecycle-service.ts#tenantWindowsFor',
    ]);
  });

  it('records why the lifecycle passes are in scope: the spec accepts a lifecycle policy on a federated object', () => {
    // The lifecycle rows above are readers only because this parse succeeds. If
    // the spec ever refuses `lifecycle` beside `external`, this fails and the
    // rows can be re-judged as unreachable.
    const federated = {
      name: 'ext_event',
      label: 'External Event',
      datasource: 'remote_ds',
      external: { remoteName: 'events' },
      fields: { expires_at: { type: 'datetime' as const, label: 'Expires At' } },
    };
    for (const lifecycle of [
      { class: 'telemetry', retention: { maxAge: '30d' } },
      { class: 'transient', ttl: { field: 'expires_at', expireAfter: '1d' } },
      { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'cold' } },
    ]) {
      const parsed = ObjectSchema.safeParse({ ...federated, lifecycle });
      expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    }
  });
});
