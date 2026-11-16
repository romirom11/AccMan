import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { vaultApi } from "@/api/vault";
import { DEFAULT_SETTINGS, type ServiceType } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { useVaultStore } from "@/stores/vault-store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getErrorMessage, toApiError } from "@/lib/errors";
import { currentLanguage, type SupportedLanguage } from "@/i18n";
import { cn } from "@/lib/utils";
import { PasswordGenerator, PasswordStrengthHint } from "@/components/password-generator";

const MIN_PASSWORD_LENGTH = 8;

const stepVariants = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -50 },
};

// Step 1: Language Selection
function LanguageStep({ onNext }: { onNext: () => void }) {
  const { t, i18n } = useTranslation();
  const active = currentLanguage();

  const changeLanguage = async (lng: SupportedLanguage) => {
    await i18n.changeLanguage(lng);
    onNext();
  };

  const options: { code: SupportedLanguage; label: string }[] = [
    { code: "en", label: "English" },
    { code: "uk", label: "Українська" },
  ];

  return (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" key="lang" layout>
      <h2 className="text-2xl font-bold text-center mb-2">{t("setup.language.title")}</h2>
      <p className="text-gray-400 mb-6 text-center">{t("setup.language.description")}</p>
      <div className="flex gap-4">
        {options.map(({ code, label }) => (
          <Button
            key={code}
            onClick={() => void changeLanguage(code)}
            variant={active === code ? "default" : "outline"}
            className="w-full flex items-center justify-center gap-2"
          >
            {active === code && <Check className="w-4 h-4" />}
            {label}
          </Button>
        ))}
      </div>
    </motion.div>
  );
}

// Step 2: Service Selection (state is owned by Setup so going Back keeps the choices)
interface ServiceSelectionStepProps {
  serviceTypes: ServiceType[] | null;
  loadError: string | null;
  onRetry: () => void;
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSetAll: (value: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

function ServiceSelectionStep({
  serviceTypes,
  loadError,
  onRetry,
  selected,
  onToggle,
  onSetAll,
  onNext,
  onBack,
}: ServiceSelectionStepProps) {
  const { t } = useTranslation();
  const selectedCount = serviceTypes ? serviceTypes.filter((type) => selected[type.id]).length : 0;

  return (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" key="services" layout>
      <h2 className="text-2xl font-bold text-center mb-2">{t("setup.services.title")}</h2>
      <p className="text-gray-400 mb-6 text-center">{t("setup.services.description")}</p>

      {serviceTypes === null && !loadError && (
        <div className="flex items-center justify-center gap-2 text-gray-400 p-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {loadError && (
        <div className="space-y-2">
          <div className="text-red-400 text-sm text-center p-2 bg-red-900/20 rounded-md">
            {t("setup.services.load_failed")} {loadError}
          </div>
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("app.retry")}
            </Button>
          </div>
        </div>
      )}

      {serviceTypes && serviceTypes.length > 0 && (
        <>
          <div className="flex justify-end gap-2 mb-2">
            <Button variant="ghost" size="sm" onClick={() => onSetAll(true)}>
              {t("setup.services.select_all")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onSetAll(false)}>
              {t("setup.services.select_none")}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 max-h-60 overflow-y-auto p-1">
            {serviceTypes.map((type) => (
              <motion.div
                whileHover={{ scale: 1.03 }}
                key={type.id}
                className="flex items-center space-x-2 p-3 bg-gray-700 rounded-md cursor-pointer"
                onClick={() => onToggle(type.id)}
              >
                <Checkbox
                  id={`setup-type-${type.id}`}
                  checked={selected[type.id] ?? false}
                  onCheckedChange={() => onToggle(type.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <Label
                  htmlFor={`setup-type-${type.id}`}
                  className="flex-1 cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {type.name}
                </Label>
              </motion.div>
            ))}
          </div>
          {selectedCount === 0 && (
            <p className="text-sm text-gray-400 text-center mt-3">{t("setup.services.none_selected")}</p>
          )}
        </>
      )}

      <div className="flex justify-between mt-6">
        <Button variant="outline" onClick={onBack}>
          {t("setup.back")}
        </Button>
        <Button onClick={onNext} disabled={serviceTypes === null}>
          {t("setup.next")}
        </Button>
      </div>
    </motion.div>
  );
}

// Step 3: Password and Settings
interface PasswordStepProps {
  onBack: () => void;
  selectedServiceTypeIds: string[];
}

function PasswordStep({ onBack, selectedServiceTypeIds }: PasswordStepProps) {
  const { t } = useTranslation();
  const createVault = useVaultStore((s) => s.createVault);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(DEFAULT_SETTINGS.autoLockMinutes);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const tooShort = password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const valid = !tooShort && password === confirmPassword;

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!valid || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createVault(
        password,
        { ...DEFAULT_SETTINGS, autoLockMinutes },
        selectedServiceTypeIds,
      );
      // On success the route guard leaves the setup page.
    } catch (err) {
      const apiError = toApiError(err);
      // VAULT_EXISTS: the store already switched to the lock screen.
      if (apiError.code !== "VAULT_EXISTS") {
        setSubmitError(getErrorMessage(apiError));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const passwordError = attempted && tooShort ? t("errors.password_too_short") : null;
  const confirmError =
    mismatch || (attempted && !tooShort && password !== confirmPassword) ? t("errors.passwords_do_not_match") : null;

  return (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" key="password" layout>
      <h2 className="text-2xl font-bold text-center mb-2">{t("setup.password.title")}</h2>
      <p className="text-gray-400 mb-6 text-center">{t("setup.password.description")}</p>
      <form onSubmit={handleCreateVault} noValidate>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="setup-password">{t("setup.password.master_password")}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="setup-password"
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  readOnly={submitting}
                  autoComplete="new-password"
                  aria-invalid={passwordError ? true : undefined}
                  className={cn("bg-gray-700 border-gray-600 pr-10", passwordError && "border-red-500")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  tabIndex={-1}
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t("lock_screen.hide_password") : t("lock_screen.show_password")}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <PasswordGenerator
                disabled={submitting}
                confirmReplace={password.length > 0}
                onGenerate={(value) => {
                  // Show it so the user can write it down; the confirmation is filled in too.
                  setPassword(value);
                  setConfirmPassword(value);
                  setShowPassword(true);
                }}
              />
            </div>
            <p className={cn("text-xs", passwordError ? "text-red-400" : "text-gray-400")}>
              {passwordError ?? t("setup.password.min_length_hint", { count: MIN_PASSWORD_LENGTH })}
            </p>
            <PasswordStrengthHint password={password} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-confirm-password">{t("setup.password.confirm_password")}</Label>
            <Input
              id="setup-confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              readOnly={submitting}
              autoComplete="new-password"
              aria-invalid={confirmError ? true : undefined}
              className={cn("bg-gray-700 border-gray-600", confirmError && "border-red-500")}
            />
            {confirmError && <p className="text-xs text-red-400">{confirmError}</p>}
          </div>
          <div className="space-y-2">
            <Label>{t("setup.password.autolock_timer")}</Label>
            <Select
              value={autoLockMinutes.toString()}
              onValueChange={(val) => setAutoLockMinutes(Number(val))}
              disabled={submitting}
            >
              <SelectTrigger className="bg-gray-700 border-gray-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("settings.autolock.disabled")}</SelectItem>
                <SelectItem value="1">{t("settings.autolock.minutes", { count: 1 })}</SelectItem>
                <SelectItem value="5">{t("settings.autolock.minutes", { count: 5 })}</SelectItem>
                <SelectItem value="15">{t("settings.autolock.minutes", { count: 15 })}</SelectItem>
                <SelectItem value="30">{t("settings.autolock.minutes", { count: 30 })}</SelectItem>
                <SelectItem value="60">{t("settings.autolock.hour", { count: 1 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {submitError && (
            <div role="alert" className="text-red-400 text-sm text-center p-2 bg-red-900/20 rounded-md">
              {t("setup.errors.create_failed")} {submitError}
            </div>
          )}
        </div>
        <div className="flex justify-between mt-6">
          <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
            {t("setup.back")}
          </Button>
          <Button type="submit" disabled={submitting} className="flex items-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? t("setup.creating") : t("setup.finish")}
          </Button>
        </div>
      </form>
    </motion.div>
  );
}

export default function Setup() {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const loadServiceTypes = useCallback(async () => {
    setLoadError(null);
    try {
      const types = await vaultApi.getDefaultServiceTypesList({ silent: true });
      setServiceTypes(types);
      // Everything is selected initially; later visits keep the user's choices.
      setSelected((prev) =>
        Object.keys(prev).length > 0 ? prev : Object.fromEntries(types.map((type) => [type.id, true])),
      );
    } catch (err) {
      setLoadError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadServiceTypes();
  }, [loadServiceTypes]);

  const selectedServiceTypeIds = (serviceTypes ?? []).filter((type) => selected[type.id]).map((type) => type.id);

  const renderStep = () => {
    switch (step) {
      case 1:
        return <LanguageStep onNext={() => setStep(2)} />;
      case 2:
        return (
          <ServiceSelectionStep
            serviceTypes={serviceTypes}
            loadError={loadError}
            onRetry={() => void loadServiceTypes()}
            selected={selected}
            onToggle={(id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }))}
            onSetAll={(value) =>
              setSelected(Object.fromEntries((serviceTypes ?? []).map((type) => [type.id, value])))
            }
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        );
      case 3:
        return <PasswordStep onBack={() => setStep(2)} selectedServiceTypeIds={selectedServiceTypeIds} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-900">
      <Card className="w-full max-w-lg bg-gray-800 border-gray-700 text-white overflow-hidden">
        <CardHeader>
          <CardTitle className="text-center text-3xl font-bold">{t("setup.main_title")}</CardTitle>
          <CardDescription className="text-center text-gray-400">{t("setup.main_description")}</CardDescription>
        </CardHeader>
        <div className="flex justify-center gap-2 mb-4">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-3 h-3 rounded-full transition-colors ${step === s ? "bg-blue-500" : "bg-gray-600"}`}
            ></div>
          ))}
        </div>
        <CardContent className="relative">
          <AnimatePresence mode="wait">{renderStep()}</AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}
