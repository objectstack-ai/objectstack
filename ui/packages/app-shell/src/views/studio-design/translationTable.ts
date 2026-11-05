// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30285 — the rows of Studio's translation table: one per key a
 * translation item can carry for the package, each with the source text it
 * translates and what the item (or the served language) already says for it.
 *
 * ## Where the rows come from
 *
 * The keys are `collectExpectedEntries` from `@objectstack/lint`, the walk
 * `os i18n extract` scaffolds bundles from and `os lint` gates coverage by, so
 * a row's key is the key the runtime looks up and cannot be misspelled here.
 * The walk is handed the package as a stack: each item's DECLARED document,
 * read through the layered read (`client.layered`: the `code` layer, or for a
 * database-authored item its served document less the injected fields). Not
 * the plain list read, which is translated into the reader's language and
 * carries the fields the platform injects into every object (owner, audit
 * stamps), none of which the package declares.
 *
 * The platform objects the package points at (a lookup's `reference`, the
 * owner the platform gives every object, an app navigation entry for an
 * object the package does not declare) are walked too:
 * their labels ship in a few languages only, and under any other language an
 * administrator has to write them.
 *
 * Left out, and left to the item's JSON view: the registry-driven
 * `metadataForms` group (Studio's own form copy, the same for every package),
 * and every group the walk has no source for (`messages`, `settingsCommon`).
 * The console's own words (New, Save) are no key of a translation item at all:
 * they come from the console's language packs.
 *
 * ## What counts as translated
 *
 * A row is translated when the item has a non-empty value at its key
 * (`here`), when the language's served translations already carry one from
 * another bundle (`elsewhere`, a shipped package bundle for example), or when
 * the source is an inline locale map that names the language (`inline`).
 * Anything else is `missing`, and that is what the count counts.
 */

import type { ExpectedEntry } from '@objectstack/lint';

/** The metadata types the walk reads, and the stack key each one sits under. */
export const WALKED_TYPE_STACK_KEYS = {
  object: 'objects',
  app: 'apps',
  view: 'views',
  action: 'actions',
  dashboard: 'dashboards',
  dataset: 'datasets',
  report: 'reports',
  picklist: 'picklists',
  page: 'pages',
  flow: 'flows',
  hook: 'hooks',
  position: 'positions',
  permission: 'permissions',
  book: 'books',
} as const;

export type WalkedType = keyof typeof WALKED_TYPE_STACK_KEYS;

/** Groups the table leaves to the JSON view: Studio's own form copy, the same for every package. */
const LEFT_TO_JSON_GROUPS: ReadonlySet<string> = new Set(['metadataForms']);

export type TranslationRowStatus = 'here' | 'elsewhere' | 'inline' | 'missing';

export interface TranslationRow {
  /** The dot-joined key, the row's identity. */
  key: string;
  path: readonly string[];
  /** What the walk harvested the key from (`object`, `field`, `option`, …). */
  kind: ExpectedEntry['source'];
  /** The translation group (`objects`, `apps`, …). */
  group: string;
  /** The item the key belongs to (`objects.crm_account`), the table's grouping. */
  groupKey: string;
  /** The text being translated, as the package declares it. */
  sourceText: string;
  /** The item's own value at the key, `''` when it has none. */
  value: string;
  /** What the language already serves at the key from elsewhere, if anything. */
  served?: string;
  status: TranslationRowStatus;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The non-empty string at `path` in `tree`, else `undefined`. */
export function readTranslationAt(tree: unknown, path: readonly string[]): string | undefined {
  let cur: unknown = tree;
  for (const seg of path) {
    if (!isDict(cur)) return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' && cur.length > 0 ? cur : undefined;
}

/**
 * `item` with `value` written at `path`, as the item's JSON would hold it.
 * An empty value removes the key, and the objects it leaves empty, so clearing
 * a cell leaves no empty slot behind. Never mutates `item`.
 */
export function writeTranslationAt(item: Dict, path: readonly string[], value: string): Dict {
  const [head, ...rest] = path;
  if (head === undefined) return item;
  if (rest.length === 0) {
    if (value) return { ...item, [head]: value };
    if (!(head in item)) return item;
    const { [head]: _removed, ...kept } = item;
    return kept;
  }
  const child = isDict(item[head]) ? (item[head] as Dict) : {};
  const next = writeTranslationAt(child, rest, value);
  if (Object.keys(next).length === 0) {
    if (!(head in item)) return item;
    const { [head]: _removed, ...kept } = item;
    return kept;
  }
  return { ...item, [head]: next };
}

/** The entries the table offers: a source text to translate, outside the groups left to JSON. */
export function translatableEntries(entries: readonly ExpectedEntry[]): ExpectedEntry[] {
  return entries.filter((entry) => {
    const group = entry.path[0];
    if (group === undefined || LEFT_TO_JSON_GROUPS.has(group)) return false;
    // The walk records a key with no authored text only so the coverage gate
    // can notice a bundle that writes it anyway: there is nothing to translate.
    return entry.inline !== undefined || entry.inlineLocales !== undefined;
  });
}

function sourceTextOf(entry: ExpectedEntry, locale: string): string {
  if (entry.inline !== undefined) return entry.inline;
  const map = entry.inlineLocales ?? {};
  return map.en ?? Object.values(map).find((text) => text !== map[locale]) ?? entry.sourceValue ?? '';
}

/**
 * One row per translatable entry, judged against the item's draft and the
 * language's served translations (`served`, `null` when not read or when the
 * server answered another language).
 */
export function buildTranslationRows(
  entries: readonly ExpectedEntry[],
  draft: Dict,
  served: Dict | null,
  locale: string,
): TranslationRow[] {
  return translatableEntries(entries).map((entry) => {
    const path = entry.path;
    const value = readTranslationAt(draft, path) ?? '';
    const servedText = served ? readTranslationAt(served, path) : undefined;
    const inlineText = entry.inlineLocales?.[locale];
    const status: TranslationRowStatus = value
      ? 'here'
      : servedText
        ? 'elsewhere'
        : inlineText
          ? 'inline'
          : 'missing';
    return {
      key: path.join('.'),
      path,
      kind: entry.source,
      group: path[0] ?? '',
      groupKey: path.slice(0, 2).join('.'),
      sourceText: sourceTextOf(entry, locale),
      value,
      ...(servedText ? { served: servedText } : inlineText ? { served: inlineText } : {}),
      status,
    };
  });
}

/** How many rows are still untranslated, of how many. */
export function countUntranslated(rows: readonly TranslationRow[]): { untranslated: number; total: number } {
  return { untranslated: rows.filter((row) => row.status === 'missing').length, total: rows.length };
}

/**
 * A registry item's name as the stack spells it. A view is registered as
 * `<object>.<key>` while the stack (and every bundle) keys it by `<key>` alone
 * under its object, so the object's prefix comes off.
 */
function stackItem(type: WalkedType, doc: Dict): Dict {
  if (type !== 'view') return doc;
  const name = typeof doc.name === 'string' ? doc.name : '';
  const object = typeof doc.object === 'string' ? doc.object : '';
  const prefix = `${object}.`;
  return object && name.startsWith(prefix) ? { ...doc, name: name.slice(prefix.length) } : doc;
}

/** The objects a declared stack points at without declaring them. */
export function referencedObjects(stack: Dict): string[] {
  const declared = new Set<string>();
  const objects = Array.isArray(stack.objects) ? (stack.objects as Dict[]) : [];
  for (const obj of objects) if (typeof obj.name === 'string') declared.add(obj.name);
  const out = new Set<string>();
  const note = (name: unknown) => {
    if (typeof name === 'string' && name && !declared.has(name)) out.add(name);
  };
  for (const obj of objects) {
    if (!isDict(obj.fields)) continue;
    for (const field of Object.values(obj.fields)) if (isDict(field)) note(field.reference);
  }
  const walkNav = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!isDict(item)) continue;
      if (item.type === 'object') note(item.objectName);
      walkNav(item.children);
    }
  };
  for (const app of Array.isArray(stack.apps) ? (stack.apps as Dict[]) : []) walkNav(app.navigation);
  return [...out].sort();
}

/** The reads `readDeclaredStack` makes, the part of the metadata client it needs. */
export interface DeclaredStackClient {
  list(type: string, options?: { packageId?: string }): Promise<unknown[]>;
  layered(type: string, name: string, options?: { packageId?: string }): Promise<{ effective: unknown; code: unknown }>;
}

export interface DeclaredStackRead {
  stack: Dict;
  /** The requests the read made: a list per type and package, a layered read per item. */
  requests: number;
}

/** Run `tasks` with at most `limit` in flight. */
async function runBounded<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const at = next++;
      results[at] = await tasks[at]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** At most this many reads in flight while the package is read. */
export const DECLARED_STACK_READ_CONCURRENCY = 4;

/**
 * An object document without the fields the platform injects into every
 * object (owner, audit stamps, tenancy): the served layer marks them
 * `system: true`, and no package declares them.
 */
function withoutInjectedFields(doc: Dict): Dict {
  if (!isDict(doc.fields)) return doc;
  const fields: Dict = {};
  for (const [key, field] of Object.entries(doc.fields)) {
    if (!(isDict(field) && field.system === true)) fields[key] = field;
  }
  return { ...doc, fields };
}

/**
 * What an item declares, from its layered read: the `code` layer when the item
 * ships in code, else the served (`effective`) document of a database-authored
 * item, without the fields the platform injects into it.
 */
function declaredOf(type: WalkedType | 'object', lay: { effective: unknown; code: unknown }): Dict | null {
  if (isDict(lay.code)) return lay.code;
  if (!isDict(lay.effective)) return null;
  return type === 'object' ? withoutInjectedFields(lay.effective) : lay.effective;
}

/**
 * The packages as one stack of their declared documents: a list read per
 * walked type and package for the names, then one layered read per item, at
 * most {@link DECLARED_STACK_READ_CONCURRENCY} in flight, then one per
 * platform object the items point at, the lookups the platform injects (an
 * owner is a user) included. `onProgress` hears each finished read.
 *
 * A translation item of a code package lives in its `.custom` pair, which
 * declares little of its own, so a pair is read with its base.
 */
export async function readDeclaredStack(
  client: DeclaredStackClient,
  packageIds: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<DeclaredStackRead> {
  const types = Object.keys(WALKED_TYPE_STACK_KEYS) as WalkedType[];
  const lists = packageIds.flatMap((packageId) => types.map((type) => ({ type, packageId })));
  let done = 0;
  let total = lists.length;
  const tick = () => onProgress?.(++done, total);
  const listed = await runBounded(
    lists.map(({ type, packageId }) => async () => {
      const items = await client.list(type, { packageId });
      tick();
      const names = items
        .map((raw) => (isDict(raw) && isDict(raw.item) ? raw.item : raw))
        .map((item) => (isDict(item) && typeof item.name === 'string' ? item.name : null))
        .filter((name): name is string => name !== null);
      return { type, packageId, names };
    }),
    DECLARED_STACK_READ_CONCURRENCY,
  );
  const reads = listed.flatMap(({ type, packageId, names }) => names.map((name) => ({ type, packageId, name })));
  total += reads.length;
  const docs = await runBounded(
    reads.map(({ type, packageId, name }) => async () => {
      const lay = await client.layered(type, name, { packageId });
      tick();
      return { type, declared: declaredOf(type, lay), served: isDict(lay.effective) ? lay.effective : null };
    }),
    DECLARED_STACK_READ_CONCURRENCY,
  );
  const stack: Dict = {};
  const served: Dict = {};
  for (const { type, declared, served: doc } of docs) {
    const key = WALKED_TYPE_STACK_KEYS[type];
    if (declared) ((stack[key] ??= []) as Dict[]).push(stackItem(type, declared));
    if (doc) ((served[key] ??= []) as Dict[]).push(doc);
  }
  // What the running app points at, injected lookups included, less what the packages declare.
  const declaredObjects = new Set(((stack.objects ?? []) as Dict[]).map((o) => o.name));
  const platform = referencedObjects(served).filter((name) => !declaredObjects.has(name));
  total += platform.length;
  const platformDocs = await runBounded(
    platform.map((name) => async () => {
      const lay = await client.layered('object', name);
      tick();
      return declaredOf('object', lay);
    }),
    DECLARED_STACK_READ_CONCURRENCY,
  );
  for (const doc of platformDocs) if (doc) ((stack.objects ??= []) as Dict[]).push(doc);
  return { stack, requests: total };
}
