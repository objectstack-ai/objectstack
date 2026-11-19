// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What makes an exported app a package a customer can install and try: the
 * listing text and facet it is shown with, and the sample data it arrives
 * with. The exporter adds these to the app's `source/` AFTER the run is
 * scored, so the AI's build is never graded on them, and it never writes
 * them into the run's own project.
 *
 *  - `objectstack.manifest.json` gains the card's listing text and facet
 *    ({@link listingManifest}): `displayName` and `description` are the
 *    card's English title and one-sentence requirement (`prompt.short`), the
 *    Chinese pair goes under `translations.zh`, and `businessFunctions` is the
 *    card's own list, primary first. `os package publish` reads all four off
 *    this file.
 *  - `src/sample-data.json` ({@link SAMPLE_DATA_FILE}) holds the card's seed
 *    rows as stack `data:` datasets ({@link sampleDataOf}): one per object,
 *    the object named with the app's namespace, keyed on the card's row id
 *    (`externalId: 'id'`), each row as the card states it. A lookup value
 *    names a row id of the same load, which the platform's seed loader
 *    resolves; it orders the objects itself. This is the shape a package's
 *    `data[]` has, which both the managed install (`seedSampleData`) and the
 *    unmanaged install's seed copy read.
 *  - `objectstack.config.ts` reads that file into its `data:`
 *    ({@link withSampleData}): one import line and one property, spliced
 *    into the default-exported `defineStack({ … })` literal, every other byte
 *    as the AI wrote it.
 *
 * A user-handle field (`run.userHandleFields`, `account.owner` = `u_sam`) is
 * left out of every row: its value stands for a user of the run's own
 * environment, which an installer's environment does not have, and a faithful
 * build models it as a user lookup that refuses the text. The field stays
 * unset on the installed rows.
 *
 * ⛔ The install modes and the solution type are NOT written here: declaring
 * `installModes: ['unmanaged']` makes `defineStack` refuse an app that carries
 * code `plugins` or `capability` items, which every app on the standard
 * scaffold does today.
 */

import type { LoadedScenario } from '../loader.js';
import { scenarioNamespace } from '../schema.js';
import { SAMPLE_DATA_BINDING, SAMPLE_DATA_FILE, SAMPLE_DATA_SPECIFIER } from './contract.js';

export { SAMPLE_DATA_BINDING, SAMPLE_DATA_FILE, SAMPLE_DATA_SPECIFIER };

/** One stack `data:` dataset, as `src/sample-data.json` holds it. */
export interface SampleDataset {
  object: string;
  externalId: 'id';
  records: Array<Record<string, unknown>>;
}

/** The trial package's additions could not be written: one reason each, printed with the export's refusal. */
export class TrialPackageRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrialPackageRefusal';
  }
}

/**
 * The card's seed rows as stack `data:` datasets, in the card's object order:
 * each object named `<namespace>_<object>`, keyed on `id`, every row as the
 * card states it except its user-handle fields (left out, see the module
 * header). `omitted` names each `object.field` left out.
 */
export function sampleDataOf(card: LoadedScenario['card']): { datasets: SampleDataset[]; omitted: string[] } {
  const ns = scenarioNamespace(card);
  const handles = new Set((card.run.userHandleFields ?? []).map((h) => `${h.object}.${h.field}`));
  const omitted = new Set<string>();
  const datasets: SampleDataset[] = [];
  for (const [object, rows] of Object.entries(card.run.seed)) {
    if (rows.length === 0) continue;
    const records = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (handles.has(`${object}.${k}`)) omitted.add(`${object}.${k}`);
        else out[k] = v;
      }
      return out;
    });
    datasets.push({ object: object.startsWith(`${ns}_`) ? object : `${ns}_${object}`, externalId: 'id', records });
  }
  return { datasets, omitted: [...omitted].sort() };
}

/**
 * The project's `objectstack.manifest.json` (its text, or `undefined` when the
 * project has none) with the card's listing text and facet set, as the bytes
 * to write. Every other key is kept as it was; the four written keys replace
 * whatever the build had there. A text that is not a JSON object is refused.
 */
export function listingManifest(text: string | undefined, card: LoadedScenario['card']): string {
  let m: Record<string, unknown> = {};
  if (text !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new TrialPackageRefusal(`objectstack.manifest.json is not JSON, so the listing text cannot be added: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TrialPackageRefusal('objectstack.manifest.json is not a JSON object, so the listing text cannot be added');
    m = parsed as Record<string, unknown>;
  }
  const short = card.prompt.short;
  const zh = { displayName: card.title.zh, ...(short.zh ? { description: short.zh } : {}) };
  const translations = m.translations !== null && typeof m.translations === 'object' && !Array.isArray(m.translations) ? (m.translations as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {
    ...m,
    displayName: card.title.en,
    ...(short.en ? { description: short.en } : {}),
    businessFunctions: [...card.businessFunctions],
    translations: { ...translations, zh },
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The TypeScript compiler API, loaded only when an export edits a config. */
type Ts = typeof import('typescript');

const CONFIG_FILE = 'objectstack.config.ts';
const LISTING_FILE = 'objectstack.manifest.json';

/**
 * The authored source (`source.ts`, relative path → bytes) as the trial
 * package: the listing manifest written, the sample data file added and read
 * into the config. `objects` are the object names the run's build declares
 * (its `dist/objectstack.json`): a dataset for an object the build lacks would
 * make `defineStack` refuse the source, so it is refused here instead.
 * Throws {@link TrialPackageRefusal}.
 */
export async function trialPackageSource(
  files: ReadonlyMap<string, Buffer>,
  card: LoadedScenario['card'],
  objects: ReadonlySet<string>,
): Promise<{ files: Map<string, Buffer>; omitted: string[] }> {
  const config = files.get(CONFIG_FILE);
  if (config === undefined) throw new TrialPackageRefusal(`the source holds no ${CONFIG_FILE}`);
  if (files.has(SAMPLE_DATA_FILE)) throw new TrialPackageRefusal(`the build already wrote ${SAMPLE_DATA_FILE}, the file the sample data is written to`);
  const { datasets, omitted } = sampleDataOf(card);
  if (datasets.length === 0) throw new TrialPackageRefusal('the card has no seed rows, so the package would arrive with no sample data');
  const absent = datasets.map((d) => d.object).filter((o) => !objects.has(o));
  if (absent.length > 0) throw new TrialPackageRefusal(`the build declares no object ${absent.map((o) => `\`${o}\``).join(', ')}, which the sample data loads into`);
  const mod = (await import('typescript')) as Ts & { default?: Ts };
  const ts = mod.default ?? mod;
  const out = new Map(files);
  out.set(CONFIG_FILE, Buffer.from(withSampleData(ts, config.toString('utf8'))));
  out.set(LISTING_FILE, Buffer.from(listingManifest(files.get(LISTING_FILE)?.toString('utf8'), card)));
  out.set(SAMPLE_DATA_FILE, Buffer.from(`${JSON.stringify(datasets, null, 2)}\n`));
  return { files: new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), omitted };
}

/**
 * `objectstack.config.ts` with the sample data read into the stack: the import
 * line `import BINDING from './src/sample-data.json';` after the file's last
 * import, and `data: BINDING,` as the first property of the object literal the
 * default export hands `defineStack`. Every other byte is kept.
 *
 * Refused, each with its reason, when the edit cannot be proved safe: the
 * default export is not `defineStack({ … })` with an object literal; that
 * literal already declares `data` or spreads another value (which may carry
 * one); or the binding name is already used in the file.
 */
export function withSampleData(ts: Ts, source: string): string {
  const file = ts.createSourceFile('objectstack.config.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const literal = defaultStackLiteral(ts, file);
  if (!literal) {
    throw new TrialPackageRefusal(
      'objectstack.config.ts does not default-export `defineStack({ … })` with an object literal, so the sample data cannot be added to its `data:`',
    );
  }
  for (const p of literal.properties) {
    if (ts.isSpreadAssignment(p)) throw new TrialPackageRefusal('objectstack.config.ts spreads a value into `defineStack({ … })`, which may declare `data:` already, so the sample data is not added');
    const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
    if (name === 'data') throw new TrialPackageRefusal('objectstack.config.ts already declares `data:`, so the card\'s seed rows are not added as the sample data');
  }
  let used = false;
  const visit = (n: import('typescript').Node): void => {
    if (ts.isIdentifier(n) && n.text === SAMPLE_DATA_BINDING) used = true;
    if (!used) ts.forEachChild(n, visit);
  };
  visit(file);
  if (used) throw new TrialPackageRefusal(`objectstack.config.ts already uses the name \`${SAMPLE_DATA_BINDING}\`, which the sample-data import takes`);

  const imports = file.statements.filter(ts.isImportDeclaration);
  const importLine = `import ${SAMPLE_DATA_BINDING} from '${SAMPLE_DATA_SPECIFIER}';`;
  const brace = literal.getStart(file) + 1;
  const edits: Array<{ at: number; text: string }> = [
    { at: brace, text: `\n  // The card's seed rows, the sample data an install loads (added by the gallery export).\n  data: ${SAMPLE_DATA_BINDING},` },
    imports.length > 0 ? { at: imports[imports.length - 1]!.getEnd(), text: `\n${importLine}` } : { at: 0, text: `${importLine}\n` },
  ];
  let out = source;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return out;
}

/** The object literal `export default defineStack({ … })` hands over, or `undefined`. */
function defaultStackLiteral(ts: Ts, file: import('typescript').SourceFile): import('typescript').ObjectLiteralExpression | undefined {
  for (const s of file.statements) {
    if (!ts.isExportAssignment(s) || s.isExportEquals) continue;
    let e = s.expression;
    while (ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e) || ts.isAsExpression(e)) e = e.expression;
    if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression) || e.expression.text !== 'defineStack') return undefined;
    const arg = e.arguments[0];
    return arg !== undefined && ts.isObjectLiteralExpression(arg) ? arg : undefined;
  }
  return undefined;
}
