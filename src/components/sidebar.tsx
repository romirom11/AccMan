"use client"

import { useState, useMemo } from "react"
import { Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Blocks, Home, Users, Server, Settings, Search, Lock, Clock, User, Globe } from "lucide-react"
import { useVaultStore } from "../stores/vault-store"
import type { Account, Service, ServiceType } from "@/types"

export default function Sidebar() {
  const location = useLocation()
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("")
  const { lock, vault } = useVaultStore()

  const navigation = [
    { name: t('sidebar.nav.dashboard'), href: "/", icon: Home },
    { name: t('sidebar.nav.accounts'), href: "/accounts", icon: Users },
    { name: t('sidebar.nav.services'), href: "/services", icon: Server },
    { name: t('sidebar.nav.service_types'), href: "/service-types", icon: Blocks},
    { name: t('sidebar.nav.settings'), href: "/settings", icon: Settings },
  ]

  const isActive = (href: string) => {
    if (href === "/") {
      return location.pathname === "/"
    }
    return location.pathname.startsWith(href)
  }

  // Search functionality
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !vault) {
      return { accounts: [], services: [] }
    }

    const query = searchQuery.toLowerCase().trim()
    
    const filteredAccounts = vault.accounts.filter(account => 
      account.label.toLowerCase().includes(query) ||
      account.notes.toLowerCase().includes(query) ||
      account.tags.some(tag => tag.toLowerCase().includes(query))
    )

    const filteredServices = vault.services.filter(service => {
      const serviceType = vault.serviceTypes.find(st => st.id === service.serviceTypeId)
      return (
        service.label.toLowerCase().includes(query) ||
        serviceType?.name.toLowerCase().includes(query) ||
        service.tags.some(tag => tag.toLowerCase().includes(query)) ||
        Object.values(service.data).some(value => value.toLowerCase().includes(query))
      )
    })

    return { accounts: filteredAccounts, services: filteredServices }
  }, [searchQuery, vault])

  const hasSearchResults = searchQuery.trim() && (searchResults.accounts.length > 0 || searchResults.services.length > 0)
  const showNoResults = searchQuery.trim() && searchResults.accounts.length === 0 && searchResults.services.length === 0

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
            <p className="text-xs text-gray-400">Manager</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-gray-700">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder={t('sidebar.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-gray-700 border-gray-600 text-white"
          />
        </div>
      </div>

      {/* Navigation / Search Results */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {!searchQuery.trim() ? (
          // Regular navigation
          navigation.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.name}
                to={item.href}
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
          // Search results
          <div className="space-y-4">
            {showNoResults && (
              <div className="text-center py-4 text-gray-400">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('sidebar.search.no_results')}</p>
              </div>
            )}
            
            {searchResults.accounts.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {t('sidebar.search.accounts')} ({searchResults.accounts.length})
                </h3>
                <div className="space-y-1">
                  {searchResults.accounts.map((account) => (
                    <Link
                      key={account.id}
                      to={`/account/${account.id}`}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                      onClick={() => setSearchQuery("")}
                    >
                      <User className="w-4 h-4" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{account.label}</p>
                        {account.tags.length > 0 && (
                          <p className="text-xs text-gray-400 truncate">
                            {account.tags.slice(0, 2).join(", ")}
                          </p>
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
                  {t('sidebar.search.services')} ({searchResults.services.length})
                </h3>
                <div className="space-y-1">
                  {searchResults.services.map((service) => {
                    const serviceType = vault?.serviceTypes.find(st => st.id === service.serviceTypeId)
                    return (
                      <Link
                         key={service.id}
                         to={`/service/${service.id}`}
                         className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                         onClick={() => setSearchQuery("")}
                       >
                        <Globe className="w-4 h-4" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{service.label}</p>
                          <p className="text-xs text-gray-400 truncate">{serviceType?.name}</p>
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
        {vault?.settings?.autoLockMinutes && vault.settings.autoLockMinutes > 0 ? (
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-gray-400">
                    <Clock className="w-4 h-4" />
                    <span>{t('sidebar.autolock.active')}</span>
                </div>
                <Badge variant="secondary" className="bg-green-800 text-white">
                    {t(vault.settings.autoLockMinutes === 60 ? 'settings.autolock.hour' : 'settings.autolock.minutes', { count: vault.settings.autoLockMinutes === 60 ? 1 : vault.settings.autoLockMinutes })}
                </Badge>
            </div>
        ) : (
            <div className="flex items-center justify-center text-sm">
                <div className="flex items-center gap-2 text-gray-400">
                    <Clock className="w-4 h-4" />
                    <span>{t('sidebar.autolock.disabled')}</span>
                </div>
            </div>
        )}

        <Button
          onClick={lock}
          variant="outline"
          className="w-full border-gray-600 text-gray-300 hover:bg-gray-700 bg-transparent"
        >
          <Lock className="w-4 h-4 mr-2" />
          {t('sidebar.lock_button')}
        </Button>
      </div>
    </div>
  )
}
