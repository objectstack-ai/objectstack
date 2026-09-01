// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * System Identifier Schema
 * 
 * Universal naming convention for all machine identifiers (API Names) in ObjectStack.
 * Enforces lowercase with underscores or dots to ensure:
 * - Cross-platform compatibility (case-insensitive filesystems)
 * - URL-friendliness (no encoding needed)
 * - Database consistency (no collation issues)
 * - Security (no case-sensitivity bugs in permission checks)
 * 
 * **Applies to all metadata that acts as a machine identifier:**
 * - Object names (tables/collections)
 * - Field names
 * - Role names
 * - Permission set names
 * - Action/trigger names
 * - Event keys
 * - App IDs
 * - Menu/page IDs
 * - Select option values
 * - Workflow names
 * - Webhook names
 * 
 * **Naming Convention Summary:**
 * | Type | Pattern | Example |
 * |------|---------|---------|
 * | Machine ID | snake_case | `crm_account`, `btn_submit`, `role_admin` |
 * | Event keys | dot.notation | `user.login`, `order.created` |
 * | Labels | Any case | `Client Account`, `Submit Form` |
 *
 * **Length ceiling — storage-owned, deliberately not declared here (#12144).**
 * The identifier schemas in this file declare a floor and a grammar but no
 * `.max()`: the enforced ceiling on an identifier is the `maxLength` of the
 * column that stores it (refused at the write seam by ObjectQL's record
 * validator), and the storing columns disagree — the config-object name
 * columns (`sys_permission_set.name`, `sys_position.name`,
 * `sys_capability.name`) enforce 100 while `sys_metadata.name` enforces 255 —
 * so no single `.max()` here can equal every consumer's enforced ceiling.
 * Do not add one unless every consuming column agrees on one width: a
 * `.max()` below the widest storing column refuses names that are legal
 * stored rows today. The schema↔column link is pinned in
 * `@objectstack/plugin-security`'s `identifier-storage-ceiling-pin.test.ts`,
 * which reads the column widths off the registration surface.
 * 
 * @example Valid identifiers
 * - 'account'
 * - 'crm_account'
 * - 'user_profile'
 * - 'order.created' (for events)
 * - 'api_v2_endpoint'
 * 
 * @example Invalid identifiers (will be rejected)
 * - 'Account' (uppercase)
 * - 'CrmAccount' (camelCase)
 * - 'crm-account' (kebab-case - use underscore instead)
 * - 'user profile' (spaces)
 */
import { lazySchema } from './lazy-schema';
export const SystemIdentifierSchema = lazySchema(() => z
  .string()
  .min(2, { message: 'System identifier must be at least 2 characters' })
  .regex(/^[a-z][a-z0-9_.]*$/, {
    message:
      'System identifier must be lowercase, starting with a letter, and may contain letters, numbers, underscores, or dots (e.g., "user_profile" or "order.created")',
  })
  .describe('System identifier (lowercase with underscores or dots)'));

/**
 * Strict Snake Case Identifier
 * 
 * More restrictive than SystemIdentifierSchema - only allows underscores (no dots).
 * Use this for identifiers that should NOT contain dots (e.g., database table/column names).
 * 
 * @example Valid
 * - 'account'
 * - 'crm_account'
 * - 'user_profile'
 * 
 * @example Invalid
 * - 'user.profile' (dots not allowed)
 * - 'UserProfile' (uppercase)
 *
 * No `.max()` is declared, deliberately — identifier length ceilings are
 * storage-owned and the storing columns disagree; see the length-ceiling note
 * on {@link SystemIdentifierSchema} and issue #12144.
 */
export const SnakeCaseIdentifierSchema = lazySchema(() => z
  .string()
  .min(2, { message: 'Identifier must be at least 2 characters' })
  .regex(/^[a-z][a-z0-9_]*$/, {
    message:
      'Identifier must be lowercase snake_case, starting with a letter, and may contain only letters, numbers, and underscores (e.g., "user_profile")',
  })
  .describe('Snake case identifier (lowercase with underscores only)'));

/**
 * Metadata item-name grammar — the ONE segment source (#12194, stage 1 of the
 * #12176 maintainer-ruled retirement of compound `<section>/<name>` addressing,
 * 2026-08-25).
 *
 * Both patterns below are built from this segment so the item-name grammar has
 * a single declaration: {@link METADATA_ITEM_NAME_PATTERN} makes the dot
 * qualifier OPTIONAL (a flat `crm_lead` and a qualified `crm_lead.pipeline`
 * are both item names), while `QUALIFIED_ITEM_NAME_PATTERN` REQUIRES it (the
 * `ViewItemNameSchema` identity in `ui/view.zod.ts`, where the prefix must
 * recover the owning object). Extend the segment here, never by minting a
 * sibling regex — two spellings of one grammar is how the `/meta` door ended
 * up accepting `''`, `//` and `'Views/All Leads'` while spec declared a strict
 * dotted identity nothing enforced.
 */
const ITEM_NAME_SEGMENT = '[a-z][a-z0-9_]*';

/**
 * The enforced metadata item-name grammar: lowercase snake_case segments,
 * optionally dot-qualified — `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/`.
 *
 * Decided by the declaration, not ad hoc: no `/`, no empty string, no
 * whitespace, no uppercase, no leading/trailing/double dots. Enforced at the
 * metadata publish door (`@objectstack/metadata-protocol` `saveMetaItem` /
 * `publishMetaItem`); `deleteMetaItem` and the read doors deliberately stay
 * open so pre-grammar residue rows remain listable and clearable.
 */
export const METADATA_ITEM_NAME_PATTERN = new RegExp(
  `^${ITEM_NAME_SEGMENT}(\\.${ITEM_NAME_SEGMENT})*$`,
);

/**
 * The dot-REQUIRED variant of {@link METADATA_ITEM_NAME_PATTERN}: at least one
 * qualifier segment. `ViewItemNameSchema` (`ui/view.zod.ts`) pins independent
 * view-item identity on it (`<object>.<viewKey>` — the object is recovered
 * from the prefix). Same segment source; only the arity differs.
 */
export const QUALIFIED_ITEM_NAME_PATTERN = new RegExp(
  `^${ITEM_NAME_SEGMENT}(\\.${ITEM_NAME_SEGMENT})+$`,
);

/**
 * Metadata Item Name
 *
 * The addressing identity of a metadata item — the `name` half of the
 * `type`/`name` pair that keys `sys_metadata` and the `/api/v1/meta` URL
 * space. Lowercase snake_case segments, optionally dot-qualified
 * (`crm_lead`, `crm_lead.pipeline`).
 *
 * A slash never belongs in an item name: the compound `<section>/<name>`
 * convention is retired (#12176 — sub-resource identity is spelled with a
 * dot; containment is expressed by structure, never by a separator inside
 * the identity string).
 *
 * @example Valid
 * - 'crm_lead'
 * - 'crm_lead.pipeline'
 * - 'sys_user'
 * @example Invalid (refused at the publish door)
 * - 'views/all_leads' (slash — retired compound addressing; write `views_all_leads` or a dotted qualified name)
 * - '' (empty)
 * - 'Views/All Leads' (uppercase, whitespace, slash)
 * - '.a', 'a.', 'a..b' (leading/trailing/double dots)
 */
export const MetadataItemNameSchema = lazySchema(() => z
  .string()
  .regex(METADATA_ITEM_NAME_PATTERN, {
    message:
      'Metadata item name must be lowercase snake_case segments, optionally dot-qualified '
      + '(e.g. "crm_lead" or "crm_lead.pipeline"). No slashes, spaces, uppercase, empty '
      + 'segments, or leading/trailing dots.',
  })
  .describe('Metadata item name (lowercase snake_case segments, optionally dot-qualified)'));

// [#13613] `EventNameSchema` (and its `EventName` type) was retired under
// ADR-0049 enforce-or-remove. It presented itself as the platform's
// event-name grammar while nothing that runs consumed its three binding
// schemas; the vocabulary the platform actually checks is the closed literal
// enums `DataEventType` / `BulkDataEventType` (`api/events.zod.ts`) — the
// event surface is platform-defined, not author-extensible, so a grammar
// layer for a hypothetical extension surface misleads in both directions.

/**
 * Type Exports
 */
export type SystemIdentifier = z.input<typeof SystemIdentifierSchema>;
export type SnakeCaseIdentifier = z.input<typeof SnakeCaseIdentifierSchema>;
export type MetadataItemName = z.input<typeof MetadataItemNameSchema>;
