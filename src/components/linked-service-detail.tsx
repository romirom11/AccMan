"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Copy, Edit, Link2 } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { Service, ServiceField } from "@/types"
import { CreateServiceModal } from "./create-service-modal"

interface LinkedServiceDetailProps {
  service: Service
}

export function LinkedServiceDetail({ service }: LinkedServiceDetailProps) {
  const { vault } = useVaultStore()
  const { t } = useTranslation();
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const serviceType = vault?.serviceTypes.find((st) => st.id === service.serviceTypeId)

  const toggleSecretVisibility = (fieldKey: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }))
    if (!visibleSecrets[fieldKey]) {
      setTimeout(() => {
        setVisibleSecrets((prev) => ({ ...prev, [fieldKey]: false }))
      }, 15000)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const renderFieldValue = (field: ServiceField, value: string) => {
    const isSecret = field.type === "secret" || field.masked
    const isVisible = visibleSecrets[field.key]
    return isSecret && !isVisible ? "••••••••" : value
  }

  if (!serviceType) return null

  return (
    <>
      <Card className="bg-gray-700/50 border-gray-600/50 border-dashed mt-2">
        <CardContent className="p-3">
          <div className="flex justify-between items-center mb-2">
             <div className="flex items-center gap-2 text-sm text-gray-400">
                <Link2 className="w-4 h-4" />
                <span>{t('components.linked_service.title', { label: service.label })}</span>
             </div>
             <Button
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-white"
                onClick={() => setIsEditModalOpen(true)}
              >
                <Edit className="w-4 h-4" />
              </Button>
          </div>
          <div className="space-y-2">
            {serviceType.fields.map((field) => {
              const value = service.data[field.key] || ""
              if (!value) return null;
              const isSecret = field.type === "secret" || field.masked

              return (
                <div key={field.id} className="flex items-center justify-between p-2 bg-gray-600/50 rounded-md">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-400 block">{field.label}</label>
                    <div className="text-white font-mono text-sm">
                        {renderFieldValue(field, value)}
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2">
                    {isSecret && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleSecretVisibility(field.key)}
                        className="text-gray-400 hover:text-white h-7 w-7"
                      >
                        {visibleSecrets[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copyToClipboard(value)}
                      className="text-gray-400 hover:text-white h-7 w-7"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
       <CreateServiceModal 
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        serviceToEdit={service}
      />
    </>
  )
}
