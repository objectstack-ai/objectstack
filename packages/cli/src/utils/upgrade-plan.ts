// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package upgrade plan as the CLI prints it (epic cloud#3652 Q3): one
 * printer for every command that shows a plan before it installs, so
 * `os package install --dry-run` and `os deploy` cannot disagree about what an
 * upgrade changes or about what a refusal asks for.
 *
 * Everything here reads an ANSWER: the plan is computed by the framework
 * (`comparePackageVersions` and the environment half, metadata-core) and
 * judged by the door that serves it (install-local's Q3 verdict, the
 * finding-set token exported beside it). Nothing is recomputed on this side,
 * a list an answer does not carry prints nothing, and the one judgement read
 * here ({@link previewSchemaUpgradeStop}) is the framework's own verdict
 * function, run on the plan the door answered — a preview, never a token.
 *
 * The input is the plan READING — `{ plan, environment }`, the shape
 * install-local's dry run answers under `data`. A door that serves the same
 * reading (a hosted install, once it answers a plan to this CLI) prints
 * through the same functions by handing its reading over; the transport that
 * fetched it stays the caller's.
 */

import {
  SCHEMA_UPGRADE_CONFIRMATION_REQUIRED,
  schemaUpgradeVerdict,
  type PackageUpgradePlan,
} from '@objectstack/metadata-core';

/** One finding of a Q3 refusal, as `details.findings` carries it. */
export interface SchemaUpgradeRefusalFinding {
  kind?: string;
  describe?: string;
}

/** A Q3 refusal read from an error envelope: its findings and the finding-set token that confirms exactly them. */
export interface SchemaUpgradeRefusal {
  findings: SchemaUpgradeRefusalFinding[];
  findingSet: string;
}

/**
 * Read a Q3 refusal from an answer's body (`{ error: { code, details } }`).
 * Anything else — another code, or a refusal without a token — is not one.
 */
export function readSchemaUpgradeRefusal(body: unknown): SchemaUpgradeRefusal | undefined {
  const error = (body as { error?: { code?: unknown; details?: any } } | null | undefined)?.error;
  if (error?.code !== SCHEMA_UPGRADE_CONFIRMATION_REQUIRED) return undefined;
  const details = error.details ?? {};
  if (typeof details.findingSet !== 'string' || details.findingSet === '') return undefined;
  const findings: SchemaUpgradeRefusalFinding[] = Array.isArray(details.findings) ? details.findings : [];
  return { findings, findingSet: details.findingSet };
}

/**
 * The lines a Q3 refusal prints: every finding, then both ways forward —
 * declare the rename in the package (`renamedFrom`, epic ruling D3: the
 * mapping lives in the package, never on the command line), or confirm
 * exactly these findings with `retry --confirm-upgrade <token>`.
 */
export function renderSchemaUpgradeRefusal(refusal: SchemaUpgradeRefusal, retry: string): { headline: string; lines: string[] } {
  const { findings, findingSet } = refusal;
  // A record of the installed version the runtime could not read is a
  // finding too (no comparison ran): there is no field to declare.
  const fieldFindings = findings.some((f) => f.kind === 'suspected_rename' || f.kind === 'type_change');
  const lines: string[] = [''];
  for (const finding of findings) lines.push(`  • ${finding.describe ?? JSON.stringify(finding)}`);
  lines.push('');
  if (fieldFindings) lines.push("  If a field was renamed, declare its old key in the new field's `renamedFrom` and rebuild.");
  lines.push('  To upgrade anyway, accepting each finding as listed, confirm exactly these findings:');
  lines.push(`    ${retry} --confirm-upgrade ${findingSet}`);
  return {
    headline: fieldFindings
      ? 'Upgrade stopped — it would rename or retype stored fields without carrying their values'
      : 'Upgrade stopped — the runtime cannot compare it with the installed version',
    lines,
  };
}

/**
 * What a dry run's plan means for the install that would follow: the
 * findings the framework's Q3 verdict (`schemaUpgradeVerdict`, the function
 * install-local judges with) asks the installer to confirm, read off the
 * plan the dry run answered. Empty ⇒ the install proceeds without asking.
 *
 * A preview, never the verdict: the door judges again at install time, on
 * its own reading of the installed version, and only ITS refusal carries the
 * token that confirms — so no token is minted here. A dry run that says the
 * installed record could not be read previews the one finding the door asks
 * for in that case; a plan this cannot read previews nothing (`undefined`),
 * which is never taken for "nothing to confirm".
 */
export function previewSchemaUpgradeStop(manifestId: string, answer: unknown): SchemaUpgradeRefusalFinding[] | undefined {
  const data = answer as { installedRecordUnreadable?: unknown; plan?: unknown } | null | undefined;
  if (data?.installedRecordUnreadable === true) {
    return [{
      kind: 'installed_record_unreadable',
      describe: 'The record of the installed version could not be read, so the upgrade cannot be compared with it.',
    }];
  }
  const plan = data?.plan as Partial<PackageUpgradePlan> | undefined;
  if (!plan || !Array.isArray(plan.suspectedRenames) || !Array.isArray(plan.typeChanges)) return undefined;
  return schemaUpgradeVerdict(manifestId, plan as PackageUpgradePlan).findings
    .map((f) => ({ kind: f.kind, describe: f.describe }));
}

/** One row count, or the honest "could not be read". */
function rowsText(rows: unknown, noun: string): string {
  if (rows === null) return 'its rows could not be read';
  if (typeof rows !== 'number') return '';
  return `${rows} row(s) ${noun}`;
}

/**
 * [epic cloud#3652 Q3, #30884] The lines a dry run's answer prints: the
 * package upgrade plan (`data.plan`, `comparePackageVersions`) with the
 * environment's readings beside each finding (`data.environment`). Printed
 * from the answer only; a list the answer does not carry prints nothing.
 */
export function renderUpgradePlan(data: any): string[] {
  const plan = data?.plan ?? {};
  const env = data?.environment ?? {};
  const lines: string[] = [];
  const columnRows = new Map<string, unknown>();
  for (const c of Array.isArray(env.columns) ? env.columns : []) columnRows.set(`${c.object}.${c.field}`, c.rows);
  const objectRows = new Map<string, unknown>();
  for (const o of Array.isArray(env.removedObjects) ? env.removedObjects : []) objectRows.set(o.object, o.rows);
  const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
  const held = (object: string, field: string) => {
    const text = rowsText(columnRows.get(`${object}.${field}`), 'hold a value');
    return text ? ` — ${text}` : '';
  };

  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`  ${title}`);
    for (const item of items) lines.push(`    ${item}`);
  };
  section('Objects', [
    ...list(plan.objects?.added).map((name: string) => `+ ${name}`),
    ...list(plan.objects?.removed).map((name: string) => {
      const text = rowsText(objectRows.get(name), 'in it');
      return `- ${name}${text ? ` — ${text}; the table is not dropped` : ''}`;
    }),
  ]);
  section('Fields', [
    ...list(plan.fields?.added).map((f: any) => `+ ${f.object}.${f.field}${f.type ? ` (${f.type})` : ''}${f.required ? ' required' : ''}`),
    ...list(plan.fields?.removed).map((f: any) => `- ${f.object}.${f.field}${f.type ? ` (${f.type})` : ''}${held(f.object, f.field)}; the column is not dropped`),
  ]);
  section('Renames declared by renamedFrom', list(plan.declaredRenames).map((r: any) =>
    `${r.object}.${r.from} → ${r.to}${held(r.object, r.from)}`));
  section('Suspected renames (no renamedFrom links them)', list(plan.suspectedRenames).map((r: any) =>
    `${r.object}.${r.field} → ${list(r.candidates).map((c: any) => c.field).join(' or ')}?${held(r.object, r.field)}; `
    + 'the new key would install as a new empty column. Declare renamedFrom on the new field and rebuild if it is a rename'));
  section('Type changes', list(plan.typeChanges).map((t: any) =>
    `${t.object}.${t.field}: ${t.from} → ${t.to} (${t.category})${t.renamedFrom ? `, renamed from ${t.renamedFrom}` : ''}`
    + `${held(t.object, t.renamedFrom ?? t.field)}`));

  const overwrites = new Map<string, any>();
  for (const o of list(env.seeds)) overwrites.set(o.key, o);
  const seedLine = (d: any, sign: string) => {
    const o = overwrites.get(d.key);
    let line = `${sign} ${d.key} (mode ${d.fromMode && d.fromMode !== d.mode ? `${d.fromMode} → ${d.mode}` : d.mode}, ${d.records} record(s))`;
    if (Array.isArray(d.changed)) line += `: ${d.changed.join(', ')} changed`;
    if (o) {
      line += o.editedRows === null
        ? ' — rows a customer edited could not be read'
        : ` — ${o.editedRows} row(s) a customer edited would be overwritten${o.editedKeys?.length ? ` (${o.editedKeys.join(', ')})` : ''}`;
    }
    return line;
  };
  const changedKeys = new Set(list(plan.seeds?.changed).map((d: any) => d.key));
  section('Seed datasets', [
    ...list(plan.seeds?.added).map((d: any) => seedLine(d, '+')),
    ...list(plan.seeds?.removed).map((d: any) => `- ${d.key} (mode ${d.mode}); its rows are not removed`),
    ...list(plan.seeds?.changed).map((d: any) => seedLine(d, '~')),
    // An unchanged overwriting dataset still writes over the rows a customer edited.
    ...list(env.seeds).filter((o: any) => !changedKeys.has(o.key) && o.editedRows !== 0)
      .map((o: any) => `= ${o.key} (mode ${o.mode}, unchanged)${o.editedRows === null
        ? ' — rows a customer edited could not be read'
        : ` — ${o.editedRows} row(s) a customer edited would be overwritten${o.editedKeys?.length ? ` (${o.editedKeys.join(', ')})` : ''}`}`),
  ]);
  if (lines.length === 0) lines.push('  No change to objects, fields or seed datasets.');

  // [ADR-0146 D2, as amended] The advisory class: overrides of the base in
  // its paired `.custom` package. Advice only: nothing here stops the
  // install, and no confirmation covers it. `null` = the runtime could not
  // read them; a runtime that predates the key carries none and prints none.
  const overrides = env.overrides;
  if (overrides === null) {
    lines.push('  Overrides (advisory): the customizations of this package could not be read.');
  } else if (overrides && typeof overrides === 'object') {
    const named = (f: any) => `${f.type} '${f.name}'${f.member ? ` (${f.member})` : ''}`;
    const baseDoes = (change: unknown) => (change === 'removed' ? 'no longer ships it' : change === 'added' ? 'now ships it' : 'changes it');
    section('Overrides that hide a change in this upgrade (advisory; the upgrade installs either way)', list(overrides.hidesChange).map((f: any) =>
      `${named(f)}: the base ${baseDoes(f.change)}${f.basedOn ? `; the override was taken from ${f.basedOn}` : ''}. ${f.next ?? ''}`.trimEnd()));
    section('Overrides taken from another version than the installed one (advisory)', list(overrides.stale).map((f: any) =>
      `${named(f)}: taken from ${f.basedOn}, installed ${f.installedVersion ?? 'unknown'}. ${f.next ?? ''}`.trimEnd()));
  }
  return lines;
}
