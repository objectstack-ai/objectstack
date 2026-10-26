/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useRecordContext } from '../context/RecordContext.js';
import { evaluateConfigBagInScope } from '../SchemaRenderer.js';
import { usePredicateScope } from './useExpression.js';
import { usePageVariables } from './usePageVariables.js';

/**
 * The `properties` evaluation of the `SchemaRenderer` memo, for a node that is
 * rendered WITHOUT `SchemaRenderer` (objectui#10290).
 *
 * `action:bar` (in `@object-ui/components`) mounts its member actions itself,
 * so a member's `properties` never passes through the memo. Its static
 * execution values ride `properties.params` (objectui#10289; an `action:group`
 * / `action:menu` member carries no `properties` bag and its container reads
 * none, objectui#11638), and those values are templates
 * evaluated where `properties` are (objectui#7867). This hook is that
 * evaluation: the memo's per-key rule, its `ExpressionEvaluator`, and its
 * scope (the host's ambient roots, `current_user`, the page's bound row as
 * `record`, and page variables as `page`), read from the same contexts the memo
 * reads. It is not a second template engine. See `evaluateConfigBagInScope`.
 *
 * The returned function takes a config bag and returns a new, evaluated bag. A
 * value that is not a config bag is returned unchanged. Call it once per
 * authored bag: the result is already evaluated, and evaluating it again would
 * interpolate text that came out of the row.
 *
 * A fresh function each render. Nothing may depend on its identity
 * (AGENTS.md #10).
 */
export function useConfigBagEvaluator(): (bag: unknown) => unknown {
  const predicateScope = usePredicateScope();
  const boundRecord = useRecordContext()?.data;
  const { variables: pageVariables } = usePageVariables();
  return (bag: unknown): unknown =>
    evaluateConfigBagInScope(bag, predicateScope, boundRecord, pageVariables);
}
