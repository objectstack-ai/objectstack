// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The storage key of a file: where its bytes live inside the storage root.
 *
 * A key is laid out by the platform, never by the client. The only part of
 * it a client's file name reaches is the extension, and that part is taken
 * from a sanitised basename: everything up to the last `/` or `\` is dropped,
 * and the extension survives only when it is a short run of ASCII letters and
 * digits. Anything else (a separator, a dot run, a space, a control or
 * non-ASCII character) leaves the key without an extension. The client's
 * name itself is kept as metadata on the file record (`sys_file.name`), which
 * is what downloads and listings show; the key never has to carry it.
 *
 * Without this, a name such as `../../etc/passwd` gave the extension
 * `./etc/passwd` and the key `user/ID./etc/passwd`: no escape from the root,
 * but nested directories shaped by user input, which drivers where `/` means
 * something (S3 prefixes, local directories) then materialise.
 *
 * Existing keys are not migrated: every reader reads the stored `key`, so
 * only keys minted from here on change shape.
 */

/** The longest extension a key keeps, in characters. */
const KEY_EXTENSION_MAX = 16;

/** The characters an extension in a key may use. */
const KEY_EXTENSION_RE = new RegExp(`^[A-Za-z0-9]{1,${KEY_EXTENSION_MAX}}$`);

/**
 * The extension a key carries for `filename`, with its leading dot, or `''`.
 * Taken from the basename's last dot-separated segment, kept only when it is
 * 1 to {@link KEY_EXTENSION_MAX} ASCII letters or digits.
 */
export function storageKeyExtension(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? '';
  const dot = basename.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = basename.slice(dot + 1);
  return KEY_EXTENSION_RE.test(ext) ? `.${ext}` : '';
}

/**
 * The storage key of a new file: `<scope>/<fileId><.ext>`, where the
 * extension comes from {@link storageKeyExtension}. Package-internal (not
 * re-exported from `index.ts`); every door that mints a key builds it here,
 * so the upload doors, the server-side attach verbs, the copy of a reused
 * file and the legacy backfill lay keys out the same way.
 */
export function buildKey(scope: string, fileId: string, filename: string): string {
  return `${scope}/${fileId}${storageKeyExtension(filename)}`;
}
