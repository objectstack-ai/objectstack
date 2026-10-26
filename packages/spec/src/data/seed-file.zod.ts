// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * # Seed files — a file a package ships, written into a file field by a seed
 *
 * A `file` / `image` / `avatar` / `video` / `audio` field stores an opaque
 * `sys_file` id (ADR-0104 D3 wave 2), and only an upload mints one. A seed has
 * no upload, so a seed record names the file by the PATH the package ships it
 * at instead, and the platform carries the bytes from there (#25779, ruled on
 * hotclm#19: "the platform's seed loader should carry bundled fixture files;
 * the app keeps `file` required"):
 *
 * 1. **Authoring.** A record writes `seedFile('fixtures/nda-v1.pdf')` — the
 *    value {@link SeedFileReferenceSchema} — into a file-class field. The path
 *    is relative to the package root: the directory holding
 *    `objectstack.config.ts`, the root a declarative connector's file ref
 *    resolves against too.
 * 2. **Bundling.** `os build` / `os compile` reads every referenced file and
 *    writes its bytes into the dataset's `files` map
 *    ({@link SeedFileContentSchema}), keyed by the same path. The compiled
 *    artifact is what every boot reads — `os dev`, `os serve`, a published
 *    package, an artifact URL — so the bytes travel with the seed wherever it
 *    goes. A path that names no file fails the build.
 * 3. **Loading.** The seed loader stores the bytes as a `sys_file`, writes its
 *    id into the field, and has the written record own it — (object, record,
 *    field), the ownership an upload gets. A replay that finds the row still
 *    holding a file with the same bytes keeps it, so a boot does not mint a
 *    new file for an unchanged fixture. A reference whose bytes the dataset
 *    does not carry is refused, by row, naming the path.
 *
 * 300 rows may name the same path: each row gets a file of its own, because a
 * file has one owning field (ADR-0104 D3).
 */

/** Why a seed file path was refused — the one sentence both refusals print. */
const SEED_FILE_PATH_RULE =
  'a seed file path is relative to the package root, uses `/` separators, and has no empty, `.` or `..` '
  + 'segment (e.g. `fixtures/nda-v1.pdf`)';

/**
 * A package-relative seed file path: relative (no leading `/`, no drive
 * letter), `/`-separated (no `\`), and confined to the package — every segment
 * non-empty and neither `.` nor `..`, so the path cannot climb out of the root
 * it is resolved against and two spellings of one file cannot key two entries.
 *
 * One regular expression rather than a predicate, so the published JSON Schema
 * states the rule as the `pattern` the runtime applies.
 */
const SEED_FILE_PATH_PATTERN = /^(?![A-Za-z]:)(?!\.{1,2}(?:\/|$))[^/\\]+(?:\/(?!\.{1,2}(?:\/|$))[^/\\]+)*$/;

/** Is `path` a package-relative seed file path ({@link SeedFilePathSchema})? */
export function isSeedFilePath(path: unknown): path is string {
  return typeof path === 'string' && SEED_FILE_PATH_PATTERN.test(path);
}

/** A package-relative seed file path, e.g. `fixtures/nda-v1.pdf`. */
export const SeedFilePathSchema = lazySchema(() => z.string()
  .regex(SEED_FILE_PATH_PATTERN, SEED_FILE_PATH_RULE)
  .describe('Path of a file the package ships, relative to the package root (e.g. `fixtures/nda-v1.pdf`)'));
export type SeedFilePath = z.infer<typeof SeedFilePathSchema>;

/** A MIME type: `type/subtype`, the shape a `sys_file.mime_type` carries. */
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/**
 * The value a seed record writes into a file-class field to have the platform
 * store a file the package ships: `{ $file: 'fixtures/nda-v1.pdf' }`, built by
 * {@link seedFile}. A `multiple: true` file field takes an array of them.
 */
export const SeedFileReferenceSchema = lazySchema(() => strictObject({
  surface: 'a seed file reference',
  history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
  aliases: { path: '$file', file: '$file', mimetype: 'contentType', mime: 'contentType', filename: 'name' },
}, {
  $file: SeedFilePathSchema,
  name: z.string().min(1).optional()
    .describe('File name the stored file carries (what a download is saved as); defaults to the last segment of the path'),
  contentType: z.string().regex(MIME_TYPE, 'expected a MIME type such as `application/pdf`').optional()
    .describe('MIME type of the file; defaults to the one `os build` infers from the path\'s extension'),
}).describe('A file the package ships, by package-relative path, written into a file field by a seed'));

/** Author-time shape of {@link SeedFileReferenceSchema}. */
export type SeedFileReference = z.input<typeof SeedFileReferenceSchema>;

/**
 * The bytes of one seed file, as `os build` bundles them into a dataset's
 * `files` map: base64 `data`, with the `size` and SHA-256 the loader checks
 * them against before it stores anything.
 */
export const SeedFileContentSchema = lazySchema(() => strictObject({
  surface: 'a bundled seed file',
  history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
}, {
  contentType: z.string().regex(MIME_TYPE, 'expected a MIME type such as `application/pdf`')
    .describe('MIME type the stored file carries'),
  size: z.number().int().nonnegative().describe('Byte length of the file'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'expected a lowercase hex SHA-256 digest')
    .describe('SHA-256 of the bytes, lowercase hex — the loader refuses bytes that do not match it'),
  data: z.string().describe('The bytes, base64-encoded'),
}).describe('One bundled seed file: its bytes and what they must hash to'));

/** Author-time shape of {@link SeedFileContentSchema}. */
export type SeedFileContent = z.input<typeof SeedFileContentSchema>;

/**
 * Write a file the package ships into a file field from a seed record.
 *
 * ```ts
 * defineSeed(ContractVersion, {
 *   externalId: 'code',
 *   records: [
 *     { code: 'NDA-001-V1', file: seedFile('fixtures/nda-v1.pdf') },
 *   ],
 * });
 * ```
 *
 * `path` is relative to the package root (the directory holding
 * `objectstack.config.ts`). `os build` bundles the bytes; the seed loader
 * stores them and the written record owns the file.
 */
export function seedFile(
  path: string,
  options: { name?: string; contentType?: string } = {},
): SeedFileReference {
  return {
    $file: path,
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
  };
}

/**
 * Does `value` claim to be a seed file reference — a plain object carrying an
 * own `$file` key? The CLAIM, not its validity: a malformed reference is still
 * one, so the place that finds it can refuse it with the schema's own issues
 * instead of writing an object into a file field.
 */
export function isSeedFileReference(value: unknown): value is SeedFileReference {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, '$file');
}
