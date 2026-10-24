import React from 'react';
import { Button, Badge, cn } from '@object-ui/components';
import { Plus, X, ExternalLink } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';

// TOMBSTONE (objectui#4811): this widget is NOT in `fieldWidgetMap`
// (packages/fields/src/index.tsx) and is unreachable from any form path —
// `registerField`/`registerAllFields` only walk `fieldWidgetMap`'s keys, and
// the `master_detail` key there deliberately resolves to `LookupField`, not
// this component (see the comment above that map entry: the child-side FK
// must render as a single-value lookup picker, not the one-to-many list this
// widget models). Its only in-repo consumer is its own test
// (complex-widgets.test.tsx), which renders it directly and proves nothing
// about form reachability. It remains solely because its named export
// (`export * from './widgets/MasterDetailField'` in index.tsx) is a public
// API surface, and removing it is a breaking change left to the maintainer
// (see #4811). Auditors of `widgets/**` (the #3291 / #3318 / #4788 class of
// sweep): skip this file — it is a known, deliberate orphan, not a gap in
// your coverage.

/**
 * Master-Detail relationship data structure
 */
export interface MasterDetailValue {
  id: string;
  label: string;
  [key: string]: any;
}

/**
 * Master-Detail field widget - manages one-to-many relationships
 * Displays related records with add/remove capabilities
 */
export function MasterDetailField({ 
  value, 
  onChange, 
  field,
  readonly,
  className,
  ...props 
}: FieldWidgetComponentProps<MasterDetailValue[]>) {
  const items = value || [];
  const config = field;

  const handleAdd = () => {
    // This would typically open a dialog to select/create related records
    // For now, we'll just show a placeholder
    const newItem: MasterDetailValue = {
      id: `new-${Date.now()}`,
      label: 'New Related Record',
    };
    onChange([...items, newItem]);
  };

  const handleRemove = (id: string) => {
    onChange(items.filter(item => item.id !== id));
  };

  const handleView = (_item: MasterDetailValue) => {
    // This would typically navigate to the detail view
  };

  if (readonly) {
    return (
      <div className={cn("space-y-2", className)}>
        {items.length === 0 ? (
          <span className="text-sm text-muted-foreground">No related records</span>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-2 border rounded hover:bg-muted/50"
            >
              <span className="text-sm">{item.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleView(item)}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          ))
        )}
        <p className="text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? 'record' : 'records'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 p-2 border rounded hover:bg-muted/50"
          >
            <div className="flex items-center gap-2 flex-1">
              <Badge variant="outline">{item.id}</Badge>
              <span className="text-sm flex-1">{item.label}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleView(item)}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(item.id)}
                disabled={props.disabled}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded bg-muted/20">
            No related records
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleAdd}
        disabled={props.disabled}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add {config?.label || 'Record'}
      </Button>
    </div>
  );
}
