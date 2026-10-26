/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MarkdownSchema` has ONE authority: `@object-ui/types` (objectui#6172, the
 * 2026-08-25 family ruling — every exported schema name has exactly one
 * authority). This package used to declare a second copy of the name, and the
 * two had drifted on exactly one member: `content` was REQUIRED there and
 * optional here.
 *
 * That divergence was measured, not adjudicated by taste, and it was drift
 * rather than a real semantic difference — every other statement this package
 * makes about `content` already says required:
 *
 *   - the registration in `./index.tsx` declares the `content` input
 *     `required: true`, and `./index.test.ts` pins that;
 *   - `MarkdownImplProps.content` in `./MarkdownImpl.tsx` is `content: string`,
 *     non-optional — the renderer that actually consumes it;
 *   - the Zod mirror `packages/types/src/zod/data-display.zod.ts` spells it
 *     `z.string()`, not `.optional()`, and a parity test pins it;
 *   - and every authored `type: 'markdown'` NODE in the repository supplies
 *     `content`. (The `type: 'markdown'` literals that omit it are rich-text
 *     FIELD metadata — `MarkdownFieldMetadata` in
 *     `packages/types/src/field-types.ts` — which is a different type.)
 *
 * The lone `content?: string` here was the outlier, so the copies converge onto
 * the required spelling rather than the loose one. `className` is not lost: it
 * is declared by `BaseSchema`, which both copies extend, so it was always
 * inherited rather than added here.
 *
 * ⛔ Do not re-add a local `export interface MarkdownSchema`. A re-export is
 * one declaration with many export sites; a second declaration is a second
 * meaning behind one published name, which is the defect this converged.
 */
export type { MarkdownSchema } from '@object-ui/types';
