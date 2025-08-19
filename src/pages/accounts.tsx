import { useState, useMemo, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import Fuse from "fuse.js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Search, Filter, Edit, Trash2, Grid, List, Users, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import type { Account } from "@/types"
import { CreateAccountModal } from "@/components/create-account-modal"
import { BulkCreateAccountsModal } from "@/components/bulk-create-accounts-modal"
import { confirm } from "@tauri-apps/plugin-dialog"

export default function AccountsList() {
  const navigate = useNavigate()
  const { t } = useTranslation();
  const { vault, deleteAccount, accountsViewMode, setAccountsViewMode } = useVaultStore()
  const viewMode = accountsViewMode;
  const setViewMode = setAccountsViewMode;
  const [searchTerm, setSearchTerm] = useState(() => {
    return localStorage.getItem('accounts-search-term') || ''
  })
  const [selectedTag, setSelectedTag] = useState(() => {
    return localStorage.getItem('accounts-selected-tag') || 'all'
  })
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'none'>(() => {
    return (localStorage.getItem('accounts-sort-order') as 'asc' | 'desc' | 'none') || 'asc'
  })
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false)
  const [accountToEdit, setAccountToEdit] = useState<Account | null>(null)


  const accounts = vault?.accounts || []
  
  const allTags = ["all", ...Array.from(new Set(accounts.flatMap((account) => account.tags)))]

  // Save search term to localStorage
  useEffect(() => {
    localStorage.setItem('accounts-search-term', searchTerm)
  }, [searchTerm])

  // Save selected tag to localStorage
  useEffect(() => {
    localStorage.setItem('accounts-selected-tag', selectedTag)
  }, [selectedTag])

  // Save sort order to localStorage
  useEffect(() => {
    localStorage.setItem('accounts-sort-order', sortOrder)
  }, [sortOrder])

  // Natural sort function that handles numbers correctly
  const naturalSort = (a: string, b: string): number => {
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: 'base'
    })
    return collator.compare(a, b)
  }

  const handleSortToggle = () => {
    if (sortOrder === 'none') {
      setSortOrder('asc')
    } else if (sortOrder === 'asc') {
      setSortOrder('desc')
    } else {
      setSortOrder('none')
    }
  }

  const fuse = useMemo(() => new Fuse(accounts, {
    keys: ['label', 'notes', 'tags'],
    threshold: 0.3,
    includeScore: true,
  }), [accounts]);

  const filteredAccounts = useMemo(() => {
    let results = accounts;

    if (searchTerm) {
        results = fuse.search(searchTerm).map(result => result.item);
    }

    if (selectedTag !== 'all') {
        results = results.filter(account => account.tags.includes(selectedTag));
    }

    // Apply sorting
    if (sortOrder !== 'none') {
      results = [...results].sort((a, b) => {
        const comparison = naturalSort(a.label, b.label)
        return sortOrder === 'asc' ? comparison : -comparison
      })
    }

    return results;
  }, [accounts, searchTerm, selectedTag, fuse, sortOrder]);
  
  const handleAddAccount = () => {
    setAccountToEdit(null)
    setIsModalOpen(true)
  }

  const handleEditAccount = (account: Account) => {
    setAccountToEdit(account)
    setIsModalOpen(true)
  }

  const handleDeleteAccount = async (accountId: string) => {
    const confirmed = await confirm(t('accounts.delete_confirm.message'), { title: t('accounts.delete_confirm.title') });
    if(confirmed) {
        await deleteAccount(accountId);
    }
  }

  const getTagColor = (tag: string) => {
    const hash = tag.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
    const colors = ["bg-purple-600/20 text-purple-300", "bg-blue-600/20 text-blue-300", "bg-green-600/20 text-green-300", "bg-pink-600/20 text-pink-300", "bg-yellow-600/20 text-yellow-300", "bg-indigo-600/20 text-indigo-300", "bg-teal-600/20 text-teal-300", "bg-orange-600/20 text-orange-300"];
    return colors[Math.abs(hash) % colors.length];
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('accounts.title')}</h1>
          <p className="text-gray-400 mt-1">{t('accounts.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            onClick={handleAddAccount}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('accounts.create_button')}
          </Button>
          <Button
            variant="outline"
            className="border-blue-600 text-blue-400 hover:bg-blue-600/10"
            onClick={() => setIsBulkModalOpen(true)}
          >
            <Users className="w-4 h-4 mr-2" />
            Bulk Create
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder={t('accounts.search_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-gray-700 border-gray-600 text-white"
              />
            </div>

            <Select value={selectedTag} onValueChange={setSelectedTag}>
              <SelectTrigger className="w-48 bg-gray-700 border-gray-600 text-white">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder={t('accounts.filter_placeholder')} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                {allTags.map((tag) => (
                  <SelectItem key={tag} value={tag} className="text-white">
                    {tag === "all" ? t('accounts.all_tags') : tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                variant={sortOrder !== 'none' ? "secondary" : "ghost"}
                size="sm"
                onClick={handleSortToggle}
                className="text-gray-300"
                title={sortOrder === 'none' ? 'Sort by name' : sortOrder === 'asc' ? 'Sorted A-Z' : 'Sorted Z-A'}
              >
                {sortOrder === 'none' && <ArrowUpDown className="w-4 h-4" />}
                {sortOrder === 'asc' && <ArrowUp className="w-4 h-4" />}
                {sortOrder === 'desc' && <ArrowDown className="w-4 h-4" />}
              </Button>
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="text-gray-300"
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="text-gray-300"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts Grid/List */}
      <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-3"}>
        {filteredAccounts.map((account) => (
          <Card
            key={account.id}
            className="bg-gray-800 border-gray-700 hover:bg-gray-750 transition-colors cursor-pointer flex flex-col"
            onClick={() => navigate(`/accounts/${account.id}`)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center shrink-0">
                    <Users className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-white text-lg">{account.label}</CardTitle>
                    <p className="text-sm text-gray-400">{t('accounts.services_count', { count: account.linkedServices.length })}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400 hover:text-white"
                    onClick={(e) => { e.stopPropagation(); handleEditAccount(account); }}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400 hover:text-red-400"
                    onClick={(e) => { e.stopPropagation(); handleDeleteAccount(account.id); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col justify-between">
              <p className="text-sm text-gray-300 mb-3 flex-grow">{account.notes.substring(0, 100)}{account.notes.length > 100 && '...'}</p>
              <div className="flex flex-wrap gap-2">
                {account.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className={`text-xs ${getTagColor(tag)}`}>
                    <span>{tag}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredAccounts.length === 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8 text-center">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg mb-2">{t('accounts.not_found')}</p>
            <p className="text-gray-500 text-sm mb-4">
              {searchTerm || selectedTag !== "all"
                ? t('accounts.try_changing_filters')
                : t('accounts.create_first')}
            </p>
            {!searchTerm && selectedTag === "all" && (
              <Button
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                onClick={handleAddAccount}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('accounts.create_first_button')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      
      <CreateAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        accountToEdit={accountToEdit}
      />
      <BulkCreateAccountsModal
        isOpen={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
      />
    </div>
  )
}
