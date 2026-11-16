import { useMemo, type ReactNode } from "react"
import { Check } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { matchesSearch } from "@/lib/service-helpers"
import { naturalCompare } from "@/lib/account-list"
import type { Account } from "@/types"

interface AccountPickerProps {
  accounts: readonly Account[]
  /** Selected account id ("" = none). */
  value: string
  onChange: (accountId: string) => void
  /** Accounts that are shown but cannot be picked (e.g. already linked). */
  isDisabled?: (account: Account) => boolean
  /** Extra note on the right of an item (e.g. "Already linked"). */
  renderNote?: (account: Account) => ReactNode
  label: string
  searchPlaceholder: string
  emptyText: string
  disabled?: boolean
}

// Items use the account id as their cmdk value (labels may repeat), so filtering only looks at
// the keywords: label and tags. Accounts hold no secrets.
const filterByKeywords = (_value: string, search: string, keywords?: string[]) =>
  matchesSearch((keywords ?? []).join("\n"), search) ? 1 : 0

/** Inline searchable single-select list of accounts (pinned first, natural label order). */
export function AccountPicker({
  accounts,
  value,
  onChange,
  isDisabled,
  renderNote,
  label,
  searchPlaceholder,
  emptyText,
  disabled,
}: AccountPickerProps) {
  const sorted = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return naturalCompare(a.label, b.label)
      }),
    [accounts],
  )

  return (
    <Command
      label={label}
      filter={filterByKeywords}
      className={cn("bg-gray-700 border border-gray-600 rounded-md text-white", disabled && "pointer-events-none opacity-60")}
    >
      <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="text-white" disabled={disabled} />
      <CommandList className="max-h-60">
        <CommandEmpty className="text-gray-400 py-6 text-center text-sm">{emptyText}</CommandEmpty>
        <CommandGroup>
          {sorted.map((account) => {
            const selected = account.id === value
            const itemDisabled = isDisabled?.(account) ?? false
            return (
              <CommandItem
                key={account.id}
                value={account.id}
                keywords={[account.label, ...account.tags]}
                disabled={itemDisabled}
                aria-checked={selected}
                onSelect={() => onChange(selected ? "" : account.id)}
                className="text-white cursor-pointer data-[selected=true]:bg-gray-600 data-[selected=true]:text-white"
              >
                <Check className={cn("h-4 w-4", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{account.label}</div>
                  {account.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {account.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {renderNote?.(account)}
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
