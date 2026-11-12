"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { create } from "zustand"
import { confirm } from "@tauri-apps/plugin-dialog"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  Edit,
  Filter,
  Grid,
  Import,
  Link,
  List,
  MousePointer,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useVaultStore } from "@/stores/vault-store"
import { CreateServiceModal } from "@/components/create-service-modal"
import { BulkLinkServicesModal } from "@/components/bulk-link-services-modal"
import { useCreateRequest } from "@/components/command-palette"
import { useHotkey } from "@/hooks/use-hotkey"
import { cn } from "@/lib/utils"
import {
  TYPE_FILTER_ALL,
  countLinkedAccounts,
  filterAndSortServices,
  findServiceReferences,
  isServiceSortBy,
  isServiceSortOrder,
  nextServiceSortOrder,
  pruneSelection,
  resolveTypeFilter,
  type ServiceSortBy,
  type ServiceSortOrder,
} from "@/lib/service-list"
import type { Service } from "@/types"

const SORT_ORDER_KEY = "services-sort-order"
const SORT_BY_KEY = "services-sort-by"
const TYPE_FILTER_KEY = "services-selected-type"

// The search text is vault content: it lives in memory only (surviving navigation within the
// session) and is dropped on lock. Older versions persisted it in localStorage.
try {
  localStorage.removeItem("services-search-query")
} catch {
  // Storage unavailable: nothing to clean up.
}

interface ServicesSearchState {
  search: string
  setSearch: (search: string) => void
}

const useServicesSearch = create<ServicesSearchState>((set) => ({
  search: "",
  setSearch: (search) => set({ search }),
}))

useVaultStore.subscribe((state, prev) => {
  if (prev.vault && !state.vault) useServicesSearch.getState().setSearch("")
})

function readStored<T>(key: string, guard: (value: unknown) => value is T, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return guard(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preferences are optional.
  }
}

function readTypeFilter(): string | null {
  try {
    const stored = localStorage.getItem(TYPE_FILTER_KEY)
    return stored && stored !== TYPE_FILTER_ALL ? stored : null
  } catch {
    return null
  }
}

// Select values for the type filter. Type ids are user-chosen, so they are prefixed and can never
// collide with the "all" sentinel.
const TYPE_PREFIX = "type:"
const typeFilterValue = (typeId: string | null) => (typeId === null ? TYPE_FILTER_ALL : `${TYPE_PREFIX}${typeId}`)
const parseTypeFilterValue = (value: string) => (value.startsWith(TYPE_PREFIX) ? value.slice(TYPE_PREFIX.length) : null)

export default function ServicesLibrary() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const vault = useVaultStore((s) => s.vault)
  const deleteService = useVaultStore((s) => s.deleteService)
  const deleteServices = useVaultStore((s) => s.deleteServices)
  const setPinned = useVaultStore((s) => s.setPinned)
  const viewMode = useVaultStore((s) => s.servicesViewMode)
  const setViewMode = useVaultStore((s) => s.setServicesViewMode)

  const searchQuery = useServicesSearch((s) => s.search)
  const setSearchQuery = useServicesSearch((s) => s.setSearch)
  const [storedTypeFilter, setStoredTypeFilter] = useState<string | null>(readTypeFilter)
  const [sortOrder, setSortOrder] = useState<ServiceSortOrder>(() => readStored(SORT_ORDER_KEY, isServiceSortOrder, "asc"))
  const [sortBy, setSortBy] = useState<ServiceSortBy>(() => readStored(SORT_BY_KEY, isServiceSortBy, "name"))
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false)
  const [editServiceId, setEditServiceId] = useState<string | null>(null)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [pinBusyId, setPinBusyId] = useState<string | null>(null)

  const services = useMemo(() => vault?.services ?? [], [vault])
  const serviceTypes = useMemo(() => vault?.serviceTypes ?? [], [vault])
  // A filter on a type that no longer exists falls back to "all types".
  const typeFilter = resolveTypeFilter(storedTypeFilter, serviceTypes)
  const typesById = useMemo(() => new Map(serviceTypes.map((type) => [type.id, type])), [serviceTypes])

  useEffect(() => writeStored(TYPE_FILTER_KEY, typeFilter ?? TYPE_FILTER_ALL), [typeFilter])
  useEffect(() => writeStored(SORT_ORDER_KEY, sortOrder), [sortOrder])
  useEffect(() => writeStored(SORT_BY_KEY, sortBy), [sortBy])

  const filteredServices = useMemo(
    () => filterAndSortServices(services, serviceTypes, { search: searchQuery, typeId: typeFilter, sortBy, sortOrder }),
    [services, serviceTypes, searchQuery, typeFilter, sortBy, sortOrder],
  )
  const visibleIds = useMemo(() => filteredServices.map((s) => s.id), [filteredServices])

  // Only visible, existing services stay selected (filters changed, services deleted elsewhere).
  useEffect(() => {
    setSelectedIds((prev) => pruneSelection(prev, visibleIds))
  }, [visibleIds])
  const selection = useMemo(() => visibleIds.filter((id) => selectedIds.has(id)), [visibleIds, selectedIds])
  const allVisibleSelected = visibleIds.length > 0 && selection.length === visibleIds.length

  // Always the current copy from the vault (it is replaced after every save).
  const serviceToEdit = editServiceId ? services.find((s) => s.id === editServiceId) ?? null : null

  const handleAddService = useCallback(() => {
    setEditServiceId(null)
    setIsCreateModalOpen(true)
  }, [])
  useCreateRequest(handleAddService)

  const handleEditService = (service: Service) => {
    setEditServiceId(service.id)
    setIsCreateModalOpen(true)
  }

  const enterSelectionMode = () => {
    setSelectedIds(new Set())
    setIsSelectionMode(true)
  }

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  const toggleServiceSelection = (serviceId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(serviceId)) next.delete(serviceId)
      else next.add(serviceId)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds))
  }

  const handleServiceClick = (serviceId: string) => {
    if (isSelectionMode) toggleServiceSelection(serviceId)
    else navigate(`/services/${serviceId}`)
  }

  const handleDeleteService = async (service: Service) => {
    if (busy) return
    const references = findServiceReferences(vault, service.id)
    const lines = [t("services.delete_confirm.message")]
    if (references.accountIds.length > 0) {
      lines.push(t("services_library.delete_refs.accounts", { count: references.accountIds.length }))
    }
    if (references.serviceIds.length > 0) {
      lines.push(t("services_library.delete_refs.services", { count: references.serviceIds.length }))
    }
    const confirmed = await confirm(lines.join("\n\n"), { title: t("services.delete_confirm.title"), kind: "warning" })
    if (!confirmed) return
    setBusy(true)
    try {
      await deleteService(service.id)
    } catch {
      // Error toast shown by the API layer.
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSelected = async () => {
    const ids = selection
    if (ids.length === 0 || busy) return
    const lines = [t("services.delete_selected_confirm.message", { count: ids.length })]
    const accountCount = countLinkedAccounts(vault, ids)
    if (accountCount > 0) lines.push(t("services_library.delete_refs.accounts", { count: accountCount }))
    const confirmed = await confirm(lines.join("\n\n"), {
      title: t("services.delete_selected_confirm.title"),
      kind: "warning",
    })
    if (!confirmed) return
    setBusy(true)
    try {
      // Success toast (with the count) comes from the store.
      await deleteServices(ids)
      exitSelectionMode()
    } catch {
      // Error toast shown by the API layer; keep the selection for a retry.
    } finally {
      setBusy(false)
    }
  }

  const handleTogglePin = async (service: Service) => {
    if (pinBusyId) return
    setPinBusyId(service.id)
    try {
      await setPinned("service", service.id, !service.pinned)
    } catch {
      // Error toast shown by the API layer.
    } finally {
      setPinBusyId(null)
    }
  }

  const anyModalOpen = isCreateModalOpen || isLinkModalOpen
  useHotkey("Escape", exitSelectionMode, { mod: false, enabled: isSelectionMode && !anyModalOpen })

  const sortTitle =
    sortOrder === "none"
      ? t("services.sort.no_sort")
      : sortOrder === "asc"
        ? t("services.sort.ascending")
        : t("services.sort.descending")
  const selectionTitle = isSelectionMode ? t("services_library.selection.exit") : t("services_library.selection.enter")
  const hasFilters = searchQuery.trim() !== "" || typeFilter !== null

  const pinButton = (service: Service) => (
    <Button
      size="sm"
      variant="ghost"
      className={cn(service.pinned ? "text-yellow-400 hover:text-yellow-300" : "text-gray-400 hover:text-white")}
      onClick={(e) => {
        e.stopPropagation()
        void handleTogglePin(service)
      }}
      disabled={pinBusyId === service.id}
      aria-label={service.pinned ? t("services_library.unpin") : t("services_library.pin")}
      title={service.pinned ? t("services_library.unpin") : t("services_library.pin")}
    >
      {service.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
    </Button>
  )

  const rowActions = (service: Service) => (
    <>
      {pinButton(service)}
      <Button
        size="sm"
        variant="ghost"
        className="text-gray-400 hover:text-white"
        onClick={(e) => {
          e.stopPropagation()
          handleEditService(service)
        }}
        aria-label={t("common.edit")}
        title={t("common.edit")}
      >
        <Edit className="w-4 h-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-gray-400 hover:text-red-400"
        onClick={(e) => {
          e.stopPropagation()
          void handleDeleteService(service)
        }}
        disabled={busy}
        aria-label={t("common.delete")}
        title={t("common.delete")}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </>
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">{t("services.title")}</h1>
          <p className="text-gray-400">{t("services.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="text-white border-gray-600 hover:bg-gray-700 hover:text-white"
            onClick={() => navigate("/services-import")}
          >
            <Import className="w-4 h-4 mr-2" />
            {t("services.import_button")}
          </Button>
          <Button
            className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"
            onClick={handleAddService}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t("services.add_button")}
          </Button>
        </div>
      </div>

      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder={t("services.search_placeholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-9 bg-gray-700 border-gray-600 text-white"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  aria-label={t("services_library.clear_search")}
                  title={t("services_library.clear_search")}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <Select
              value={typeFilterValue(typeFilter)}
              onValueChange={(value) => setStoredTypeFilter(parseTypeFilterValue(value))}
            >
              <SelectTrigger className="w-48 bg-gray-700 border-gray-600 text-white">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder={t("services.filter_placeholder")} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                <SelectItem value={TYPE_FILTER_ALL}>{t("services.all_types")}</SelectItem>
                {serviceTypes.map((type) => (
                  <SelectItem key={type.id} value={typeFilterValue(type.id)}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Button
                variant={isSelectionMode ? "default" : "outline"}
                size="sm"
                onClick={() => (isSelectionMode ? exitSelectionMode() : enterSelectionMode())}
                className={isSelectionMode ? "bg-green-600 hover:bg-green-700" : "border-gray-600 text-gray-300 hover:bg-gray-700"}
                title={selectionTitle}
                aria-label={selectionTitle}
                aria-pressed={isSelectionMode}
                disabled={services.length === 0 && !isSelectionMode}
              >
                {isSelectionMode ? <CheckSquare className="w-4 h-4" /> : <MousePointer className="w-4 h-4" />}
              </Button>
              <div className="w-px h-6 bg-gray-600" />

              <Select value={sortBy} onValueChange={(value) => isServiceSortBy(value) && setSortBy(value)}>
                <SelectTrigger className="w-32 bg-gray-700 border-gray-600 text-white" aria-label={t("services_library.sort_by")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="name">{t("services.sort.by_name")}</SelectItem>
                  <SelectItem value="type">{t("services.sort.by_type")}</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortOrder(nextServiceSortOrder(sortOrder))}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
                title={sortTitle}
                aria-label={sortTitle}
              >
                {sortOrder === "none" && <ArrowUpDown className="w-4 h-4" />}
                {sortOrder === "asc" && <ArrowUp className="w-4 h-4" />}
                {sortOrder === "desc" && <ArrowDown className="w-4 h-4" />}
              </Button>

              <div className="w-px h-6 bg-gray-600" />
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className={viewMode === "grid" ? "bg-blue-600 hover:bg-blue-700" : "border-gray-600 text-gray-300 hover:bg-gray-700"}
                aria-label={t("services_library.view_grid")}
                title={t("services_library.view_grid")}
                aria-pressed={viewMode === "grid"}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "table" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("table")}
                className={viewMode === "table" ? "bg-blue-600 hover:bg-blue-700" : "border-gray-600 text-gray-300 hover:bg-gray-700"}
                aria-label={t("services_library.view_table")}
                title={t("services_library.view_table")}
                aria-pressed={viewMode === "table"}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isSelectionMode && (
        <Card className="bg-blue-900 border-blue-700">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleSelectAllVisible}
                  disabled={visibleIds.length === 0}
                  aria-label={t("services_library.selection.select_all_visible")}
                />
                <span className="text-white">
                  {selection.length > 0
                    ? t("services.selected_count", { count: selection.length })
                    : t("services_library.selection.hint")}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-600 text-blue-300 bg-transparent"
                  onClick={() => setIsLinkModalOpen(true)}
                  disabled={selection.length === 0 || busy}
                >
                  <Link className="w-4 h-4 mr-2" />
                  {t("services.link_to_account")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-600 text-red-300 bg-transparent"
                  onClick={handleDeleteSelected}
                  disabled={selection.length === 0 || busy}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t("common.delete")}
                </Button>
                <Button size="sm" variant="ghost" className="text-gray-300 hover:text-white" onClick={exitSelectionMode}>
                  <X className="w-4 h-4 mr-2" />
                  {t("services_library.selection.exit")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {filteredServices.length > 0 &&
        (viewMode === "grid" ? (
          // Column count follows the width (cards never narrower than 22rem), so labels stay readable
          // at the minimum window size next to the action buttons.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-4">
            {filteredServices.map((service) => {
              const serviceType = typesById.get(service.serviceTypeId)
              const isSelected = isSelectionMode && selectedIds.has(service.id)

              return (
                <Card
                  key={service.id}
                  className={cn(
                    "bg-gray-800 border-gray-700 cursor-pointer transition-all hover:bg-gray-750",
                    isSelected && "ring-2 ring-blue-500",
                  )}
                  onClick={() => handleServiceClick(service.id)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {isSelectionMode && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleServiceSelection(service.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={service.label}
                          />
                        )}
                        <div className="w-10 h-10 shrink-0 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center">
                          <span className="text-white font-bold">{(serviceType?.name || service.label).charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-white text-lg flex items-start gap-1">
                            <span className="min-w-0 leading-snug line-clamp-2 [overflow-wrap:anywhere]" title={service.label}>
                              {service.label}
                            </span>
                            {service.pinned && (
                              <Pin className="w-4 h-4 mt-1 shrink-0 text-yellow-400 fill-yellow-400/30" aria-label={t("services_library.pinned")} />
                            )}
                          </CardTitle>
                          <p className="text-gray-400 text-sm truncate" title={serviceType?.name}>
                            {serviceType?.name ?? t("services_library.unknown_type")}
                          </p>
                        </div>
                      </div>
                      {!isSelectionMode && <div className="flex gap-1 shrink-0">{rowActions(service)}</div>}
                    </div>
                  </CardHeader>
                  {service.tags.length > 0 && (
                    <CardContent>
                      <div className="flex flex-wrap gap-1">
                        {service.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="bg-gray-700 text-gray-300">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              )
            })}
          </div>
        ) : (
          <Card className="bg-gray-800 border-gray-700">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-700">
                    <tr>
                      {isSelectionMode && (
                        <th className="p-2 w-8">
                          <Checkbox
                            checked={allVisibleSelected}
                            onCheckedChange={toggleSelectAllVisible}
                            aria-label={t("services_library.selection.select_all_visible")}
                          />
                        </th>
                      )}
                      <th className="text-left p-4 text-gray-300 font-medium">{t("services.table.service")}</th>
                      <th className="text-left p-4 text-gray-300 font-medium">{t("services.table.type")}</th>
                      <th className="text-left p-4 text-gray-300 font-medium">{t("services.table.tags")}</th>
                      {!isSelectionMode && (
                        <th className="text-right p-4 text-gray-300 font-medium">{t("services.table.actions")}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredServices.map((service) => {
                      const serviceType = typesById.get(service.serviceTypeId)
                      const isSelected = isSelectionMode && selectedIds.has(service.id)

                      return (
                        <tr
                          key={service.id}
                          className={cn(
                            "border-b border-gray-700 hover:bg-gray-750 cursor-pointer",
                            isSelected && "bg-blue-900/20",
                          )}
                          onClick={() => handleServiceClick(service.id)}
                        >
                          {isSelectionMode && (
                            <td className="p-2 w-8">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleServiceSelection(service.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={service.label}
                              />
                            </td>
                          )}
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 shrink-0 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center">
                                <span className="text-white text-sm font-bold">{(serviceType?.name || service.label).charAt(0)}</span>
                              </div>
                              <span className="text-white font-medium">{service.label}</span>
                              {service.pinned && (
                                <Pin className="w-4 h-4 shrink-0 text-yellow-400 fill-yellow-400/30" aria-label={t("services_library.pinned")} />
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-gray-400">{serviceType?.name ?? t("services_library.unknown_type")}</td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-1">
                              {service.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="secondary" className="bg-gray-700 text-gray-300">
                                  {tag}
                                </Badge>
                              ))}
                              {service.tags.length > 3 && (
                                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                                  +{service.tags.length - 3}
                                </Badge>
                              )}
                            </div>
                          </td>
                          {!isSelectionMode && (
                            <td className="p-4">
                              <div className="flex gap-1 justify-end">{rowActions(service)}</div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}

      {filteredServices.length === 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="text-center py-12">
            <div className="text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
              {services.length === 0 ? (
                <>
                  <p className="text-lg mb-2">{t("services_library.empty.title")}</p>
                  <p className="text-sm mb-4">{t("services_library.empty.description")}</p>
                  <Button
                    className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"
                    onClick={handleAddService}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t("services.add_button")}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-lg mb-2">{t("services.not_found")}</p>
                  <p className="text-sm mb-4">{t("services.try_changing_filters")}</p>
                  {hasFilters && (
                    <Button
                      variant="outline"
                      className="border-gray-600 text-gray-300"
                      onClick={() => {
                        setSearchQuery("")
                        setStoredTypeFilter(null)
                      }}
                    >
                      {t("services_library.reset_filters")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <CreateServiceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        serviceToEdit={serviceToEdit}
      />
      <BulkLinkServicesModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        serviceIdsToLink={selection}
        onLink={exitSelectionMode}
      />
    </div>
  )
}
