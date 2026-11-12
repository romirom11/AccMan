import { useMemo, useState, type MouseEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Blocks, Home, Users, Server, Settings, Search, Lock, Clock, User, Globe, Command, X } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { formatShortcut, openCommandPalette } from "@/components/command-palette"
import { confirmLeave, hasUnsavedChanges } from "@/lib/unsaved-guard"
import {
  buildAccountSearchText,
  buildServiceSearchText,
  compareByPinnedAndRecent,
  getServiceTitle,
  matchesSearch,
} from "@/lib/service-helpers"
import type { ServiceType } from "@/types"

const MAX_RESULTS_PER_GROUP = 50

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const lock = useVaultStore((s) => s.lock)
  const vault = useVaultStore((s) => s.vault)
  const autoLockMinutes = vault?.settings.autoLockMinutes ?? 0

  const navigation = [
    { name: t("sidebar.nav.dashboard"), href: "/", icon: Home },
    { name: t("sidebar.nav.accounts"), href: "/accounts", icon: Users },
    { name: t("sidebar.nav.services"), href: "/services", icon: Server },
    { name: t("sidebar.nav.service_types"), href: "/service-types", icon: Blocks },
    { name: t("sidebar.nav.settings"), href: "/settings", icon: Settings },
  ]

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/"
    return location.pathname === href || location.pathname.startsWith(`${href}/`)
  }

  const typesById = useMemo(
    () => new Map<string, ServiceType>((vault?.serviceTypes ?? []).map((type) => [type.id, type])),
    [vault],
  )

  // Matches labels, tags, notes, type names and NON-secret field values only.
  const query = searchQuery.trim()
  const searchResults = useMemo(() => {
    if (!query || !vault) return { accounts: [], services: [] }
    const accounts = vault.accounts
      .filter((account) => matchesSearch(buildAccountSearchText(account), query))
      .sort(compareByPinnedAndRecent)
    const services = vault.services
      .filter((service) => matchesSearch(buildServiceSearchText(service, typesById.get(service.serviceTypeId)), query))
      .sort(compareByPinnedAndRecent)
    return { accounts, services }
  }, [query, vault, typesById])

  const showNoResults = query && searchResults.accounts.length === 0 && searchResults.services.length === 0
  const clearSearch = () => setSearchQuery("")
  const paletteShortcut = formatShortcut("k")

  /** Link click handler that asks before leaving a page with unsaved changes. */
  const guardedClick = (href: string, after?: () => void) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (href === location.pathname || !hasUnsavedChanges()) {
      after?.()
      return
    }
    event.preventDefault()
    void confirmLeave().then((leave) => {
      if (!leave) return
      after?.()
      navigate(href)
    })
  }

  return (
    <div className="fixed left-0 top-0 h-full w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
            <img src="/accman.png" alt="AccMan" className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">AccMan</h1>
            <p className="text-xs text-gray-400">{t("sidebar.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-gray-700 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" aria-hidden="true" />
          <Input
            placeholder={t("sidebar.search_placeholder")}
            aria-label={t("sidebar.search_placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchQuery) {
                e.preventDefault()
                clearSearch()
              }
            }}
            className="pl-10 pr-8 bg-gray-700 border-gray-600 text-white"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label={t("sidebar.search.clear")}
              title={t("sidebar.search.clear")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={openCommandPalette}
          title={t("sidebar.command_palette_hint", { shortcut: paletteShortcut })}
          className="flex w-full items-center gap-2 rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
        >
          <Command className="w-4 h-4" aria-hidden="true" />
          <span className="flex-1 text-left">{t("sidebar.command_palette")}</span>
          <kbd className="rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 font-mono text-[11px] text-gray-300">
            {paletteShortcut}
          </kbd>
        </button>
      </div>

      {/* Navigation / Search Results */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {!query ? (
          navigation.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                onClick={guardedClick(item.href)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive(item.href) ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700 hover:text-white"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.name}</span>
              </Link>
            )
          })
        ) : (
          <div className="space-y-4">
            {showNoResults && (
              <div className="text-center py-4 text-gray-400">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t("sidebar.search.no_results")}</p>
              </div>
            )}

            {searchResults.accounts.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {t("sidebar.search.accounts")} ({searchResults.accounts.length})
                </h3>
                <div className="space-y-1">
                  {searchResults.accounts.slice(0, MAX_RESULTS_PER_GROUP).map((account) => (
                    <Link
                      key={account.id}
                      to={`/accounts/${account.id}`}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                      onClick={guardedClick(`/accounts/${account.id}`, clearSearch)}
                    >
                      <User className="w-4 h-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{account.label}</p>
                        {account.tags.length > 0 && (
                          <p className="text-xs text-gray-400 truncate">{account.tags.slice(0, 3).join(", ")}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {searchResults.services.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {t("sidebar.search.services")} ({searchResults.services.length})
                </h3>
                <div className="space-y-1">
                  {searchResults.services.slice(0, MAX_RESULTS_PER_GROUP).map((service) => {
                    const serviceType = typesById.get(service.serviceTypeId)
                    const subtitle = [serviceType?.name, ...service.tags.slice(0, 2)].filter(Boolean).join(" · ")
                    return (
                      <Link
                        key={service.id}
                        to={`/services/${service.id}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                        onClick={guardedClick(`/services/${service.id}`, clearSearch)}
                      >
                        <Globe className="w-4 h-4 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{getServiceTitle(service, serviceType)}</p>
                          {subtitle && <p className="text-xs text-gray-400 truncate">{subtitle}</p>}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Status and Lock */}
      <div className="p-4 border-t border-gray-700 space-y-3">
        {autoLockMinutes > 0 ? (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-gray-400">
              <Clock className="w-4 h-4" />
              <span>{t("sidebar.autolock.active")}</span>
            </div>
            <Badge variant="secondary" className="bg-green-800 text-white">
              {autoLockMinutes === 60
                ? t("settings.autolock.hour", { count: 1 })
                : t("settings.autolock.minutes", { count: autoLockMinutes })}
            </Badge>
          </div>
        ) : (
          <div className="flex items-center justify-center text-sm">
            <div className="flex items-center gap-2 text-gray-400">
              <Clock className="w-4 h-4" />
              <span>{t("sidebar.autolock.disabled")}</span>
            </div>
          </div>
        )}

        <Button
          onClick={() => void lock()}
          variant="outline"
          title={formatShortcut("l")}
          className="w-full border-gray-600 text-gray-300 hover:bg-gray-700 bg-transparent"
        >
          <Lock className="w-4 h-4 mr-2" />
          {t("sidebar.lock_button")}
        </Button>
      </div>
    </div>
  )
}
