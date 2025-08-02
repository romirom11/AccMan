"use client"

import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Edit, Trash2, ChevronDown, ChevronRight, Eye, EyeOff, Copy, Link, Save, Unlink, ArrowLeft, KeyRound, RefreshCw } from "lucide-react"
import { useVaultStore } from "../stores/vault-store"
import { LinkNewServicesModal } from "@/components/link-new-services-modal"
import { CreateAccountModal } from "@/components/create-account-modal"
import { confirm } from "@tauri-apps/plugin-dialog"
import { LinkedServiceDetail } from "@/components/linked-service-detail"
import * as OTPAuth from "otpauth";
import { ServiceField } from "@/types"

export default function AccountView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation();
  const { vault, updateAccount, deleteAccount } = useVaultStore()
  const [editingNotes, setEditingNotes] = useState(false)
  
  const account = vault?.accounts.find((acc) => acc.id === id)
  const [notes, setNotes] = useState(account?.notes || "")
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})
  const [openServices, setOpenServices] = useState<Record<string, boolean>>({})
  const [generatedTokens, setGeneratedTokens] = useState<Record<string, string | null>>({})

  const linkedServices = vault?.services.filter((service) => account?.linkedServices.includes(service.id)) || []
  const allServices = vault?.services || [];

  if (!account) {
    return (
      <div className="p-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="text-center py-12">
            <p className="text-gray-400">{t('account_view.not_found')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleSaveNotes = async () => {
    if (!account) return;
    await updateAccount({ ...account, notes });
    setEditingNotes(false);
  }

  const handleEditAccount = () => {
    setIsEditModalOpen(true);
  }

  const handleDeleteAccount = async () => {
    if (!account) return;
    const confirmed = await confirm(t('accounts.delete_confirm.message'), { title: t('accounts.delete_confirm.title') });
    if (confirmed) {
      await deleteAccount(account.id);
      navigate('/accounts');
    }
  }

  const handleUnlinkService = async (serviceId: string) => {
    if(!account) return;
    const confirmed = await confirm(t('account_view.unlink_confirm_message'), { title: t('account_view.unlink_confirm_title') });
    if(confirmed) {
        const updatedLinkedServices = account.linkedServices.filter(id => id !== serviceId);
        await updateAccount({ ...account, linkedServices: updatedLinkedServices });
    }
  }

  const getServiceType = (serviceTypeId: string) => {
    return vault?.serviceTypes.find((type) => type.id === serviceTypeId)
  }

  const toggleSecretVisibility = (fieldKey: string) => {
    setVisibleSecrets((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey],
    }))

    if (!visibleSecrets[fieldKey]) {
      setTimeout(() => {
        setVisibleSecrets((prev) => ({
          ...prev,
          [fieldKey]: false,
        }))
      }, 15000)
    }
  }

  const toggleServiceOpen = (serviceId: string) => {
    setOpenServices((prev) => ({
      ...prev,
      [serviceId]: !prev[serviceId],
    }))
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }
  
  const renderFieldValue = (field: ServiceField, value: string) => {
    const isSecret = field.type === "secret" || field.masked;
    const isVisible = visibleSecrets[`${field.id}`]
    const displayValue = isSecret && !isVisible ? "••••••••" : value

    return displayValue || <span className="text-gray-500 italic">{t('account_view.empty_field')}</span>;
  }

  const generateTotp = (fieldId: string, secret: string, label: string) => {
    try {
      const totp = new OTPAuth.TOTP({
        issuer: "AccMan",
        label: label,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: secret,
      });
      const token = totp.generate();
      setGeneratedTokens(prev => ({ ...prev, [fieldId]: token }));

      setTimeout(() => {
        setGeneratedTokens(prev => ({ ...prev, [fieldId]: null }));
      }, 30000);

    } catch (error) {
      console.error("Error generating TOTP:", error);
      setGeneratedTokens(prev => ({ ...prev, [fieldId]: "Error" }));
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back Button */}
      <div className="flex items-center gap-4">
        <Button 
          variant="outline" 
          size="icon" 
          onClick={() => navigate('/accounts')}
          className="border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white">{account.label}</h1>
          <div className="flex flex-wrap gap-2 mt-1">
            {account.tags.map((tag) => (
              <Badge key={tag} className="bg-blue-600 text-white text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Account Header */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-3xl font-bold text-white mb-2">{account.label}</CardTitle>
              <div className="flex flex-wrap gap-2">
                {account.tags.map((tag) => (
                  <Badge key={tag} className="bg-blue-600 text-white">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="border-gray-600 text-gray-300 bg-transparent"
                onClick={handleEditAccount}
              >
                <Edit className="w-4 h-4 mr-2" />
                {t('common.edit')}
              </Button>
              <Button
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white bg-transparent"
                onClick={handleDeleteAccount}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if(editingNotes) {
                    handleSaveNotes();
                } else {
                    setEditingNotes(true)
                }
              }}
              className="border-gray-600 text-gray-300"
            >
              {editingNotes ? <Save className="w-4 h-4 mr-2" /> : <Edit className="w-4 h-4 mr-2" />}
              {editingNotes ? t('common.save') : t('common.edit')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {editingNotes ? (
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('account_view.notes.placeholder')}
              className="bg-gray-700 border-gray-600 text-white min-h-32"
            />
          ) : (
            <div className="text-gray-300 whitespace-pre-wrap min-h-[50px]">
              {account.notes || <span className="text-gray-500 italic">{t('account_view.notes.no_notes')}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Services */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">{t('account_view.services.title', { count: linkedServices.length })}</CardTitle>
            <Button className="bg-gradient-to-r from-blue-600 to-purple-700" onClick={() => setIsLinkModalOpen(true)}>
              <Link className="w-4 h-4 mr-2" />
              {t('account_view.services.link_button')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {linkedServices.length > 0 ? (
            linkedServices.map((service) => {
              const serviceType = getServiceType(service.serviceTypeId)
              const isOpen = openServices[service.id]

              return (
                <Collapsible key={service.id} open={isOpen} onOpenChange={() => toggleServiceOpen(service.id)}>
                  <CollapsibleTrigger asChild>
                    <Card className="bg-gray-700 border-gray-600 cursor-pointer hover:bg-gray-650 transition-colors">
                      <CardHeader className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center">
                              <span className="text-white font-bold">{serviceType?.name.charAt(0) || "S"}</span>
                            </div>
                            <div>
                              <h3 className="text-white font-medium">{service.label}</h3>
                              <p className="text-gray-400 text-sm">{serviceType?.name}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="ghost" className="text-gray-400 hover:text-red-400" onClick={(e) => { e.stopPropagation(); handleUnlinkService(service.id); }}>
                                <Unlink className="w-4 h-4" />
                            </Button>
                            {isOpen ? (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Card className="bg-gray-750 border-gray-600 mt-2">
                      <CardContent className="pt-4">
                        <div className="space-y-4">
                          {serviceType?.fields.map((field) => {
                            const value = service.data[field.key] || ""
                            
                            if (field.type === 'linked_service') {
                                const linkedService = allServices.find(s => s.id === value);
                                return linkedService ? (
                                  <div className="p-3" key={field.id}>
                                      <label className="text-sm font-medium text-gray-300 block mb-1">{field.label}</label>
                                      <LinkedServiceDetail service={linkedService} />
                                  </div>
                                ) : null;
                            }

                            return (
                              <div
                                key={field.id}
                                className="flex items-center justify-between p-3 bg-gray-700 rounded-lg"
                              >
                                <div className="flex-1">
                                  <label className="text-sm font-medium text-gray-300 block mb-1">{field.label}</label>
                                  <div className="text-white font-mono">
                                    {generatedTokens[field.id] ? (
                                      <div className="flex items-center gap-2">
                                        <span className="tracking-widest text-lg text-green-400">{generatedTokens[field.id]}</span>
                                      </div>
                                    ) : (
                                      renderFieldValue(field, value)
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2 ml-4">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => toggleSecretVisibility(field.id)}
                                    className="text-gray-400 hover:text-white"
                                  >
                                    {visibleSecrets[field.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </Button>
                                  {value && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => copyToClipboard(value)}
                                      className="text-gray-400 hover:text-white"
                                    >
                                      <Copy className="w-4 h-4" />
                                    </Button>
                                  )}
                                  {field.type === '2fa' && value && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => generateTotp(field.id, value, service.label)}
                                      className="text-gray-400 hover:text-white"
                                    >
                                      {generatedTokens[field.id] ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              )
            })
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Link className="w-12 h-12 mx-auto mb-4 opacity-50" />
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
    </div>
  )
}
