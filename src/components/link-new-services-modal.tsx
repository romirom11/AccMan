"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Pin, Search } from "lucide-react";
import { useVaultStore } from "../stores/vault-store";
import { buildServiceSearchText, findServiceType, matchesSearch } from "@/lib/service-helpers";
import { naturalCompare } from "@/lib/account-list";

interface LinkNewServicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

// Select values are prefixed so that no service type id can collide with the "all" sentinel.
const ALL_TYPES = "all";
const TYPE_PREFIX = "type:";

export function LinkNewServicesModal({ isOpen, onClose, accountId }: LinkNewServicesModalProps) {
  const { t } = useTranslation();
  const vault = useVaultStore((s) => s.vault);
  const linkServicesToAccount = useVaultStore((s) => s.linkServicesToAccount);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(() => new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fresh state every time the dialog opens, whichever way it was closed before.
  useEffect(() => {
    if (isOpen) {
      setSelectedServiceIds(new Set());
      setSearchTerm("");
      setTypeFilter(ALL_TYPES);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const account = vault?.accounts.find((acc) => acc.id === accountId);
  const serviceTypes = useMemo(() => vault?.serviceTypes ?? [], [vault]);

  // Already linked services are not offered again.
  const unlinkedServices = useMemo(() => {
    const linked = new Set(account?.linkedServices ?? []);
    return (vault?.services ?? [])
      .filter((service) => !linked.has(service.id))
      .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : naturalCompare(a.label, b.label)));
  }, [vault, account]);

  const selectedTypeId = typeFilter.startsWith(TYPE_PREFIX) ? typeFilter.slice(TYPE_PREFIX.length) : null;

  const filteredServices = useMemo(() => {
    const query = searchTerm.trim();
    return unlinkedServices.filter((service) => {
      if (selectedTypeId !== null && service.serviceTypeId !== selectedTypeId) return false;
      if (!query) return true;
      // Label, tags, type name and non-secret field values only.
      return matchesSearch(buildServiceSearchText(service, findServiceType(serviceTypes, service.serviceTypeId)), query);
    });
  }, [unlinkedServices, searchTerm, selectedTypeId, serviceTypes]);

  // Never submit services that got linked or deleted meanwhile.
  const effectiveSelection = unlinkedServices.filter((s) => selectedServiceIds.has(s.id)).map((s) => s.id);
  const visibleIds = filteredServices.map((s) => s.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedServiceIds.has(id));

  const toggleSelection = (serviceId: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (effectiveSelection.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      // Success and error toasts come from the store / API layer.
      await linkServicesToAccount(accountId, effectiveSelection);
      setSelectedServiceIds(new Set());
      onClose();
    } catch {
      // Keep the dialog open with the selection so the user can retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{t('modals.link_new.title')}</DialogTitle>
          <DialogDescription>
            {t('modals.link_new.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" aria-hidden="true" />
              <Input
                placeholder={t('modals.link_new.search_placeholder')}
                aria-label={t('modals.link_new.search_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-gray-700 border-gray-600"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-56 bg-gray-700 border-gray-600 text-white" aria-label={t('modals.link_new.filter_by_type')}>
                <SelectValue placeholder={t('modals.link_new.filter_by_type')} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                <SelectItem value={ALL_TYPES}>{t('modals.link_new.all_types')}</SelectItem>
                {serviceTypes.map((type) => (
                  <SelectItem key={type.id} value={`${TYPE_PREFIX}${type.id}`}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filteredServices.length > 0 && (
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>{t('modals.link_new.available_count', { count: filteredServices.length })}</span>
              <Button variant="ghost" size="sm" onClick={toggleAllVisible} disabled={isSubmitting} className="text-gray-300 hover:text-white">
                {allVisibleSelected ? t('modals.link_new.deselect_all') : t('modals.link_new.select_all')}
              </Button>
            </div>
          )}
          <ScrollArea className="h-72 pr-6">
            <div className="space-y-3" role="group" aria-label={t('modals.link_new.title')}>
              {filteredServices.map(service => {
                const typeName = findServiceType(serviceTypes, service.serviceTypeId)?.name;
                const checkboxId = `link-service-${service.id}`;
                return (
                  <div key={service.id} className="flex items-center p-3 bg-gray-700 rounded-lg">
                    <Checkbox
                      id={checkboxId}
                      checked={selectedServiceIds.has(service.id)}
                      onCheckedChange={() => toggleSelection(service.id)}
                      disabled={isSubmitting}
                    />
                    <label htmlFor={checkboxId} className="flex-1 ml-3 cursor-pointer min-w-0">
                      <div className="flex items-center gap-2">
                        {service.pinned && <Pin className="w-3.5 h-3.5 text-yellow-400 shrink-0" aria-label={t('accounts.pin.pinned')} />}
                        <p className="font-medium truncate">{service.label}</p>
                        {typeName && <span className="text-xs text-gray-400 shrink-0">{typeName}</span>}
                      </div>
                      {service.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {service.tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      )}
                    </label>
                  </div>
                );
              })}
              {filteredServices.length === 0 && (
                <div className="text-center py-10 text-gray-500">
                  <p>
                    {unlinkedServices.length === 0
                      ? t('modals.link_new.all_linked')
                      : t('modals.link_new.no_services_found')}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting} className="border-gray-600">{t('common.cancel')}</Button>
          <Button
            onClick={handleSubmit}
            className="bg-gradient-to-r from-blue-600 to-purple-700"
            disabled={effectiveSelection.length === 0 || isSubmitting}
          >
            {isSubmitting ? t('modals.link_new.linking') : t('modals.link_new.link_button', { count: effectiveSelection.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
