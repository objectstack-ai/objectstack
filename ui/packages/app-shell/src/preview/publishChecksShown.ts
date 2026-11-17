// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which publishes the author reviewed the publish checks for, right before
 * pressing Publish (objectstack#34818, item 1: 「发布抽屉里同样列出，用户确认后再
 * 发布。发布后的提示只留一句结果」).
 *
 * The pending-changes sheet (`flowDraftChecks.ts`) and the flow designer's
 * Problems tab list what a flow draft's publish will report. When the author
 * publishes from one of them, the post-publish advisory toast repeating those
 * findings as a block of text says nothing new, so it keeps its one title line
 * (`providers/saveAdvisoryToast.ts`). A publish the author did NOT review —
 * one an AI surface performs, or a sheet that listed nothing for that item —
 * keeps the full body, because that toast is then the only place the findings
 * reach them.
 *
 * A surface marks an item while its publish is in flight and clears the mark
 * when it is done, so a mark never outlives the publish it describes.
 * Module state, because the toast is raised from the metadata client's
 * advisory listener, which knows the item but not the surface that published
 * it.
 */

const shown = new Set<string>();

function keyOf(type: string, name: string, member?: string): string {
  return JSON.stringify([type, name, member ?? null]);
}

/** Mark that the author has just been shown this item's publish checks. */
export function markPublishChecksShown(type: string, name: string, member?: string): void {
  shown.add(keyOf(type, name, member));
}

/** Clear the mark (the publish settled, or the surface closed). */
export function clearPublishChecksShown(type: string, name: string, member?: string): void {
  shown.delete(keyOf(type, name, member));
}

/** Whether the author was shown this item's publish checks before this publish. */
export function werePublishChecksShown(type: string, name: string, member?: string): boolean {
  return shown.has(keyOf(type, name, member));
}
