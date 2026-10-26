/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 */

/**
 * Registers `@object-ui/layout`'s blocks (`app-schema-renderer`,
 * `layout:page:card`) for the docs site's schema renderers. (The `page-header`
 * alias this module was first added for was retired by objectui#10859 batch 8;
 * authors write `page:header`, which `@object-ui/components` registers.
 * `responsive-grid` and `navigation-renderer` retired under objectui#11441:
 * authors write `grid` with a breakpoint `columns` object, and navigation is
 * application metadata.)
 *
 * Why this exists (objectui#3787): the site renders catalog examples through
 * `SchemaRenderer`, and `ComponentRegistry` only knows a type once the package
 * owning it has been loaded. `@object-ui/components` registers its own blocks
 * as an import side-effect and every renderer host already imports it, so
 * `div`/`text`/`button` resolved — but nothing pulled in `@object-ui/layout`,
 * so `page-header` resolved to nothing and rendered the red
 * "Unknown component type" panel (OBJUI-001). It was not noticed because no
 * example used the component: the one demo on the PageHeader docs page
 * hand-rolled the header out of `div`s instead, which is the defect #3787 is
 * about.
 *
 * Imported for effect by EVERY host that renders a catalog example
 * (`InteractiveDemo`, `SchemaThumbnail`, `LiveSplitDemo`) rather than wired
 * into one docs page: `SchemaThumbnail` renders the whole catalog on
 * `/docs/guide/schema-catalog`, so a page-local loader would fix the component
 * page and leave that index showing the error panel for the same example.
 *
 * `registerLayout()` is called EXPLICITLY even though the package body also
 * calls it on load: `@object-ui/layout` declares `"sideEffects": false`
 * (`packages/layout/package.json`), which permits a bundler to drop a module
 * imported only for its side-effects. A named import that is actually invoked
 * cannot be dropped. Registration is idempotent, so the double call is safe,
 * and doing it at module scope (not in an effect) means it has already happened
 * for the server render — the demos stay in the prerendered HTML.
 */
import { registerLayout } from '@object-ui/layout';

registerLayout();
