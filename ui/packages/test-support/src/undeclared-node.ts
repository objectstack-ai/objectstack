/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE ONE CROSSING for deliberately undeclared node input in a test
 * (objectui#11466).
 *
 * A node slot and `SchemaRenderer`'s `schema` prop take `DeclaredNode` from
 * `@object-ui/types`: the union of the declared node types, with no
 * `type: string` arm. Some tests pin what the RUNTIME does with input that no
 * declaration covers, on purpose: an unknown or retired `type`, a spelling the
 * contract refuses, a host value merged into a node. Such a test still has to
 * hand that input over, and this is the one place it crosses. The return type
 * is inferred from where the value goes, so a call reads as what it is:
 *
 * ```tsx
 * <SchemaRenderer schema={undeclaredNode({ type: 'zzz' })} />
 * ```
 *
 * ⛔ Not for a node of a type the test registers with `ComponentRegistry`:
 * declare that type in `CustomNodeRegistry` (`@object-ui/types`), the way an
 * application declares its own types. ⛔ Not for a fixture that is a declared
 * node: annotate it with its declared type. ⛔ Never from source under `src/`
 * outside a test; this package is never published.
 *
 * It takes no `@object-ui/types` import on purpose: that package depends on
 * this one for its own tests, so the target type comes from the call site.
 */
export function undeclaredNode<Target = unknown>(node: object): Target {
  return node as unknown as Target;
}
