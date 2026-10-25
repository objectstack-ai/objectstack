/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:approval_decision` — the decision panel of an approval request's
 * record page, registered as the page block `@objectstack/spec` 18 declares
 * (objectui#12342). The renderer itself is `ApprovalDecisionRenderer`
 * (`./approval-decision/ApprovalDecisionPanel.tsx`, objectui#12045); this leaf
 * only registers it, the way `record:approvals` and `record:attachments`
 * register their panels.
 *
 * The spec's `ComponentPropsMap['record:approval_decision']` row is an empty
 * strict object: the panel draws from the record context alone (the request
 * row the page binds, with its `viewer` and `decision_progress`) and from
 * `sys_approval_request`'s own declared actions. So the registration declares
 * no input but `className`, a node-level key. Its arm in
 * `@object-ui/types/zod` (`RecordApprovalDecisionBlockSchema`) landed with
 * this registration, so `objectui validate` accepts a node of this type.
 *
 * Registered in app-shell rather than plugin-detail for the reason
 * `record:approvals` is: the decision bar's runtime depends on
 * `@object-ui/auth`, which plugin-detail deliberately does not pull in. The
 * side-effect registration is imported from the app-shell barrel
 * (`src/index.ts`), and this file is in the package's `sideEffects` array.
 */

import { ComponentRegistry } from '@object-ui/core';
import { ApprovalDecisionRenderer } from './approval-decision/ApprovalDecisionPanel.js';

ComponentRegistry.register('approval_decision', ApprovalDecisionRenderer, {
  namespace: 'record',
  skipFallback: true,
  category: 'record',
  label: 'Approval Decision',
  icon: 'Gavel',
  inputs: [{ name: 'className', type: 'string' }],
});

export default ApprovalDecisionRenderer;
