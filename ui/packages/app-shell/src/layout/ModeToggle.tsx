import { Moon, Sun, Monitor } from "lucide-react"
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@object-ui/components"
import { useTheme } from "../chrome/ThemeProvider.js"
import { useObjectTranslation } from '@object-ui/i18n'

export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  const { t } = useObjectTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 max-md:size-11">
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t('console.theme.toggle')}</span>
        </Button>
      </DropdownMenuTrigger>
      {/* 44 px rows below `md`, as the top bar's menus (objectstack#29075). */}
      <DropdownMenuContent align="end" className="max-md:[&_[role=menuitem]]:min-h-11">
        <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2">
          <Sun className="h-4 w-4" />
          {t('console.theme.light')}
          {theme === "light" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2">
          <Moon className="h-4 w-4" />
          {t('console.theme.dark')}
          {theme === "dark" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2">
          <Monitor className="h-4 w-4" />
          {t('console.theme.system')}
          {theme === "system" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
