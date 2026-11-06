// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `index.json`, the gallery's one machine-readable manifest. The gallery's
 * README promises it carries each app's function, title, screenshots, question
 * count, framework version and run date; the landing pages on objectos.ai are
 * built from it.
 *
 * Validated before it is written ({@link GalleryIndexSchema}, strict at every
 * level), and written so that an export with no change in its inputs is a
 * no-op diff: apps sorted by id, every key in schema order, no export
 * timestamp, a trailing newline.
 */

import { z } from 'zod';

import { CategorySchema, MachineNameSchema } from '../schema.js';

export const GALLERY_INDEX_SCHEMA_VERSION = 1;

export const SHOT_KINDS = ['list', 'kanban', 'calendar', 'record', 'dashboard'] as const;
export const ShotKindSchema = z.enum(SHOT_KINDS);
export type ShotKind = z.infer<typeof ShotKindSchema>;

export const GalleryScreenshotSchema = z.strictObject({
  kind: ShotKindSchema,
  /** Relative to the gallery root, e.g. `apps/order_to_cash/screenshots/list.png`. */
  path: z.string().regex(/^apps\/[a-z][a-z0-9_]*\/screenshots\/[a-z]+\.png$/),
  /** The object the view shows (`demoorder_invoice`); absent for a dashboard. */
  object: z.string().min(1).optional(),
  /** The view (`demoorder_invoice.board`) or dashboard name shown. */
  view: z.string().min(1).optional(),
});

export const GalleryAppSchema = z.strictObject({
  /** The scenario card's id, which is also the app's directory under `apps/`. */
  id: MachineNameSchema,
  /** The card's app code; the app lives in namespace `demo` + code. */
  code: z.string().regex(/^[a-z]{2,8}$/),
  namespace: z.string().regex(/^demo[a-z]{2,8}$/),
  /** `apps/<id>`. */
  path: z.string().regex(/^apps\/[a-z][a-z0-9_]*$/),
  /** The business function: the card's `category` (the marketplace taxonomy). */
  function: CategorySchema,
  /** `en` is the card's `title`; the card schema has no Chinese title, so `zh` is `null` until it does. */
  title: z.strictObject({ en: z.string().min(1), zh: z.string().min(1).nullable() }),
  /** The card's one-sentence requirement (`prompt.short`), in the languages it has. */
  summary: z.strictObject({ en: z.string().min(1).optional(), zh: z.string().min(1).optional() }),
  /** The card's capability tags, sorted. */
  capabilities: z.array(z.string().min(1)),
  screenshots: z.array(GalleryScreenshotSchema),
  /** The 问数 count: the card's questions, and the turns they are asked in (one per persona a question names). */
  qa: z.strictObject({ questions: z.number().int().min(0), turns: z.number().int().min(0), personas: z.number().int().min(0) }),
  /** Write operations the run graded. */
  operations: z.number().int().min(0),
  framework: z.strictObject({
    /** The `@objectstack/spec` version the generated project pins. */
    version: z.string().min(1),
    /** The objectstack checkout the runner ran from (`git rev-parse --short HEAD`), or `unknown`. */
    runner: z.string().min(1),
  }),
  /** The run record's date (`YYYY-MM-DD`). */
  runDate: z.iso.date(),
  /** The run record's id. */
  run: z.string().min(1),
});
export type GalleryApp = z.infer<typeof GalleryAppSchema>;

export const GalleryIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(GALLERY_INDEX_SCHEMA_VERSION),
    apps: z.array(GalleryAppSchema),
  })
  .refine((ix) => ix.apps.every((a, i) => i === 0 || ix.apps[i - 1]!.id < a.id), { message: 'apps are sorted by id, each id once' })
  .refine((ix) => ix.apps.every((a) => a.path === `apps/${a.id}` && a.screenshots.every((s) => s.path.startsWith(`${a.path}/`))), {
    message: 'an app lives at apps/<id>, and its screenshots under it',
  });
export type GalleryIndex = z.infer<typeof GalleryIndexSchema>;

/** The index for these apps, validated, as the bytes to write. Throws a ZodError on an invalid index. */
export function serializeIndex(apps: readonly GalleryApp[]): string {
  const sorted = [...apps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = GalleryIndexSchema.parse({ schemaVersion: GALLERY_INDEX_SCHEMA_VERSION, apps: sorted });
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Read an existing index. Throws on one that does not validate. */
export function parseIndex(text: string): GalleryIndex {
  return GalleryIndexSchema.parse(JSON.parse(text));
}
