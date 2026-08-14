// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7823 / #8497] The write-response `internal: true` strip — RE-EXPORT.
 *
 * The implementation moved to `@objectstack/core`
 * (`utils/internal-write-response.ts`) in #8497, and that module's header
 * carries the full reasoning: the A-prime placement measurement, why the
 * engine keeps its write results whole, and why the helper had to sit on the
 * floor every transport shares rather than beside the protocol class.
 *
 * The short version: this package was the helper's home when the protocol
 * class was its only caller, but the generic write mouths are not all on that
 * class. `@objectstack/rest`'s cross-object batch and `@objectstack/mcp`'s
 * stdio bridge both write through the engine directly, and neither depends on
 * this package — so the old home forced every new mouth to choose between a
 * duck-typed reach through a protocol instance and a private restatement of a
 * security-relevant rule.
 *
 * This file stays so the names remain importable from
 * `@objectstack/metadata-protocol` exactly as before (`index.ts` re-exports
 * them, and `protocol.ts` imports the strip from here): the move is invisible
 * to every existing consumer.
 */

export {
  collectInternalWriteResponseFields,
  omitInternalFieldsFromWriteResponse,
} from '@objectstack/core';
