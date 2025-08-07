"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { useVaultStore } from "../stores/vault-store";
import type { BulkCreateRequest, BulkAccountConfig, ServiceLinkConfig, ServiceType } from "../types";
import { toast } from "sonner";

interface BulkCreateAccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BulkCreateAccountsModal({ isOpen, onClose }: BulkCreateAccountsModalProps) {
  const { t } = useTranslation();
  const { bulkCreateAccounts, vault } = useVaultStore();
  
  // Account config state
  const [count, setCount] = useState(1);
  const [nameTemplate, setNameTemplate] = useState("Work%n%");
  const [startNumber, setStartNumber] = useState(1);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  
  // Service linking state
  const [linkServices, setLinkServices] = useState(false);
  const [serviceConfigs, setServiceConfigs] = useState<ServiceLinkConfig[]>([]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Reset form when modal opens
      setCount(1);
      setNameTemplate("Work%n%");
      setStartNumber(1);
      setTags("");
      setNotes("");
      setLinkServices(false);
      setServiceConfigs([]);
    }
  }, [isOpen]);

  const addServiceConfig = () => {
    const newConfig: ServiceLinkConfig = {
      serviceTypeId: "",
      nameTemplate: "%n%",
      data: {},
      tags: []
    };
    setServiceConfigs([...serviceConfigs, newConfig]);
  };

  const removeServiceConfig = (index: number) => {
    setServiceConfigs(serviceConfigs.filter((_, i) => i !== index));
  };

  const updateServiceConfig = (index: number, updates: Partial<ServiceLinkConfig>) => {
    setServiceConfigs(serviceConfigs.map((config, i) => 
      i === index ? { ...config, ...updates } : config
    ));
  };

  const handleSubmit = async () => {
    if (!nameTemplate.trim()) {
      toast.error(t('modals.bulk_create_accounts.errors.name_template_required'));
      return;
    }

    if (count < 1 || count > 100) {
      toast.error(t('modals.bulk_create_accounts.errors.invalid_count'));
      return;
    }

    if (linkServices && serviceConfigs.length === 0) {
      toast.error(t('modals.bulk_create_accounts.errors.no_service_configs'));
      return;
    }

    // Validate service configs
    if (linkServices) {
      for (const config of serviceConfigs) {
        if (!config.serviceTypeId) {
          toast.error(t('modals.bulk_create_accounts.errors.service_type_required'));
          return;
        }
        if (!config.nameTemplate.trim()) {
          toast.error(t('modals.bulk_create_accounts.errors.service_name_template_required'));
          return;
        }
      }
    }

    const accountConfig: BulkAccountConfig = {
      count,
      nameTemplate,
      startNumber,
      tags: tags.split(",").map(tag => tag.trim()).filter(Boolean),
      notes
    };

    const request: BulkCreateRequest = {
      accountConfig,
      linkServices,
      serviceConfigs: linkServices ? serviceConfigs : []
    };

    setIsSubmitting(true);
    try {
      await bulkCreateAccounts(request);
      onClose();
    } catch (e) {
      // Error is handled by the store
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableServiceTypes = vault?.serviceTypes || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl bg-gray-800 border-gray-700 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('modals.bulk_create_accounts.title')}</DialogTitle>
          <DialogDescription>
            {t('modals.bulk_create_accounts.description')}
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-6 py-4">
          {/* Account Configuration */}
          <Card className="bg-gray-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-lg">{t('modals.bulk_create_accounts.account_config.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="count">{t('modals.bulk_create_accounts.account_config.count')}</Label>
                  <Input 
                    id="count" 
                    type="number" 
                    min="1" 
                    max="100" 
                    value={count} 
                    onChange={(e) => setCount(parseInt(e.target.value) || 1)} 
                    className="bg-gray-600 border-gray-500" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startNumber">{t('modals.bulk_create_accounts.account_config.start_number')}</Label>
                  <Input 
                    id="startNumber" 
                    type="number" 
                    min="1" 
                    value={startNumber} 
                    onChange={(e) => setStartNumber(parseInt(e.target.value) || 1)} 
                    className="bg-gray-600 border-gray-500" 
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="nameTemplate">{t('modals.bulk_create_accounts.account_config.name_template')}</Label>
                <Input 
                  id="nameTemplate" 
                  value={nameTemplate} 
                  onChange={(e) => setNameTemplate(e.target.value)} 
                  placeholder="Work%n%" 
                  className="bg-gray-600 border-gray-500" 
                />
                <p className="text-sm text-gray-400">{t('modals.bulk_create_accounts.account_config.name_template_help')}</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="tags">{t('modals.bulk_create_accounts.account_config.tags')}</Label>
                <Input 
                  id="tags" 
                  value={tags} 
                  onChange={(e) => setTags(e.target.value)} 
                  placeholder={t('modals.bulk_create_accounts.account_config.tags_placeholder')} 
                  className="bg-gray-600 border-gray-500" 
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">{t('modals.bulk_create_accounts.account_config.notes')}</Label>
                <Textarea 
                  id="notes" 
                  value={notes} 
                  onChange={(e) => setNotes(e.target.value)} 
                  placeholder={t('modals.bulk_create_accounts.account_config.notes_placeholder')} 
                  className="bg-gray-600 border-gray-500 min-h-[80px]" 
                />
              </div>
            </CardContent>
          </Card>

          {/* Service Linking Configuration */}
          <Card className="bg-gray-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Checkbox 
                  checked={linkServices} 
                  onCheckedChange={(checked) => setLinkServices(checked === true)}
                  className="border-gray-500"
                />
                {t('modals.bulk_create_accounts.service_linking.title')}
              </CardTitle>
            </CardHeader>
            
            {linkServices && (
              <CardContent className="space-y-4">
                {serviceConfigs.map((config, index) => (
                  <Card key={index} className="bg-gray-600 border-gray-500">
                    <CardContent className="pt-4">
                      <div className="flex justify-between items-start mb-4">
                        <h4 className="font-medium">{t('modals.bulk_create_accounts.service_linking.service')} {index + 1}</h4>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => removeServiceConfig(index)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      
                      <div className="grid gap-4">
                        <div className="space-y-2">
                          <Label>{t('modals.bulk_create_accounts.service_linking.service_type')}</Label>
                          <Select 
                            value={config.serviceTypeId} 
                            onValueChange={(value) => updateServiceConfig(index, { serviceTypeId: value })}
                          >
                            <SelectTrigger className="bg-gray-500 border-gray-400">
                              <SelectValue placeholder={t('modals.bulk_create_accounts.service_linking.select_service_type')} />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-600 border-gray-500">
                              {availableServiceTypes.map((serviceType) => (
                                <SelectItem key={serviceType.id} value={serviceType.id} className="text-white">
                                  {serviceType.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-2">
                          <Label>{t('modals.bulk_create_accounts.service_linking.name_template')}</Label>
                          <Input 
                            value={config.nameTemplate} 
                            onChange={(e) => updateServiceConfig(index, { nameTemplate: e.target.value })} 
                            placeholder="TwWork%n%" 
                            className="bg-gray-500 border-gray-400" 
                          />
                          <p className="text-sm text-gray-400">{t('modals.bulk_create_accounts.service_linking.name_template_help')}</p>
                        </div>
                        
                        <div className="space-y-2">
                          <Label>{t('modals.bulk_create_accounts.service_linking.tags')}</Label>
                          <Input 
                            value={config.tags.join(", ")} 
                            onChange={(e) => updateServiceConfig(index, { 
                              tags: e.target.value.split(",").map(tag => tag.trim()).filter(Boolean) 
                            })} 
                            placeholder={t('modals.bulk_create_accounts.service_linking.tags_placeholder')} 
                            className="bg-gray-500 border-gray-400" 
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                
                <Button 
                  variant="outline" 
                  onClick={addServiceConfig}
                  className="w-full border-gray-500 text-gray-300 hover:bg-gray-600"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('modals.bulk_create_accounts.service_linking.add_service')}
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-gray-600">
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting}
            className="bg-gradient-to-r from-blue-600 to-purple-700"
          >
            {isSubmitting ? t('common.creating') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}