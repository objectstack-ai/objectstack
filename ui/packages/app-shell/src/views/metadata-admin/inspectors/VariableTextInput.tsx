// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * VariableTextInput — a single-line input (or textarea) for an expression /
 * template flow-config value, with a braces-icon data-picker (#1934) that inserts an
 * in-scope reference at the cursor.
 *
 * Brace handling is done FOR the author (ADR-0032): the picker inserts the BARE
 * reference (`discount_pct`) in `expression` fields, and the double-brace hole
 * `{{ discount_pct }}` in `hole` fields — a flow text slot that renders
 * ADR-0032 §3 template holes (objectui#11824). There is no third spelling: since
 * `@objectstack/spec` 18 no flow string reads the single-brace dialect
 * (objectstack#19939 S7 deleted its resolver), so the picker never writes one
 * (objectui#12329). A literal position — a value a flow reads as written — is
 * rendered with no `groups`, and so with no picker. That kills the recurring
 * `{record.x}` brace-in-CEL trap. Free-text typing is untouched, and the picker
 * button is hidden entirely when nothing is in scope, so an empty scope
 * degrades to a plain input.
 */


import * as React from 'react';
import { Braces } from 'lucide-react';
import {
  cn,
  Input,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@object-ui/components';
import type { ScopeGroup } from './useFlowScope.js';
import { t, useMetadataLocale } from '../i18n.js';

/**
 * How the picker spells a reference: `expression` → bare CEL, `hole` → an
 * ADR-0032 §3 `{{ }}` template hole (objectui#12329: the single-brace spelling
 * is gone with the dialect).
 */
export type VariableFieldMode = 'expression' | 'hole';

/** Wrap a bare reference token for insertion into the given field mode. */
export function formatToken(token: string, mode: VariableFieldMode): string {
  return mode === 'hole' ? `{{ ${token} }}` : token;
}

/**
 * Splice a reference into `value` at the selection `[selStart, selEnd]`, in the
 * brace mode for the field, returning the new string and the caret position
 * just after the inserted token. Pure (the DOM caret restore lives in the
 * component); selection bounds are clamped and order-normalized so a reversed or
 * out-of-range selection can't corrupt the value.
 */
export function insertToken(
  value: string,
  mode: VariableFieldMode,
  token: string,
  selStart: number,
  selEnd: number,
): { next: string; caret: number } {
  const text = formatToken(token, mode);
  const a = Math.min(Math.max(selStart, 0), value.length);
  const b = Math.min(Math.max(selEnd, 0), value.length);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { next: value.slice(0, lo) + text + value.slice(hi), caret: lo + text.length };
}

export interface VariableTextInputProps {
  value: string;
  onValueChange: (v: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Brace rule: bare token for `expression` (the default), `{{ token }}` for `hole`. */
  mode?: VariableFieldMode;
  /**
   * In-scope reference groups (from useFlowScope). Empty → no picker button,
   * which is how a literal position renders (objectui#12329).
   */
  groups: ScopeGroup[];
  placeholder?: string;
  disabled?: boolean;
  /** Render a multi-line `<textarea>` instead of a single-line input. */
  multiline?: boolean;
  rows?: number;
  /** Monospace the input text (expressions). Textareas are always mono. */
  mono?: boolean;
  className?: string;
  /**
   * The host marks this value required (objectui#10948): announced on the
   * input as `aria-required`, beside the visual marker the host's label draws.
   */
  ariaRequired?: boolean;
}

export function VariableTextInput({
  value,
  onValueChange,
  onBlur,
  onKeyDown,
  mode = 'expression',
  groups,
  placeholder,
  disabled,
  multiline,
  rows = 4,
  mono,
  className,
  ariaRequired,
}: VariableTextInputProps) {
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  // Remember the caret across the button press (which blurs the field) so the
  // token lands where the author was typing — not appended at the end.
  const caret = React.useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [open, setOpen] = React.useState(false);
  // The picker's own words, in the designer locale — a shared atom reads it
  // itself, as `InspectorComboField` does (objectui#10748).
  const locale = useMetadataLocale();
  const pickLabel = t('engine.flowScope.picker.insert', locale);

  const setRef = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    inputRef.current = el;
  };

  const rememberCaret = () => {
    const el = inputRef.current;
    if (el) {
      caret.current = {
        start: el.selectionStart ?? value.length,
        end: el.selectionEnd ?? value.length,
      };
    }
  };

  const insert = (token: string) => {
    const { next, caret: pos } = insertToken(value, mode, token, caret.current.start, caret.current.end);
    onValueChange(next);
    setOpen(false);
    // Restore focus + place the caret just after the inserted token.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* some input types disallow setSelectionRange */
      }
      caret.current = { start: pos, end: pos };
    });
  };

  const hasScope = groups.some((g) => g.refs.length > 0);

  const shared = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onValueChange(e.target.value),
    onBlur,
    onKeyDown,
    onSelect: rememberCaret,
    onKeyUp: rememberCaret,
    onClick: rememberCaret,
    placeholder,
    disabled,
    'aria-required': ariaRequired ? true : undefined,
  };

  return (
    <div className={cn('relative', className)}>
      {multiline ? (
        <textarea
          ref={setRef}
          {...shared}
          rows={rows}
          className="w-full rounded border bg-background px-2 py-1.5 pr-8 font-mono text-xs"
        />
      ) : (
        <Input ref={setRef} {...shared} className={cn('h-8 pr-8 text-sm', mono && 'font-mono')} />
      )}

      {hasScope && !disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={pickLabel}
              title={pickLabel}
              // Capture the caret on mousedown (fires before the input blur), so
              // the insertion point is the author's last position.
              onMouseDown={rememberCaret}
              className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Braces className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-0"
            // Keep our rAF focus-restore from fighting Radix's focus return.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <Command>
              <CommandInput placeholder={t('engine.flowScope.picker.search', locale)} className="h-9" />
              <CommandList>
                <CommandEmpty>{t('engine.flowScope.picker.empty', locale)}</CommandEmpty>
                {groups.map((g) => (
                  <CommandGroup key={g.id} heading={g.label}>
                    {g.refs.map((ref) => (
                      <CommandItem
                        key={`${g.id}:${ref.token}`}
                        value={`${ref.token} ${ref.label} ${ref.detail ?? ''}`}
                        onSelect={() => insert(ref.token)}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate font-mono text-xs">{formatToken(ref.token, mode)}</span>
                        {ref.detail && (
                          <span className="shrink-0 truncate text-[10px] text-muted-foreground">{ref.detail}</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
