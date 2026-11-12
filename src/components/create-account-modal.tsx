"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useVaultStore } from "../stores/vault-store";
import type { Account, AccountInput } from "../types";

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountToEdit?: Account | null;
}

/** "a, b,, a , c" -> ["a", "b", "c"] */
function parseTags(raw: string): string[] {
  return Array.from(new Set(raw.split(",").map((tag) => tag.trim()).filter(Boolean)));
}

export function CreateAccountModal({ isOpen, onClose, accountToEdit }: CreateAccountModalProps) {
  const { t } = useTranslation();
  const addAccount = useVaultStore((s) => s.addAccount);
  const updateAccount = useVaultStore((s) => s.updateAccount);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [labelError, setLabelError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const editingId = accountToEdit?.id ?? null;

  // Seed the form only when the dialog opens (or switches to another account), so later store
  // updates of the same account do not overwrite what the user is typing.
  useEffect(() => {
    if (!isOpen) return;
    setLabel(accountToEdit?.label ?? "");
    setNotes(accountToEdit?.notes ?? "");
    setTags(accountToEdit?.tags.join(", ") ?? "");
    setLabelError(false);
    setIsSubmitting(false);
  }, [isOpen, editingId]);

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setLabelError(true);
      return;
    }

    const fields = { label: trimmedLabel, notes, tags: parseTags(tags) };
    setIsSubmitting(true);
    try {
      // Success and error toasts come from the store / API layer.
      if (editingId) {
        // Start from the current store copy so links changed meanwhile are not overwritten.
        const current = useVaultStore.getState().vault?.accounts.find((a) => a.id === editingId) ?? accountToEdit!;
        await updateAccount({ ...current, ...fields });
      } else {
        const account: AccountInput = { ...fields, id: crypto.randomUUID(), linkedServices: [] };
        await addAccount(account);
      }
      onClose();
    } catch {
      // Keep the dialog open so the user can retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{accountToEdit ? t('modals.create_account.edit_title') : t('modals.create_account.create_title')}</DialogTitle>
          <DialogDescription>
            {accountToEdit ? t('modals.create_account.edit_description') : t('modals.create_account.create_description')}
          </DialogDescription>
        </DialogHeader>
        <form
          id="account-form"
          className="grid gap-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="account-label">{t('modals.create_account.label')}</Label>
            <Input
              id="account-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (labelError && e.target.value.trim()) setLabelError(false);
              }}
              placeholder={t('modals.create_account.label_placeholder')}
              aria-invalid={labelError}
              aria-describedby={labelError ? "account-label-error" : undefined}
              disabled={isSubmitting}
              className="bg-gray-700 border-gray-600"
            />
            {labelError && (
              <p id="account-label-error" role="alert" className="text-sm text-red-400">
                {t('modals.create_account.errors.label_required')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-notes">{t('modals.create_account.notes')}</Label>
            <Textarea id="account-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('modals.create_account.notes_placeholder')} disabled={isSubmitting} className="bg-gray-700 border-gray-600 min-h-[100px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-tags">{t('modals.create_account.tags')}</Label>
            <Input id="account-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('modals.create_account.tags_placeholder')} disabled={isSubmitting} className="bg-gray-700 border-gray-600" />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting} className="border-gray-600">{t('common.cancel')}</Button>
          <Button type="submit" form="account-form" disabled={isSubmitting} className="bg-gradient-to-r from-blue-600 to-purple-700">
            {isSubmitting ? t('modals.create_account.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
