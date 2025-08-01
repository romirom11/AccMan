"use client"

import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Edit, Trash2, Eye, EyeOff, Copy, Globe, ArrowLeft, KeyRound, RefreshCw } from "lucide-react"
import { useVaultStore } from "../stores/vault-store"
import { confirm } from "@tauri-apps/plugin-dialog"
import * as OTPAuth from "otpauth";
import { ServiceField } from "@/types"
import { CreateServiceModal } from "@/components/create-service-modal"
import { LinkedServiceDetail } from "@/components/linked-service-detail"

export default function ServiceView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation();
  const { vault, deleteService } = useVaultStore()
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [generatedTokens, setGeneratedTokens] = useState<Record<string, string | null>>({})
  const [expandedLinkedServices, setExpandedLinkedServices] = useState<Record<string, boolean>>({})
  
  const service = vault?.services.find((srv) => srv.id === id)
  const serviceType = service ? vault?.serviceTypes.find((type) => type.id === service.serviceTypeId) : null
  const allServices = vault?.services || []

  if (!service || !serviceType) {
    return (
      <div className="p-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="text-center py-12">
            <p className="text-gray-400">{t('service_view.not_found')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleDeleteService = async () => {
    const confirmed = await confirm(t('service_view.delete_confirm_message'), {
      title: t('service_view.delete_confirm_title')
    });
    if (confirmed) {
      await deleteService(service.id);
      navigate('/services');
    }
  }

  const handleEditService = () => {
    setIsEditModalOpen(true);
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }
  
  const renderFieldValue = (field: ServiceField, value: string) => {
    const isSecret = field.type === "secret" || field.masked;
    const isVisible = visibleSecrets[`${field.id}`]
    const displayValue = isSecret && !isVisible ? "••••••••" : value

    if (field.type === 'linked_service' && value) {
      const linkedService = allServices.find(s => s.id === value);
      if (linkedService) {
        return (
          <Button 
            variant="link"
            className="p-0 h-auto text-blue-400 hover:text-blue-300"
            onClick={() => setExpandedLinkedServices(prev => ({...prev, [field.id]: !prev[field.id]}))}
          >
            <Globe className="w-4 h-4 mr-2" />
            <span>{linkedService.label}</span>
          </Button>
        );
      }
    }

    return displayValue || <span className="text-gray-500 italic">{t('service_view.empty_field')}</span>;
  }

  const generateTotp = (fieldId: string, secret: string) => {
    try {
      const totp = new OTPAuth.TOTP({
        issuer: "AccMan",
        label: service.label,
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
          onClick={() => navigate('/services')}
          className="border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white">{service.label}</h1>
          <p className="text-gray-400">{serviceType.name}</p>
        </div>
      </div>

      {/* Service Header */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xl">{serviceType.name.charAt(0)}</span>
              </div>
              <div>
                <CardTitle className="text-3xl font-bold text-white mb-2">{service.label}</CardTitle>
                <p className="text-gray-400 text-lg">{serviceType.name}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {service.tags.map((tag) => (
                    <Badge key={tag} className="bg-blue-600 text-white">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="border-gray-600 text-gray-300 bg-transparent"
                onClick={handleEditService}
              >
                <Edit className="w-4 h-4 mr-2" />
                {t('common.edit')}
              </Button>
              <Button
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white bg-transparent"
                onClick={handleDeleteService}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Service Data */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white">{t('service_view.data.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {serviceType.fields.map((field) => {
            const value = service.data[field.key] || ""
            
            return (
              <div
                key={field.id}
                className="flex items-center justify-between p-4 bg-gray-700 rounded-lg"
              >
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-300 block mb-2">{field.label}</label>
                  <div className="text-white font-mono text-lg">
                    {generatedTokens[field.id] ? (
                      <div className="flex items-center gap-4">
                        <span className="tracking-widest text-2xl text-green-400">{generatedTokens[field.id]}</span>
                      </div>
                    ) : (
                      renderFieldValue(field, value)
                    )}
                  </div>
                  {field.type === 'linked_service' && value && expandedLinkedServices[field.id] && (
                    <div className="mt-2">
                      <LinkedServiceDetail service={allServices.find(s => s.id === value)!} />
                    </div>
                  )}
                  {field.required && !value && (
                    <p className="text-red-400 text-xs mt-1">{t('service_view.required_field')}</p>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  {(field.type === "secret" || field.masked) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleSecretVisibility(field.id)}
                      className="text-gray-400 hover:text-white"
                    >
                      {visibleSecrets[field.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  )}
                  {value && field.type !== 'linked_service' && (
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
                      onClick={() => generateTotp(field.id, value)}
                      className="text-gray-400 hover:text-white"
                    >
                      {generatedTokens[field.id] ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Linked Accounts */}
      {vault?.accounts.some(account => account.linkedServices.includes(service.id)) && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">{t('service_view.linked_accounts.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vault.accounts
              .filter(account => account.linkedServices.includes(service.id))
              .map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-650 transition-colors cursor-pointer"
                  onClick={() => navigate(`/accounts/${account.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-blue-600 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold">{account.label.charAt(0)}</span>
                    </div>
                    <div>
                      <h3 className="text-white font-medium">{account.label}</h3>
                      <div className="flex gap-1 mt-1">
                        {account.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            }
          </CardContent>
        </Card>
      )}

      <CreateServiceModal 
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        serviceToEdit={service}
      />
    </div>
  )
}