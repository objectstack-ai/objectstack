/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"

import { cn } from "../lib/utils"
import { useDisplayDateLocale } from "../lib/date-fns-locale"
import { Button } from "../ui/button"
import { Calendar } from "../ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

export interface DatePickerProps {
  date?: Date
  onDateChange?: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DatePicker({
  date,
  onDateChange,
  placeholder = "Pick a date",
  className,
  disabled,
}: DatePickerProps) {
  // The label is spelled in the display locale, the one the Calendar below
  // reads too (objectui#10722).
  const locale = useDisplayDateLocale()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-[280px] justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP", { locale }) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        {/*
          Opens on the date's month, and on today's with no date
          (objectui#10799): react-day-picker's `selected` does not move the
          month it opens on. The content unmounts on close, so each open reads
          the current date.
        */}
        <Calendar
          mode="single"
          defaultMonth={date}
          selected={date}
          onSelect={onDateChange}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
