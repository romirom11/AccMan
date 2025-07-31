"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useVaultStore } from "../stores/vault-store";
import type { Account } from "../types";
import { toast } from "sonner";

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountToEdit?: Account | null;
}

export function CreateAccountModal({ isOpen, onClose, accountToEdit }: CreateAccountModalProps) {
  const { t } = useTranslation();
  const { addAccount, updateAccount } = useVaultStore();
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (accountToEdit) {
      setLabel(accountToEdit.label);
      setNotes(accountToEdit.notes);
      setTags(accountToEdit.tags.join(", "));
    } else {
      setLabel("");
      setNotes("");
      setTags("");
    }
  }, [accountToEdit, isOpen]);

  const handleSubmit = async () => {
    if (!label) {
      toast.error(t('modals.create_account.errors.label_required'));
      return;
    }

    const newAccount: Omit<Account, 'id' | 'linkedServices'> = {
      label,
      notes,
      tags: tags.split(",").map(tag => tag.trim()).filter(Boolean),
    };

    try {
      if (accountToEdit) {
        await updateAccount({ ...accountToEdit, ...newAccount });
      } else {
        const accountWithId: Account = {
            ...newAccount,
            id: crypto.randomUUID(),
            linkedServices: []
        };
        await addAccount(accountWithId);
      }
      onClose();
    } catch (e) {
      // error is handled by the store
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{accountToEdit ? t('modals.create_account.edit_title') : t('modals.create_account.create_title')}</DialogTitle>
          <DialogDescription>
            {accountToEdit ? t('modals.create_account.edit_description') : t('modals.create_account.create_description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="account-label">{t('modals.create_account.label')}</Label>
            <Input id="account-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('modals.create_account.label_placeholder')} className="bg-gray-700 border-gray-600" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-notes">{t('modals.create_account.notes')}</Label>
            <Textarea id="account-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('modals.create_account.notes_placeholder')} className="bg-gray-700 border-gray-600 min-h-[100px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-tags">{t('modals.create_account.tags')}</Label>
            <Input id="account-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('modals.create_account.tags_placeholder')} className="bg-gray-700 border-gray-600" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-gray-600">{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} className="bg-gradient-to-r from-blue-600 to-purple-700">{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
