/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "../lib/utils"
import { Button } from "../ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover"

// One authority for `ComboboxOption` (objectui#6349): `@object-ui/types`
// declares it (`packages/types/src/form.ts` — the shape `ComboboxSchema.options`
// carries and `form.zod.ts` mirrors), and this component read a strict SUBSET
// of it, `value` and `label`. The `./form` subpath is the door because the
// root barrel does not publish the name. A re-export, not a second declaration.
import type { ComboboxOption } from "@object-ui/types/form"
export type { ComboboxOption } from "@object-ui/types/form"

/**
 * Beyond its own named props, the combobox accepts standard button attributes
 * (`id`, `aria-*`, `data-*`, handlers, …) and forwards them to the trigger —
 * the focusable `role="combobox"` button a user and their screen reader
 * actually interact with. Without this seam a field widget rendering a
 * Combobox had no element to deliver `aria-invalid` / `aria-describedby` to
 * after a validation failure (objectui#3318; the same reason #3306 routes the
 * select's pass-through onto `SelectTrigger`). `value` / `onChange` are
 * omitted: this component's own `value` / `onValueChange` contract owns them.
 */
export interface ComboboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange"> {
  options: ComboboxOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  className,
  disabled,
  ...triggerProps
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          // Inside a <form> a bare <button> defaults to type="submit", so an
          // untyped trigger would submit the enclosing object form on every
          // click (objectui#3344). Radix's PopoverTrigger happens to supply
          // type="button" via its Slot today, but that is an upstream
          // implementation detail — declare the contract locally, like
          // LookupField / MultiSelectField / RatingField do. Placed BEFORE the
          // pass-through spread so an explicit consumer `type` still wins.
          type="button"
          // Before this component's own props, which stay authoritative for
          // the combobox contract (role, aria-expanded, className, disabled).
          {...triggerProps}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-[200px] min-w-0 justify-between", className)}
          disabled={disabled}
        >
          {/* The label is a flex child, so it needs `truncate` + `min-w-0` of
              its own — without them a long option ("成员
              (showcase_project_membership)") rendered straight past the
              button's border instead of ellipsizing (objectstack#3821). */}
          <span className="truncate">
            {value
              ? options.find((option) => option.value === value)?.label
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Match the trigger instead of a hardcoded 200px: a combobox widened by
          its consumer had its own options clipped in the dropdown. */}
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[200px] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // `value` stays the option's value: it is what cmdk hands
                  // `onSelect`, so it is what a pick commits.
                  value={option.value}
                  // objectui#13229 — cmdk filters on `value` plus `keywords`
                  // and never reads the children, so with `value` alone a
                  // visible label that is not inside the value ("Opportunities"
                  // for `crm_opp`, a user's name for a record id, a Chinese
                  // label) matched nothing. The label is passed as a keyword,
                  // so typing either the label or the value finds the option.
                  //
                  // `label` is declared `string` on both faces of
                  // `ComboboxOption`, but the `combobox` schema node hands this
                  // component its options straight from JSON, unvalidated at
                  // render. cmdk calls `.trim()` on every keyword, so a number
                  // or missing label passed through would throw and take the
                  // picker down, where before this change it rendered. Such an
                  // option gets no keyword and stays searchable by its value
                  // only, exactly as before: nothing is coerced or widened.
                  keywords={typeof option.label === "string" ? [option.label] : undefined}
                  // objectui#7687 — `options[].disabled` is declared by
                  // `@object-ui/types` and validated by the zod mirror, so it
                  // has to be READ; the sibling select renderer already spells
                  // it this way (`disabled={opt.disabled}` on `SelectItem`).
                  // cmdk 1.1.1 needs nothing more than the prop: a disabled
                  // `Command.Item` renders with `onClick` undefined, never
                  // registers the `cmdk-item-select` listener Enter
                  // dispatches, and is excluded from the valid-item selector
                  // the arrow keys walk — so an extra refusal inside
                  // `onSelect` below would be unreachable. Measured, and the
                  // behaviour half of `combobox-option-disabled.test.tsx`
                  // keeps that measurement honest.
                  disabled={option.disabled}
                  onSelect={(currentValue) => {
                    onValueChange?.(currentValue === value ? "" : currentValue)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
