/**
 * crudAffordances — re-export shim.
 *
 * The canonical bucket/affordance logic now lives in `@object-ui/core`
 * (`utils/managedBy.ts`) so it is defined ONCE and shared by every UI package
 * — app-shell, plugin-detail, plugin-form, plugin-grid — instead of being
 * hand-mirrored. This file is kept so existing app-shell imports of
 * `./crudAffordances` keep working; prefer importing from `@object-ui/core`
 * directly in new code.
 */

export type {
  ManagedByBucket,
  CrudAffordances,
  RowCrudPredicates,
  UserActionOverride,
  UserActionsOverride,
  SchemaLike,
} from '@object-ui/core';

export {
  resolveEffectiveCrudAffordances,
  isWriteOptedIn,
  isSystemWritable,
  isObjectInlineEditable,
} from '@object-ui/core';
