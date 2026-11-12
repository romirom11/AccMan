"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { confirm } from "@tauri-apps/plugin-dialog"
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Edit,
  ExternalLink,
  Globe,
  Link,
  Loader2,
  MailWarning,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useVaultStore } from "@/stores/vault-store"
import { CreateServiceModal } from "@/components/create-service-modal"
import { LinkedServiceDetail } from "@/components/linked-service-detail"
import { LinkServiceToAccountModal } from "@/components/link-service-to-account-modal"
import { EmailViewer } from "@/components/email-viewer"
import { FieldValueRow } from "@/components/field-value-row"
import { ListPager } from "@/components/list-pager"
import { useServiceNeighbors } from "@/hooks/use-list-navigation"
import { confirmLeave } from "@/lib/unsaved-guard"
import { vaultApi } from "@/api/vault"
import { currentLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import { findServiceType, isEmailService } from "@/lib/service-helpers"
import { findServiceReferences } from "@/lib/service-list"
import { parseImapPort } from "@/lib/email-view"
import { isBlank } from "@/lib/service-form"
import type { Service, ServiceField } from "@/types"

function formatTimestamp(ms: number, locale: string): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms))
  } catch {
    return null
  }
}

/** Value of a linked_service field: the target's label, expandable into its details. */
function LinkedServiceValue({ linked }: { linked: Service | undefined }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  if (!linked) return <LinkedServiceDetail service={undefined} />

  return (
    <div className="font-sans text-base">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-blue-400 hover:text-blue-300"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <Globe className="w-4 h-4 mr-2" />
          <span className="truncate">{linked.label}</span>
          <ChevronDown className={cn("w-4 h-4 ml-1 transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-gray-400 hover:text-white"
          onClick={() => navigate(`/services/${linked.id}`)}
          aria-label={t("service_view.open_linked", { label: linked.label })}
          title={t("service_view.open_linked", { label: linked.label })}
        >
          <ExternalLink className="w-4 h-4" />
        </Button>
      </div>
      {expanded && <LinkedServiceDetail service={linked} />}
    </div>
  )
}

export default function ServiceView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const locale = currentLanguage()
  const vault = useVaultStore((s) => s.vault)
  const deleteService = useVaultStore((s) => s.deleteService)
  const setPinned = useVaultStore((s) => s.setPinned)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isLinkToAccountModalOpen, setIsLinkToAccountModalOpen] = useState(false)
  const [showEmptyFields, setShowEmptyFields] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const [providerSupport, setProviderSupport] = useState<{ key: string; supported: boolean } | null>(null)

  const service = vault?.services.find((srv) => srv.id === id)
  const serviceType = service ? findServiceType(vault?.serviceTypes, service.serviceTypeId) : undefined

  const references = useMemo(() => findServiceReferences(vault, id ?? ""), [vault, id])
  // Previous/Next in the order the Services page currently shows.
  const neighbors = useServiceNeighbors(id)

  // Email inbox: only for the Email type with credentials, and a known provider or an explicit IMAP host.
  const emailAccess = useMemo(() => {
    if (!service || !isEmailService(serviceType)) return null
    const email = service.data.email?.trim() ?? ""
    const password = service.data.password ?? ""
    if (!email || !password) return null
    return {
      email,
      password,
      imapHost: service.data.imap_host?.trim() || undefined,
      imapPort: parseImapPort(service.data.imap_port),
    }
  }, [service, serviceType])
  const supportKey = emailAccess && !emailAccess.imapHost ? emailAccess.email.toLowerCase() : null

  useEffect(() => {
    if (!supportKey) return
    let ignore = false
    vaultApi
      .isEmailProviderSupported(supportKey, undefined, { silent: true })
      .then((supported) => {
        if (!ignore) setProviderSupport({ key: supportKey, supported })
      })
      .catch(() => {
        if (!ignore) setProviderSupport({ key: supportKey, supported: false })
      })
    return () => {
      ignore = true
    }
  }, [supportKey])

  const providerState: "none" | "checking" | "supported" | "unsupported" = !emailAccess
    ? "none"
    : emailAccess.imapHost
      ? "supported"
      : providerSupport?.key !== supportKey
        ? "checking"
        : providerSupport.supported
          ? "supported"
          : "unsupported"

  if (!service) {
    // Right after a delete the page is about to navigate away.
    if (deleting) return null
    return (
      <div className="p-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="text-center py-12 space-y-4">
            <p className="text-gray-400">{t("service_view.not_found")}</p>
            <Button variant="outline" className="border-gray-600 text-gray-300" onClick={() => navigate("/services")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t("service_view.back_to_services")}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // A service whose type was deleted stays readable: its raw values, all treated as secrets.
  const fields: ServiceField[] = serviceType
    ? serviceType.fields
    : Object.keys(service.data).map((key) => ({
        id: `raw:${key}`,
        key,
        label: key,
        type: "secret",
        masked: true,
        required: false,
      }))
  const shownFields = showEmptyFields ? fields : fields.filter((f) => f.required || !isBlank(service.data[f.key]))
  const hiddenEmptyCount = fields.length - fields.filter((f) => f.required || !isBlank(service.data[f.key])).length
  const missingRequired = fields.filter((f) => f.required && isBlank(service.data[f.key])).length

  const usedByServices = references.serviceIds
    .map((serviceId) => vault?.services.find((s) => s.id === serviceId))
    .filter((s): s is Service => !!s)
  const linkedAccounts = references.accountIds
    .map((accountId) => vault?.accounts.find((a) => a.id === accountId))
    .filter((a): a is NonNullable<typeof a> => !!a)

  const createdAt = formatTimestamp(service.createdAt, locale)
  const updatedAt = formatTimestamp(service.updatedAt, locale)
  const typeName = serviceType?.name ?? t("service_view.unknown_type")

  const handleBack = () => {
    // The first history entry of the MemoryRouter has the key "default".
    if (location.key !== "default") navigate(-1)
    else navigate("/services")
  }

  // Replaces the entry, so "back" still leads to where the user came from.
  const goToService = async (serviceId: string) => {
    if (await confirmLeave()) navigate(`/services/${serviceId}`, { replace: true })
  }

  const handleDeleteService = async () => {
    if (deleting) return
    const lines = [t("service_view.delete_confirm_message")]
    if (references.accountIds.length > 0) {
      lines.push(t("service_view.delete_refs.accounts", { count: references.accountIds.length }))
    }
    if (references.serviceIds.length > 0) {
      lines.push(t("service_view.delete_refs.services", { count: references.serviceIds.length }))
    }
    const confirmed = await confirm(lines.join("\n\n"), {
      title: t("service_view.delete_confirm_title"),
      kind: "warning",
    })
    if (!confirmed) return
    setDeleting(true)
    try {
      await deleteService(service.id)
      navigate("/services", { replace: true })
    } catch {
      // Error toast shown by the API layer.
      setDeleting(false)
    }
  }

  const handleTogglePin = async () => {
    if (pinBusy) return
    setPinBusy(true)
    try {
      await setPinned("service", service.id, !service.pinned)
    } catch {
      // Error toast shown by the API layer.
    } finally {
      setPinBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={handleBack}
          aria-label={t("service_view.back")}
          title={t("service_view.back")}
          className="border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white truncate">{service.label}</h1>
          <p className="text-gray-400">{typeName}</p>
        </div>
      </div>

      {/* Header */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-16 shrink-0 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xl">{(serviceType?.name || service.label).charAt(0)}</span>
              </div>
              <div className="min-w-0">
                <CardTitle className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
                  <span className="truncate">{service.label}</span>
                  {service.pinned && (
                    <Pin className="w-5 h-5 shrink-0 text-yellow-400 fill-yellow-400/30" aria-label={t("service_view.pinned")} />
                  )}
                </CardTitle>
                <p className="text-gray-400 text-lg">{typeName}</p>
                {service.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {service.tags.map((tag) => (
                      <Badge key={tag} className="bg-blue-600 text-white">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {(createdAt || updatedAt) && (
                  <p className="text-xs text-gray-500 mt-2 space-x-3">
                    {createdAt && <span>{t("service_view.created_at", { date: createdAt })}</span>}
                    {updatedAt && <span>{t("service_view.updated_at", { date: updatedAt })}</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ListPager
                neighbors={neighbors}
                onNavigate={(serviceId) => void goToService(serviceId)}
                previousLabel={t("service_view.nav.previous")}
                nextLabel={t("service_view.nav.next")}
                positionLabel={t(neighbors.unfiltered ? "service_view.nav.position_unfiltered" : "service_view.nav.position", {
                  current: neighbors.index + 1,
                  total: neighbors.total,
                })}
                hotkeysEnabled={!isEditModalOpen && !isLinkToAccountModalOpen}
              />
              {neighbors.index !== -1 && <div className="w-px h-6 bg-gray-600" aria-hidden="true" />}
              <Button
                variant="outline"
                className={cn(
                  "bg-transparent",
                  service.pinned
                    ? "border-yellow-600 text-yellow-300 hover:bg-yellow-600/20"
                    : "border-gray-600 text-gray-300",
                )}
                onClick={handleTogglePin}
                disabled={pinBusy}
                aria-pressed={service.pinned}
              >
                {service.pinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                {service.pinned ? t("service_view.unpin") : t("service_view.pin")}
              </Button>
              <Button
                variant="outline"
                className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white bg-transparent"
                onClick={() => setIsLinkToAccountModalOpen(true)}
              >
                <Link className="w-4 h-4 mr-2" />
                {t("common.link_to_account")}
              </Button>
              <Button
                variant="outline"
                className="border-gray-600 text-gray-300 bg-transparent"
                onClick={() => setIsEditModalOpen(true)}
              >
                <Edit className="w-4 h-4 mr-2" />
                {t("common.edit")}
              </Button>
              <Button
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white bg-transparent"
                onClick={handleDeleteService}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                {t("common.delete")}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Data */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-white">{t("service_view.data.title")}</CardTitle>
            {missingRequired > 0 && (
              <span className="flex items-center gap-1 text-sm text-red-400">
                <AlertTriangle className="w-4 h-4" />
                {t("service_view.missing_required", { count: missingRequired })}
              </span>
            )}
          </div>
          {!serviceType && (
            <p className="flex items-start gap-2 text-sm text-yellow-400">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {t("service_view.type_missing_hint")}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {fields.length === 0 && <p className="text-gray-500 italic">{t("service_view.no_fields")}</p>}
          {shownFields.map((field) => (
            <FieldValueRow
              key={`${service.id}:${field.id}`}
              field={field}
              value={service.data[field.key]}
              serviceLabel={service.label}
              size="md"
              renderLinkedService={(_linkedId, linked) => <LinkedServiceValue linked={linked} />}
            />
          ))}
          {hiddenEmptyCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white"
              onClick={() => setShowEmptyFields((value) => !value)}
            >
              {showEmptyFields
                ? t("service_view.hide_empty")
                : t("service_view.show_empty", { count: hiddenEmptyCount })}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Email inbox */}
      {providerState === "checking" && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("service_view.email.checking")}
        </p>
      )}
      {providerState === "unsupported" && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4 flex items-start gap-3">
            <MailWarning className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-white font-medium">{t("service_view.email.unsupported_title")}</p>
              <p className="text-sm text-gray-400">
                {serviceType?.fields.some((field) => field.key === "imap_host")
                  ? t("service_view.email.unsupported_hint")
                  : t("service_view.email.unsupported_hint_add_fields", { type: serviceType?.name ?? "" })}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {providerState === "supported" && emailAccess && (
        <EmailViewer
          key={service.id}
          email={emailAccess.email}
          password={emailAccess.password}
          imapHost={emailAccess.imapHost}
          imapPort={emailAccess.imapPort}
          serviceLabel={service.label}
        />
      )}

      {/* Services that point to this one */}
      {usedByServices.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">{t("service_view.linked_services.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {usedByServices.map((linkedService) => {
              const linkedServiceType = findServiceType(vault?.serviceTypes, linkedService.serviceTypeId)
              return (
                <button
                  type="button"
                  key={linkedService.id}
                  className="w-full text-left flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
                  onClick={() => navigate(`/services/${linkedService.id}`)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 shrink-0 bg-gradient-to-br from-purple-600 to-pink-600 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold">{(linkedServiceType?.name || linkedService.label).charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-white font-medium truncate">{linkedService.label}</h3>
                      <p className="text-gray-400 text-sm">{linkedServiceType?.name ?? t("service_view.unknown_type")}</p>
                      {linkedService.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {linkedService.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Accounts */}
      {linkedAccounts.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">{t("service_view.linked_accounts.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {linkedAccounts.map((account) => (
              <button
                type="button"
                key={account.id}
                className="w-full text-left flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
                onClick={() => navigate(`/accounts/${account.id}`)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 shrink-0 bg-gradient-to-br from-green-600 to-blue-600 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold">{account.label.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-white font-medium truncate">{account.label}</h3>
                    {account.tags.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {account.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <CreateServiceModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        serviceToEdit={service}
      />

      <LinkServiceToAccountModal
        isOpen={isLinkToAccountModalOpen}
        onClose={() => setIsLinkToAccountModalOpen(false)}
        serviceId={service.id}
      />
    </div>
  )
}
