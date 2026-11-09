// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Does the local dev database hold a Studio customization that this build
 * leaves behind?" — the question `os build` asks after it writes the artifact.
 *
 * A change saved in Studio to an item a package ships is an item of that
 * base's paired customization package `<base>.custom` (ADR-0146 D2, D3),
 * stored in the environment's database and never in `src/`. `os build` and
 * the scaffold's `Dockerfile` compile `src/` alone, so a developer who tuned a
 * view on `os dev` and then deployed lost it with no word said. ADR-0146 D2's
 * way to move it is the package export (`os package export`), committed and
 * installed on the target; this module only lets the build say so, once, at
 * the moment the change is left behind.
 *
 * ## Cheap, local, read-only
 *
 * No server door and no network round trip: the build reads the SQLite file
 * `os dev` would open — resolved by the ONE shared resolution
 * (`resolveProjectDatabaseUrl`, `@objectstack/runtime`), over the environment
 * `os dev` reads (this process's, with the project's development `.env*` files
 * under it, as dotenv-flow layers them, and without loading them into this
 * process) — opened read-only, one aggregate `SELECT` over `sys_metadata`.
 * A database that is not a local SQLite file (Postgres, MongoDB, libSQL, a
 * `:memory:` URL) is not probed: reading it would be a network round trip, so
 * the answer is `not_applicable` and the build prints nothing.
 *
 * ## What counts
 *
 * Every `sys_metadata` row whose `package_id` ends in the pair suffix
 * (`CUSTOMIZATION_PACKAGE_SUFFIX`), counted per package. Those rows are what
 * `os package export` carries in a pair's export; an ensured pair with no item
 * yet has no row here and nothing to lose, so it is not counted.
 *
 * ## Never a verdict it did not reach
 *
 * A file that cannot be read, a missing `better-sqlite3` (the optional native
 * driver), or a database with no `sys_metadata` table yet are told apart:
 * the first two answer `unknown` with the reason, the last `none` (a database
 * `os dev` never booted holds no customization). The build never fails on
 * this probe; `unknown` is printed as such, never as "nothing to export".
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenvFlow from 'dotenv-flow';
import { CUSTOMIZATION_PACKAGE_SUFFIX } from '@objectstack/spec/kernel';

/** One pair package and how many stored items it holds. */
export interface LocalCustomizationPackage {
  id: string;
  items: number;
}

export type LocalCustomizationReading =
  /** No local SQLite file to read: a remote or in-memory database, or none created yet. */
  | { status: 'not_applicable' }
  /** Read: no stored item of any `.custom` package. */
  | { status: 'none'; filename: string }
  /** Read: these `.custom` packages hold stored items, which the build does not carry. */
  | { status: 'found'; filename: string; packages: LocalCustomizationPackage[] }
  /** The file exists but could not be read; `detail` says why. */
  | { status: 'unknown'; filename: string; detail: string };

/**
 * The environment `os dev` resolves its database from: this process's
 * variables over the project's development `.env*` files (dotenv-flow never
 * overrides a variable the process already has). Nothing is loaded into
 * `process.env`.
 */
export function devDatabaseEnv(
  projectRoot: string,
  processEnv: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  let fromFiles: Record<string, string> = {};
  try {
    const files = dotenvFlow.listFiles({ node_env: 'development', path: projectRoot });
    if (files.length > 0) fromFiles = dotenvFlow.parse(files);
  } catch {
    // An unreadable `.env*` file: `os dev` loads with `silent: true` and boots
    // without it, so the build resolves without it too.
  }
  return { ...fromFiles, ...processEnv };
}

/** The SQLite file a resolved database URL names, or `null` when it names none on disk. */
export function localSqliteFile(
  url: string,
  sqliteFilenameFromUrl: (url: string, kind: 'sqlite' | 'sqlite-wasm') => string,
): string | null {
  const kind = /^file:/i.test(url) ? 'sqlite' : /^wasm-sqlite:\/\//i.test(url) ? 'sqlite-wasm' : null;
  if (!kind) return null;
  let filename: string;
  try {
    filename = sqliteFilenameFromUrl(url, kind);
  } catch {
    return null;
  }
  if (!filename || filename === ':memory:' || filename.startsWith(':')) return null;
  return filename;
}

/** The aggregate read: stored items per `.custom` package. */
export const LOCAL_CUSTOMIZATION_QUERY =
  "SELECT package_id AS id, COUNT(*) AS items FROM sys_metadata WHERE package_id LIKE ? ESCAPE '\\' "
  + 'GROUP BY package_id ORDER BY package_id';

/** `%.custom`, with LIKE's own wildcards in the suffix escaped. */
function suffixPattern(): string {
  return `%${CUSTOMIZATION_PACKAGE_SUFFIX.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
}

/** Read the stored `.custom` items of one SQLite file. */
export async function readCustomizationsFromSqlite(filename: string): Promise<LocalCustomizationReading> {
  if (!existsSync(filename)) return { status: 'not_applicable' };

  let Database: any;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch (e: any) {
    return { status: 'unknown', filename, detail: `better-sqlite3 is not loadable (${e?.message ?? e})` };
  }

  let db: any;
  try {
    db = new Database(filename, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sys_metadata'").get();
    if (!table) return { status: 'none', filename };
    const rows = db.prepare(LOCAL_CUSTOMIZATION_QUERY).all(suffixPattern()) as Array<{ id: unknown; items: unknown }>;
    const packages = rows
      .filter((r) => typeof r.id === 'string' && r.id.endsWith(CUSTOMIZATION_PACKAGE_SUFFIX))
      .map((r) => ({ id: r.id as string, items: Number(r.items) }));
    return packages.length > 0 ? { status: 'found', filename, packages } : { status: 'none', filename };
  } catch (e: any) {
    return { status: 'unknown', filename, detail: e?.message ?? String(e) };
  } finally {
    try { db?.close(); } catch { /* never opened */ }
  }
}

/**
 * Resolve the database `os dev` opens for `projectRoot` and read its stored
 * `.custom` items. Never throws.
 */
export async function readLocalCustomizations(opts: {
  projectRoot: string;
  artifactPath?: string;
  env?: Record<string, string | undefined>;
}): Promise<LocalCustomizationReading> {
  let filename: string | null;
  try {
    const { resolveProjectDatabaseUrl, sqliteFilenameFromUrl } = await import('@objectstack/runtime');
    const { url } = resolveProjectDatabaseUrl({
      env: opts.env ?? devDatabaseEnv(opts.projectRoot),
      projectRoot: opts.projectRoot,
      artifactPath: opts.artifactPath,
    });
    filename = localSqliteFile(url, sqliteFilenameFromUrl);
  } catch {
    // A database selection the dev boot itself refuses: that boot reports it;
    // there is no file here to read.
    return { status: 'not_applicable' };
  }
  if (!filename) return { status: 'not_applicable' };
  return readCustomizationsFromSqlite(path.resolve(filename));
}

/**
 * The notice lines for a reading, or `[]` when there is nothing to say. Said
 * once per build: what is left behind, where it lives, and the one command
 * that takes it out.
 */
export function localCustomizationNotice(reading: LocalCustomizationReading): string[] {
  if (reading.status === 'found') {
    const total = reading.packages.reduce((n, p) => n + p.items, 0);
    const list = reading.packages.map((p) => `${p.id} (${p.items})`).join(', ');
    return [
      `This build does not carry ${total} Studio customization${total === 1 ? '' : 's'} stored in your dev database: ${list}.`,
      total === 1
        ? `It lives in ${reading.filename}, not in src/, so a deployment of this artifact (or the Dockerfile) does not have it.`
        : `They live in ${reading.filename}, not in src/, so a deployment of this artifact (or the Dockerfile) does not have them.`,
      'Make the change in src/ to ship it with the app, or take it out as a package while `os dev` runs: `os package export`.',
    ];
  }
  if (reading.status === 'unknown') {
    return [
      `Could not check ${reading.filename} for Studio customizations this build leaves behind (${reading.detail}).`,
      'A change saved in Studio is never in src/; `os package export` takes it out while `os dev` runs.',
    ];
  }
  return [];
}
