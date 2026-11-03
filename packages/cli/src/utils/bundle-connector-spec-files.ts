// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';

/**
 * `os build` carries the OpenAPI document a declarative `provider: 'openapi'`
 * connector names by file into the artifact (ADR-0097, the package-relative
 * `providerConfig.spec` form).
 *
 * The file form resolves against a root on disk: the directory holding
 * `objectstack.config.ts` when that directory is the one serving the stack.
 * An artifact installed into another runtime — `os package install
 * ./dist/objectstack.json`, or the marketplace catalog, both of which send the
 * artifact JSON alone — has no such directory: the runtime caches the JSON and
 * nothing else, so the reference resolved against the HOST's root and named a
 * file the host does not have, and the instance never materialized. The
 * artifact is what every runtime loads, so the document travels inside it, as
 * the inline form the provider already accepts (`spec: { openapi: '3…', … }`),
 * the way seed files travel in their datasets (`bundle-seed-files.ts`).
 *
 * The provider owns `providerConfig`'s vocabulary; this pass reads exactly the
 * one key `connector.zod.ts` documents as a package file reference — `spec` of
 * `provider: 'openapi'`, a string that is not an http(s) URL — and leaves every
 * other provider, key and form as written. It reads JSON only, as the provider
 * does, and judges nothing about the document beyond "a JSON object": whether
 * it is OpenAPI 3.x stays the provider's verdict at materialization.
 *
 * Two calls, split the way seed files are:
 *
 *  - {@link collectConnectorSpecFiles} — the GATE: reads each referenced file,
 *    relative to the directory holding the config and confined to it, and
 *    refuses a reference that is absolute, climbs out, names no file or names
 *    a file that is not a JSON object. It writes nothing.
 *  - {@link placeConnectorSpecFiles} — the ASSEMBLY: each entry's
 *    `providerConfig.spec` replaced by the document it named.
 */

/** A refusal, located in the artifact like a schema issue is. */
export interface ConnectorSpecFileIssue {
  /** Where the reference sits, e.g. `connectors[0].providerConfig.spec`. */
  location: string;
  message: string;
}

/** One connector entry, as far as this pass reads it. */
interface ConnectorEntryLike {
  name?: unknown;
  provider?: unknown;
  providerConfig?: Record<string, unknown>;
}

export interface CollectedConnectorSpecFiles {
  /** Each entry that names a spec file, with the document it is to carry. */
  entries: Map<ConnectorEntryLike, Record<string, unknown>>;
  /** Documents read, counted once per entry that carries one. */
  files: number;
  /** Their bytes, as read. */
  bytes: number;
  issues: ConnectorSpecFileIssue[];
}

/**
 * The package file reference `entry` declares, or `undefined`: the
 * `providerConfig.spec` of a `provider: 'openapi'` entry when it is a
 * non-empty string that is not an http(s) URL — the provider's own reading of
 * that key (`connector-openapi` `loadOpenApiDocument`).
 */
export function connectorSpecFileRef(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const { provider, providerConfig } = entry as ConnectorEntryLike;
  if (provider !== 'openapi' || !providerConfig || typeof providerConfig !== 'object') return undefined;
  const spec = providerConfig.spec;
  if (typeof spec !== 'string' || spec.length === 0 || /^https?:\/\//i.test(spec)) return undefined;
  return spec;
}

/**
 * Every connector entry in the stack, with where it sits: the top level's
 * `connectors`, the manifest's, and each `packages[i].manifest` body's. Read
 * by position, off the objects themselves, because
 * {@link placeConnectorSpecFiles} writes into these very entries — the ones
 * the artifact serializes.
 */
function connectorsOf(stack: Record<string, unknown>): Array<{ entry: ConnectorEntryLike; location: string }> {
  const found: Array<{ entry: ConnectorEntryLike; location: string }> = [];
  const seen = new Set<unknown>();
  const take = (list: unknown, location: string): void => {
    if (!Array.isArray(list)) return;
    list.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || seen.has(entry)) return;
      seen.add(entry);
      found.push({ entry: entry as ConnectorEntryLike, location: `${location}[${i}]` });
    });
  };
  take(stack.connectors, 'connectors');
  const manifest = stack.manifest as { connectors?: unknown } | undefined;
  if (manifest && typeof manifest === 'object') take(manifest.connectors, 'manifest.connectors');
  if (Array.isArray(stack.packages)) {
    stack.packages.forEach((pkg, i) => {
      const body = (pkg as { manifest?: { connectors?: unknown } } | null)?.manifest;
      if (body && typeof body === 'object') take(body.connectors, `packages[${i}].manifest.connectors`);
    });
  }
  return found;
}

/**
 * Read every OpenAPI document the stack's connector entries name by file and
 * judge it. `configPath` is the config's path; references resolve against its
 * directory — the root the runtime's package file loader confines a read to.
 * Reads only: the stack is not changed.
 */
export function collectConnectorSpecFiles(
  configPath: string,
  stack: Record<string, unknown>,
): CollectedConnectorSpecFiles {
  const result: CollectedConnectorSpecFiles = { entries: new Map(), files: 0, bytes: 0, issues: [] };
  const root = path.dirname(path.resolve(configPath));
  for (const { entry, location: at } of connectorsOf(stack)) {
    const ref = connectorSpecFileRef(entry);
    if (ref === undefined) continue;
    const location = `${at}.providerConfig.spec`;
    const name = typeof entry.name === 'string' ? entry.name : '(unnamed)';
    const subject = `connector '${name}' providerConfig.spec '${ref}'`;
    // The runtime loader's confinement rule, word for word in effect: an
    // absolute ref (posix or a Windows drive letter) and one that climbs out
    // after resolution are refused.
    if (path.isAbsolute(ref) || /^[a-zA-Z]:[\\/]/.test(ref)) {
      result.issues.push({ location, message: `${subject} is absolute; a spec file path is relative to the directory holding objectstack.config.ts (${root}).` });
      continue;
    }
    const absolute = path.resolve(root, ref);
    const relative = path.relative(root, absolute);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      result.issues.push({ location, message: `${subject} climbs out of the package root ${root}; a spec file path stays inside it.` });
      continue;
    }
    let text: string;
    try {
      if (!fs.statSync(absolute).isFile()) throw new Error('not a file');
      text = fs.readFileSync(absolute, 'utf8');
    } catch {
      result.issues.push({
        location,
        message: `${subject} names no file: ${absolute} does not exist or is not a file. A spec file path is relative to the directory holding objectstack.config.ts.`,
      });
      continue;
    }
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch (err) {
      result.issues.push({ location, message: `${subject} is not a parseable JSON document: ${(err as Error).message}` });
      continue;
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      result.issues.push({ location, message: `${subject} is not a JSON object; an OpenAPI document is one.` });
      continue;
    }
    result.entries.set(entry, document as Record<string, unknown>);
    result.files += 1;
    result.bytes += Buffer.byteLength(text, 'utf8');
  }
  return result;
}

/**
 * Write what {@link collectConnectorSpecFiles} read into the entries it read
 * it for: each one's `providerConfig.spec`, the document in place of the path.
 * Run after the gate passed, on the stack it read.
 */
export function placeConnectorSpecFiles(collected: CollectedConnectorSpecFiles): void {
  for (const [entry, document] of collected.entries) {
    entry.providerConfig = { ...entry.providerConfig, spec: document };
  }
}
