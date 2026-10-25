/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@object-ui/components"
import { Check, X } from "lucide-react"
import type { InlineFieldDefinition } from "./types"

const cn = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' ')

export interface InlineQuickAddProps {
  /** Column where the card will be added */
  columnId: string
  /** Field definitions for inline editing */
  fields: InlineFieldDefinition[]
  /** Called with field values when the form is submitted */
  onSubmit: (columnId: string, values: Record<string, any>) => void
  /** Called when the form is cancelled */
  onCancel: () => void
  /** Pre-filled values (e.g. from a card template) */
  defaultValues?: Record<string, any>
}

/**
 * InlineQuickAdd renders form fields directly inside the kanban column
 * without opening a dialog or modal. Submit with Enter or the Save button;
 * cancel with Escape or the Cancel button.
 */
export const InlineQuickAdd: React.FC<InlineQuickAddProps> = ({
  columnId,
  fields,
  onSubmit,
  onCancel,
  defaultValues,
}) => {
  const [values, setValues] = React.useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {}
    for (const field of fields) {
      initial[field.name] = defaultValues?.[field.name] ?? field.defaultValue ?? ""
    }
    return initial
  })

  const firstInputRef = React.useRef<HTMLInputElement | HTMLButtonElement>(null)

  React.useEffect(() => {
    // Auto-focus first field on mount
    const timer = setTimeout(() => firstInputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])

  const handleChange = React.useCallback((name: string, value: any) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }, [])

  const handleSubmit = React.useCallback(() => {
    // Require at least one non-empty value
    const hasValue = Object.values(values).some(v =>
      typeof v === "string" ? v.trim().length > 0 : v != null
    )
    if (hasValue) {
      onSubmit(columnId, values)
    }
  }, [columnId, values, onSubmit])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    },
    [handleSubmit, onCancel],
  )

  return (
    <div
      className="mt-2 rounded-lg border border-primary/30 bg-card p-3 space-y-2 shadow-sm"
      onKeyDown={handleKeyDown}
      role="form"
      aria-label="Quick add card"
    >
      {fields.map((field, idx) => (
        <div key={field.name} className="space-y-1">
          <label
            htmlFor={`qa-${columnId}-${field.name}`}
            className="text-xs text-muted-foreground"
          >
            {field.label ?? field.name}
          </label>
          {renderField(field, values[field.name], handleChange, idx === 0 ? firstInputRef : undefined, `qa-${columnId}-${field.name}`)}
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleSubmit}
        >
          <Check className="h-3 w-3" />
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={onCancel}
        >
          <X className="h-3 w-3" />
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** The item a value none of the options carries is shown by. */
const OUTSIDE_OPTIONS = "outside"

/**
 * objectui#11865 — a select field of the quick-add form, drawn with the shared
 * `Select`, the control the rest of the console picks with. It used to be a
 * browser-native `<select>`. A pick writes the option's own value, the string
 * the native control's `change` carried; re-picking the current option writes
 * nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value: the placeholder is the
 *   option whose value is `''`, which `SelectItem` refuses.
 * - The value is matched as the native control matched it, by its string, so
 *   a pre-filled `2` still shows the option whose value is `"2"`.
 * - A value none of the options carries gets an item of its own, labelled with
 *   the value, so the trigger shows what the card will be created with. The
 *   native control showed the placeholder there. Picking that item writes
 *   nothing.
 * - `id` goes on the trigger, so the `<label htmlFor>` names it as it named the
 *   native control, and the ref reaches the trigger, so it takes the form's
 *   first focus.
 * - Keys keep the form's contract: Enter on the closed picker still submits the
 *   form and Escape still cancels it, as on the native control. The other open
 *   keys (Space, the arrows) open the list, and a key pressed in the open list
 *   stays in it: Enter there selects, and Escape closes the list, not the form.
 */
const QuickAddPicker = React.forwardRef<
  HTMLButtonElement,
  {
    id?: string
    value: unknown
    options: ReadonlyArray<{ value: string; label: string }>
    onPick: (value: string) => void
    className?: string
  }
>(({ id, value, options, onPick, className }, ref) => {
  const shown = String(value ?? "")
  const at = options.findIndex(o => o.value === shown)
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={token => {
        // `undefined` for the outside item: it is the form's own value, so there is nothing to write.
        const picked = options[Number(token)]
        if (picked) onPick(picked.value)
      }}
    >
      <SelectTrigger
        ref={ref}
        id={id}
        className={cn(className, "px-2 py-1")}
        onKeyDown={e => {
          // Enter is the form's submit key; it does not open the list.
          if (e.key === "Enter") e.preventDefault()
        }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent onKeyDown={e => e.stopPropagation()}>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{shown}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
})
QuickAddPicker.displayName = "QuickAddPicker"

/** Renders a single field based on its type. */
function renderField(
  field: InlineFieldDefinition,
  value: any,
  onChange: (name: string, value: any) => void,
  ref?: React.Ref<any>,
  id?: string,
) {
  const commonClasses = "text-sm h-8"

  switch (field.type) {
    case "select":
      return (
        <QuickAddPicker
          ref={ref as React.Ref<HTMLButtonElement>}
          id={id}
          value={value}
          options={[
            { value: "", label: field.placeholder ?? `Select ${field.label ?? field.name}...` },
            ...(field.options ?? []),
          ]}
          onPick={picked => onChange(field.name, picked)}
          className={commonClasses}
        />
      )

    case "number":
      return (
        <Input
          ref={ref as React.Ref<HTMLInputElement>}
          id={id}
          type="number"
          value={value ?? ""}
          onChange={e => onChange(field.name, e.target.value === "" ? "" : Number(e.target.value))}
          placeholder={field.placeholder ?? `Enter ${field.label ?? field.name}...`}
          className={commonClasses}
        />
      )

    case "text":
    default:
      return (
        <Input
          ref={ref as React.Ref<HTMLInputElement>}
          id={id}
          type="text"
          value={value ?? ""}
          onChange={e => onChange(field.name, e.target.value)}
          placeholder={field.placeholder ?? `Enter ${field.label ?? field.name}...`}
          className={commonClasses}
        />
      )
  }
}

export default InlineQuickAdd
