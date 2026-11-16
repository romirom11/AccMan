"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountPicker } from "@/components/account-picker";
import { useVaultStore } from "../stores/vault-store";
import type { Account } from "@/types";

interface BulkLinkServicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceIdsToLink: string[];
  onLink: () => void;
}

export function BulkLinkServicesModal({ isOpen, onClose, serviceIdsToLink, onLink }: BulkLinkServicesModalProps) {
  const { t } = useTranslation();
  const vault = useVaultStore((s) => s.vault);
  const linkServicesToAccount = useVaultStore((s) => s.linkServicesToAccount);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fresh state every time the dialog opens: never pre-select the previous account.
  useEffect(() => {
    if (isOpen) {
      setSelectedAccountId("");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const accounts = vault?.accounts ?? [];
  // Only services that still exist.
  const serviceIds = serviceIdsToLink.filter((id) => vault?.services.some((s) => s.id === id));
  const alreadyLinkedCount = (account: Account) => serviceIds.filter((id) => account.linkedServices.includes(id)).length;

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const toLink = selectedAccount ? serviceIds.filter((id) => !selectedAccount.linkedServices.includes(id)) : [];
  const canSubmit = !!selectedAccount && toLink.length > 0 && !isSubmitting;

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedAccount || toLink.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      // Success and error toasts come from the store / API layer.
      await linkServicesToAccount(selectedAccount.id, toLink);
      setSelectedAccountId("");
      onLink();
      onClose();
    } catch {
      // Keep the dialog open so the user can retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{t('modals.bulk_link.title')}</DialogTitle>
          <DialogDescription>
            {t('modals.bulk_link.description', { count: serviceIds.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <div className="text-sm font-medium">{t('modals.bulk_link.account_label')}</div>
          {accounts.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">{t('modals.bulk_link.no_accounts')}</p>
          ) : (
            <AccountPicker
              accounts={accounts}
              value={selectedAccountId}
              onChange={setSelectedAccountId}
              isDisabled={(account) => serviceIds.length > 0 && alreadyLinkedCount(account) === serviceIds.length}
              renderNote={(account) => {
                const linked = alreadyLinkedCount(account);
                if (linked === 0) return null;
                return (
                  <Badge variant="outline" className="shrink-0 text-xs border-gray-500 text-gray-300">
                    {linked === serviceIds.length
                      ? t('modals.bulk_link.all_already_linked')
                      : t('modals.bulk_link.some_already_linked', { count: linked })}
                  </Badge>
                );
              }}
              label={t('modals.bulk_link.account_label')}
              searchPlaceholder={t('modals.bulk_link.search_placeholder')}
              emptyText={t('modals.bulk_link.no_accounts_found')}
              disabled={isSubmitting}
            />
          )}
          {selectedAccount && toLink.length < serviceIds.length && toLink.length > 0 && (
            <p className="text-xs text-gray-400">{t('modals.bulk_link.will_link', { count: toLink.length })}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting} className="border-gray-600">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="bg-gradient-to-r from-blue-600 to-purple-700">
            {isSubmitting ? t('modals.bulk_link.linking') : t('modals.bulk_link.link_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
