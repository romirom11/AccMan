"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useVaultStore } from "../stores/vault-store";
import { cn } from "@/lib/utils";
import {
  BULK_NUMBER_PLACEHOLDER,
  MAX_BULK_COUNT,
  countMatchingServices,
  previewBulkNames,
  validateBulkNumbers,
  type BulkNamePreview,
} from "@/lib/bulk-names";
import type { BulkCreateRequest, BulkCreateSummary } from "../types";

interface BulkCreateAccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ServiceConfigDraft {
  /** Local React key only. */
  key: string;
  serviceTypeId: string;
  nameTemplate: string;
}

const DEFAULT_TEMPLATE = "Work%n%";

function parseTags(raw: string): string[] {
  return Array.from(new Set(raw.split(",").map((tag) => tag.trim()).filter(Boolean)));
}

function PreviewNames({ preview }: { preview: BulkNamePreview }) {
  return (
    <span className="font-mono text-white break-all">
      {preview.first}
      {preview.last !== undefined && (
        <>
          <span className="text-gray-500 mx-1.5">…</span>
          {preview.last}
        </>
      )}
    </span>
  );
}

export function BulkCreateAccountsModal({ isOpen, onClose }: BulkCreateAccountsModalProps) {
  const { t } = useTranslation();
  const bulkCreateAccounts = useVaultStore((s) => s.bulkCreateAccounts);
  const vault = useVaultStore((s) => s.vault);

  // Raw input strings: number fields can be cleared and are validated, never silently replaced.
  const [countRaw, setCountRaw] = useState("1");
  const [startRaw, setStartRaw] = useState("1");
  const [nameTemplate, setNameTemplate] = useState(DEFAULT_TEMPLATE);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [linkServices, setLinkServices] = useState(false);
  const [serviceConfigs, setServiceConfigs] = useState<ServiceConfigDraft[]>([]);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summary, setSummary] = useState<BulkCreateSummary | null>(null);

  const resetForm = () => {
    setCountRaw("1");
    setStartRaw("1");
    setNameTemplate(DEFAULT_TEMPLATE);
    setTags("");
    setNotes("");
    setLinkServices(false);
    setServiceConfigs([]);
    setTriedSubmit(false);
    setIsSubmitting(false);
    setSummary(null);
  };

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen]);

  const serviceTypes = vault?.serviceTypes ?? [];
  const services = vault?.services ?? [];

  const numbers = validateBulkNumbers(countRaw, startRaw);
  const templateMissing = !nameTemplate.trim();
  const count = numbers.ok ? numbers.count : 0;
  const startNumber = numbers.ok ? numbers.startNumber : 0;

  const configErrors = serviceConfigs.map((config) => ({
    type: !config.serviceTypeId || !serviceTypes.some((type) => type.id === config.serviceTypeId),
    template: !config.nameTemplate.trim(),
  }));
  const noConfigs = linkServices && serviceConfigs.length === 0;
  const hasConfigErrors = linkServices && configErrors.some((e) => e.type || e.template);
  const isValid = numbers.ok && !templateMissing && !noConfigs && !hasConfigErrors;

  const accountPreview = numbers.ok ? previewBulkNames(nameTemplate, startNumber, count) : null;

  const servicePreviews = useMemo(
    () =>
      serviceConfigs.map((config) => {
        if (!config.serviceTypeId || !config.nameTemplate.trim()) return null;
        return {
          names: previewBulkNames(config.nameTemplate, startNumber, count),
          matches: countMatchingServices(services, config.serviceTypeId, config.nameTemplate, startNumber, count),
        };
      }),
    [serviceConfigs, services, startNumber, count],
  );

  const addServiceConfig = () => {
    setServiceConfigs((prev) => [...prev, { key: crypto.randomUUID(), serviceTypeId: "", nameTemplate: DEFAULT_TEMPLATE }]);
  };

  const removeServiceConfig = (key: string) => {
    setServiceConfigs((prev) => prev.filter((config) => config.key !== key));
  };

  const updateServiceConfig = (key: string, updates: Partial<Omit<ServiceConfigDraft, "key">>) => {
    setServiceConfigs((prev) => prev.map((config) => (config.key === key ? { ...config, ...updates } : config)));
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setTriedSubmit(true);
    if (!isValid || !numbers.ok) return;

    const request: BulkCreateRequest = {
      accountConfig: {
        count: numbers.count,
        nameTemplate: nameTemplate.trim(),
        startNumber: numbers.startNumber,
        tags: parseTags(tags),
        notes,
      },
      linkServices,
      serviceConfigs: linkServices
        ? serviceConfigs.map(({ serviceTypeId, nameTemplate: template }) => ({ serviceTypeId, nameTemplate: template.trim() }))
        : [],
    };

    setIsSubmitting(true);
    try {
      // The store shows the success toast (and a warning for unmatched lookups); errors come from the API layer.
      const result = await bulkCreateAccounts(request);
      setSummary(result);
    } catch {
      // Keep the form so the user can fix it and retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  const errorText = (show: boolean, text: string, id?: string) =>
    show ? (
      <p id={id} role="alert" className="text-sm text-red-400">
        {text}
      </p>
    ) : null;

  const placeholderHint = (template: string) =>
    template.trim() && !template.includes(BULK_NUMBER_PLACEHOLDER) ? (
      <p className="text-xs text-yellow-400">{t('modals.bulk_create_accounts.placeholder_appended')}</p>
    ) : null;

  const typeName = (id: string) => serviceTypes.find((type) => type.id === id)?.name ?? "";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-4xl bg-gray-800 border-gray-700 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('modals.bulk_create_accounts.title')}</DialogTitle>
          <DialogDescription>
            {t('modals.bulk_create_accounts.description')}
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="py-4 space-y-4" role="status">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-green-400 shrink-0" aria-hidden="true" />
              <h3 className="text-lg font-medium">{t('modals.bulk_create_accounts.summary.title')}</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Card className="bg-gray-700 border-gray-600">
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-white">{summary.created}</div>
                  <div className="text-sm text-gray-400">{t('modals.bulk_create_accounts.summary.created')}</div>
                </CardContent>
              </Card>
              <Card className="bg-gray-700 border-gray-600">
                <CardContent className="p-4">
                  <div className="text-2xl font-bold text-white">{summary.linked}</div>
                  <div className="text-sm text-gray-400">{t('modals.bulk_create_accounts.summary.linked')}</div>
                </CardContent>
              </Card>
              <Card className={cn("border-gray-600", summary.unmatched > 0 ? "bg-yellow-900/30 border-yellow-700" : "bg-gray-700")}>
                <CardContent className="p-4">
                  <div className={cn("text-2xl font-bold", summary.unmatched > 0 ? "text-yellow-300" : "text-white")}>{summary.unmatched}</div>
                  <div className="text-sm text-gray-400">{t('modals.bulk_create_accounts.summary.unmatched')}</div>
                </CardContent>
              </Card>
            </div>
            {summary.unmatched > 0 && (
              <p className="text-sm text-yellow-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                {t('modals.bulk_create_accounts.summary.unmatched_hint')}
              </p>
            )}
          </div>
        ) : (
          <form
            id="bulk-create-form"
            className="grid gap-6 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            {/* Account Configuration */}
            <Card className="bg-gray-700 border-gray-600">
              <CardHeader>
                <CardTitle className="text-lg">{t('modals.bulk_create_accounts.account_config.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bulk-count">{t('modals.bulk_create_accounts.account_config.count')}</Label>
                    <Input
                      id="bulk-count"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_BULK_COUNT}
                      step={1}
                      value={countRaw}
                      onChange={(e) => setCountRaw(e.target.value)}
                      aria-invalid={!numbers.ok && !!numbers.countError}
                      aria-describedby="bulk-count-error"
                      disabled={isSubmitting}
                      className="bg-gray-600 border-gray-500"
                    />
                    {errorText(
                      !numbers.ok && !!numbers.countError,
                      t('modals.bulk_create_accounts.errors.invalid_count', { max: MAX_BULK_COUNT }),
                      "bulk-count-error",
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bulk-start">{t('modals.bulk_create_accounts.account_config.start_number')}</Label>
                    <Input
                      id="bulk-start"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={startRaw}
                      onChange={(e) => setStartRaw(e.target.value)}
                      aria-invalid={!numbers.ok && !!numbers.startError}
                      aria-describedby="bulk-start-error"
                      disabled={isSubmitting}
                      className="bg-gray-600 border-gray-500"
                    />
                    {errorText(
                      !numbers.ok && !!numbers.startError,
                      !numbers.ok && numbers.startError === "range_too_large"
                        ? t('modals.bulk_create_accounts.errors.range_too_large')
                        : t('modals.bulk_create_accounts.errors.invalid_start'),
                      "bulk-start-error",
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bulk-name-template">{t('modals.bulk_create_accounts.account_config.name_template')}</Label>
                  <Input
                    id="bulk-name-template"
                    value={nameTemplate}
                    onChange={(e) => setNameTemplate(e.target.value)}
                    placeholder={DEFAULT_TEMPLATE}
                    aria-invalid={templateMissing}
                    disabled={isSubmitting}
                    className="bg-gray-600 border-gray-500"
                  />
                  <p className="text-sm text-gray-400">{t('modals.bulk_create_accounts.account_config.name_template_help')}</p>
                  {placeholderHint(nameTemplate)}
                  {errorText(templateMissing, t('modals.bulk_create_accounts.errors.name_template_required'))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bulk-tags">{t('modals.bulk_create_accounts.account_config.tags')}</Label>
                  <Input
                    id="bulk-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder={t('modals.bulk_create_accounts.account_config.tags_placeholder')}
                    disabled={isSubmitting}
                    className="bg-gray-600 border-gray-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bulk-notes">{t('modals.bulk_create_accounts.account_config.notes')}</Label>
                  <Textarea
                    id="bulk-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('modals.bulk_create_accounts.account_config.notes_placeholder')}
                    disabled={isSubmitting}
                    className="bg-gray-600 border-gray-500 min-h-[80px]"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Service Linking Configuration */}
            <Card className="bg-gray-700 border-gray-600">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bulk-link-services"
                    checked={linkServices}
                    onCheckedChange={(checked) => setLinkServices(checked === true)}
                    disabled={isSubmitting}
                    className="border-gray-500"
                  />
                  <Label htmlFor="bulk-link-services" className="text-lg font-semibold cursor-pointer">
                    {t('modals.bulk_create_accounts.service_linking.title')}
                  </Label>
                </div>
                <p className="text-sm text-gray-400">{t('modals.bulk_create_accounts.service_linking.description')}</p>
              </CardHeader>

              {linkServices && (
                <CardContent className="space-y-4">
                  {serviceConfigs.map((config, index) => {
                    const errors = configErrors[index];
                    const typeSelectId = `bulk-service-type-${config.key}`;
                    const templateId = `bulk-service-template-${config.key}`;
                    const heading = `${t('modals.bulk_create_accounts.service_linking.service')} ${index + 1}`;
                    return (
                      <Card key={config.key} className="bg-gray-600 border-gray-500">
                        <CardContent className="pt-4">
                          <div className="flex justify-between items-start mb-4">
                            <h4 className="font-medium">{heading}</h4>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeServiceConfig(config.key)}
                              disabled={isSubmitting}
                              aria-label={t('modals.bulk_create_accounts.service_linking.remove', { name: heading })}
                              title={t('modals.bulk_create_accounts.service_linking.remove', { name: heading })}
                              className="text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="grid gap-4">
                            <div className="space-y-2">
                              <Label htmlFor={typeSelectId}>{t('modals.bulk_create_accounts.service_linking.service_type')}</Label>
                              <Select
                                value={config.serviceTypeId}
                                onValueChange={(value) => updateServiceConfig(config.key, { serviceTypeId: value })}
                                disabled={isSubmitting}
                              >
                                <SelectTrigger id={typeSelectId} className="bg-gray-500 border-gray-400" aria-invalid={triedSubmit && errors.type}>
                                  <SelectValue placeholder={t('modals.bulk_create_accounts.service_linking.select_service_type')} />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-600 border-gray-500">
                                  {serviceTypes.map((serviceType) => (
                                    <SelectItem key={serviceType.id} value={serviceType.id} className="text-white">
                                      {serviceType.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {errorText(triedSubmit && errors.type, t('modals.bulk_create_accounts.errors.service_type_required'))}
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={templateId}>{t('modals.bulk_create_accounts.service_linking.name_template')}</Label>
                              <Input
                                id={templateId}
                                value={config.nameTemplate}
                                onChange={(e) => updateServiceConfig(config.key, { nameTemplate: e.target.value })}
                                placeholder="TwWork%n%"
                                aria-invalid={errors.template}
                                disabled={isSubmitting}
                                className="bg-gray-500 border-gray-400"
                              />
                              <p className="text-sm text-gray-400">{t('modals.bulk_create_accounts.service_linking.name_template_help')}</p>
                              {placeholderHint(config.nameTemplate)}
                              {errorText(errors.template, t('modals.bulk_create_accounts.errors.service_name_template_required'))}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}

                  {errorText(triedSubmit && noConfigs, t('modals.bulk_create_accounts.errors.no_service_configs'))}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={addServiceConfig}
                    disabled={isSubmitting}
                    className="w-full border-gray-500 text-gray-300 hover:bg-gray-600"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t('modals.bulk_create_accounts.service_linking.add_service')}
                  </Button>
                </CardContent>
              )}
            </Card>

            {/* Live preview with the backend's numbering rule */}
            <Card className="bg-gray-700 border-gray-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{t('modals.bulk_create_accounts.preview.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm" aria-live="polite">
                {accountPreview ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-400">{t('modals.bulk_create_accounts.preview.accounts', { count })}</span>
                    <ArrowRight className="w-4 h-4 text-gray-500" aria-hidden="true" />
                    <PreviewNames preview={accountPreview} />
                  </div>
                ) : (
                  <p className="text-gray-500 italic">{t('modals.bulk_create_accounts.preview.unavailable')}</p>
                )}
                {linkServices &&
                  serviceConfigs.map((config, index) => {
                    const preview = servicePreviews[index];
                    if (!preview?.names) return null;
                    const allFound = preview.matches === count;
                    return (
                      <div key={config.key} className="flex flex-wrap items-center gap-2">
                        <span className="text-gray-400">{typeName(config.serviceTypeId)}</span>
                        <ArrowRight className="w-4 h-4 text-gray-500" aria-hidden="true" />
                        <PreviewNames preview={preview.names} />
                        <span
                          className={cn(
                            "text-xs",
                            allFound ? "text-green-400" : preview.matches === 0 ? "text-red-400" : "text-yellow-400",
                          )}
                        >
                          {t('modals.bulk_create_accounts.preview.found', { found: preview.matches, total: count })}
                        </span>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          </form>
        )}

        <DialogFooter>
          {summary ? (
            <>
              <Button type="button" variant="outline" onClick={resetForm} className="border-gray-600">
                {t('modals.bulk_create_accounts.summary.create_more')}
              </Button>
              <Button type="button" onClick={onClose} className="bg-gradient-to-r from-blue-600 to-purple-700">
                {t('modals.bulk_create_accounts.summary.done')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting} className="border-gray-600">
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form="bulk-create-form"
                disabled={isSubmitting || (triedSubmit && !isValid)}
                className="bg-gradient-to-r from-blue-600 to-purple-700"
              >
                {isSubmitting
                  ? t('common.creating')
                  : numbers.ok
                    ? t('modals.bulk_create_accounts.create_button', { count })
                    : t('common.create')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
