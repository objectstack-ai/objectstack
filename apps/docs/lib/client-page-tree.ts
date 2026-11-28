import type { Item, Node, Root } from 'fumadocs-core/page-tree';

/**
 * The docs page tree as the BROWSER receives it.
 *
 * `DocsLayout` is a client component, so the `tree` prop is serialised into the
 * RSC payload of every docs page -- once inline in the prerendered HTML, once in
 * the `.rsc` file -- and the whole site's tree (500+ nodes) rides on each of the
 * 500+ pages. Measured on the offline `vercel build` output before this file
 * existed: ~175 KB of tree per page, ~168 MiB of a ~743 MiB deploy.
 *
 * Most of those bytes are fields no client component reads:
 *
 * - `$ref` -- the loader's link back to the source file; server-side only.
 * - a page's `description` -- the sidebar never shows it. Its one client reader
 *   is the previous / next footer (`fumadocs-ui` `layouts/docs/page/slots/footer`),
 *   which looks the neighbours up in this tree and prints their description.
 *   `footerNeighbours()` below hands the footer those two items from the server
 *   instead, so the footer text is unchanged and the tree no longer carries 500
 *   descriptions for it. Folder descriptions stay: the sidebar's root-folder tabs
 *   read them.
 * - keys whose value is `undefined` (`icon` on almost every page): React still
 *   serialises the key with an `$undefined` marker.
 *
 * Everything else -- `$id` (the client's tree identity and React keys), names,
 * urls, `external`, folder state, icons that are set -- passes through untouched,
 * and unknown keys pass through too, so a field a later fumadocs release starts
 * reading is not silently dropped here.
 */
export function toClientPageTree(tree: Root): Root {
  const cached = clientTrees.get(tree);
  if (cached) return cached;
  const trimmed = trimNode(tree) as Root;
  clientTrees.set(tree, trimmed);
  return trimmed;
}

const clientTrees = new WeakMap<Root, Root>();

function trimNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => trimNode(entry));
  if (value === null || typeof value !== 'object') return value;
  // A React element (a resolved icon) is not tree data: hand it through as is.
  if ('$$typeof' in value) return value;

  const node = value as Record<string, unknown>;
  const page = node.type === 'page';
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(node)) {
    if (entry === undefined) continue;
    if (key === '$ref') continue;
    if (key === 'description' && page) continue;
    out[key] = trimNode(entry);
  }
  return out;
}

/** What the footer reads off a neighbour: nothing else is sent. */
export interface FooterItem {
  name: Item['name'];
  url: string;
  description?: Item['description'];
}

/**
 * The previous / next pages for `url`, computed exactly the way the client
 * footer would compute them from the full tree (`fumadocs-ui`
 * `utils/use-footer-items`): every folder's index page, then its children, depth
 * first, external links skipped, over the root the page sits under.
 *
 * The docs declare no root folders (`"root": true` in a `meta.json`), so that
 * root is the tree itself. If one is ever added, the client footer would scope
 * to it and this function would not: `rootFolderGuard()` makes that a build
 * failure instead of a footer that quietly disagrees with the sidebar.
 */
export function footerNeighbours(
  tree: Root,
  url: string,
): { previous?: FooterItem; next?: FooterItem } {
  rootFolderGuard(tree);
  const list = footerList(tree);
  const index = list.findIndex((item) => item.url === url);
  if (index === -1) return {};
  return { previous: toFooterItem(list[index - 1]), next: toFooterItem(list[index + 1]) };
}

const footerLists = new WeakMap<Root, Item[]>();

function footerList(tree: Root): Item[] {
  const cached = footerLists.get(tree);
  if (cached) return cached;
  const list: Item[] = [];
  const visit = (node: Node) => {
    if (node.type === 'folder') {
      if (node.index) visit(node.index);
      for (const child of node.children) visit(child);
    } else if (node.type === 'page' && !node.external) {
      list.push(node);
    }
  };
  for (const child of tree.children) visit(child);
  footerLists.set(tree, list);
  return list;
}

function toFooterItem(item: Item | undefined): FooterItem | undefined {
  if (!item) return undefined;
  const out: FooterItem = { name: item.name, url: item.url };
  if (item.description !== undefined) out.description = item.description;
  return out;
}

function rootFolderGuard(tree: Root): void {
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.type !== 'folder') continue;
      if (node.root) {
        throw new Error(
          `docs page tree: folder "${String(node.name)}" is a root folder. The footer neighbours in ` +
            'apps/docs/lib/client-page-tree.ts walk the whole tree, while the client footer scopes ' +
            'to the root folder a page sits under; teach footerNeighbours() that scoping before ' +
            'adding a root folder.',
        );
      }
      visit(node.children);
    }
  };
  visit(tree.children);
}
