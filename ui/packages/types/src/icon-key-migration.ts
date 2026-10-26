/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/types` - `ui:icon` glyph-key conversion (objectui#5631)
 *
 * The one-shot conversion for STORED metadata written before `ui:icon`'s glyph
 * key moved from `name` to `icon`.
 *
 * Deliberately ZOD-FREE and deliberately not in `zod/layout.zod.ts` next to the
 * schema it serves, for the reason `dashboard-filter-alias.ts` states for the
 * same choice: `@object-ui/types`' main entry re-exports runtime helpers, and
 * pulling one from a `*.zod.ts` module would drag the whole zod graph into
 * every consumer of that entry.
 *
 * ## ⛔ This is a CONVERSION, not a fallback — the distinction is the ruling
 *
 * The maintainer ruled out `schema.icon ?? schema.name` by name (2026-08-22,
 * restated 2026-08-24). Nothing here is wired into a read path: no renderer
 * calls it, no parse calls it, and it is not re-exported from `/zod`. It is a
 * function a deployer runs ONCE over stored documents, whose result is written
 * back to storage. That is what makes it a migration instead of a second
 * de-facto contract — a tolerant read would leave `name` meaning two different
 * things forever, depending on whether a lucide lookup happened to hit.
 *
 * ## Why a conversion exists at all
 *
 * The in-repo corpus was measured at 98 authored icon nodes, 100% naming the
 * glyph with `name`, zero already using `icon` — the whole population, not a
 * legacy tail. Those 98 are converted in the same change as the contract.
 * Deployed tenant metadata is UNMEASURED, and the prior is high reliance for
 * exactly the same reason. The ruling requires that break be loud and carry a
 * conversion path rather than land silently, so stored nodes get three things:
 *
 *  1. a REFUSAL from `IconSchema` naming the rename (see `zod/layout.zod.ts`);
 *  2. a VISIBLE placeholder plus a warning if an unvalidated node reaches the
 *     renderer anyway (PR #5959's placeholder, unchanged by this migration);
 *  3. this converter, so the fix is mechanical rather than hand-editing.
 *
 * ## What it refuses to convert, and why that is reported rather than guessed
 *
 * A node carrying BOTH keys is left untouched and reported. `icon` is already
 * authoritative there, and `name` is a legitimate identity — there is nothing
 * to lift, and overwriting `icon` from `name` could replace a working glyph
 * with an identity string. A node carrying NEITHER is left untouched and
 * reported too: it has no glyph name anywhere to move, so it is a node the
 * contract will refuse on its own merits, not one this converter can repair.
 * Both surface in {@link IconKeyMigrationResult.warnings} so a caller can act
 * on them instead of discovering later that a "successful" migration skipped
 * rows in silence.
 *
 * @module icon-key-migration
 * @packageDocumentation
 */

/** One node this converter declined to convert, and the reason. */
export interface IconKeyMigrationWarning {
  /**
   * Why the node was left alone.
   *
   * - `both-keys` — the node already has `icon`; `name` is being kept as the
   *   identity it is. Nothing to do, reported so it is not mistaken for a miss.
   * - `no-glyph-key` — neither `icon` nor a string `name`, so there is no
   *   glyph name to move. The contract refuses this node; a human decides what
   *   it should have said.
   */
  reason: 'both-keys' | 'no-glyph-key';
  /** JSON path to the node within the document handed in, e.g. `children.2.children.0`. */
  path: string;
  /** The node's `id`, when it declares one — usually the fastest way to find it. */
  id?: string;
  /** Human-readable, already carrying the path and the reason. */
  message: string;
}

/** What {@link migrateIconNodeKeys} did, and what it refused to do. */
export interface IconKeyMigrationResult<T> {
  /**
   * The converted document. A NEW object when anything changed; the SAME
   * reference when nothing did, so callers can use identity to skip a write.
   */
  document: T;
  /** How many `ui:icon` nodes had `name` lifted to `icon`. */
  converted: number;
  /** Nodes deliberately left alone. Empty means every icon node was mechanical. */
  warnings: IconKeyMigrationWarning[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Is this an icon node? Accepts both the bare registry key and the namespaced
 * spelling, because authored documents carry both (`type: 'icon'` in the
 * schema catalog, `ui:icon` where the namespace is written out).
 */
function isIconNode(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  return value.type === 'icon' || value.type === 'ui:icon';
}

/**
 * Convert stored SDUI metadata from `ui:icon`'s legacy `name`-as-glyph spelling
 * to the ruled `icon` key (objectui#5631).
 *
 * Walks the whole document — every array element and every object value, not
 * just a `children` chain, because icon nodes are authored inside slots,
 * toolbars, column definitions and block variables as well. Non-icon nodes are
 * copied structurally and otherwise untouched.
 *
 * On a converted node `name` is REMOVED rather than left in place beside
 * `icon`: leaving it would preserve the exact ambiguity this migration exists
 * to end. If the value was doing double duty as a real identity, `id` is where
 * that belongs, and the conversion is reported so the caller can look.
 *
 * @example
 * ```ts
 * const { document, converted, warnings } = migrateIconNodeKeys(storedPage);
 * if (warnings.length) console.warn(warnings.map(w => w.message).join('\n'));
 * if (document !== storedPage) await save(document);
 * ```
 */
export function migrateIconNodeKeys<T>(document: T): IconKeyMigrationResult<T> {
  const warnings: IconKeyMigrationWarning[] = [];
  let converted = 0;

  function walk(value: unknown, path: string): unknown {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((entry, index) => {
        const result = walk(entry, path ? `${path}.${index}` : String(index));
        if (result !== entry) changed = true;
        return result;
      });
      return changed ? next : value;
    }

    if (!isPlainObject(value)) return value;

    // Recurse first, so a node's own conversion below sees already-converted
    // descendants and the returned document is new only where it had to be.
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const result = walk(entry, path ? `${path}.${key}` : key);
      if (result !== entry) changed = true;
      next[key] = result;
    }

    if (isIconNode(value)) {
      const hasIcon = next.icon !== undefined;
      const hasGlyphName = typeof next.name === 'string' && next.name.length > 0;
      const id = typeof next.id === 'string' ? next.id : undefined;
      const where = `${path || '(root)'}${id ? ` (id: ${id})` : ''}`;

      if (hasIcon && typeof next.name === 'string') {
        warnings.push({
          reason: 'both-keys',
          path: path || '(root)',
          id,
          message:
            `ui:icon at ${where} declares BOTH \`icon\` and \`name\`. Left unchanged: `
            + '`icon` is already the glyph key and `name` is a valid identity. '
            + 'Nothing was overwritten (objectui#5631).',
        });
      } else if (!hasIcon && !hasGlyphName) {
        warnings.push({
          reason: 'no-glyph-key',
          path: path || '(root)',
          id,
          message:
            `ui:icon at ${where} names no glyph — neither \`icon\` nor a non-empty `
            + '`name`. Left unchanged: there is nothing to convert. The node is refused '
            + 'by `IconSchema` and renders a visible placeholder (objectui#5631).',
        });
      } else if (!hasIcon && hasGlyphName) {
        next.icon = next.name;
        delete next.name;
        converted++;
        changed = true;
      }
    }

    return changed ? next : value;
  }

  return { document: walk(document, '') as T, converted, warnings };
}
