/**
 * ObjectStack-backed `UserDataAdapter` factory.
 *
 * Persists arbitrary per-user UI state (favorites, recently-accessed items, …)
 * as a single JSON blob per `(user_id, key)` row in the **unified per-user
 * KV store** — the `sys_user_preference` object shipped by every
 * `@objectstack/plugin-auth`-enabled environment.
 *
 * Using the existing `sys_user_preference` table (rather than a parallel
 * `user_app_state` table) keeps things consistent with the platform's
 * "one KV store per scope" pattern:
 *
 *   - `sys_setting`         ← tenant / env scope
 *   - `sys_user_preference` ← per-user scope  ← we live here
 *
 * Callers are encouraged to namespace their keys (e.g. `ui.favorites`,
 * `ui.recent`, `ui.grid.account.state`) so explicit settings (`theme`,
 * `locale`) and machine-written UI traces stay easy to tell apart.
 *
 * ## Schema this adapter expects
 *
 * The canonical `sys_user_preference` schema (from
 * `@objectstack/platform-objects`):
 *
 * ```yaml
 * object: sys_user_preference
 * fields:
 *   user_id:    lookup(sys_user)  # indexed
 *   key:        string            # indexed  (e.g. "ui.favorites")
 *   value:      json              # the serialised list
 *   updated_at: datetime          # auto-managed
 * unique: [user_id, key]
 * ```
 *
 * ## Failure modes
 *
 * The adapter is designed to **degrade silently**. Any error — missing
 * schema, 4xx/5xx, network — is caught:
 *
 * - `load()` returns `[]`, so the hosting provider keeps its localStorage state.
 * - `save()` resolves without throwing, so UI mutations never surface a toast.
 *
 * As soon as the backend supports `sys_user_preference`, persistence
 * "lights up" with no code change.
 *
 * ## One read per load (objectui#12187)
 *
 * The console builds one adapter per slot (favorites, recent items, flow
 * palette recents) over the same data source and user, and their providers
 * call `load()` in the same effects pass. Those loads share ONE request: the
 * first `load()` opens a read for its (data source, resource, user), every
 * `load()` of that scope issued before the next microtask adds its key to it,
 * and the read is then sent once and each adapter takes its own row from the
 * answer. A read that collected one key sends the per-key query this adapter
 * always sent; several keys go as one `key in (...)` query.
 *
 * Nothing is kept past that: the read closes the moment it is sent, so a later
 * `load()` (a new adapter after a language or account switch) asks the server
 * again, and a different user or data source never joins another's read.
 * `save()` does not use it: a write still finds and writes its own row.
 *
 * ## A family of keys in the same read (objectui#12418)
 *
 * Some state is one row per subject the console cannot name at load time: the
 * list state of every object a user has opened is a row per object,
 * `ui.list.<object>`, and which objects those are is only known from the rows
 * themselves. {@link createObjectStackUserPreferenceFamily} loads such a family
 * by its key PREFIX, and joins the same shared read: the read then asks for its
 * keys OR any key starting with the prefix, still one request. A prefix bounds
 * nothing the way the unique index bounds a key, so the read asks for at most
 * {@link PREFERENCE_FAMILY_ROW_LIMIT} family rows on top of its keys; an
 * answer that fills that limit may have left a key's row out, and such a key
 * asks for its own row instead (the same fallback an untagged row takes).
 *
 * @module
 */

import type { DataSource, QueryParams } from '@object-ui/types';

export interface ObjectStackUserStateAdapterOptions {
  /** Connected data source (usually the one provided by `<AdapterProvider>`). */
  dataSource: DataSource<any>;
  /** Authenticated user id. */
  userId: string;
  /**
   * Storage key. Should be a dotted, namespaced string so UI traces
   * don't collide with user-facing preferences. Examples:
   * `ui.favorites`, `ui.recent`, `ui.grid.account.state`.
   */
  key: string;
  /** Override the storage object name. Defaults to `"sys_user_preference"`. */
  resource?: string;
  /**
   * Optional console logger for development diagnostics. Defaults to noop so
   * production builds stay quiet.
   */
  onError?: (where: 'load' | 'save', error: unknown) => void;
}

/**
 * Generic persistence adapter for a user-scoped list.
 *
 * Implementations must be safe to call concurrently and should *never*
 * throw — failures should be swallowed so the hosting provider can degrade
 * to localStorage-only mode without crashing the UI.
 *
 * This is the one declaration of the name: `@object-ui/app-shell`'s
 * `UserStateAdaptersProvider` injects adapters of this type and re-exports it
 * (objectui#6349, batch 9).
 */
export interface UserDataAdapter<T> {
  /** Load the persisted list for the current user. Resolve to [] when absent. */
  load(): Promise<T[]>;
  /** Persist the full list (debounced upstream). Errors are silently ignored. */
  save(items: T[]): Promise<void>;
}

interface UserPreferenceRecord {
  /**
   * Row id, as `@objectstack/spec` declares every record door: a `string`
   * (objectui#9333). These rows are read back off the protocol and handed to
   * `DataSource.update`, so the union this used to carry was a claim the wire
   * never makes.
   */
  id?: string;
  user_id: string;
  key: string;
  value: unknown;
  updated_at?: string;
}

const DEFAULT_RESOURCE = 'sys_user_preference';

/**
 * How many rows of one key family a shared read asks for (objectui#12418).
 * The unique index bounds a KEY to one row; nothing bounds a prefix, so the
 * read's `$top` is its key count plus this many rows per family. An answer
 * that reaches its `$top` is read as possibly cut short: see
 * {@link SharedAnswer.saturated}.
 */
export const PREFERENCE_FAMILY_ROW_LIMIT = 200;

/**
 * The query for the rows of `keys`, and of every key starting with one of
 * `prefixes`. With no prefix: a lone key keeps the per-key query this adapter
 * has always sent, and several keys go as one membership query; the object's
 * unique index on `(user_id, key)` (per organization) bounds the answer to one
 * row per key, so a `$top` of the key count drops none of them. A prefix adds
 * a `$startsWith` arm beside the keys, and {@link PREFERENCE_FAMILY_ROW_LIMIT}
 * rows to the `$top`.
 */
function preferenceQuery(
  userId: string,
  keys: readonly string[],
  prefixes: readonly string[] = [],
): QueryParams {
  if (prefixes.length === 0) {
    if (keys.length === 1) {
      return { $filter: { user_id: userId, key: keys[0] }, $top: 1 };
    }
    return { $filter: { user_id: userId, key: { $in: [...keys] } }, $top: keys.length };
  }
  const arms: Array<Record<string, unknown>> = [];
  if (keys.length === 1) arms.push({ key: keys[0] });
  else if (keys.length > 1) arms.push({ key: { $in: [...keys] } });
  for (const prefix of prefixes) arms.push({ key: { $startsWith: prefix } });
  return {
    $filter: { user_id: userId, ...(arms.length === 1 ? arms[0] : { $or: arms }) },
    $top: keys.length + prefixes.length * PREFERENCE_FAMILY_ROW_LIMIT,
  };
}

/** What one shared request answered. */
interface SharedAnswer {
  readonly rows: UserPreferenceRecord[];
  /**
   * The answer filled the `$top` of a read that carried a prefix, so a row
   * may have been left out. A key whose row is not in such an answer asks for
   * it on its own; a family takes the rows it got.
   */
  readonly saturated: boolean;
}

/** One request for the rows of several adapters' keys and key families. */
interface SharedRead {
  /** The keys asked for. Grows until the request is sent, then fixed. */
  readonly keys: Set<string>;
  /** The key prefixes asked for (objectui#12418). Same lifetime as `keys`. */
  readonly prefixes: Set<string>;
  /** The one request's answer. */
  readonly answer: Promise<SharedAnswer>;
}

/** What a load asks the shared read for: one key, or one key family. */
type SharedReadWant = { key: string } | { prefix: string };

/**
 * The reads still collecting keys: per data source, then per (resource, user).
 * An entry lives only until its request is sent, one microtask after it opens.
 */
const openReads = new WeakMap<object, Map<string, SharedRead>>();

/**
 * Join the open read for this (data source, resource, user), or open one.
 * See "One read per load" in the module header.
 */
function joinSharedRead(
  dataSource: ObjectStackUserStateAdapterOptions['dataSource'],
  resource: string,
  userId: string,
  want: SharedReadWant,
): SharedRead {
  let scopes = openReads.get(dataSource);
  if (!scopes) {
    scopes = new Map();
    openReads.set(dataSource, scopes);
  }
  const scope = JSON.stringify([resource, userId]);
  const open = scopes.get(scope);
  if (open) {
    if ('key' in want) open.keys.add(want.key);
    else open.prefixes.add(want.prefix);
    return open;
  }

  const keys = new Set<string>('key' in want ? [want.key] : []);
  const prefixes = new Set<string>('prefix' in want ? [want.prefix] : []);
  const opened = scopes;
  const read: SharedRead = {
    keys,
    prefixes,
    answer: Promise.resolve().then(async () => {
      // Closed before the request goes out: a load after this point opens the
      // next read instead of waiting on, or being served by, this one.
      if (opened.get(scope) === read) opened.delete(scope);
      const query = preferenceQuery(userId, [...keys], [...prefixes]);
      const result = await dataSource.find(resource, query);
      const rows = (result?.data ?? []) as UserPreferenceRecord[];
      return {
        rows,
        saturated: prefixes.size > 0 && rows.length >= (query.$top ?? Infinity),
      };
    }),
  };
  scopes.set(scope, read);
  return read;
}

/**
 * The writes of ONE `(user, key)` row: an upsert that remembers the row id it
 * found or created. Shared by the per-key adapter and by each key of a family
 * (objectui#12418), so both write a row the same way.
 */
interface PreferenceRowWriter {
  /** Seed or clear the remembered row id (from a load). */
  remember(id: string | null): void;
  /** Upsert the row's value. Throws on failure; callers catch. */
  upsert(value: unknown): Promise<void>;
  /** This key's row, read on its own (the per-key query). */
  find(): Promise<UserPreferenceRecord | null>;
}

function createPreferenceRowWriter(
  dataSource: ObjectStackUserStateAdapterOptions['dataSource'],
  resource: string,
  userId: string,
  key: string,
  onError: NonNullable<ObjectStackUserStateAdapterOptions['onError']>,
): PreferenceRowWriter {
  // Cache the row id between load() and save() so we can update in place
  // without re-querying. Reset on every successful load.
  let cachedRowId: string | null = null;

  // The per-key read, used by writes. Loads go through the shared read.
  const findExisting = async (): Promise<UserPreferenceRecord | null> => {
    // NOTE: `QueryParams` uses OData-style `$`-prefixed keys. Using the bare
    // names (`filter`, `limit`) silently drops the predicate at the
    // `convertQueryParams` layer, which then returns *any* row in the
    // `sys_user_preference` table — that caused the Favorites adapter to load
    // the Recents row (and vice-versa), so clicked items leaked into Starred.
    const result = await dataSource.find(resource, preferenceQuery(userId, [key]));
    return matchPreferenceRow((result?.data ?? []) as UserPreferenceRecord[], userId, key);
  };

  // Upsert by (user_id, key): update in place when the row is known/found,
  // otherwise insert — and if the insert loses a UNIQUE(user_id, key) race
  // (a concurrent writer created the row, or the backend dropped our find
  // predicate), recover by re-finding and updating rather than surfacing the
  // failed insert.
  //
  // Deliberately does NOT stamp `updated_at`: the column is server-managed, and
  // a non-system caller's write to it is stripped (objectstack-ai/objectstack#2948) and reported
  // back as a dropped field — which the console surfaces as a "Some fields were
  // not saved" toast (objectstack-ai/objectstack#3431). Sending it made every recents/favorites write pop
  // a scary warning about a field the user never touched, drowning the real
  // signal the toast exists for (objectstack-ai/objectstack#3794). The server stamps it either way.
  const upsert = async (value: unknown): Promise<void> => {
    // Fast path: we already know the row id from a previous load/save.
    if (cachedRowId !== null) {
      try {
        await dataSource.update(resource, cachedRowId, { value });
        return;
      } catch (updateError) {
        // Row may have been deleted server-side — fall through to find/insert.
        cachedRowId = null;
        onError('save', updateError);
      }
    }

    const existing = await findExisting();
    if (existing && existing.id !== undefined && existing.id !== null) {
      cachedRowId = existing.id;
      await dataSource.update(resource, existing.id, { value });
      return;
    }

    try {
      const created = await dataSource.create(resource, {
        user_id: userId,
        key,
        value,
      });
      const newId = (created as UserPreferenceRecord | undefined)?.id;
      if (newId !== undefined && newId !== null) cachedRowId = newId;
    } catch (createError) {
      // The row already exists (UNIQUE(user_id, key) violation) — re-find and
      // update in place. This turns the insert into a real upsert.
      const recovered = await findExisting();
      if (recovered && recovered.id !== undefined && recovered.id !== null) {
        cachedRowId = recovered.id;
        await dataSource.update(resource, recovered.id, { value });
        return;
      }
      throw createError;
    }
  };

  return {
    remember(id) {
      cachedRowId = id;
    },
    upsert,
    find: findExisting,
  };
}

/**
 * Defensive: if the backend ignored our predicate and returned mixed rows,
 * only accept ones tagged for this (user, key) pair. Rows that omit those
 * metadata fields entirely are trusted (covers mocks and backends that strip
 * metadata from the projection).
 */
function matchPreferenceRow(
  rows: UserPreferenceRecord[],
  userId: string,
  key: string,
): UserPreferenceRecord | null {
  const match = rows.find(r => {
    if (!r) return false;
    const userMismatch = r.user_id !== undefined && r.user_id !== userId;
    const keyMismatch = r.key !== undefined && r.key !== key;
    return !userMismatch && !keyMismatch;
  });
  return match ?? null;
}

/**
 * Build a `UserDataAdapter<T>` backed by ObjectStack.
 *
 * Each adapter instance is bound to a single `(user, key)` pair; create
 * one per slot you want to persist.
 */
export function createObjectStackUserStateAdapter<T = unknown>(
  options: ObjectStackUserStateAdapterOptions,
): UserDataAdapter<T> {
  const {
    dataSource,
    userId,
    key,
    resource = DEFAULT_RESOURCE,
    onError = () => {},
  } = options;

  const writer = createPreferenceRowWriter(dataSource, resource, userId, key, onError);

  // Serializes overlapping save() calls. A fresh adapter is created whenever
  // the data source / user changes (see UserStateBridge), so its cached row id
  // starts null; rapid navigations then fire debounced flushes that can race —
  // two saves each findExisting()→null→create() and the second trips the
  // UNIQUE(user_id, key) constraint. Chaining writes means the second save
  // sees the row id the first one set and updates instead of inserting.
  let saveChain: Promise<void> = Promise.resolve();

  // A load's read: this key's row out of the one request every adapter of
  // this (data source, resource, user) shares for the load (objectui#12187).
  const loadExisting = async (): Promise<UserPreferenceRecord | null> => {
    const read = joinSharedRead(dataSource, resource, userId, { key });
    const { rows, saturated } = await read.answer;
    // The read asked for this key alone: the per-key answer, read as above.
    if (read.keys.size === 1 && read.prefixes.size === 0) {
      return matchPreferenceRow(rows, userId, key);
    }
    // An answer for several keys: a row is this key's only when it names it.
    const own = rows.find(
      r => r && r.key === key && (r.user_id === undefined || r.user_id === userId),
    );
    if (own) return own;
    // A row that names no key cannot be told apart in an answer for several
    // keys, and an answer cut short by a key family's rows may have left this
    // key's row out (objectui#12418): this key's own read, as before the
    // share, answers instead.
    if (saturated || rows.some(r => r && r.key === undefined)) return writer.find();
    return null;
  };

  const decodeValue = (value: unknown): T[] => {
    // The server may return the JSON column already parsed, or as a string.
    if (Array.isArray(value)) return value as T[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  return {
    async load(): Promise<T[]> {
      try {
        const row = await loadExisting();
        if (!row) {
          writer.remember(null);
          return [];
        }
        if (row.id !== undefined && row.id !== null) writer.remember(row.id);
        return decodeValue(row.value);
      } catch (error) {
        onError('load', error);
        return [];
      }
    },

    async save(items: T[]): Promise<void> {
      // Chain onto any in-flight save so concurrent flushes upsert serially
      // rather than racing into two inserts (see `saveChain` above). Each link
      // catches its own errors so one failure never poisons the chain.
      const run = saveChain.then(() => writer.upsert(items)).catch(error => {
        onError('save', error);
        // Swallow — provider falls back to localStorage as source of truth.
      });
      saveChain = run;
      return run;
    },
  };
}

// ---------------------------------------------------------------------------
// Key families (objectui#12418)
// ---------------------------------------------------------------------------

export interface ObjectStackUserPreferenceFamilyOptions {
  /** Connected data source (usually the one provided by `<AdapterProvider>`). */
  dataSource: DataSource<any>;
  /** Authenticated user id. */
  userId: string;
  /**
   * The family's key prefix, dotted and ending in a dot, e.g. `ui.list.`: the
   * family is every key that starts with it, one row per subject
   * (`ui.list.account`, `ui.list.contact`, …).
   */
  prefix: string;
  /** Override the storage object name. Defaults to `"sys_user_preference"`. */
  resource?: string;
  /** Optional diagnostics hook; defaults to noop. */
  onError?: (where: 'load' | 'save', error: unknown) => void;
}

/**
 * A user's rows of one key family: every `sys_user_preference` row whose key
 * starts with the family's prefix, each holding one JSON object.
 *
 * Same contract as {@link UserDataAdapter}: never throws; a failed read loads
 * as no rows and a failed write is reported to `onError` and swallowed, so
 * the hosting provider keeps its localStorage state.
 */
export interface UserPreferenceFamily<T> {
  /** The key prefix this family covers. */
  readonly prefix: string;
  /**
   * Load every row of the family, joining the shared read of the load
   * (one request with the slots' keys). Resolves to `{ [key]: value }`, with
   * only the rows whose value is a JSON object; `{}` when there are none.
   */
  load(): Promise<Record<string, T>>;
  /**
   * Upsert one key's row. A key outside the family is refused (reported to
   * `onError`, nothing written). Writes to one key run in order.
   */
  save(key: string, value: T): Promise<void>;
}

/**
 * Build a {@link UserPreferenceFamily} backed by ObjectStack: one row per key,
 * loaded together by prefix in the shared read (see the module header), each
 * written with the same upsert a single-key adapter uses.
 */
export function createObjectStackUserPreferenceFamily<T extends object = Record<string, unknown>>(
  options: ObjectStackUserPreferenceFamilyOptions,
): UserPreferenceFamily<T> {
  const {
    dataSource,
    userId,
    prefix,
    resource = DEFAULT_RESOURCE,
    onError = () => {},
  } = options;

  const writers = new Map<string, PreferenceRowWriter>();
  const chains = new Map<string, Promise<void>>();
  const writerFor = (key: string): PreferenceRowWriter => {
    let writer = writers.get(key);
    if (!writer) {
      writer = createPreferenceRowWriter(dataSource, resource, userId, key, onError);
      writers.set(key, writer);
    }
    return writer;
  };

  const decodeValue = (value: unknown): T | undefined => {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        return undefined;
      }
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as T)
      : undefined;
  };

  return {
    prefix,

    async load(): Promise<Record<string, T>> {
      try {
        const read = joinSharedRead(dataSource, resource, userId, { prefix });
        const { rows } = await read.answer;
        const out: Record<string, T> = {};
        for (const row of rows) {
          // Only a row that names a key of this family, for this user: a row
          // that names no key cannot be attributed to any subject.
          if (!row || typeof row.key !== 'string' || !row.key.startsWith(prefix)) continue;
          if (row.user_id !== undefined && row.user_id !== userId) continue;
          if (row.id !== undefined && row.id !== null) writerFor(row.key).remember(row.id);
          const value = decodeValue(row.value);
          if (value !== undefined) out[row.key] = value;
        }
        return out;
      } catch (error) {
        onError('load', error);
        return {};
      }
    },

    async save(key: string, value: T): Promise<void> {
      if (!key.startsWith(prefix) || key.length === prefix.length) {
        onError('save', new Error(`key "${key}" is not in the family "${prefix}"`));
        return;
      }
      const run = (chains.get(key) ?? Promise.resolve())
        .then(() => writerFor(key).upsert(value))
        .catch(error => {
          onError('save', error);
        });
      chains.set(key, run);
      return run;
    },
  };
}
