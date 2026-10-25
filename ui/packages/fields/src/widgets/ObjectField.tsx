import React, { useState, useEffect, useRef } from 'react';
import { Textarea, cn, EmptyValue } from '@object-ui/components';
import { isEmptyValue } from '@object-ui/core';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/** The JSON text the box shows for a stored value — empty for no value. */
function jsonText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

/**
 * Does the text in the box already MEAN the stored value?
 *
 * Compared by meaning, not by string, so the person's own spacing survives an
 * echo of what they typed: `{"a":1}` and the pretty-printed `{ "a": 1 }` denote
 * the same value. Text that does not parse denotes no value at all.
 */
function draftDenotes(text: string, value: unknown): boolean {
  if (!text.trim()) return value === undefined || value === null;
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/**
 * ObjectField - JSON editor for a structured value.
 *
 * The form face of the free-form JSON types: `object`, `composite`, `record`, and
 * since objectui#11448 `json`, which used to alias the raw-text code editor and
 * so showed a stored object as `[object Object]` and saved an edit as a string.
 * A json value need not be an object — an array, a number, a string, a boolean
 * and `null` are all JSON — and this editor shows and parses each of them as
 * itself: the box holds `JSON.stringify(value, null, 2)` and an edit emits
 * `JSON.parse(text)`.
 */
export function ObjectField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<any>) {
  const config = field;

  const [jsonString, setJsonString] = useState(() => jsonText(value));
  // Named `parseError`, NOT `error`: `error` is the published validation slot
  // on the widget contract (#3222) and is destructured above.
  const [parseError, setParseError] = useState<string | null>(null);
  // objectui#6755 — this widget's ONE diagnostic sentence goes through the
  // package's locale channel, the same one 11 of its 55 widgets already read.
  // Called here, ABOVE the readonly early return below, so hook order is the
  // same on both branches (the `AddressField` discipline).
  const { t } = useFieldTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Adopt a value that changed OUTSIDE this box — a record finishing its load,
   * a host resetting the form (objectui#11448).
   *
   * ⚠️ The trigger is the VALUE changing, tracked against what this widget last
   * saw — never "the draft disagrees with the value". The effect used to run on
   * every change of the draft and replace any text that did not parse with the
   * stored value, so a JSON value could not be typed one character at a time:
   * in an empty field the first `{` was wiped at once, and in a filled one the
   * box snapped back to the last valid value while still saying "Invalid JSON".
   * `LocationField` measured the same rule wrong for the same reason and tracks
   * the value the same way.
   *
   * Two guards then decide whether an external change may overwrite what the
   * person is holding: a refused draft stands (it is the text the diagnostic is
   * about, and an unsaved edit is not a background refresh's to discard —
   * AGENTS.md #8), and a draft that already denotes the new value keeps the
   * person's own spelling.
   */
  const lastSeenValue = useRef(value);
  useEffect(() => {
    if (Object.is(lastSeenValue.current, value)) return;
    lastSeenValue.current = value;
    if (parseError) return;
    if (draftDenotes(jsonString, value)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Required for controlled component sync
    setJsonString(jsonText(value));
  }, [value, jsonString, parseError]);

  /**
   * The refusal reaches the FORM, not only the eye (objectui#11448).
   *
   * A refused draft never becomes a form value — `onChange` is not called — so
   * react-hook-form still holds the last value that parsed, and a submit used
   * to save that stale value with the refusal still on screen. The control is
   * therefore marked invalid through the browser's constraint validation, the
   * channel the form renderer already relies on for native `min` / `max` /
   * `minlength` (it sets no `noValidate`): the submit button's click is refused
   * by the browser, which focuses this box and shows the same sentence. Nothing
   * is sent while the text in the box cannot be parsed.
   */
  useEffect(() => {
    textareaRef.current?.setCustomValidity(parseError ?? '');
  }, [parseError]);

  if (readonly) {
    // The json cell's own floor (`JsonCellRenderer`): `0` and `false` are
    // values and print, and `[]` is a structure and prints. The old `!value`
    // test drew a stored `0` or `false` as empty.
    if (isEmptyValue(value) && !Array.isArray(value)) return <EmptyValue />;
    return (
      <pre className={cn("text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-auto max-h-40", props.className)}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const str = e.target.value;
    setJsonString(str);

    if (!str.trim()) {
      setParseError(null);
      onChange(null);
      return;
    }

    try {
      const parsed = JSON.parse(str);
      setParseError(null);
      onChange(parsed);
    } catch {
      // Invalid JSON - don't propagate change to parent, but keep local state.
      // The sentence is produced HERE, when the draft is refused, rather than
      // at render: `LocationField`'s two arms carry data measured at refusal
      // time (the spec's complaint about the pair that was refused), and the
      // two widgets say their refusals the same way on purpose. The cost is
      // stated rather than hidden: a language switched WHILE a refusal is lit
      // leaves that one sentence in the language it was produced in until the
      // next keystroke.
      setParseError(t('fields.object.invalidJson'));
    }
  };

  return (
    <div className="space-y-1">
      <Textarea
        // DOM pass-through onto the real focusable control (objectui#3318).
        {...toDomProps(props)}
        ref={textareaRef}
        value={jsonString}
        onChange={handleChange}
        placeholder={config?.placeholder || '{\n  "key": "value"\n}'}
        disabled={readonly || props.disabled}
        className={cn("font-mono text-xs", parseError ? "border-red-500 focus-visible:ring-red-500" : "", props.className)}
        rows={6}
        // AFTER the spread so this widget's own computation wins (#3222).
        // Invalid = the form's validation slot OR this widget's own unparsable
        // draft (which already draws the red border above).
        aria-invalid={!!error || !!parseError}
      />
      {parseError && <p className="text-xs text-red-500">{parseError}</p>}
    </div>
  );
}
