"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useVaultStore } from "../stores/vault-store";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface LinkNewServicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

export function LinkNewServicesModal({ isOpen, onClose, accountId }: LinkNewServicesModalProps) {
  const { t } = useTranslation();
  const { vault, linkServicesToAccount } = useVaultStore();
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const account = vault?.accounts.find(acc => acc.id === accountId);
  const unlinkedServices = vault?.services.filter(service => !account?.linkedServices.includes(service.id)) || [];

  const filteredServices = unlinkedServices.filter(service => 
    service.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
    service.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const toggleSelection = (serviceId: string) => {
    setSelectedServiceIds(prev => prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]);
  }

  const handleSubmit = async () => {
    if (selectedServiceIds.length === 0) {
      toast.error(t('modals.link_new.errors.no_services'));
      return;
    }

    try {
      await linkServicesToAccount(accountId, selectedServiceIds);
      onClose();
    } catch (e) {
      // error is handled by the store
    }
  };

  // Reset state on close
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedServiceIds([]);
      setSearchTerm("");
      onClose();
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{t('modals.link_new.title')}</DialogTitle>
          <DialogDescription>
            {t('modals.link_new.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input 
              placeholder={t('modals.link_new.search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-700 border-gray-600"
            />
          </div>
          <ScrollArea className="h-72 pr-6">
            <div className="space-y-3">
              {filteredServices.map(service => (
                <div key={service.id} className="flex items-center p-3 bg-gray-700 rounded-lg">
                  <Checkbox 
                    id={`service-${service.id}`}
                    checked={selectedServiceIds.includes(service.id)}
                    onCheckedChange={() => toggleSelection(service.id)}
                  />
                  <label htmlFor={`service-${service.id}`} className="flex-1 ml-3 cursor-pointer">
                    <p className="font-medium">{service.label}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {service.tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  </label>
                </div>
              ))}
              {filteredServices.length === 0 && (
                <div className="text-center py-10 text-gray-500">
                    <p>{t('modals.link_new.no_services_found')}</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-gray-600">{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} className="bg-gradient-to-r from-blue-600 to-purple-700" disabled={selectedServiceIds.length === 0}>
            {t('modals.link_new.link_button', { count: selectedServiceIds.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
