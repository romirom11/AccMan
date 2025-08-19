"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useVaultStore } from "../stores/vault-store";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface LinkServiceToAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceId: string;
}

export function LinkServiceToAccountModal({ isOpen, onClose, serviceId }: LinkServiceToAccountModalProps) {
  const { t } = useTranslation();
  const { vault, linkServicesToAccount } = useVaultStore();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [open, setOpen] = useState(false);

  const service = vault?.services.find(srv => srv.id === serviceId);
  const availableAccounts = vault?.accounts.filter(account => !account.linkedServices.includes(serviceId)) || [];

  const handleSubmit = async () => {
    if (!selectedAccountId) {
      toast.error(t('modals.link_service_to_account.errors.account_required'));
      return;
    }

    try {
      await linkServicesToAccount(selectedAccountId, [serviceId]);
      toast.success(t('modals.link_service_to_account.success'));
      onClose();
    } catch (error) {
      console.error('Error linking service to account:', error);
      toast.error(t('modals.link_service_to_account.errors.link_failed'));
    }
  };

  const handleClose = () => {
    setSelectedAccountId("");
    setOpen(false);
    onClose();
  };

  const selectedAccount = availableAccounts.find(account => account.id === selectedAccountId);

  if (!service) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>{t('modals.link_service_to_account.title')}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {t('modals.link_service_to_account.description', { serviceName: service.label })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Account Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              {t('modals.link_service_to_account.account_label')}
            </label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full justify-between bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                >
                  {selectedAccount
                    ? selectedAccount.label
                    : t('modals.link_service_to_account.account_placeholder')}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0 bg-gray-700 border-gray-600">
                <Command className="bg-gray-700">
                  <CommandInput 
                    placeholder={t('modals.link_service_to_account.search_placeholder')} 
                    className="bg-gray-700 text-white border-gray-600"
                  />
                  <CommandList>
                    <CommandEmpty className="text-gray-400 py-6 text-center text-sm">
                      {t('modals.link_service_to_account.no_accounts_found')}
                    </CommandEmpty>
                    <CommandGroup>
                      <ScrollArea className="max-h-48">
                        {availableAccounts.map((account) => (
                          <CommandItem
                            key={account.id}
                            value={account.label}
                            onSelect={() => {
                              setSelectedAccountId(account.id === selectedAccountId ? "" : account.id);
                              setOpen(false);
                            }}
                            className="text-white hover:bg-gray-600 cursor-pointer"
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedAccountId === account.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex items-center justify-between w-full">
                              <div>
                                <div className="font-medium">{account.label}</div>
                                <div className="flex gap-1 mt-1">
                                  {account.tags.slice(0, 2).map((tag) => (
                                    <Badge key={tag} variant="secondary" className="text-xs">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </ScrollArea>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {availableAccounts.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-4">
              {t('modals.link_service_to_account.no_available_accounts')}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="border-gray-600 text-gray-300">
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!selectedAccountId}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {t('modals.link_service_to_account.link_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}