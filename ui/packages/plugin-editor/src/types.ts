/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TypeScript type definitions for @object-ui/plugin-editor
 *
 * These types can be imported by applications using this plugin
 * to get full TypeScript support for code-editor schemas.
 */

/**
 * Code Editor component schema.
 * Renders a Monaco-based code editor with syntax highlighting.
 *
 * ⚠️ RE-EXPORTED, not declared here. The authority is
 * `CodeEditorSchema` in `@object-ui/types` (`packages/types/src/form.ts`),
 * alongside the zod mirror that `AnyComponentSchema` validates `code-editor`
 * documents against — so the type an author reads and the schema that accepts
 * their document cannot drift apart.
 *
 * Why that direction and not the other (objectui#6273, the 2026-08-25 family
 * ruling objectui#6172 / 甲-A1): `@object-ui/types` is the lower layer and
 * cannot import from a plugin without creating a cycle, so of the two possible
 * authorities only this one is legal.
 *
 * The two declarations were measured structurally before this re-point rather
 * than assumed equivalent — same heritage (`BaseSchema`), same seven members,
 * same per-member types and optionality, mutually assignable in both
 * directions. That includes `language`, the one member the two spelled
 * differently: this file wrote
 * `'javascript' | 'typescript' | … | string`, which TypeScript collapses to
 * exactly `string`, and the authority declares `string` outright with the
 * six-name authoring shortlist recorded in its own doc comment. No published
 * shape changes here, and the import path `@object-ui/plugin-editor` keeps
 * working exactly as before.
 *
 * @example
 * ```typescript
 * import type { CodeEditorSchema } from '@object-ui/plugin-editor';
 *
 * const editorSchema: CodeEditorSchema = {
 *   type: 'code-editor',
 *   value: 'console.log("Hello, World!");',
 *   language: 'javascript',
 *   theme: 'vs-dark',
 *   height: '400px'
 * }
 * ```
 */
export type { CodeEditorSchema } from '@object-ui/types';
