import React, { useState } from "react"
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Users, Server, Clock } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { CreateAccountModal } from "@/components/create-account-modal"
import { CreateServiceModal } from "@/components/create-service-modal"

export default function Dashboard() {
  const { vault } = useVaultStore()
  const { t } = useTranslation();
  const [isCreateAccountModalOpen, setIsCreateAccountModalOpen] = useState(false)
  const [isCreateServiceModalOpen, setIsCreateServiceModalOpen] = useState(false)

  const recentAccounts = vault?.accounts.slice(0, 5) || []
  const totalAccounts = vault?.accounts.length || 0
  const totalServices = vault?.services.length || 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">{t('dashboard.welcome')}</h1>
        <p className="text-gray-400">{t('dashboard.description')}</p>
      </div>

      {/* Quick Actions */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">{t('dashboard.quick_actions.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Button 
            className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"
            onClick={() => setIsCreateAccountModalOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('dashboard.quick_actions.create_account')}
          </Button>
          <Button 
            variant="outline" 
            className="border-gray-600 text-gray-300 hover:bg-gray-700 bg-transparent"
            onClick={() => setIsCreateServiceModalOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('dashboard.quick_actions.create_service')}
          </Button>
        </CardContent>
      </Card>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-300">{t('dashboard.stats.total_accounts')}</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalAccounts}</div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-300">{t('dashboard.stats.total_services')}</CardTitle>
            <Server className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalServices}</div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-300">{t('dashboard.stats.autolock')}</CardTitle>
            <Clock className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
                {vault?.settings?.autoLockMinutes && vault.settings.autoLockMinutes > 0
                    ? t(vault.settings.autoLockMinutes === 60 ? 'settings.autolock.hour' : 'settings.autolock.minutes', { count: vault.settings.autoLockMinutes === 60 ? 1 : vault.settings.autoLockMinutes })
                    : t('settings.autolock.disabled')
                }
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Accounts */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">{t('dashboard.recent_accounts.title')}</CardTitle>
          <CardDescription className="text-gray-400">{t('dashboard.recent_accounts.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {recentAccounts.length > 0 ? (
            <div className="space-y-3">
              {recentAccounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors cursor-pointer"
                >
                  <div>
                    <h3 className="font-medium text-white">{account.label}</h3>
                    <p className="text-sm text-gray-400">{t('dashboard.recent_accounts.services_count', { count: account.linkedServices.length })}</p>
                  </div>
                  <div className="flex gap-1">
                    {account.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t('dashboard.recent_accounts.no_accounts')}</p>
              <Button className="mt-4 bg-gradient-to-r from-blue-600 to-purple-700" onClick={() => setIsCreateAccountModalOpen(true)}>
                {t('dashboard.recent_accounts.create_first')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      <CreateAccountModal
        isOpen={isCreateAccountModalOpen}
        onClose={() => setIsCreateAccountModalOpen(false)}
      />
      
      <CreateServiceModal
        isOpen={isCreateServiceModalOpen}
        onClose={() => setIsCreateServiceModalOpen(false)}
      />
    </div>
  )
}
