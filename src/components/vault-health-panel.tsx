import { useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { AlertOctagon, AlertTriangle, ChevronDown, Info, ShieldAlert, ShieldCheck, ShieldX, User } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import {
  analyseVault,
  type AccountRef,
  type HealthIssue,
  type HealthIssueKind,
  type HealthSeverity,
  type HealthStatus,
  type ReuseGroup,
  type ServiceFieldsItem,
  type ServiceRef,
} from "@/lib/vault-health"
import type { Vault } from "@/types"

/** Rows shown per group before "Show all". */
const PREVIEW_ROWS = 5
/** Service chips shown per reuse group before "+N more". */
const PREVIEW_CHIPS = 6

const ROW_LINK =
  "flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-gray-700/60 hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"

const SEVERITY_STYLE: Record<HealthSeverity, { icon: typeof Info; text: string; badge: string }> = {
  critical: { icon: AlertOctagon, text: "text-red-400", badge: "bg-red-500/15 text-red-300 border-red-500/30" },
  warning: { icon: AlertTriangle, text: "text-amber-400", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  info: { icon: Info, text: "text-blue-400", badge: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
}

const STATUS_STYLE: Record<HealthStatus, { icon: typeof Info; text: string; ring: string }> = {
  healthy: { icon: ShieldCheck, text: "text-green-400", ring: "border-green-500/40 bg-green-500/10" },
  needs_attention: { icon: ShieldAlert, text: "text-amber-400", ring: "border-amber-500/40 bg-amber-500/10" },
  at_risk: { icon: ShieldX, text: "text-red-400", ring: "border-red-500/40 bg-red-500/10" },
}

function statusLabel(t: TFunction, status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return t("vault_health.status.healthy")
    case "needs_attention":
      return t("vault_health.status.needs_attention")
    case "at_risk":
      return t("vault_health.status.at_risk")
  }
}

function severityLabel(t: TFunction, severity: HealthSeverity): string {
  switch (severity) {
    case "critical":
      return t("vault_health.severity.critical")
    case "warning":
      return t("vault_health.severity.warning")
    case "info":
      return t("vault_health.severity.info")
  }
}

function issueText(t: TFunction, kind: HealthIssueKind): { title: string; description: string } {
  switch (kind) {
    case "reused_values":
      return { title: t("vault_health.issues.reused_values.title"), description: t("vault_health.issues.reused_values.description") }
    case "invalid_totp":
      return { title: t("vault_health.issues.invalid_totp.title"), description: t("vault_health.issues.invalid_totp.description") }
    case "missing_type":
      return { title: t("vault_health.issues.missing_type.title"), description: t("vault_health.issues.missing_type.description") }
    case "weak_passwords":
      return { title: t("vault_health.issues.weak_passwords.title"), description: t("vault_health.issues.weak_passwords.description") }
    case "missing_required":
      return {
        title: t("vault_health.issues.missing_required.title"),
        description: t("vault_health.issues.missing_required.description"),
      }
    case "orphan_services":
      return {
        title: t("vault_health.issues.orphan_services.title"),
        description: t("vault_health.issues.orphan_services.description"),
      }
    case "empty_accounts":
      return { title: t("vault_health.issues.empty_accounts.title"), description: t("vault_health.issues.empty_accounts.description") }
  }
}

function reuseReasonLabel(t: TFunction, group: ReuseGroup): string {
  switch (group.reason) {
    case "cross_account":
      return t("vault_health.reuse.reason.cross_account")
    case "same_type":
      return t("vault_health.reuse.reason.same_type")
    case "password":
      return t("vault_health.reuse.reason.password")
  }
}

function SeverityBadge({ severity }: { severity: HealthSeverity }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0",
        SEVERITY_STYLE[severity].badge,
      )}
    >
      {severityLabel(t, severity)}
    </span>
  )
}

function TypeName({ service }: { service: ServiceRef }) {
  const { t } = useTranslation()
  return service.typeName ? (
    <span className="text-xs text-gray-400 truncate">{service.typeName}</span>
  ) : (
    <span className="text-xs text-amber-400 truncate">{t("vault_health.unknown_type")}</span>
  )
}

function ServiceRow({ service, children }: { service: ServiceRef; children?: ReactNode }) {
  return (
    <li>
      <Link to={`/services/${service.id}`} className={ROW_LINK}>
        <span className="min-w-0 flex flex-col">
          <span className="text-sm text-white truncate" title={service.label}>{service.label}</span>
          {children}
        </span>
        <TypeName service={service} />
      </Link>
    </li>
  )
}

function AccountRow({ account }: { account: AccountRef }) {
  return (
    <li>
      <Link to={`/accounts/${account.id}`} className={ROW_LINK}>
        <span className="flex items-center gap-2 min-w-0">
          <User className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          <span className="text-sm text-white truncate" title={account.label}>{account.label}</span>
        </span>
      </Link>
    </li>
  )
}

function FieldsRow({ item }: { item: ServiceFieldsItem }) {
  return (
    <ServiceRow service={item.service}>
      <span className="text-xs text-gray-400 truncate">{item.fields.map((f) => f.label).join(", ")}</span>
    </ServiceRow>
  )
}

function ReuseRow({ group }: { group: ReuseGroup }) {
  const { t } = useTranslation()
  const [showAllChips, setShowAllChips] = useState(false)
  const chips = showAllChips ? group.services : group.services.slice(0, PREVIEW_CHIPS)
  const hidden = group.services.length - chips.length

  return (
    <li className="rounded-md bg-gray-700/60 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-white font-medium truncate">{group.fieldLabels.join(", ")}</p>
          <p className="text-xs text-gray-400">
            {reuseReasonLabel(t, group)}
            {" · "}
            {t("vault_health.reuse.counts", { services: group.serviceCount, accounts: group.accountCount })}
          </p>
          {group.linkedService && (
            <p className="text-xs text-gray-400">
              {t("vault_health.reuse.linked_to")}{" "}
              <Link
                to={`/services/${group.linkedService.id}`}
                className="text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              >
                {group.linkedService.label}
              </Link>
            </p>
          )}
        </div>
        <SeverityBadge severity={group.severity} />
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t("vault_health.reuse.services_label")}>
        {chips.map((service) => (
          <li key={service.id}>
            <Link
              to={`/services/${service.id}`}
              className="inline-flex items-center gap-1 max-w-[16rem] rounded bg-gray-800 border border-gray-600 px-2 py-0.5 text-xs text-gray-200 hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span className="truncate" title={service.label}>{service.label}</span>
              {service.typeName && <span className="text-gray-500 truncate">· {service.typeName}</span>}
            </Link>
          </li>
        ))}
        {group.services.length > PREVIEW_CHIPS && (
          <li>
            <button
              type="button"
              onClick={() => setShowAllChips((v) => !v)}
              className="rounded px-2 py-0.5 text-xs text-blue-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {showAllChips ? t("vault_health.show_less") : t("vault_health.more_services", { count: hidden })}
            </button>
          </li>
        )}
      </ul>
    </li>
  )
}

function IssueRows({ issue, limit }: { issue: HealthIssue; limit: number }) {
  switch (issue.kind) {
    case "reused_values":
      return (
        <>
          {issue.items.slice(0, limit).map((group) => (
            <ReuseRow key={group.key} group={group} />
          ))}
        </>
      )
    case "invalid_totp":
    case "weak_passwords":
    case "missing_required":
      return (
        <>
          {issue.items.slice(0, limit).map((item) => (
            <FieldsRow key={item.service.id} item={item} />
          ))}
        </>
      )
    case "missing_type":
    case "orphan_services":
      return (
        <>
          {issue.items.slice(0, limit).map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </>
      )
    case "empty_accounts":
      return (
        <>
          {issue.items.slice(0, limit).map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </>
      )
  }
}

function IssueGroup({ issue, defaultOpen }: { issue: HealthIssue; defaultOpen: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const [showAll, setShowAll] = useState(false)
  const { title, description } = issueText(t, issue.kind)
  const style = SEVERITY_STYLE[issue.severity]
  const Icon = style.icon
  const limit = showAll ? issue.items.length : PREVIEW_ROWS

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-gray-700 bg-gray-900/40">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg hover:bg-gray-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Icon className={cn("w-4 h-4 shrink-0", style.text)} aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-white truncate">{title}</span>
          </span>
          <span className="sr-only">{severityLabel(t, issue.severity)}</span>
          <span className="sr-only">{t("vault_health.items_count", { count: issue.count })}</span>
          <span
            className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums", style.badge)}
            aria-hidden="true"
          >
            {issue.count}
          </span>
          <ChevronDown
            className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs text-gray-400">{description}</p>
          <ul className="space-y-1.5">
            <IssueRows issue={issue} limit={limit} />
          </ul>
          {issue.items.length > PREVIEW_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-blue-300 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {showAll ? t("vault_health.show_less") : t("vault_health.show_all", { count: issue.items.length })}
            </button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export interface VaultHealthPanelProps {
  vault: Vault
  className?: string
}

/** Dashboard card with the vault health report. Never renders field values. */
export function VaultHealthPanel({ vault, className }: VaultHealthPanelProps) {
  const { t } = useTranslation()
  const report = useMemo(() => analyseVault(vault), [vault])
  const status = STATUS_STYLE[report.status]
  const StatusIcon = status.icon
  const { critical, warning, info } = report.totals

  return (
    <Card className={cn("bg-gray-800 border-gray-700", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5 min-w-0">
          <CardTitle className="text-white flex items-center gap-2">
            <StatusIcon className={cn("w-5 h-5", status.text)} aria-hidden="true" />
            {t("vault_health.title")}
          </CardTitle>
          <CardDescription className="text-gray-400">{t("vault_health.description")}</CardDescription>
          {report.issues.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs pt-1">
              {critical > 0 && <span className="text-red-300">{t("vault_health.counts.critical", { count: critical })}</span>}
              {warning > 0 && <span className="text-amber-300">{t("vault_health.counts.warning", { count: warning })}</span>}
              {info > 0 && <span className="text-blue-300">{t("vault_health.counts.info", { count: info })}</span>}
            </p>
          )}
        </div>
        <div className={cn("shrink-0 rounded-xl border px-4 py-2 text-center", status.ring)}>
          <span className="sr-only">
            {t("vault_health.score_aria", { score: report.score, status: statusLabel(t, report.status) })}
          </span>
          <div className={cn("text-2xl font-bold tabular-nums leading-tight", status.text)} aria-hidden="true">
            {report.score}
            <span className="text-sm font-normal text-gray-400">/100</span>
          </div>
          <div className={cn("text-xs font-medium", status.text)} aria-hidden="true">
            {statusLabel(t, report.status)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {report.issues.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
            <ShieldCheck className="w-5 h-5 shrink-0" aria-hidden="true" />
            {t("vault_health.no_issues")}
          </div>
        ) : (
          <div className="space-y-2">
            {report.issues.map((issue) => (
              <IssueGroup key={issue.kind} issue={issue} defaultOpen={issue.severity === "critical"} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default VaultHealthPanel
