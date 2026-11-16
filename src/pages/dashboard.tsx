import { useMemo, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { Blocks, ChevronRight, Clock, FileUp, Pin, Plus, Search, Server, Users } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useVaultStore } from "@/stores/vault-store"
import { CREATE_REQUEST_STATE, formatShortcut, openCommandPalette } from "@/components/command-palette"
import { VaultHealthPanel } from "@/components/vault-health-panel"
import { getServiceTitle } from "@/lib/service-helpers"
import { cn } from "@/lib/utils"
import { currentLanguage } from "@/i18n"
import type { Account, Service, ServiceType } from "@/types"

const RECENT_LIMIT = 5
const PINNED_LIMIT = 6

const PRIMARY_BUTTON = "bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"
const OUTLINE_BUTTON = "border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white bg-transparent"
const ROW_LINK =
  "flex items-center justify-between gap-3 p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"

type Timestamped = { updatedAt?: number; createdAt?: number }

/**
 * Most recently updated first. Records without a timestamp (legacy, 0) go last; among equal
 * timestamps the one added later to the vault comes first.
 */
function sortByRecent<T extends Timestamped>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (b.item.updatedAt || 0) - (a.item.updatedAt || 0) ||
        (b.item.createdAt || 0) - (a.item.createdAt || 0) ||
        b.index - a.index,
    )
    .map(({ item }) => item)
}

function formatUpdated(timestamp: number | undefined, now: number): { relative: string; full: string } | null {
  if (!timestamp || timestamp <= 0) return null
  const language = currentLanguage()
  const full = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(timestamp)
  const diffSeconds = Math.round((timestamp - now) / 1000)
  const abs = Math.abs(diffSeconds)
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" })
  let relative: string
  if (abs < 60) relative = rtf.format(0, "second")
  else if (abs < 3600) relative = rtf.format(Math.round(diffSeconds / 60), "minute")
  else if (abs < 86_400) relative = rtf.format(Math.round(diffSeconds / 3600), "hour")
  else if (abs < 30 * 86_400) relative = rtf.format(Math.round(diffSeconds / 86_400), "day")
  else relative = new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(timestamp)
  return { relative, full }
}

function autoLockLabel(t: TFunction, minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return t("settings.autolock.disabled")
  if (minutes % 60 === 0) return t("settings.autolock.hour", { count: minutes / 60 })
  return t("settings.autolock.minutes", { count: minutes })
}

function UpdatedAt({ timestamp, now }: { timestamp: number | undefined; now: number }) {
  const formatted = formatUpdated(timestamp, now)
  if (!formatted) return null
  return (
    <time className="text-xs text-gray-400 shrink-0" dateTime={new Date(timestamp as number).toISOString()} title={formatted.full}>
      {formatted.relative}
    </time>
  )
}

function PinnedMark() {
  const { t } = useTranslation()
  return <Pin className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400/30 shrink-0" aria-label={t("dashboard.pinned.badge")} />
}

function AccountRow({ account, servicesCount, now }: { account: Account; servicesCount: number; now: number }) {
  const { t } = useTranslation()
  return (
    <li>
      <Link to={`/accounts/${account.id}`} className={ROW_LINK}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {account.pinned && <PinnedMark />}
            <h3 className="font-medium text-white truncate" title={account.label}>{account.label}</h3>
          </div>
          <p className="text-sm text-gray-400">{t("dashboard.recent_accounts.services_count", { count: servicesCount })}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <UpdatedAt timestamp={account.updatedAt} now={now} />
          {account.tags.length > 0 && (
            <div className="flex gap-1">
              {account.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded max-w-[8rem] truncate">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>
    </li>
  )
}

function ServiceRow({ service, type, now }: { service: Service; type: ServiceType | undefined; now: number }) {
  const { t } = useTranslation()
  return (
    <li>
      <Link to={`/services/${service.id}`} className={ROW_LINK}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {service.pinned && <PinnedMark />}
            <h3 className="font-medium text-white truncate">{getServiceTitle(service, type)}</h3>
          </div>
          <p className={cn("text-sm truncate", type ? "text-gray-400" : "text-amber-400")}>
            {type ? type.name : t("dashboard.recent_services.unknown_type")}
          </p>
        </div>
        <UpdatedAt timestamp={service.updatedAt} now={now} />
      </Link>
    </li>
  )
}

function ViewAllLink({ to }: { to: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0"
    >
      {t("dashboard.view_all")}
      <ChevronRight className="w-4 h-4" aria-hidden="true" />
    </Link>
  )
}

function EmptyState({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="text-center py-8 text-gray-400">
      {icon}
      <p>{text}</p>
      {action}
    </div>
  )
}

function StatCard({ to, title, icon, value }: { to: string; title: string; icon: ReactNode; value: ReactNode }) {
  return (
    <Link
      to={to}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <Card className="bg-gray-800 border-gray-700 hover:border-gray-600 transition-colors h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-gray-300">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-white">{value}</div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function Dashboard() {
  const vault = useVaultStore((s) => s.vault)
  const { t } = useTranslation()
  const navigate = useNavigate()

  const newAccount = () => navigate("/accounts", { state: CREATE_REQUEST_STATE })
  const newService = () => navigate("/services", { state: CREATE_REQUEST_STATE })

  const data = useMemo(() => {
    const accounts = vault?.accounts ?? []
    const services = vault?.services ?? []
    const typesById = new Map((vault?.serviceTypes ?? []).map((type) => [type.id, type]))
    const serviceIds = new Set(services.map((s) => s.id))
    const linkedCount = new Map<string, number>()
    for (const account of accounts) {
      linkedCount.set(account.id, new Set(account.linkedServices.filter((id) => serviceIds.has(id))).size)
    }
    const pinnedAccounts = sortByRecent(accounts.filter((a) => a.pinned))
    const pinnedServices = sortByRecent(services.filter((s) => s.pinned))
    return {
      typesById,
      linkedCount,
      pinnedAccounts,
      pinnedServices,
      recentAccounts: sortByRecent(accounts).slice(0, RECENT_LIMIT),
      recentServices: sortByRecent(services).slice(0, RECENT_LIMIT),
    }
  }, [vault])

  // Relative times ("5 minutes ago") are as of this render.
  const now = Date.now()

  const totalAccounts = vault?.accounts.length ?? 0
  const totalServices = vault?.services.length ?? 0
  const totalTypes = vault?.serviceTypes.length ?? 0
  const hasPinned = data.pinnedAccounts.length + data.pinnedServices.length > 0

  const accountRow = (account: Account) => (
    <AccountRow key={account.id} account={account} servicesCount={data.linkedCount.get(account.id) ?? 0} now={now} />
  )
  const serviceRow = (service: Service) => (
    <ServiceRow key={service.id} service={service} type={data.typesById.get(service.serviceTypeId)} now={now} />
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">{t("dashboard.welcome")}</h1>
        <p className="text-gray-400">{t("dashboard.description")}</p>
      </div>

      {/* Quick actions */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">{t("dashboard.quick_actions.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button className={PRIMARY_BUTTON} onClick={newAccount}>
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            {t("dashboard.quick_actions.create_account")}
          </Button>
          <Button variant="outline" className={OUTLINE_BUTTON} onClick={newService}>
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            {t("dashboard.quick_actions.create_service")}
          </Button>
          <Button variant="outline" className={OUTLINE_BUTTON} onClick={() => navigate("/services-import")}>
            <FileUp className="w-4 h-4 mr-2" aria-hidden="true" />
            {t("dashboard.quick_actions.import_services")}
          </Button>
          <Button variant="outline" className={OUTLINE_BUTTON} onClick={openCommandPalette}>
            <Search className="w-4 h-4 mr-2" aria-hidden="true" />
            {t("dashboard.quick_actions.search")}
            <kbd className="ml-2 rounded border border-gray-600 bg-gray-700 px-1.5 py-0.5 text-[10px] font-mono text-gray-300">
              {formatShortcut("k")}
            </kbd>
          </Button>
        </CardContent>
      </Card>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          to="/accounts"
          title={t("dashboard.stats.total_accounts")}
          icon={<Users className="h-4 w-4 text-blue-500" aria-hidden="true" />}
          value={totalAccounts}
        />
        <StatCard
          to="/services"
          title={t("dashboard.stats.total_services")}
          icon={<Server className="h-4 w-4 text-purple-500" aria-hidden="true" />}
          value={totalServices}
        />
        <StatCard
          to="/service-types"
          title={t("dashboard.stats.service_types")}
          icon={<Blocks className="h-4 w-4 text-pink-500" aria-hidden="true" />}
          value={totalTypes}
        />
        <StatCard
          to="/settings"
          title={t("dashboard.stats.autolock")}
          icon={<Clock className="h-4 w-4 text-green-500" aria-hidden="true" />}
          value={autoLockLabel(t, vault?.settings?.autoLockMinutes)}
        />
      </div>

      {/* Pinned */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Pin className="w-5 h-5 text-yellow-400" aria-hidden="true" />
            {t("dashboard.pinned.title")}
          </CardTitle>
          <CardDescription className="text-gray-400">{t("dashboard.pinned.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {hasPinned ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section aria-labelledby="dashboard-pinned-accounts" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="dashboard-pinned-accounts" className="text-sm font-medium text-gray-300">
                    {t("dashboard.pinned.accounts", { count: data.pinnedAccounts.length })}
                  </h2>
                  {data.pinnedAccounts.length > PINNED_LIMIT && <ViewAllLink to="/accounts" />}
                </div>
                {data.pinnedAccounts.length > 0 ? (
                  <ul className="space-y-2">{data.pinnedAccounts.slice(0, PINNED_LIMIT).map(accountRow)}</ul>
                ) : (
                  <p className="text-sm text-gray-500">{t("dashboard.pinned.no_accounts")}</p>
                )}
              </section>
              <section aria-labelledby="dashboard-pinned-services" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="dashboard-pinned-services" className="text-sm font-medium text-gray-300">
                    {t("dashboard.pinned.services", { count: data.pinnedServices.length })}
                  </h2>
                  {data.pinnedServices.length > PINNED_LIMIT && <ViewAllLink to="/services" />}
                </div>
                {data.pinnedServices.length > 0 ? (
                  <ul className="space-y-2">{data.pinnedServices.slice(0, PINNED_LIMIT).map(serviceRow)}</ul>
                ) : (
                  <p className="text-sm text-gray-500">{t("dashboard.pinned.no_services")}</p>
                )}
              </section>
            </div>
          ) : (
            <p className="text-sm text-gray-400">{t("dashboard.pinned.empty")}</p>
          )}
        </CardContent>
      </Card>

      {/* Recently updated */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-white">{t("dashboard.recent_accounts.title")}</CardTitle>
              <CardDescription className="text-gray-400">{t("dashboard.recent_accounts.description")}</CardDescription>
            </div>
            {totalAccounts > 0 && <ViewAllLink to="/accounts" />}
          </CardHeader>
          <CardContent>
            {data.recentAccounts.length > 0 ? (
              <ul className="space-y-3">{data.recentAccounts.map(accountRow)}</ul>
            ) : (
              <EmptyState
                icon={<Users className="w-12 h-12 mx-auto mb-4 opacity-50" aria-hidden="true" />}
                text={t("dashboard.recent_accounts.no_accounts")}
                action={
                  <Button className={cn("mt-4", PRIMARY_BUTTON)} onClick={newAccount}>
                    {t("dashboard.recent_accounts.create_first")}
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-white">{t("dashboard.recent_services.title")}</CardTitle>
              <CardDescription className="text-gray-400">{t("dashboard.recent_services.description")}</CardDescription>
            </div>
            {totalServices > 0 && <ViewAllLink to="/services" />}
          </CardHeader>
          <CardContent>
            {data.recentServices.length > 0 ? (
              <ul className="space-y-3">{data.recentServices.map(serviceRow)}</ul>
            ) : (
              <EmptyState
                icon={<Server className="w-12 h-12 mx-auto mb-4 opacity-50" aria-hidden="true" />}
                text={t("dashboard.recent_services.no_services")}
                action={
                  <div className="mt-4 flex flex-wrap justify-center gap-3">
                    <Button className={PRIMARY_BUTTON} onClick={newService}>
                      {t("dashboard.recent_services.create_first")}
                    </Button>
                    <Button variant="outline" className={OUTLINE_BUTTON} onClick={() => navigate("/services-import")}>
                      {t("dashboard.quick_actions.import_services")}
                    </Button>
                  </div>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vault health */}
      {vault && <VaultHealthPanel vault={vault} />}
    </div>
  )
}
