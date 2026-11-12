"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountPicker } from "@/components/account-picker";
import { useVaultStore } from "../stores/vault-store";

interface LinkServiceToAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceId: string;
}

export function LinkServiceToAccountModal({ isOpen, onClose, serviceId }: LinkServiceToAccountModalProps) {
  const { t } = useTranslation();
  const vault = useVaultStore((s) => s.vault);
  const linkServicesToAccount = useVaultStore((s) => s.linkServicesToAccount);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fresh state every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setSelectedAccountId("");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const service = vault?.services.find((srv) => srv.id === serviceId);
  const accounts = vault?.accounts ?? [];
  const isLinked = (accountId: string) =>
    accounts.find((a) => a.id === accountId)?.linkedServices.includes(serviceId) ?? false;
  const availableCount = accounts.filter((a) => !a.linkedServices.includes(serviceId)).length;
  // The selection may have been deleted or linked meanwhile.
  const selectionValid = !!selectedAccountId && accounts.some((a) => a.id === selectedAccountId) && !isLinked(selectedAccountId);

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectionValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      // Success and error toasts come from the store / API layer.
      await linkServicesToAccount(selectedAccountId, [serviceId]);
      setSelectedAccountId("");
      onClose();
    } catch {
      // Keep the dialog open so the user can retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!service) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>{t('modals.link_service_to_account.title')}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {t('modals.link_service_to_account.description', { serviceName: service.label })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-300">{t('modals.link_service_to_account.account_label')}</div>
          {accounts.length === 0 || availableCount === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">
              {t('modals.link_service_to_account.no_available_accounts')}
            </p>
          ) : (
            <AccountPicker
              accounts={accounts}
              value={selectedAccountId}
              onChange={setSelectedAccountId}
              isDisabled={(account) => account.linkedServices.includes(serviceId)}
              renderNote={(account) =>
                account.linkedServices.includes(serviceId) ? (
                  <Badge variant="outline" className="shrink-0 text-xs border-gray-500 text-gray-300">
                    {t('modals.link_service_to_account.already_linked')}
                  </Badge>
                ) : null
              }
              label={t('modals.link_service_to_account.account_label')}
              searchPlaceholder={t('modals.link_service_to_account.search_placeholder')}
              emptyText={t('modals.link_service_to_account.no_accounts_found')}
              disabled={isSubmitting}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting} className="border-gray-600 text-gray-300">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectionValid || isSubmitting}
            className="bg-gradient-to-r from-blue-600 to-purple-700"
          >
            {isSubmitting ? t('modals.link_service_to_account.linking') : t('modals.link_service_to_account.link_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
