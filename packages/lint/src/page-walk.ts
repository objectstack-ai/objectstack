// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared page-component traversal for the lint rules that inspect
 * `PageComponent.properties` (issue #3583).
 *
 * Getting this walk right is subtle enough that duplicating it has already
 * produced one dead rule, so it lives here once:
 *
 *   - Components hang off `page.regions[].components[]` and `page.slots.<slot>`
 *     — there is NO top-level `page.components`. A walker that reads
 *     `page.components` silently visits nothing on a schema-parsed stack.
 *   - `slots.<slot>` is `PageComponent | PageComponent[]` — a single component
 *     is legal and must be normalized.
 *   - `PageComponentSchema` is `.strict()`, so a component carries no `children`
 *     key of its own. Sub-trees live INSIDE the untyped `properties` bag:
 *     `page:tabs` → `properties.items[].children`, `page:accordion` →
 *     `properties.items[].children`, `page:card` → `properties.body` /
 *     `properties.footer`. All are `z.array(z.unknown())`, so the recursion is
 *     untyped and has to be done by hand.
 *   - `kind: 'html' | 'react' | 'jsx'` pages are authored as `source`, which is
 *     authoritative; their `regions` hold at most a DERIVED cache that the
 *     source wins over. Linting that cache reports findings about metadata the
 *     author never wrote, so those pages are skipped here and covered by
 *     `validate-jsx-pages` / `validate-react-page-props` instead.
 */

export type AnyRec = Record<string, unknown>;

/** A visited component plus everything needed to locate and bind it. */
export interface WalkedComponent {
  /** The component record itself. */
  component: AnyRec;
  /** Config path, e.g. `pages[0].regions[1].components[2]`. */
  path: string;
  /**
   * The object this component binds against, by precedence:
   * `dataSource.object` → `properties.object` → the page's `object`.
   * `undefined` when nothing in the chain names one.
   */
  objectName?: string;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Page kinds whose component tree is a derived cache, not authored metadata. */
const SOURCE_AUTHORED_KINDS = new Set(['html', 'react', 'jsx']);

/** Is this page authored as `source` (so its `regions` must not be linted)? */
export function isSourceAuthoredPage(page: AnyRec): boolean {
  const kind = strName(page.kind);
  return kind !== undefined && SOURCE_AUTHORED_KINDS.has(kind);
}

/**
 * Walk every component on a page, depth-first, yielding each with its config
 * path and resolved object binding. Source-authored pages yield nothing.
 *
 * `pagePath` is the caller's path prefix for the page (e.g. `pages[3]`).
 */
export function walkPageComponents(page: AnyRec, pagePath: string): WalkedComponent[] {
  const out: WalkedComponent[] = [];
  if (!isRec(page) || isSourceAuthoredPage(page)) return out;

  const pageObject = strName(page.object);

  const visit = (node: unknown, path: string, inheritedObject?: string) => {
    if (!isRec(node)) return;

    // Per-element `dataSource` overrides the page object so one page can bind
    // several objects; an inline `properties.object` does the same for the
    // element-family components that declare one.
    const props = isRec(node.properties) ? node.properties : undefined;
    const dataSource = isRec(node.dataSource) ? node.dataSource : undefined;
    const objectName =
      strName(dataSource?.object) ?? strName(props?.object) ?? inheritedObject;

    out.push({ component: node, path, objectName });

    if (!props) return;

    // `page:tabs` / `page:accordion` — items[].children[]
    if (Array.isArray(props.items)) {
      for (let i = 0; i < props.items.length; i++) {
        const item = props.items[i];
        if (!isRec(item) || !Array.isArray(item.children)) continue;
        for (let c = 0; c < item.children.length; c++) {
          visit(item.children[c], `${path}.properties.items[${i}].children[${c}]`, objectName);
        }
      }
    }
    // Generic layout nesting — `properties.children[]`. Not in any props
    // schema, but it is how real pages compose layout containers (`type:
    // 'flex'` grids in the showcase command-center wrap every chart this way).
    // Omitting it hides whole sub-trees from every rule built on this walk.
    if (Array.isArray(props.children)) {
      for (let i = 0; i < props.children.length; i++) {
        visit(props.children[i], `${path}.properties.children[${i}]`, objectName);
      }
    }
    // `page:card` — body[] / footer[]
    for (const key of ['body', 'footer'] as const) {
      const slotList = props[key];
      if (!Array.isArray(slotList)) continue;
      for (let i = 0; i < slotList.length; i++) {
        visit(slotList[i], `${path}.properties.${key}[${i}]`, objectName);
      }
    }
  };

  const regions = Array.isArray(page.regions) ? page.regions : [];
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r];
    if (!isRec(region) || !Array.isArray(region.components)) continue;
    for (let c = 0; c < region.components.length; c++) {
      visit(region.components[c], `${pagePath}.regions[${r}].components[${c}]`, pageObject);
    }
  }

  const slots = isRec(page.slots) ? page.slots : undefined;
  if (slots) {
    for (const [slot, value] of Object.entries(slots)) {
      // A slot holds a single component or an array of them.
      const list = Array.isArray(value) ? value : [value];
      const indexed = Array.isArray(value);
      for (let i = 0; i < list.length; i++) {
        visit(list[i], `${pagePath}.slots.${slot}${indexed ? `[${i}]` : ''}`, pageObject);
      }
    }
  }

  return out;
}
