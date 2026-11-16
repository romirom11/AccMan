import { useState, useMemo, useEffect, type MouseEvent } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Plus,
  Search,
  Filter,
  Edit,
  Trash2,
  Grid,
  List,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Pin,
  PinOff,
  ListChecks,
  X,
} from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { useAccountsListView } from "@/stores/list-view-store"
import type { Account } from "@/types"
import { CreateAccountModal } from "@/components/create-account-modal"
import { BulkCreateAccountsModal } from "@/components/bulk-create-accounts-modal"
import { formatShortcut, useCreateRequest } from "@/components/command-palette"
import { useHotkey } from "@/hooks/use-hotkey"
import { cn } from "@/lib/utils"
import {
  TAG_FILTER_ALL,
  collectAccountTags,
  filterAndSortAccounts,
  nextSortOrder,
  parseTagFilterValue,
  rangeBetween,
  resolveTagFilter,
  tagFilterValue,
} from "@/lib/account-list"
import { confirm } from "@tauri-apps/plugin-dialog"

const TAG_COLORS = [
  "bg-purple-600/20 text-purple-300",
  "bg-blue-600/20 text-blue-300",
  "bg-green-600/20 text-green-300",
  "bg-pink-600/20 text-pink-300",
  "bg-yellow-600/20 text-yellow-300",
  "bg-indigo-600/20 text-indigo-300",
  "bg-teal-600/20 text-teal-300",
  "bg-orange-600/20 text-orange-300",
]

function getTagColor(tag: string) {
  const hash = tag.split("").reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0)
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

export default function AccountsList() {
  const { t } = useTranslation()
  const vault = useVaultStore((s) => s.vault)
  const deleteAccount = useVaultStore((s) => s.deleteAccount)
  const deleteAccounts = useVaultStore((s) => s.deleteAccounts)
  const setPinned = useVaultStore((s) => s.setPinned)
  const viewMode = useVaultStore((s) => s.accountsViewMode)
  const setViewMode = useVaultStore((s) => s.setAccountsViewMode)

  // Shared with the account page's Previous/Next (see list-view-store for what is persisted).
  const searchTerm = useAccountsListView((s) => s.search)
  const setSearchTerm = useAccountsListView((s) => s.setSearch)
  const storedTag = useAccountsListView((s) => s.tag)
  const setStoredTag = useAccountsListView((s) => s.setTag)
  const sortOrder = useAccountsListView((s) => s.sort)
  const setSortOrder = useAccountsListView((s) => s.setSort)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false)
  const [accountToEdit, setAccountToEdit] = useState<Account | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const accounts = useMemo(() => vault?.accounts ?? [], [vault])
  const allTags = useMemo(() => collectAccountTags(accounts), [accounts])
  // A filter on a tag that no longer exists falls back to "all tags".
  const activeTag = resolveTagFilter(storedTag, allTags)

  useEffect(() => {
    if (storedTag !== null && activeTag === null) setStoredTag(null)
  }, [storedTag, activeTag, setStoredTag])

  const filteredAccounts = useMemo(
    () => filterAndSortAccounts(accounts, { search: searchTerm, tag: activeTag, sort: sortOrder }),
    [accounts, searchTerm, activeTag, sortOrder],
  )
  const visibleIds = useMemo(() => filteredAccounts.map((a) => a.id), [filteredAccounts])

  // Only visible, existing accounts count as selected, so hidden items are never acted on.
  const effectiveSelection = useMemo(() => visibleIds.filter((id) => selectedIds.has(id)), [visibleIds, selectedIds])
  const allVisibleSelected = visibleIds.length > 0 && effectiveSelection.length === visibleIds.length

  const handleAddAccount = () => {
    setAccountToEdit(null)
    setIsModalOpen(true)
  }

  // The command palette's "New account" action.
  useCreateRequest(handleAddAccount)

  const handleEditAccount = (account: Account) => {
    setAccountToEdit(account)
    setIsModalOpen(true)
  }

  const handleDeleteAccount = async (account: Account) => {
    if (busy) return
    const confirmed = await confirm(t("accounts.delete_confirm.message"), { title: t("accounts.delete_confirm.title"), kind: "warning" })
    if (!confirmed) return
    setBusy(true)
    try {
      await deleteAccount(account.id)
    } catch {
      // Error toast shown by the API layer.
    } finally {
      setBusy(false)
    }
  }

  const handleTogglePin = async (account: Account) => {
    try {
      await setPinned("account", account.id, !account.pinned)
    } catch {
      // Error toast shown by the API layer.
    }
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setSelectionAnchor(null)
  }

  const handleSelectClick = (accountId: string, event: MouseEvent) => {
    const range = event.shiftKey ? rangeBetween(visibleIds, selectionAnchor, accountId) : [accountId]
    setSelectedIds((prev) => {
      const next = new Set(prev)
      // A shift range follows the state the anchor click produced; a single click toggles.
      const select = event.shiftKey && selectionAnchor !== null ? prev.has(selectionAnchor) : !prev.has(accountId)
      for (const id of range) {
        if (select) next.add(id)
        else next.delete(id)
      }
      return next
    })
    if (!event.shiftKey) setSelectionAnchor(accountId)
  }

  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds))
  }

  const handleBulkDelete = async () => {
    const ids = effectiveSelection
    if (ids.length === 0 || busy) return
    const confirmed = await confirm(t("accounts.bulk.delete_confirm_message", { count: ids.length }), {
      title: t("accounts.bulk.delete_confirm_title"),
      kind: "warning",
    })
    if (!confirmed) return
    setBusy(true)
    try {
      // One command, one save; the store shows "Accounts deleted: N".
      await deleteAccounts(ids)
      exitSelectionMode()
    } catch {
      // Error toast shown by the API layer; keep the selection.
    } finally {
      setBusy(false)
    }
  }

  useHotkey("Escape", exitSelectionMode, { mod: false, enabled: selectionMode && !isModalOpen && !isBulkModalOpen })
  useHotkey("a", toggleSelectAll, { allowInInputs: false, enabled: selectionMode && !isModalOpen && !isBulkModalOpen })

  const sortLabel =
    sortOrder === "none" ? t("accounts.sort.none") : sortOrder === "asc" ? t("accounts.sort.asc") : t("accounts.sort.desc")
  const filtersActive = searchTerm.trim() !== "" || activeTag !== null

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">{t("accounts.title")}</h1>
          <p className="text-gray-400 mt-1">{t("accounts.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            onClick={handleAddAccount}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t("accounts.create_button")}
          </Button>
          <Button
            variant="outline"
            className="border-blue-600 text-blue-400 hover:bg-blue-600/10"
            onClick={() => setIsBulkModalOpen(true)}
          >
            <Users className="w-4 h-4 mr-2" />
            {t("accounts.bulk_create_button")}
          </Button>
          <Button
            variant="outline"
            className={cn(
              "border-gray-600 text-gray-300 bg-transparent",
              selectionMode && "border-blue-500 text-blue-300 bg-blue-600/10",
            )}
            onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
            aria-pressed={selectionMode}
            disabled={accounts.length === 0 && !selectionMode}
          >
            <ListChecks className="w-4 h-4 mr-2" />
            {selectionMode ? t("accounts.bulk.exit_select") : t("accounts.bulk.select")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
              <Input
                placeholder={t("accounts.search_placeholder")}
                aria-label={t("accounts.search_placeholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-gray-700 border-gray-600 text-white"
              />
            </div>

            <Select value={tagFilterValue(activeTag)} onValueChange={(value) => setStoredTag(parseTagFilterValue(value))}>
              <SelectTrigger className="w-48 bg-gray-700 border-gray-600 text-white" aria-label={t("accounts.filter_placeholder")}>
                <Filter className="w-4 h-4 mr-2" aria-hidden="true" />
                <SelectValue placeholder={t("accounts.filter_placeholder")} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                <SelectItem value={TAG_FILTER_ALL} className="text-white">
                  {t("accounts.all_tags")}
                </SelectItem>
                {allTags.map((tag) => (
                  <SelectItem key={tag} value={tagFilterValue(tag)} className="text-white">
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                variant={sortOrder !== "none" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSortOrder(nextSortOrder(sortOrder))}
                className="text-gray-300"
                title={sortLabel}
                aria-label={sortLabel}
              >
                {sortOrder === "none" && <ArrowUpDown className="w-4 h-4" />}
                {sortOrder === "asc" && <ArrowUp className="w-4 h-4" />}
                {sortOrder === "desc" && <ArrowDown className="w-4 h-4" />}
              </Button>
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="text-gray-300"
                title={t("accounts.view.grid")}
                aria-label={t("accounts.view.grid")}
                aria-pressed={viewMode === "grid"}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="text-gray-300"
                title={t("accounts.view.list")}
                aria-label={t("accounts.view.list")}
                aria-pressed={viewMode === "list"}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selection bar */}
      {selectionMode && (
        <Card className="bg-blue-900 border-blue-700 sticky top-0 z-20">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-white" role="status">
                {t("accounts.bulk.selected_count", { count: effectiveSelection.length })}
                <span className="ml-2 text-xs text-blue-200/70">{t("accounts.bulk.hint", { shortcut: formatShortcut("a") })}</span>
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-600 text-blue-300 bg-transparent"
                  onClick={toggleSelectAll}
                  disabled={visibleIds.length === 0}
                >
                  {allVisibleSelected ? t("accounts.bulk.select_none") : t("accounts.bulk.select_all", { count: visibleIds.length })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-600 text-red-300 bg-transparent"
                  onClick={handleBulkDelete}
                  disabled={effectiveSelection.length === 0 || busy}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t("accounts.bulk.delete", { count: effectiveSelection.length })}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-blue-200 hover:text-white"
                  onClick={exitSelectionMode}
                  aria-label={t("accounts.bulk.exit_select")}
                  title={t("accounts.bulk.exit_select")}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accounts Grid/List */}
      {/* Grid columns are at least 22rem wide (two columns at the 1280px minimum window), so labels stay readable. */}
      <div className={viewMode === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-4" : "space-y-3"}>
        {filteredAccounts.map((account) => {
          const isSelected = selectionMode && selectedIds.has(account.id)
          const pinLabel = account.pinned ? t("accounts.pin.unpin") : t("accounts.pin.pin")
          return (
            <Card
              key={account.id}
              className={cn(
                "relative bg-gray-800 border-gray-700 hover:bg-gray-750 transition-colors flex flex-col focus-within:ring-2 focus-within:ring-blue-500",
                isSelected && "ring-2 ring-blue-500",
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {selectionMode && (
                      <Checkbox checked={isSelected} tabIndex={-1} aria-hidden="true" className="pointer-events-none shrink-0" />
                    )}
                    <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center shrink-0">
                      <Users className="w-6 h-6 text-white" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {account.pinned && (
                          <Pin className="w-4 h-4 text-yellow-400 fill-yellow-400/30 shrink-0" aria-label={t("accounts.pin.pinned")} />
                        )}
                        <CardTitle className="min-w-0 text-white text-lg leading-snug line-clamp-2 [overflow-wrap:anywhere]" title={account.label}>
                          {/* The whole card is the click target (stretched ::after); actions sit above it. */}
                          {selectionMode ? (
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={isSelected}
                              onClick={(e) => handleSelectClick(account.id, e)}
                              className="text-left after:absolute after:inset-0 after:content-[''] focus:outline-none"
                            >
                              {account.label}
                            </button>
                          ) : (
                            <Link
                              to={`/accounts/${account.id}`}
                              className="after:absolute after:inset-0 after:content-[''] focus:outline-none"
                            >
                              {account.label}
                            </Link>
                          )}
                        </CardTitle>
                      </div>
                      <p className="text-sm text-gray-400">{t("accounts.services_count", { count: account.linkedServices.length })}</p>
                    </div>
                  </div>
                  {!selectionMode && (
                    <div className="relative z-10 flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={account.pinned ? "text-yellow-400 hover:text-yellow-300" : "text-gray-400 hover:text-white"}
                        onClick={() => handleTogglePin(account)}
                        aria-pressed={account.pinned}
                        aria-label={`${pinLabel}: ${account.label}`}
                        title={pinLabel}
                      >
                        {account.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-400 hover:text-white"
                        onClick={() => handleEditAccount(account)}
                        aria-label={`${t("common.edit")}: ${account.label}`}
                        title={t("common.edit")}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-400 hover:text-red-400"
                        onClick={() => handleDeleteAccount(account)}
                        disabled={busy}
                        aria-label={`${t("common.delete")}: ${account.label}`}
                        title={t("common.delete")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-grow flex flex-col justify-between">
                <p className="text-sm text-gray-300 mb-3 flex-grow [overflow-wrap:anywhere]">
                  {account.notes.substring(0, 100)}
                  {account.notes.length > 100 && "..."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {account.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className={`text-xs ${getTagColor(tag)}`}>
                      <span>{tag}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredAccounts.length === 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8 text-center">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" aria-hidden="true" />
            <p className="text-gray-400 text-lg mb-2">{t("accounts.not_found")}</p>
            <p className="text-gray-500 text-sm mb-4">
              {filtersActive ? t("accounts.try_changing_filters") : t("accounts.create_first")}
            </p>
            {filtersActive ? (
              <Button
                variant="outline"
                className="border-gray-600 text-gray-300"
                onClick={() => {
                  setSearchTerm("")
                  setStoredTag(null)
                }}
              >
                {t("accounts.clear_filters")}
              </Button>
            ) : (
              <Button
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                onClick={handleAddAccount}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("accounts.create_first_button")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <CreateAccountModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} accountToEdit={accountToEdit} />
      <BulkCreateAccountsModal isOpen={isBulkModalOpen} onClose={() => setIsBulkModalOpen(false)} />
    </div>
  )
}
