"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useVaultStore } from "../stores/vault-store";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface BulkLinkServicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceIdsToLink: string[];
  onLink: () => void;
}

export function BulkLinkServicesModal({ isOpen, onClose, serviceIdsToLink: serviceIds, onLink }: BulkLinkServicesModalProps) {
  const { t } = useTranslation();
  const { vault, linkServicesToAccount } = useVaultStore();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const accounts = vault?.accounts || [];

  const handleSubmit = async () => {
    if (!selectedAccountId) {
      toast.error(t('modals.bulk_link.errors.account_required'));
      return;
    }
    if (serviceIds.length === 0) {
      toast.error(t('modals.bulk_link.errors.no_services'));
      return;
    }

    try {
      await linkServicesToAccount(selectedAccountId, serviceIds);
      onLink();
      onClose();
    } catch (e) {
      // error is handled by the store
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{t('modals.bulk_link.title')}</DialogTitle>
          <DialogDescription>
            {t('modals.bulk_link.description', { count: serviceIds.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label htmlFor="account-select" className="text-sm font-medium">{t('modals.bulk_link.account_label')}</label>
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger id="account-select" className="bg-gray-700 border-gray-600">
                <SelectValue placeholder={t('modals.bulk_link.account_placeholder')} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-gray-600">{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} className="bg-gradient-to-r from-blue-600 to-purple-700">{t('modals.bulk_link.link_button')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
