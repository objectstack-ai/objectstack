// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { hashSpec } from '@objectstack/metadata-core';

/**
 * [#28405, ADR-0146 D9 item 4] The content identity of a flow body, as a run
 * records it at start (`SuspendedRun.flowChecksum`) and a resume looks
 * its body up by.
 *
 * It is the value the metadata repository stores in `sys_metadata.checksum`
 * and keys `sys_metadata_history` by — `hashSpec(body, 'flow')` — computed the
 * same way here, over the body exactly as it was handed to `registerFlow`
 * (the stored body, for a flow the protocol's execution read serves), so a
 * stored version is found again by `getByHash`. A code-loaded body has no
 * history row, and gets an equal hash computed the same way.
 *
 * `FlowSchema.version` is not this: it is an author integer that two bodies
 * can share, and an unbumped edit keeps.
 *
 * `undefined` when the body cannot be hashed (a value `canonicalize` refuses):
 * such a run records no identity and resumes as a run recorded before this
 * field existed does.
 */
export function flowContentChecksum(definition: unknown): string | undefined {
    try {
        return hashSpec(definition, 'flow');
    } catch {
        return undefined;
    }
}
