"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, KeyRound, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import Fuse from "fuse.js";
import { useVaultStore } from "../stores/vault-store";
import type { Service, ServiceField } from "../types";
import { toast } from "sonner";

interface CreateServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceToEdit?: Service | null;
  defaultTypeId?: string;
  onSaved?: (service: Service) => void;
  accountId?: string;
}

export function CreateServiceModal({ isOpen, onClose, serviceToEdit, defaultTypeId, onSaved, accountId }: CreateServiceModalProps) {
  const { t } = useTranslation();
  const { vault, addService, updateService } = useVaultStore();
  const [label, setLabel] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [data, setData] = useState<Record<string, string>>({});
  const [tags, setTags] = useState("");
  const [openComboboxes, setOpenComboboxes] = useState<Record<string, boolean>>({});
  const [creatingLinkedServices, setCreatingLinkedServices] = useState<Record<string, boolean>>({});
  const [linkedServiceData, setLinkedServiceData] = useState<Record<string, { label: string; data: Record<string, string>; tags: string }>>({});

  const serviceTypes = vault?.serviceTypes || [];
  const services = vault?.services || [];
  const selectedType = serviceTypes.find((type) => type.id === selectedTypeId);

  useEffect(() => {
    if (serviceToEdit) {
      setLabel(serviceToEdit.label);
      setSelectedTypeId(serviceToEdit.serviceTypeId);
      setData(serviceToEdit.data);
      setTags(serviceToEdit.tags.join(", "));
    } else {
      setLabel("");
      setSelectedTypeId(defaultTypeId || "");
      setData({});
      setTags("");
      setCreatingLinkedServices({});
      setLinkedServiceData({});
    }
  }, [serviceToEdit, isOpen, defaultTypeId]);

  const handleDataChange = (key: string, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!label || !selectedTypeId) {
      toast.error(t('modals.create_service.errors.label_type_required'));
      return;
    }

    const finalData = { ...data };

    try {
      // First, create any new linked services
      for (const [fieldKey, linkedData] of Object.entries(linkedServiceData)) {
        if (creatingLinkedServices[fieldKey] && linkedData.label) {
          const linkedServiceType = selectedType?.fields.find(f => f.key === fieldKey)?.linkedServiceTypeId;
          if (linkedServiceType) {
            const newLinkedService: Service = {
              id: crypto.randomUUID(),
              label: linkedData.label,
              serviceTypeId: linkedServiceType,
              data: linkedData.data,
              tags: linkedData.tags.split(",").map(tag => tag.trim()).filter(Boolean),
            };
            await addService(newLinkedService, accountId);
            finalData[fieldKey] = newLinkedService.id;
          }
        }
      }

      // Then create/update the main service
      const newService: Service = {
        id: serviceToEdit?.id || crypto.randomUUID(),
        label,
        serviceTypeId: selectedTypeId,
        data: finalData,
        tags: tags.split(",").map(tag => tag.trim()).filter(Boolean),
      };

      if (serviceToEdit) {
        await updateService(newService);
      } else {
        await addService(newService, accountId);
      }
      
      if (onSaved) onSaved(newService);
      onClose();
    } catch (e) {
      // Error is already handled by the store
    }
  };
  
  const renderField = (field: ServiceField) => {
    const value = data[field.key] || "";
    
    if (field.type === 'linked_service') {
        const linkedServices = services.filter(s => s.serviceTypeId === field.linkedServiceTypeId);
        const selectedService = linkedServices.find(s => s.id === value);
        const isOpen = openComboboxes[field.key] || false;
        const isCreatingNew = creatingLinkedServices[field.key] || false;
        const linkedServiceType = serviceTypes.find(st => st.id === field.linkedServiceTypeId);
        
        if (isCreatingNew) {
            const currentData = linkedServiceData[field.key] || { label: '', data: {}, tags: '' };
            
            return (
                <div className="space-y-3 p-3 border border-gray-600 rounded-md bg-gray-750">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-blue-400">{t('modals.create_service.creating_new_service', { serviceName: linkedServiceType?.name })}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setCreatingLinkedServices(prev => ({ ...prev, [field.key]: false }));
                                setLinkedServiceData(prev => ({ ...prev, [field.key]: { label: '', data: {}, tags: '' } }));
                            }}
                            className="text-gray-400 hover:text-white"
                        >
                            {t('common.cancel')}
                        </Button>
                    </div>
                    
                    <div className="space-y-2">
                        <Label>{t('modals.create_service.service_name')}</Label>
                        <Input
                            value={currentData.label}
                            onChange={(e) => setLinkedServiceData(prev => ({
                                ...prev,
                                [field.key]: { ...currentData, label: e.target.value }
                            }))}
                            placeholder={t('modals.create_service.service_name_placeholder')}
                            className="bg-gray-700 border-gray-600"
                        />
                    </div>
                    
                    {linkedServiceType?.fields.map((linkedField) => (
                        <div key={linkedField.id} className="space-y-2">
                            <Label>{linkedField.label} {linkedField.required && <span className="text-red-500">*</span>}</Label>
                            {linkedField.type === 'textarea' ? (
                                <Textarea
                                    value={currentData.data[linkedField.key] || ''}
                                    onChange={(e) => setLinkedServiceData(prev => ({
                                        ...prev,
                                        [field.key]: {
                                            ...currentData,
                                            data: { ...currentData.data, [linkedField.key]: e.target.value }
                                        }
                                    }))}
                                    className="bg-gray-700 border-gray-600"
                                />
                            ) : (
                                <Input
                                    type={linkedField.type === 'secret' ? 'password' : 'text'}
                                    value={currentData.data[linkedField.key] || ''}
                                    onChange={(e) => setLinkedServiceData(prev => ({
                                        ...prev,
                                        [field.key]: {
                                            ...currentData,
                                            data: { ...currentData.data, [linkedField.key]: e.target.value }
                                        }
                                    }))}
                                    className="bg-gray-700 border-gray-600"
                                />
                            )}
                        </div>
                    ))}
                    
                    <div className="space-y-2">
                        <Label>{t('modals.create_service.tags')}</Label>
                        <Input
                            value={currentData.tags}
                            onChange={(e) => setLinkedServiceData(prev => ({
                                ...prev,
                                [field.key]: { ...currentData, tags: e.target.value }
                            }))}
                            placeholder={t('modals.create_service.tags_placeholder')}
                            className="bg-gray-700 border-gray-600"
                        />
                    </div>
                </div>
            );
        }
        
        return (
            <div className="space-y-2">
                <div className="flex gap-2">
                    <Popover open={isOpen} onOpenChange={(open: boolean) => setOpenComboboxes(prev => ({ ...prev, [field.key]: open }))}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={isOpen}
                                className="flex-1 justify-between bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                            >
                                {selectedService ? selectedService.label : t('modals.create_service.select_service_placeholder')}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0 bg-gray-700 border-gray-600">
                            <Command className="bg-gray-700">
                                <CommandInput placeholder={t('modals.create_service.search_services_placeholder')} className="bg-gray-700 text-white" />
                                <CommandList>
                                    <CommandEmpty className="text-gray-400">{t('modals.create_service.no_services_found')}</CommandEmpty>
                                    <CommandGroup>
                                        {linkedServices.map((service) => (
                                            <CommandItem
                                                key={service.id}
                                                value={service.label}
                                                onSelect={() => {
                                                    handleDataChange(field.key, service.id);
                                                    setOpenComboboxes(prev => ({ ...prev, [field.key]: false }));
                                        }}
                                        className="text-white hover:bg-gray-600"
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                value === service.id ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        {service.label}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            
            <Button
                variant="outline"
                onClick={() => {
                    setCreatingLinkedServices(prev => ({ ...prev, [field.key]: true }));
                    setLinkedServiceData(prev => ({ ...prev, [field.key]: { label: '', data: {}, tags: '' } }));
                }}
                className="bg-green-600 hover:bg-green-700 border-green-600 text-white"
            >
                <Plus className="h-4 w-4 mr-1" />
                {t('modals.create_service.create_new_service')}
            </Button>
        </div>
        </div>
        );
    }

    if (field.type === '2fa') {
      return (
        <div className="flex items-center gap-2">
          <Input 
            value={value} 
            onChange={(e) => handleDataChange(field.key, e.target.value)} 
            className="bg-gray-700 border-gray-600 font-mono flex-grow"
            placeholder={t('modals.create_service.2fa_placeholder')}
          />
        </div>
      )
    }

    switch (field.type) {
      case "textarea":
        return <Textarea value={value} onChange={(e) => handleDataChange(field.key, e.target.value)} className="bg-gray-700 border-gray-600" />;
      case "secret":
        return <Input type="password" value={value} onChange={(e) => handleDataChange(field.key, e.target.value)} className="bg-gray-700 border-gray-600" />;
      default:
        return <Input value={value} onChange={(e) => handleDataChange(field.key, e.target.value)} className="bg-gray-700 border-gray-600" />;
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{serviceToEdit ? t('modals.create_service.edit_title') : t('modals.create_service.create_title')}</DialogTitle>
          <DialogDescription>
            {serviceToEdit ? t('modals.create_service.edit_description') : t('modals.create_service.create_description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto pr-4">
          <div className="space-y-2">
            <Label htmlFor="service-label">{t('modals.create_service.label')}</Label>
            <Input id="service-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('modals.create_service.label_placeholder')} className="bg-gray-700 border-gray-600" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-type">{t('modals.create_service.type')}</Label>
            <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
              <SelectTrigger id="service-type" className="bg-gray-700 border-gray-600">
                <SelectValue placeholder={t('modals.create_service.select_type_placeholder')} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                {serviceTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {selectedType && selectedType.fields.map((field) => (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={`field-${field.key}`}>{field.label} {field.required && <span className="text-red-500">*</span>}</Label>
              {renderField(field)}
            </div>
          ))}

          <div className="space-y-2">
            <Label htmlFor="service-tags">{t('modals.create_service.tags')}</Label>
            <Input id="service-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('modals.create_service.tags_placeholder')} className="bg-gray-700 border-gray-600" />
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
