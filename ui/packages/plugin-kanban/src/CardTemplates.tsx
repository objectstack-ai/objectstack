/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import { Button } from "@object-ui/components"
import { ChevronDown, FileText, Plus } from "lucide-react"
import type { CardTemplate } from "./types"

const cn = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' ')

export interface CardTemplatesProps {
  /** Available card templates */
  templates: CardTemplate[]
  /** Called when a template (or "Custom") is selected */
  onSelect: (template: CardTemplate | null) => void
  /** Column the template applies to */
  columnId: string
}

/**
 * CardTemplates renders a dropdown button that lets users pick a
 * predefined card template or start with a blank ("Custom") card.
 * The selected template pre-fills the quick-add form values.
 */
export const CardTemplates: React.FC<CardTemplatesProps> = ({
  templates,
  onSelect,
  columnId,
}) => {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Close on Escape
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
      }
    },
    [],
  )

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <Button
        variant="ghost"
        size="sm"
        className="w-full mt-2 text-muted-foreground hover:text-foreground gap-1"
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Add card to ${columnId}`}
      >
        <Plus className="h-4 w-4" />
        Add Card
        <ChevronDown className={cn("h-3 w-3 transition-transform", open ? "rotate-180" : "")} />
      </Button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md"
          role="listbox"
          aria-label="Card templates"
        >
          {/* Custom blank card option */}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            role="option"
            aria-selected={false}
            onClick={() => {
              onSelect(null)
              setOpen(false)
            }}
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs">Custom</span>
          </button>

          {templates.length > 0 && (
            <div className="my-1 h-px bg-border" role="separator" />
          )}

          {templates.map(template => (
            <button
              key={template.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              role="option"
              aria-selected={false}
              onClick={() => {
                onSelect(template)
                setOpen(false)
              }}
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-xs truncate">{template.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default CardTemplates
