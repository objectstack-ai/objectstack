import React from 'react';
import { Textarea, cn, EmptyValue } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * Code field widget - provides a code editor with syntax highlighting
 * Uses a simple textarea with monospace font
 * For advanced code editing, use the @object-ui/plugin-editor component
 */
export function CodeField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<string>) {
  const config = field;
  // Get code-specific configuration from field metadata
  const language = (config as any)?.language ?? 'javascript';

  if (readonly) {
    return (
      <pre className={cn("text-sm bg-muted p-2 rounded overflow-x-auto border", props.className)}>
        <code>{value || <EmptyValue />}</code>
      </pre>
    );
  }

  return (
    <Textarea
      // DOM pass-through onto the real focusable control (objectui#3318).
      {...toDomProps(props)}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={config?.placeholder || `// Write ${language} code here...`}
      disabled={readonly || props.disabled}
      className={cn("font-mono text-sm", props.className)}
      rows={12}
      spellCheck={false}
      // AFTER the spread so this widget's own computation wins: `error` is
      // the published validation slot (#3222), `!!undefined` → explicit
      // "false".
      aria-invalid={!!error}
    />
  );
}
