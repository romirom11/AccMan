"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { confirm } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Check, CheckCircle2, ChevronsUpDown, Eye, EyeOff, Loader2, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PasswordGenerator } from "@/components/password-generator";
import { cn } from "@/lib/utils";
import { isSecretField } from "@/lib/service-helpers";
import { isValidTotpSecret } from "@/lib/totp";
import {
  buildServicePayload,
  checkServiceForm,
  formErrorKey,
  lostKeysOnTypeChange,
  retainTypeKeys,
  serviceDiffers,
  type InlineServiceDraft,
} from "@/lib/service-form";
import { useVaultStore } from "@/stores/vault-store";
import type { Service, ServiceField, ServiceType } from "@/types";

interface CreateServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceToEdit?: Service | null;
  defaultTypeId?: string;
  onSaved?: (service: Service) => void;
  /** Link the new service (and services created inline) to this account. */
  accountId?: string;
}

/**
 * Create/edit dialog for a service. Every time it opens (or targets another service) the form is
 * remounted, so no state of an earlier session survives.
 */
export function CreateServiceModal(props: CreateServiceModalProps) {
  const sessionKey = props.isOpen ? `${props.serviceToEdit?.id ?? "new"}|${props.defaultTypeId ?? ""}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  if (sessionKey !== prevKey) {
    setPrevKey(sessionKey);
    if (sessionKey !== null) setSession((n) => n + 1);
  }
  // Session 0 = never opened: nothing to render yet.
  if (session === 0) return null;
  return <ServiceFormDialog key={session} {...props} />;
}

const MASKED_TEXT_STYLE = { WebkitTextSecurity: "disc" } as CSSProperties;

function RequiredMessage({ message }: { message: string }) {
  return (
    <p className="text-xs text-red-400" role="alert">
      {message}
    </p>
  );
}

function RequiredWarning({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1 text-xs text-yellow-400">
      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

interface SecretInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  generator?: boolean;
  placeholder?: string;
  invalid?: boolean;
  mono?: boolean;
  fieldLabel: string;
}

/** Masked input with its own reveal toggle; secret (password) fields also get the generator. */
function SecretInput({ id, value, onChange, multiline, generator, placeholder, invalid, mono, fieldLabel }: SecretInputProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const toggleLabel = revealed ? t("field_row.hide", { field: fieldLabel }) : t("field_row.show", { field: fieldLabel });
  const common = {
    id,
    value,
    placeholder,
    autoComplete: "off",
    spellCheck: false,
    "aria-invalid": invalid || undefined,
    className: cn("bg-gray-700 border-gray-600", mono && "font-mono", invalid && "border-red-500"),
  };
  return (
    <div className="flex gap-2 items-start">
      {multiline ? (
        <Textarea
          {...common}
          onChange={(e) => onChange(e.target.value)}
          style={revealed ? undefined : MASKED_TEXT_STYLE}
          className={cn(common.className, "flex-1")}
        />
      ) : (
        <Input
          {...common}
          type={revealed ? "text" : "password"}
          onChange={(e) => onChange(e.target.value)}
          className={cn(common.className, "flex-1")}
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setRevealed((v) => !v)}
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-pressed={revealed}
        className="shrink-0 border-gray-600 bg-transparent text-gray-300 hover:text-white"
      >
        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      {generator && <PasswordGenerator onGenerate={onChange} confirmReplace={!!value} className="shrink-0" />}
    </div>
  );
}

interface LinkedServicePickerProps {
  id: string;
  field: ServiceField;
  value: string;
  onChange: (value: string) => void;
  services: readonly Service[];
  /** Never offered as a target (the service being edited). */
  excludeId?: string;
  invalid?: boolean;
}

function LinkedServicePicker({ id, field, value, onChange, services, excludeId, invalid }: LinkedServicePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const candidates = services.filter((s) => s.serviceTypeId === field.linkedServiceTypeId && s.id !== excludeId);
  const selected = value ? services.find((s) => s.id === value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex-1 min-w-0 justify-between bg-gray-700 border-gray-600 text-white hover:bg-gray-600",
            invalid && "border-red-500",
          )}
        >
          <span className={cn("truncate", !selected && "text-gray-400")}>
            {selected
              ? selected.label
              : value
                ? t("field_row.linked_missing")
                : t("modals.create_service.select_service_placeholder")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 bg-gray-700 border-gray-600">
        <Command className="bg-gray-700">
          <CommandInput placeholder={t("modals.create_service.search_services_placeholder")} className="bg-gray-700 text-white" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-sm text-gray-400">{t("modals.create_service.no_services_found")}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value={`__clear__ ${t("modals.create_service.clear_link")}`}
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="text-gray-300 hover:bg-gray-600"
                >
                  <X className="mr-2 h-4 w-4" />
                  {t("modals.create_service.clear_link")}
                </CommandItem>
              )}
              {candidates.map((service) => (
                <CommandItem
                  key={service.id}
                  value={`${service.label} ${service.id}`}
                  onSelect={() => {
                    onChange(service.id);
                    setOpen(false);
                  }}
                  className="text-white hover:bg-gray-600"
                >
                  <Check className={cn("mr-2 h-4 w-4", value === service.id ? "opacity-100" : "opacity-0")} />
                  {service.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface ValueInputProps {
  id: string;
  field: ServiceField;
  value: string;
  onChange: (value: string) => void;
  services: readonly Service[];
  excludeId?: string;
  invalid?: boolean;
}

/** The right input for a field's type (used by the main form and by inline linked-service forms). */
function ValueInput({ id, field, value, onChange, services, excludeId, invalid }: ValueInputProps) {
  const { t } = useTranslation();

  if (field.type === "linked_service") {
    return (
      <div className="flex gap-2">
        <LinkedServicePicker
          id={id}
          field={field}
          value={value}
          onChange={onChange}
          services={services}
          excludeId={excludeId}
          invalid={invalid}
        />
      </div>
    );
  }

  if (field.type === "2fa") {
    const trimmed = value.trim();
    return (
      <div className="space-y-1">
        <SecretInput
          id={id}
          value={value}
          onChange={onChange}
          placeholder={t("modals.create_service.2fa_placeholder")}
          invalid={invalid}
          mono
          fieldLabel={field.label}
        />
        {trimmed &&
          (isValidTotpSecret(trimmed) ? (
            <p className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              {t("modals.create_service.totp_valid")}
            </p>
          ) : (
            <p className="flex items-center gap-1 text-xs text-yellow-400">
              <AlertTriangle className="h-3 w-3" />
              {t("field_row.invalid_totp")}
            </p>
          ))}
      </div>
    );
  }

  if (isSecretField(field)) {
    return (
      <SecretInput
        id={id}
        value={value}
        onChange={onChange}
        multiline={field.type === "textarea"}
        generator={field.type === "secret"}
        invalid={invalid}
        fieldLabel={field.label}
      />
    );
  }

  const className = cn("bg-gray-700 border-gray-600", invalid && "border-red-500");
  if (field.type === "textarea") {
    return (
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} className={className} />
    );
  }
  // URL fields stay type="text": native url validation would block saving values without a scheme
  // (e.g. "mail.example.com"), which existing and imported data often has.
  const isUrl = field.type === "url";
  return (
    <Input
      id={id}
      type="text"
      inputMode={isUrl ? "url" : undefined}
      autoCapitalize={isUrl ? "off" : undefined}
      spellCheck={isUrl ? false : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      className={className}
    />
  );
}

function newDraft(): InlineServiceDraft {
  return { id: crypto.randomUUID(), label: "", data: {}, tags: "" };
}

function ServiceFormDialog({ isOpen, onClose, serviceToEdit, defaultTypeId, onSaved, accountId }: CreateServiceModalProps) {
  const { t } = useTranslation();
  const vault = useVaultStore((s) => s.vault);
  const addService = useVaultStore((s) => s.addService);
  const addServices = useVaultStore((s) => s.addServices);
  const updateService = useVaultStore((s) => s.updateService);
  const linkServicesToAccount = useVaultStore((s) => s.linkServicesToAccount);

  // The form belongs to the service it was opened for, even while the dialog animates closed.
  const [editTarget] = useState<Service | null>(() => serviceToEdit ?? null);
  const isEdit = editTarget !== null;
  // Stable for the whole session, so a retried save never creates a second copy.
  const [mainId] = useState(() => editTarget?.id ?? crypto.randomUUID());
  const [label, setLabel] = useState(editTarget?.label ?? "");
  const [typeId, setTypeId] = useState(editTarget?.serviceTypeId ?? defaultTypeId ?? "");
  const [data, setData] = useState<Record<string, string>>(() => ({ ...(editTarget?.data ?? {}) }));
  const [tags, setTags] = useState(editTarget ? editTarget.tags.join(", ") : "");
  const [inline, setInline] = useState<Record<string, InlineServiceDraft>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const savingRef = useRef(false);
  // Services created inline during this session (still to be linked to the account after a failure).
  const createdIdsRef = useRef<string[]>([]);

  const serviceTypes = useMemo(() => vault?.serviceTypes ?? [], [vault]);
  const services = useMemo(() => vault?.services ?? [], [vault]);
  const selectedType = serviceTypes.find((type) => type.id === typeId);
  const typeMissing = typeId !== "" && !selectedType;

  const { errors, warnings } = useMemo(
    () =>
      checkServiceForm({ label, typeId, data, inline }, serviceTypes, (id) => services.some((s) => s.id === id), {
        // Relaxes already-empty required fields only while the stored type is kept.
        previous: editTarget ?? undefined,
      }),
    [label, typeId, data, inline, serviceTypes, services, editTarget],
  );
  const hasError = (key: string) => showErrors && key in errors;
  const hasWarning = (key: string) => key in warnings;
  const requiredText = t("modals.create_service.errors.required");

  const setField = (key: string, value: string) => setData((prev) => ({ ...prev, [key]: value }));

  const updateDraft = (parentKey: string, patch: Partial<InlineServiceDraft>) =>
    setInline((prev) => {
      const current = prev[parentKey];
      return current ? { ...prev, [parentKey]: { ...current, ...patch } } : prev;
    });

  const handleTypeChange = async (nextTypeId: string) => {
    if (nextTypeId === typeId) return;
    const nextType = serviceTypes.find((type) => type.id === nextTypeId);
    const lostKeys = lostKeysOnTypeChange(data, nextType);
    const lostDrafts = Object.keys(inline);
    const lostNames = [...lostKeys, ...lostDrafts.filter((key) => !lostKeys.includes(key))].map(
      (key) => selectedType?.fields.find((field) => field.key === key)?.label ?? key,
    );
    if (lostNames.length > 0) {
      const confirmed = await confirm(t("modals.create_service.type_change_message", { fields: lostNames.join(", ") }), {
        title: t("modals.create_service.type_change_title"),
        kind: "warning",
      });
      if (!confirmed) return;
    }
    setTypeId(nextTypeId);
    setData((prev) => retainTypeKeys(prev, nextType));
    setInline({});
  };

  const handleSubmit = async () => {
    if (savingRef.current) return;
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;

    const form = { label, typeId, data, inline, tags };
    const { main, linked } = buildServicePayload(mainId, form, serviceTypes);
    const linkedIdsByField: Record<string, string> = {};
    for (const [fieldKey, draft] of Object.entries(inline)) {
      if (selectedType?.fields.some((f) => f.key === fieldKey && f.type === "linked_service")) linkedIdsByField[fieldKey] = draft.id;
    }
    // After the services exist, the drafts become plain links: a retry only does what is left.
    const markCreated = (ids: string[]) => {
      createdIdsRef.current = [...createdIdsRef.current, ...ids];
      setData((prev) => ({ ...prev, ...linkedIdsByField }));
      setInline({});
    };

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    let committed = false;
    try {
      const current = () => useVaultStore.getState().vault;
      const isStored = (id: string) => !!current()?.services.some((s) => s.id === id);
      const newLinked = linked.filter((s) => !isStored(s.id));
      const stored = current()?.services.find((s) => s.id === mainId);

      if (!stored) {
        if (newLinked.length === 0) {
          // One atomic command, including the link to the account (store shows the toast).
          await addService(main, accountId);
        } else {
          // Main service and the new linked services in one all-or-nothing batch.
          await addServices([...newLinked, main]);
          committed = true;
          markCreated(newLinked.map((s) => s.id));
          if (accountId) {
            await linkServicesToAccount(accountId, [main.id, ...createdIdsRef.current]);
          } else {
            toast.success(t("modals.create_service.created_with_linked", { count: newLinked.length }));
          }
        }
      } else {
        // Editing, or retrying a create whose services were already saved.
        if (newLinked.length > 0) {
          await addServices(newLinked);
          committed = true;
          markCreated(newLinked.map((s) => s.id));
        }
        if (serviceDiffers(stored, main)) await updateService(main);
        committed = true;
        if (accountId) {
          const account = current()?.accounts.find((a) => a.id === accountId);
          const wanted = [...(isEdit ? [] : [main.id]), ...createdIdsRef.current];
          const missing = wanted.filter((id) => !account?.linkedServices.includes(id));
          if (missing.length > 0) await linkServicesToAccount(accountId, missing);
        }
      }

      const saved = useVaultStore.getState().vault?.services.find((s) => s.id === mainId);
      if (saved) onSaved?.(saved);
      onClose();
    } catch {
      // The error toast comes from the API layer. Keep the dialog open for a retry.
      if (committed) {
        setNotice(accountId && !isEdit ? t("modals.create_service.partial_link") : t("modals.create_service.partial_saved"));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const renderInlineForm = (field: ServiceField, draft: InlineServiceDraft) => {
    const targetType: ServiceType | undefined = serviceTypes.find((st) => st.id === field.linkedServiceTypeId);
    const labelId = `svc-inline-${field.key}-label`;
    return (
      <div className="space-y-3 p-3 border border-gray-600 rounded-md bg-gray-750">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-blue-400">
            {t("modals.create_service.creating_new_service", { serviceName: targetType?.name ?? "" })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setInline((prev) => {
                const next = { ...prev };
                delete next[field.key];
                return next;
              })
            }
            className="text-gray-400 hover:text-white"
          >
            {t("common.cancel")}
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor={labelId}>
            {t("modals.create_service.service_name")} <span className="text-red-500">*</span>
          </Label>
          <Input
            id={labelId}
            value={draft.label}
            onChange={(e) => updateDraft(field.key, { label: e.target.value })}
            placeholder={t("modals.create_service.service_name_placeholder")}
            aria-invalid={hasError(formErrorKey.inlineLabel(field.key)) || undefined}
            className={cn("bg-gray-700 border-gray-600", hasError(formErrorKey.inlineLabel(field.key)) && "border-red-500")}
          />
          {hasError(formErrorKey.inlineLabel(field.key)) && <RequiredMessage message={requiredText} />}
        </div>

        {(targetType?.fields ?? []).map((nested) => {
          const nestedId = `svc-inline-${field.key}-${nested.key}`;
          const invalid = hasError(formErrorKey.inlineField(field.key, nested.key));
          return (
            <div key={nested.id} className="space-y-2">
              <Label htmlFor={nestedId}>
                {nested.label} {nested.required && <span className="text-red-500">*</span>}
              </Label>
              <ValueInput
                id={nestedId}
                field={nested}
                value={draft.data[nested.key] ?? ""}
                onChange={(value) => updateDraft(field.key, { data: { ...draft.data, [nested.key]: value } })}
                services={services}
                invalid={invalid}
              />
              {invalid && <RequiredMessage message={requiredText} />}
            </div>
          );
        })}

        <div className="space-y-2">
          <Label htmlFor={`svc-inline-${field.key}-tags`}>{t("modals.create_service.tags")}</Label>
          <Input
            id={`svc-inline-${field.key}-tags`}
            value={draft.tags}
            onChange={(e) => updateDraft(field.key, { tags: e.target.value })}
            placeholder={t("modals.create_service.tags_placeholder")}
            className="bg-gray-700 border-gray-600"
          />
        </div>
      </div>
    );
  };

  const renderField = (field: ServiceField) => {
    const inputId = `svc-field-${field.key}`;
    const invalid = hasError(formErrorKey.field(field.key));
    const value = data[field.key] ?? "";

    if (field.type === "linked_service") {
      const draft = inline[field.key];
      if (draft) return renderInlineForm(field, draft);
      const targetExists = serviceTypes.some((st) => st.id === field.linkedServiceTypeId);
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <LinkedServicePicker
              id={inputId}
              field={field}
              value={value}
              onChange={(next) => setField(field.key, next)}
              services={services}
              excludeId={mainId}
              invalid={invalid}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setInline((prev) => ({ ...prev, [field.key]: newDraft() }))}
              disabled={!targetExists}
              className="bg-green-600 hover:bg-green-700 border-green-600 text-white"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t("modals.create_service.create_new_service")}
            </Button>
          </div>
          {!targetExists && <p className="text-xs text-yellow-400">{t("modals.create_service.linked_type_missing")}</p>}
        </div>
      );
    }

    return (
      <ValueInput
        id={inputId}
        field={field}
        value={value}
        onChange={(next) => setField(field.key, next)}
        services={services}
        excludeId={mainId}
        invalid={invalid}
      />
    );
  };

  const errorCount = Object.keys(errors).length;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !savingRef.current) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("modals.create_service.edit_title") : t("modals.create_service.create_title")}</DialogTitle>
          <DialogDescription>
            {isEdit ? t("modals.create_service.edit_description") : t("modals.create_service.create_description")}
          </DialogDescription>
        </DialogHeader>
        <form
          id="service-form"
          noValidate
          className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto pr-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="service-label">
              {t("modals.create_service.label")} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="service-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("modals.create_service.label_placeholder")}
              aria-invalid={hasError(formErrorKey.label) || undefined}
              className={cn("bg-gray-700 border-gray-600", hasError(formErrorKey.label) && "border-red-500")}
            />
            {hasError(formErrorKey.label) && <RequiredMessage message={t("modals.create_service.errors.label_required")} />}
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-type">
              {t("modals.create_service.type")} <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedType ? typeId : ""} onValueChange={(value) => void handleTypeChange(value)}>
              <SelectTrigger
                id="service-type"
                aria-invalid={hasError(formErrorKey.type) || undefined}
                className={cn("bg-gray-700 border-gray-600", hasError(formErrorKey.type) && "border-red-500")}
              >
                <SelectValue placeholder={t("modals.create_service.select_type_placeholder")} />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                {serviceTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeMissing && (
              <p className="flex items-start gap-1 text-xs text-yellow-400">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {t("modals.create_service.type_missing")}
              </p>
            )}
            {hasError(formErrorKey.type) && !typeMissing && (
              <RequiredMessage message={t("modals.create_service.errors.type_required")} />
            )}
          </div>

          {selectedType?.fields.map((field) => (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={`svc-field-${field.key}`}>
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </Label>
              {renderField(field)}
              {hasError(formErrorKey.field(field.key)) && <RequiredMessage message={requiredText} />}
              {hasWarning(formErrorKey.field(field.key)) && (
                <RequiredWarning message={t("modals.create_service.errors.required_warning")} />
              )}
            </div>
          ))}

          <div className="space-y-2">
            <Label htmlFor="service-tags">{t("modals.create_service.tags")}</Label>
            <Input
              id="service-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("modals.create_service.tags_placeholder")}
              className="bg-gray-700 border-gray-600"
            />
          </div>
          {/* Lets Enter in a single-line input submit the form. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
        {(notice || (showErrors && errorCount > 0)) && (
          <div className="space-y-1 text-sm" role="status">
            {notice && <p className="text-yellow-400">{notice}</p>}
            {showErrors && errorCount > 0 && <p className="text-red-400">{t("modals.create_service.errors.fix_fields")}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="border-gray-600">
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="service-form"
            disabled={saving}
            className="bg-gradient-to-r from-blue-600 to-purple-700"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {saving ? t("modals.create_service.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
