import { useMemo, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Edit, Trash2, ChevronDown, ChevronRight, Link, Save, Unlink, ArrowLeft, Plus, Pin, PinOff, X, ExternalLink } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { LinkNewServicesModal } from "@/components/link-new-services-modal"
import { CreateAccountModal } from "@/components/create-account-modal"
import { CreateServiceModal } from "@/components/create-service-modal"
import { LinkedServiceDetail } from "@/components/linked-service-detail"
import { FieldValueRow } from "@/components/field-value-row"
import { findServiceType, getServiceTitle } from "@/lib/service-helpers"
import { currentLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import { confirmLeave, useUnsavedGuard } from "@/lib/unsaved-guard"
import { confirm } from "@tauri-apps/plugin-dialog"
import type { Service } from "@/types"

function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat(currentLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms))
}

// The route renders this page keyed by :id, so all local state belongs to one account.
export default function AccountView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const vault = useVaultStore((s) => s.vault)
  const updateAccount = useVaultStore((s) => s.updateAccount)
  const deleteAccount = useVaultStore((s) => s.deleteAccount)
  const unlinkServicesFromAccount = useVaultStore((s) => s.unlinkServicesFromAccount)
  const setPinned = useVaultStore((s) => s.setPinned)

  const account = vault?.accounts.find((acc) => acc.id === id)

  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [busy, setBusy] = useState<null | "delete" | "pin" | `unlink:${string}`>(null)
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isCreateServiceModalOpen, setIsCreateServiceModalOpen] = useState(false)
  const [serviceToEdit, setServiceToEdit] = useState<Service | null>(null)
  const [openServices, setOpenServices] = useState<Record<string, boolean>>({})

  const notesDirty = editingNotes && !!account && notesDraft !== account.notes
  // Leaving the page (sidebar, command palette, the buttons below) or cancelling asks first.
  useUnsavedGuard(notesDirty, t('account_view.notes.discard_confirm'))

  // In the account's link order; ids of services that no longer exist are skipped.
  const linkedServices = useMemo(() => {
    if (!account || !vault) return []
    const byId = new Map(vault.services.map((s) => [s.id, s]))
    return account.linkedServices.map((sid) => byId.get(sid)).filter((s): s is Service => !!s)
  }, [account, vault])

  if (!account) {
    return (
      <div className="p-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="text-center py-12">
            <p className="text-gray-400">{t('account_view.not_found')}</p>
            <Button variant="outline" className="mt-4 border-gray-600 text-gray-300" onClick={() => navigate('/accounts')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('account_view.back_to_accounts')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const startEditingNotes = () => {
    // Seed from the current account every time, never from an earlier draft.
    setNotesDraft(account.notes)
    setEditingNotes(true)
  }

  const cancelEditingNotes = async () => {
    if (savingNotes) return
    if (notesDirty && !(await confirmLeave())) return
    setEditingNotes(false)
    setNotesDraft("")
  }

  const navigateAway = async (to: string) => {
    if (await confirmLeave()) navigate(to)
  }

  const handleSaveNotes = async () => {
    if (savingNotes) return
    if (notesDraft === account.notes) {
      setEditingNotes(false)
      return
    }
    setSavingNotes(true)
    try {
      // The store fills in pinned/timestamps and the backend sanitises linkedServices.
      await updateAccount({ ...account, notes: notesDraft })
      setEditingNotes(false)
    } catch {
      // Error toast shown by the API layer; keep the editor open with the draft.
    } finally {
      setSavingNotes(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (busy) return
    const confirmed = await confirm(t('accounts.delete_confirm.message'), { title: t('accounts.delete_confirm.title'), kind: 'warning' })
    if (!confirmed) return
    setBusy("delete")
    try {
      await deleteAccount(account.id)
      navigate('/accounts')
    } catch {
      // Error toast shown by the API layer.
    } finally {
      setBusy(null)
    }
  }

  const handleTogglePin = async () => {
    if (busy) return
    setBusy("pin")
    try {
      await setPinned("account", account.id, !account.pinned)
    } catch {
      // Error toast shown by the API layer.
    } finally {
      setBusy(null)
    }
  }

  const handleUnlinkService = async (service: Service) => {
    if (busy) return
    const confirmed = await confirm(t('account_view.unlink_confirm_message_named', { service: service.label }), {
      title: t('account_view.unlink_confirm_title'),
    })
    if (!confirmed) return
    setBusy(`unlink:${service.id}`)
    try {
      await unlinkServicesFromAccount(account.id, [service.id])
    } catch {
      // Error toast shown by the API layer.
    } finally {
      setBusy(null)
    }
  }

  const toggleServiceOpen = (serviceId: string, open: boolean) => {
    setOpenServices((prev) => ({ ...prev, [serviceId]: open }))
  }

  const allOpen = linkedServices.length > 0 && linkedServices.every((s) => openServices[s.id])
  const setAllOpen = (open: boolean) => {
    setOpenServices(Object.fromEntries(linkedServices.map((s) => [s.id, open])))
  }

  const pinLabel = account.pinned ? t('accounts.pin.unpin') : t('accounts.pin.pin')

  return (
    <div className="p-6 space-y-6">
      {/* Header: back, label, tags, actions */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <Button
                variant="outline"
                size="icon"
                onClick={() => void navigateAway('/accounts')}
                aria-label={t('account_view.back_to_accounts')}
                title={t('account_view.back_to_accounts')}
                className="shrink-0 border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {account.pinned && <Pin className="w-5 h-5 text-yellow-400 shrink-0 fill-yellow-400/30" aria-label={t('accounts.pin.pinned')} />}
                  <CardTitle className="text-3xl font-bold text-white break-words">{account.label}</CardTitle>
                </div>
                {account.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {account.tags.map((tag) => (
                      <Badge key={tag} className="bg-blue-600 text-white">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {(account.createdAt > 0 || account.updatedAt > 0) && (
                  <p className="text-xs text-gray-500 mt-2">
                    {account.createdAt > 0 && t('account_view.created_at', { date: formatTimestamp(account.createdAt) })}
                    {account.createdAt > 0 && account.updatedAt > 0 && " · "}
                    {account.updatedAt > 0 && t('account_view.updated_at', { date: formatTimestamp(account.updatedAt) })}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="icon"
                className={cn("border-gray-600 bg-transparent", account.pinned ? "text-yellow-400" : "text-gray-300")}
                onClick={handleTogglePin}
                disabled={busy === "pin"}
                aria-pressed={account.pinned}
                aria-label={pinLabel}
                title={pinLabel}
              >
                {account.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </Button>
              <Button
                variant="outline"
                className="border-gray-600 text-gray-300 bg-transparent"
                onClick={() => setIsEditModalOpen(true)}
              >
                <Edit className="w-4 h-4 mr-2" />
                {t('common.edit')}
              </Button>
              <Button
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white bg-transparent"
                onClick={handleDeleteAccount}
                disabled={busy === "delete"}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Notes Section */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">{t('account_view.notes.title')}</CardTitle>
            {editingNotes ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void cancelEditingNotes()} disabled={savingNotes} className="border-gray-600 text-gray-300">
                  <X className="w-4 h-4 mr-2" />
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="bg-gradient-to-r from-blue-600 to-purple-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {savingNotes ? t('account_view.notes.saving') : t('common.save')}
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={startEditingNotes} className="border-gray-600 text-gray-300">
                <Edit className="w-4 h-4 mr-2" />
                {t('common.edit')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editingNotes ? (
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onKeyDown={(e) => {
                // Keys that confirm or cancel an IME composition belong to the IME.
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === "Escape") {
                  e.preventDefault()
                  void cancelEditingNotes()
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void handleSaveNotes()
                }
              }}
              placeholder={t('account_view.notes.placeholder')}
              aria-label={t('account_view.notes.title')}
              disabled={savingNotes}
              autoFocus
              className="bg-gray-700 border-gray-600 text-white min-h-32"
            />
          ) : (
            <div className="text-gray-300 whitespace-pre-wrap [overflow-wrap:anywhere] min-h-[50px]">
              {account.notes || <span className="text-gray-500 italic">{t('account_view.notes.no_notes')}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Services */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-white">{t('account_view.services.title', { count: linkedServices.length })}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {linkedServices.length > 1 && (
                <Button variant="ghost" className="text-gray-300 hover:text-white" onClick={() => setAllOpen(!allOpen)}>
                  {allOpen ? t('account_view.services.collapse_all') : t('account_view.services.expand_all')}
                </Button>
              )}
              <Button
                variant="outline"
                className="border-gray-600 text-gray-300 bg-transparent"
                onClick={() => setIsCreateServiceModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('dashboard.quick_actions.create_service')}
              </Button>
              <Button className="bg-gradient-to-r from-blue-600 to-purple-700" onClick={() => setIsLinkModalOpen(true)}>
                <Link className="w-4 h-4 mr-2" />
                {t('account_view.services.link_button')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {linkedServices.length > 0 ? (
            linkedServices.map((service) => {
              const serviceType = findServiceType(vault?.serviceTypes, service.serviceTypeId)
              const isOpen = !!openServices[service.id]
              const title = getServiceTitle(service, serviceType)
              // Filled fields, plus required ones that are empty (shown as missing).
              const fields = (serviceType?.fields ?? []).filter((field) => !!service.data[field.key] || field.required)

              return (
                <Collapsible key={service.id} open={isOpen} onOpenChange={(open) => toggleServiceOpen(service.id, open)}>
                  <div className="flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-700 p-3 hover:bg-gray-650 transition-colors">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex flex-1 min-w-0 items-center gap-3 text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
                        )}
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center shrink-0">
                          <span className="text-white font-bold" aria-hidden="true">{serviceType?.name.charAt(0) || "S"}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {service.pinned && <Pin className="w-3.5 h-3.5 text-yellow-400 shrink-0" aria-label={t('accounts.pin.pinned')} />}
                            <h3 className="text-white font-medium truncate">{title}</h3>
                          </div>
                          <p className="text-gray-400 text-sm truncate">{serviceType?.name ?? t('account_view.services.unknown_type')}</p>
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-gray-400 hover:text-white"
                        onClick={() => void navigateAway(`/services/${service.id}`)}
                        aria-label={t('account_view.services.open', { service: title })}
                        title={t('account_view.services.open', { service: title })}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-gray-400 hover:text-blue-400"
                        onClick={() => setServiceToEdit(service)}
                        aria-label={t('account_view.services.edit', { service: title })}
                        title={t('account_view.services.edit', { service: title })}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-gray-400 hover:text-red-400"
                        onClick={() => handleUnlinkService(service)}
                        disabled={busy === `unlink:${service.id}`}
                        aria-label={t('account_view.services.unlink', { service: title })}
                        title={t('account_view.services.unlink', { service: title })}
                      >
                        <Unlink className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <CollapsibleContent>
                    <Card className="bg-gray-750 border-gray-600 mt-2">
                      <CardContent className="pt-4">
                        {fields.length > 0 ? (
                          <div className="space-y-3">
                            {fields.map((field) => (
                              <FieldValueRow
                                key={`${service.id}:${field.id}`}
                                field={field}
                                value={service.data[field.key]}
                                serviceLabel={title}
                                size="md"
                                renderLinkedService={(_linkedId, linked) => <LinkedServiceDetail service={linked} />}
                              />
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm italic text-gray-500">{t('account_view.services.no_values')}</p>
                        )}
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              )
            })
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Link className="w-12 h-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
              <p className="text-lg mb-2">{t('account_view.services.no_services')}</p>
              <p className="text-sm">{t('account_view.services.no_services_description')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <LinkNewServicesModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        accountId={account.id}
      />
      <CreateAccountModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        accountToEdit={account}
      />
      {/* Toasts for these come from the store (service_added_and_linked / service_updated). */}
      <CreateServiceModal
        isOpen={isCreateServiceModalOpen}
        onClose={() => setIsCreateServiceModalOpen(false)}
        accountId={account.id}
      />
      <CreateServiceModal
        isOpen={serviceToEdit !== null}
        onClose={() => setServiceToEdit(null)}
        serviceToEdit={serviceToEdit}
      />
    </div>
  )
}
