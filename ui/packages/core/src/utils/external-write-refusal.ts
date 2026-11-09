/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { errorCodeIs } from '@object-ui/types';
import { EXTERNAL_ERROR_CODES } from '@objectstack/spec/shared';

/**
 * True when the server refused a write because the object is read-only BY
 * DESIGN: it is bound to an external datasource whose ADR-0015 write gate does
 * not admit writes (`403 EXTERNAL_WRITE_FORBIDDEN`, the code `@objectstack/spec`
 * declares as `EXTERNAL_ERROR_CODES.writeForbidden`). The gate admits a write
 * only when the datasource's `external.allowWrites` AND the object's
 * `external.writable` are both true; the server judges that, and this reads
 * only its verdict.
 *
 * No permission set can lift that refusal, so a caller says the table is
 * read-only (`form.readOnlyExternalSource`) instead of the fixed "you don't have
 * permission" line, which sends an administrator looking through permission
 * sets for a grant that does not exist. The server's own text names both
 * datasource flags and the object's machine name, which is a diagnostic, not a
 * sentence for the person who pressed the button.
 *
 * Callers must ask this BEFORE `isPermissionError` (`@object-ui/react`): the
 * refusal is a 403, so that predicate answers true for it. The code is read
 * from the same pair that predicate reads (`code`, then `details.code`, where
 * `@objectstack/client` parks the whole body).
 */
export function isExternalWriteRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const details = (err as { details?: unknown }).details;
  return (
    errorCodeIs(err, EXTERNAL_ERROR_CODES.writeForbidden) ||
    errorCodeIs(details, EXTERNAL_ERROR_CODES.writeForbidden)
  );
}
