"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertCircle, Edit, ExternalLink, Link2 } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { FieldValueRow } from "@/components/field-value-row"
import { findServiceType } from "@/lib/service-helpers"
import type { Service } from "@/types"
import { CreateServiceModal } from "./create-service-modal"

interface LinkedServiceDetailProps {
  /** The linked service; undefined/null when the stored id points to a service that no longer exists. */
  service?: Service | null
  /** Shows an "Open" button that calls this (the caller navigates, applying its unsaved-changes guard). */
  onOpen?: (service: Service) => void
}

/**
 * Compact card for the service a `linked_service` field points to. Nested linked_service fields
 * are rendered by FieldValueRow as the target's label (never as a raw id, and never recursively).
 */
export function LinkedServiceDetail({ service, onOpen }: LinkedServiceDetailProps) {
  const { t } = useTranslation()
  const serviceTypes = useVaultStore((s) => s.vault?.serviceTypes)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  if (!service) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-gray-600/50 p-3 text-sm italic text-gray-500">
        <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
        {t("field_row.linked_missing")}
      </div>
    )
  }

  const serviceType = findServiceType(serviceTypes, service.serviceTypeId)
  // Filled fields, plus required ones that are empty (shown as missing).
  const fields = (serviceType?.fields ?? []).filter((field) => !!service.data[field.key] || field.required)
  const editLabel = t("components.linked_service.edit", { label: service.label })
  const openLabel = t("components.linked_service.open", { label: service.label })

  return (
    <>
      <Card className="bg-gray-700/50 border-gray-600/50 border-dashed mt-2">
        <CardContent className="p-3">
          <div className="flex justify-between items-center mb-2 gap-2">
            <div className="flex items-center gap-2 text-sm text-gray-400 min-w-0">
              <Link2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("components.linked_service.title", { label: service.label })}</span>
              {serviceType && <span className="text-xs text-gray-500 shrink-0">{serviceType.name}</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-white"
                  onClick={() => onOpen(service)}
                  aria-label={openLabel}
                  title={openLabel}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-white"
                onClick={() => setIsEditModalOpen(true)}
                aria-label={editLabel}
                title={editLabel}
              >
                <Edit className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {fields.length > 0 ? (
            <div className="space-y-2">
              {fields.map((field) => (
                <FieldValueRow
                  key={`${service.id}:${field.id}`}
                  field={field}
                  value={service.data[field.key]}
                  serviceLabel={service.label}
                  size="sm"
                />
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-gray-500">
              {serviceType ? t("components.linked_service.no_values") : t("components.linked_service.type_missing")}
            </p>
          )}
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
