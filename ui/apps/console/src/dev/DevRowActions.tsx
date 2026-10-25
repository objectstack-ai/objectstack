/**
 * Dev-only harness for row-action overflow in the list grid.
 *
 * Reproduces the cloud "环境 / Environments" list, where each row declares TWO
 * `variant:'primary'` actions ("Open" + "Upgrade Plan"). Before the fix these
 * both rendered as inline buttons in a fixed 80px-floored, overflow-hidden
 * actions cell, so the leftmost ("Open") was clipped to a blue sliver.
 *
 * After the fix:
 *  - the `_actions` column is `fitContent` (hugs its buttons, never clipped);
 *  - only the first `maxInlineRowActions` (default 1) primaries stay inline —
 *    the rest fold into the "⋮" overflow menu.
 *
 * The second grid raises `maxInlineRowActions` to 2 to show both primaries can
 * still render inline when the author opts in (and the column grows to fit).
 * Not part of the product nav.
 */
import React from 'react';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '@object-ui/plugin-grid';

const ENV_ROWS = [
  { id: '1', name: 'hotcrm-fix-verify', org: 'hotcrm-fix-verify', type: 'production', status: 'running', host: 'os-05ayzz.objectos.app' },
  { id: '2', name: 'Objectstack', org: 'Objectstack', type: 'production', status: 'running', host: 'os-0zpadn.objectos.app' },
  { id: '3', name: 'hotcrm', org: "JIANGUO Zhuang's Workspace", type: 'production', status: 'running', host: 'os-48f50e60.objectos.app' },
];

// Mirrors the sys_environment row-level actions: two primaries plus secondaries
// that live in the "⋮" overflow menu.
const ROW_ACTION_DEFS = [
  { name: 'open', label: 'Open', variant: 'primary' },
  { name: 'upgrade', label: 'Upgrade Plan', variant: 'primary' },
  { name: 'rename', label: 'Rename', variant: 'secondary' },
  { name: 'archive', label: 'Archive', variant: 'secondary' },
];

const COLUMNS = [
  { field: 'name', label: '名称' },
  { field: 'org', label: '所属组织' },
  { field: 'type', label: '类型' },
  { field: 'status', label: '状态' },
  { field: 'host', label: '公开主机名' },
];

function EnvGrid({ maxInlineRowActions }: { maxInlineRowActions?: number }) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'showcase_environment',
    columns: COLUMNS,
    data: { provider: 'value', items: ENV_ROWS },
    rowActionDefs: ROW_ACTION_DEFS,
    ...(maxInlineRowActions != null ? { maxInlineRowActions } : {}),
  };
  return (
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>
  );
}

export const DevRowActions: React.FC = () => (
  <div className="mx-auto max-w-none space-y-8 p-6">
    <div>
      <h1 className="text-lg font-semibold">Dev · Row-action overflow (default)</h1>
      <p className="mb-3 text-sm text-muted-foreground">
        Two <code>variant:'primary'</code> row actions. Only <strong>Open</strong> stays inline;
        <strong> Upgrade Plan</strong> + the secondaries fold into the <code>⋮</code> menu. The
        actions column hugs its content and must never clip the inline button.
      </p>
      <div className="rounded-lg border" data-testid="grid-default">
        <EnvGrid />
      </div>
    </div>
    <div>
      <h1 className="text-lg font-semibold">Dev · Row-action overflow (maxInlineRowActions: 2)</h1>
      <p className="mb-3 text-sm text-muted-foreground">
        Same data, author opts into two inline primaries — both <strong>Open</strong> and
        <strong> Upgrade Plan</strong> render inline and the column grows to fit them.
      </p>
      <div className="rounded-lg border" data-testid="grid-wide">
        <EnvGrid maxInlineRowActions={2} />
      </div>
    </div>
    <div>
      <h1 className="text-lg font-semibold">Dev · Row-action sticky-right (narrow / horizontal scroll)</h1>
      <p className="mb-3 text-sm text-muted-foreground">
        A deliberately narrow container so the table scrolls horizontally. The
        <strong> 操作</strong> column stays pinned to the right edge (always reachable), while the
        first <strong>名称</strong> column stays frozen on the left. Scroll the grid sideways to check
        both edges hold.
      </p>
      <div className="max-w-md overflow-hidden rounded-lg border" data-testid="grid-scroll">
        <EnvGrid />
      </div>
    </div>
  </div>
);

export default DevRowActions;
