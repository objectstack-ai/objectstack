// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';

/**
 * Render a designer catalogue row whose `{token}` holes carry a node rather
 * than text — a `navigation` code span, a variable-syntax sample — keeping the
 * row's own sentence order in every locale (objectui#10862). A hole the caller
 * supplies no node for stays as written.
 *
 * The admin previews read it; `ActionPreview` carries the same function
 * locally from slice 1.
 */
export function withNodes(template: string, nodes: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const hole = /^\{(\w+)\}$/.exec(part);
    return React.createElement(React.Fragment, { key: i }, hole && hole[1] in nodes ? nodes[hole[1]] : part);
  });
}
