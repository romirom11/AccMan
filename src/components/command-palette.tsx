import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { create } from "zustand"
import { Blocks, FileUp, Globe, Lock, Pin, Settings, SquarePlus, User, UserPlus } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { IS_MAC, useHotkey } from "@/hooks/use-hotkey"
import { confirmLeave } from "@/lib/unsaved-guard"
import { useVaultStore } from "@/stores/vault-store"
import {
  accountItemValue,
  actionItemValue,
  filterPaletteActions,
  firstPaletteItem,
  getPaletteIndex,
  searchPalette,
  serviceItemValue,
  type PaletteItem,
} from "@/lib/palette-search"
import type { Vault } from "@/types"

// ---------------------------------------------------------------------------------------------
// Open state (shared so the sidebar button can open the palette)

interface CommandPaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useCommandPalette = create<CommandPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}))

/** An open modal (or popover) other than the palette: opening over it could discard its form. */
function isOtherDialogOpen(): boolean {
  if (typeof document === "undefined") return false
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null
}

export const openCommandPalette = () => {
  const { open, setOpen } = useCommandPalette.getState()
  if (!open && isOtherDialogOpen()) return
  setOpen(true)
}

/** Ctrl/⌘+K: closes the palette, or opens it unless another dialog is open. */
const togglePalette = () => {
  const { open, setOpen } = useCommandPalette.getState()
  if (open) setOpen(false)
  else openCommandPalette()
}

// ---------------------------------------------------------------------------------------------
// Router-state contract for "create" actions

/** Router state the palette passes to /accounts and /services to ask the page to open its create dialog. */
export interface CreateRequestState {
  create?: boolean
}

export const CREATE_REQUEST_STATE: CreateRequestState = { create: true }

/**
 * For list pages: calls `onCreate` when the page was opened with `{ state: { create: true } }`
 * (also when already on the page), then clears that state so Back/refresh do not reopen it.
 */
export function useCreateRequest(onCreate: () => void): void {
  const location = useLocation()
  const navigate = useNavigate()
  const onCreateRef = useRef(onCreate)
  useEffect(() => {
    onCreateRef.current = onCreate
  }, [onCreate])

  const requested = (location.state as CreateRequestState | null)?.create === true
  useEffect(() => {
    if (!requested) return
    onCreateRef.current()
    navigate(location.pathname, { replace: true, state: null })
  }, [requested, location.key, location.pathname, navigate])
}

// ---------------------------------------------------------------------------------------------
// Shortcut label

/** "Ctrl+K" on Windows/Linux, "⌘K" on macOS. */
export function formatShortcut(key: string): string {
  return IS_MAC ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`
}

/** Large vaults: wait for a typing pause before running the fuzzy search. */
const DEBOUNCE_THRESHOLD = 1000
const DEBOUNCE_MS = 150

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (delayMs <= 0) return
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return delayMs > 0 ? debounced : value
}

// ---------------------------------------------------------------------------------------------
// Palette

interface PaletteAction {
  id: string
  label: string
  keywords: string
  icon: ReactNode
  shortcut?: string
  run: () => void
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <span className="flex gap-1 shrink-0">
      {tags.slice(0, 3).map((tag) => (
        <span key={tag} className="rounded bg-gray-700 px-1.5 py-0.5 text-[11px] leading-none text-gray-300">
          {tag}
        </span>
      ))}
      {tags.length > 3 && <span className="text-[11px] text-gray-500">+{tags.length - 3}</span>}
    </span>
  )
}

/** Ctrl/Cmd+K command palette. Mount once inside the unlocked layout (it needs the router). */
export function CommandPalette() {
  const { t } = useTranslation()
  const open = useCommandPalette((s) => s.open)
  const setOpen = useCommandPalette((s) => s.setOpen)
  const vault = useVaultStore((s) => s.vault)

  useHotkey("k", togglePalette)

  // Closed on lock: the layout unmounts, and the vault disappears.
  useEffect(() => () => useCommandPalette.getState().setOpen(false), [])
  useEffect(() => {
    if (!vault) setOpen(false)
  }, [vault, setOpen])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 gap-0 bg-gray-800 border-gray-700 text-white sm:max-w-xl">
        <DialogTitle className="sr-only">{t("command_palette.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("command_palette.description")}</DialogDescription>
        {/* DialogContent is unmounted while closed, so the index is only built while the palette is open. */}
        {vault && <PaletteBody vault={vault} />}
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({ vault }: { vault: Vault }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const setOpen = useCommandPalette((s) => s.setOpen)
  const lock = useVaultStore((s) => s.lock)
  const [query, setQuery] = useState("")

  const index = useMemo(() => getPaletteIndex(vault), [vault])
  // Keeps the input responsive: the search runs on a debounced, deferred copy of the query.
  const debouncedQuery = useDebouncedValue(query, index.entries.length > DEBOUNCE_THRESHOLD ? DEBOUNCE_MS : 0)
  const trimmed = useDeferredValue(debouncedQuery).trim()

  const results = useMemo(() => searchPalette(index, trimmed), [index, trimmed])
  const { accounts, services } = results

  const currentPath = location.pathname
  const go = useCallback(
    (path: string, state?: CreateRequestState) => {
      setOpen(false)
      const navigateNow = () => navigate(path, state ? { state } : undefined)
      // Staying on the same page keeps its state, so there is nothing to confirm.
      if (path === currentPath) {
        navigateNow()
        return
      }
      void confirmLeave().then((leave) => {
        if (leave) navigateNow()
      })
    },
    [navigate, setOpen, currentPath],
  )

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "new-account",
        label: t("command_palette.actions.new_account"),
        keywords: "new account create add",
        icon: <UserPlus />,
        run: () => go("/accounts", CREATE_REQUEST_STATE),
      },
      {
        id: "new-service",
        label: t("command_palette.actions.new_service"),
        keywords: "new service create add",
        icon: <SquarePlus />,
        run: () => go("/services", CREATE_REQUEST_STATE),
      },
      {
        id: "import-services",
        label: t("command_palette.actions.import_services"),
        keywords: "import services csv bulk",
        icon: <FileUp />,
        run: () => go("/services-import"),
      },
      {
        id: "service-types",
        label: t("command_palette.actions.service_types"),
        keywords: "service types constructor fields",
        icon: <Blocks />,
        run: () => go("/service-types"),
      },
      {
        id: "settings",
        label: t("command_palette.actions.settings"),
        keywords: "settings preferences backup export import password",
        icon: <Settings />,
        run: () => go("/settings"),
      },
      {
        id: "lock",
        label: t("command_palette.actions.lock"),
        keywords: "lock vault",
        icon: <Lock />,
        shortcut: formatShortcut("l"),
        // Locking never asks about unsaved changes.
        run: () => {
          setOpen(false)
          void lock()
        },
      },
    ],
    [t, go, lock, setOpen],
  )

  const visibleActions = useMemo(() => filterPaletteActions(actions, trimmed), [actions, trimmed])

  // The highlighted row is controlled here because the results lag behind the input (deferred
  // and, for large vaults, debounced). cmdk highlights the first row when the input changes,
  // which is still a row of the previous results, and keeps it when the new results arrive if
  // that row is still listed (e.g. "Farm-5" while typing "Farm-6"). So highlight the best match
  // whenever new results are shown; arrow keys still move the highlight in between.
  const [selected, setSelected] = useState("")
  const firstValue = firstPaletteItem(visibleActions, results)?.value ?? ""
  useLayoutEffect(() => {
    setSelected(firstValue)
  }, [firstValue, visibleActions, results])

  const runItem = (item: PaletteItem<PaletteAction>) => {
    if (item.kind === "action") item.action.run()
    else go(item.kind === "account" ? `/accounts/${item.entry.id}` : `/services/${item.entry.id}`)
  }

  // Enter typed before the results caught up with the input opens the best match for what was
  // typed, not the highlighted row of the stale results.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return
    const latest = query.trim()
    if (latest === trimmed) return
    e.preventDefault()
    const item = firstPaletteItem(filterPaletteActions(actions, latest), searchPalette(index, latest))
    if (item) runItem(item)
  }

  const itemClass = "cursor-pointer data-[selected=true]:bg-gray-700 data-[selected=true]:text-white"

  return (
    <Command
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
      onKeyDown={onKeyDown}
      className="bg-transparent text-white [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-gray-400 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]]:border-gray-700 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t("command_palette.placeholder")}
        className="pr-8 text-white placeholder:text-gray-500"
      />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty className="py-6 text-center text-sm text-gray-400">{t("command_palette.no_results")}</CommandEmpty>

        {visibleActions.length > 0 && (
          <CommandGroup heading={t("command_palette.groups.actions")}>
            {visibleActions.map((action) => (
              <CommandItem key={action.id} value={actionItemValue(action.id)} onSelect={action.run} className={itemClass}>
                <span className="text-gray-400">{action.icon}</span>
                <span className="truncate">{action.label}</span>
                {action.shortcut && <CommandShortcut className="text-gray-500">{action.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {accounts.length > 0 && (
          <CommandGroup heading={t("command_palette.groups.accounts")}>
            {accounts.map((entry) => (
              <CommandItem
                key={entry.id}
                value={accountItemValue(entry.id)}
                onSelect={() => go(`/accounts/${entry.id}`)}
                className={itemClass}
              >
                <User className="text-gray-400" />
                <span className="truncate font-medium">{entry.title}</span>
                {entry.pinned && <Pin className="text-yellow-400 !size-3" aria-hidden="true" />}
                <Tags tags={entry.tags} />
                <span className="ml-auto shrink-0 text-xs text-gray-500">
                  {t("command_palette.services_count", { count: entry.linkedCount })}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {services.length > 0 && (
          <CommandGroup heading={t("command_palette.groups.services")}>
            {services.map((entry) => (
              <CommandItem
                key={entry.id}
                value={serviceItemValue(entry.id)}
                onSelect={() => go(`/services/${entry.id}`)}
                className={itemClass}
              >
                <Globe className="text-gray-400" />
                <span className="truncate font-medium">{entry.title}</span>
                {entry.pinned && <Pin className="text-yellow-400 !size-3" aria-hidden="true" />}
                <Tags tags={entry.tags} />
                {entry.typeName && <span className="ml-auto shrink-0 text-xs text-gray-500">{entry.typeName}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="border-t border-gray-700 px-3 py-2 text-[11px] text-gray-500">{t("command_palette.footer")}</div>
    </Command>
  )
}

export default CommandPalette
