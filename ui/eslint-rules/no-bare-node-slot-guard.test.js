/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit test for the local ESLint rule that refuses a bare `&&` guard whose left
 * operand is a SchemaNode slot (objectui#9162). Plain JS so it needs no package
 * tsconfig.
 *
 * The `invalid` cases are transcribed from the live defect sites the card
 * measured — `layout/container.tsx`, `layout/card.tsx` (all three guard
 * shapes, including the compound `||` header guard and the `children || body`
 * alias chain), `overlay/dialog.tsx`, `complex/table.tsx`,
 * `plugin-detail/DetailView.tsx` and `layout/containers.tsx`'s `any`-typed
 * `page:card` — so the rule is pinned against the shapes that actually
 * occurred, not against shapes imagined for it.
 *
 * The `valid` cases carry the two halves the rule must NOT break:
 *
 *  - the REPAIRED spellings (`renderChildren(x)` bare, `renderNodeSlot(x, …)`
 *    wrapped), and objectui#9033's ternary at `header-bar`, which is the
 *    control the card used to separate fixed sites from unfixed ones. If the
 *    rule flagged the ternary, the census could not tell those two apart.
 *  - the guards that are NOT this class and must stay writable: a declared
 *    boolean (`schema.showClose`), a declared string (`schema.title`), a
 *    comparison, an array-length test, and an `&&` in an ATTRIBUTE position,
 *    where the value is handed to a component rather than to React's child
 *    reconciler.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-bare-node-slot-guard.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-bare-node-slot-guard', rule, {
  valid: [
    // The repaired bare spelling — `renderChildren` IS the guard
    // (`layout/container.tsx`, `layout/flex.tsx`, `grid.tsx`, `stack.tsx`).
    `
      function Container({ schema }) {
        return <div>{renderChildren(schema.children)}</div>;
      }
    `,
    // The repaired wrapped spelling (`layout/card.tsx`, the overlays, `table`).
    `
      function Card({ schema }) {
        return (
          <div>
            {renderNodeSlot(schema.footer, (footer) => (
              <CardFooter>{renderChildren(footer)}</CardFooter>
            ))}
          </div>
        );
      }
    `,
    // objectui#9033's ternary at `header-bar`. ⛔ Must stay valid: it is the
    // control that makes the census able to distinguish fixed from unfixed.
    `
      function HeaderBar({ schema }) {
        return (
          <header>
            {schema.rightContent ? (
              <SchemaRenderer schema={toRenderableSchema(schema.rightContent)} />
            ) : null}
          </header>
        );
      }
    `,
    // A declared BOOLEAN sibling, never handed to a node renderer
    // (`overlay/drawer.tsx`'s `showClose`).
    `
      function Drawer({ schema }) {
        return (
          <DrawerFooter>
            {renderChildren(schema.footer)}
            {schema.showClose && <DrawerClose />}
          </DrawerFooter>
        );
      }
    `,
    // Declared strings. `''` contributes no characters, and neither is ever
    // handed to a node renderer, so neither is in the derived set.
    `
      function Card({ schema }) {
        return (
          <CardHeader>
            {schema.title && <CardTitle>{schema.title}</CardTitle>}
            {schema.description && <CardDescription>{schema.description}</CardDescription>}
          </CardHeader>
        );
      }
    `,
    // A comparison is already a boolean, whatever it compares.
    `
      function List({ schema }) {
        return <div>{schema.items.length > 0 && renderChildren(schema.items)}</div>;
      }
    `,
    // The `header !== null` shape `layout/card.tsx` uses for its compound
    // guard: the rendered result, not the slot.
    `
      function Card({ schema }) {
        const header = renderChildren(schema.header);
        return <div>{(schema.title || header !== null) && <CardHeader>{header}</CardHeader>}</div>;
      }
    `,
    // ATTRIBUTE position: the value is handed to the component, not to React's
    // child reconciler, so the numeric-falsy leak does not apply.
    `
      function Panel({ schema }) {
        return <Slot content={schema.children && renderChildren(schema.children)} />;
      }
    `,
    // No node renderer anywhere in the file ⇒ nothing is a slot here.
    `
      function Plain({ state }) {
        return <div>{state.count && <span>n</span>}</div>;
      }
    `,
  ],
  invalid: [
    {
      // `layout/container.tsx:101`, verbatim shape.
      code: `
        function Container({ schema }) {
          return <div>{schema.children && renderChildren(schema.children)}</div>;
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // `layout/card.tsx:58` — the slot guarding its own chrome.
      code: `
        function Card({ schema }) {
          return (
            <Card>
              {schema.footer && <CardFooter>{renderChildren(schema.footer)}</CardFooter>}
            </Card>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // `layout/card.tsx:50` — the COMPOUND guard. `undefined || undefined || 0`
      // is `0`, so the `||` leaks for exactly the same reason; the rule has to
      // look through the chain rather than only at the immediate left operand.
      code: `
        function Card({ schema }) {
          return (
            <Card>
              {(schema.title || schema.description || schema.header) && (
                <CardHeader>{renderChildren(schema.header)}</CardHeader>
              )}
            </Card>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // `layout/card.tsx:57` — the alias chain used AS the guard. `children: 0`
      // was converted away only by the accident of operand order, while
      // `body: 0` went through `undefined || 0` and leaked.
      code: `
        function Card({ schema }) {
          return (
            <Card>
              {(schema.children || schema.body) && (
                <CardContent>{renderChildren(schema.children || schema.body)}</CardContent>
              )}
            </Card>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // `overlay/dialog.tsx:34` — multi-line wrapped shape.
      code: `
        function Dialog({ schema }) {
          return (
            <DialogContent>
              {schema.footer && (
                <DialogFooter>
                  {renderChildren(schema.footer)}
                </DialogFooter>
              )}
            </DialogContent>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // `complex/table.tsx:54` — the slot reaches the renderer only through a
      // `typeof` ternary on the RIGHT, which is why objectui#9033's
      // right-operand grep could not see this one.
      code: `
        function Table({ schema }) {
          return (
            <Table>
              {schema.footer && (
                <TableFooter>
                  {typeof schema.footer === 'string' ? schema.footer : renderChildren(schema.footer)}
                </TableFooter>
              )}
            </Table>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // `plugin-detail/DetailView.tsx:1440` — rendered through
      // `<SchemaRenderer schema={…}>` rather than `renderChildren`, so the
      // derived set has to cover that spelling too.
      code: `
        function DetailView({ schema, data }) {
          return (
            <div>
              {schema.header && (
                <div>
                  <SchemaRenderer schema={toRenderableSchema(schema.header)} data={data} />
                </div>
              )}
            </div>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // `layout/containers.tsx:939` — a plain IDENTIFIER, not a member
      // expression, and the renderer's `schema` is `any`. The card's
      // TypeScript census could not see this site; a syntactic derivation can.
      code: `
        function PageCard({ schema }) {
          const body = schema?.body ?? schema?.children;
          return <Card>{body && <CardContent>{renderChildren(body)}</CardContent>}</Card>;
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // The TWELFTH slot: a name that exists nowhere in the repo today. A rule
      // keyed on a list of slot names would let this through; this one does
      // not, because the file itself declares the value to be a node by
      // rendering it as one.
      code: `
        function Future({ schema }) {
          return (
            <div>
              {schema.sidePanel && <aside>{renderChildren(schema.sidePanel)}</aside>}
            </div>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }],
    },
    {
      // Two independent guards in one file are two reports, not one.
      code: `
        function Two({ schema }) {
          return (
            <div>
              {schema.header && <header>{renderChildren(schema.header)}</header>}
              {schema.footer && <footer>{renderChildren(schema.footer)}</footer>}
            </div>
          );
        }
      `,
      errors: [{ messageId: 'bareNodeSlotGuard' }, { messageId: 'bareNodeSlotGuard' }],
    },
  ],
});
