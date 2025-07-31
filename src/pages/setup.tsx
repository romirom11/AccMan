"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { vaultApi } from "@/api/vault";
import { ServiceType, Settings } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useVaultStore } from "@/stores/vault-store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const stepVariants = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -50 },
};

// Step 1: Language Selection
function LanguageStep({ onNext }: { onNext: () => void }) {
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    onNext();
  };

  return (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" key="lang" layout>
      <h2 className="text-2xl font-bold text-center mb-2">{t('setup.language.title')}</h2>
      <p className="text-gray-400 mb-6 text-center">{t('setup.language.description')}</p>
      <div className="flex gap-4">
        <Button onClick={() => changeLanguage("en")} className="w-full">English</Button>
        <Button onClick={() => changeLanguage("uk")} className="w-full">Українська</Button>
      </div>
    </motion.div>
  );
}

// Step 2: Service Selection
function ServiceSelectionStep({ onNext, onBack }: { onNext: (selectedIds: string[]) => void; onBack: () => void; }) {
  const { t } = useTranslation();
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    vaultApi.getDefaultServiceTypesList().then(types => {
      setServiceTypes(types);
      const initialSelection = types.reduce((acc, type) => ({ ...acc, [type.id]: true }), {});
      setSelected(initialSelection);
    });
  }, []);

  const toggleSelection = (id: string) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleNext = () => {
    const selectedIds = Object.entries(selected).filter(([, isSelected]) => isSelected).map(([id]) => id);
    onNext(selectedIds);
  };
  
  return (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" key="services" layout>
        <h2 className="text-2xl font-bold text-center mb-2">{t('setup.services.title')}</h2>
        <p className="text-gray-400 mb-6 text-center">{t('setup.services.description')}</p>
        <div className="grid grid-cols-2 gap-4 max-h-60 overflow-y-auto p-1">
            {serviceTypes.map(type => (
                <motion.div whileHover={{ scale: 1.03 }} key={type.id} className="flex items-center space-x-2 p-3 bg-gray-700 rounded-md cursor-pointer" onClick={() => toggleSelection(type.id)}>
                    <Checkbox id={type.id} checked={selected[type.id] || false} onCheckedChange={() => toggleSelection(type.id)} />
                    <Label htmlFor={type.id} className="flex-1 cursor-pointer">{type.name}</Label>
                </motion.div>
            ))}
        </div>
        <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={onBack}>{t('setup.back')}</Button>
            <Button onClick={handleNext}>{t('setup.next')}</Button>
        </div>
    </motion.div>
  )
}


// Step 3: Password and Settings
function PasswordStep({ onBack, selectedServiceTypeIds }: { onBack: () => void; selectedServiceTypeIds: string[]; }) {
  const { t } = useTranslation();
  const { createVault, appStatus } = useVaultStore();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);

  const handleCreateVault = async () => {
      if (password !== confirmPassword) {
        toast.error(t('errors.passwords_do_not_match'));
        return;
      }
      if (password.length < 8) {
        toast.error(t('errors.password_too_short'));
        return;
      }

    const settings: Settings = { autoLockMinutes };
    await createVault(password, settings, selectedServiceTypeIds);
  };

  return (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" key="password" layout>
      <h2 className="text-2xl font-bold text-center mb-2">{t('setup.password.title')}</h2>
      <p className="text-gray-400 mb-6 text-center">{t('setup.password.description')}</p>
       <div className="space-y-4">
         <div className="space-y-2">
           <Label htmlFor="password">{t('setup.password.master_password')}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-700 border-gray-600"
              />
              <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
         </div>
         <div className="space-y-2">
           <Label htmlFor="confirmPassword">{t('setup.password.confirm_password')}</Label>
           <Input
             id="confirmPassword"
             type={showPassword ? "text" : "password"}
             value={confirmPassword}
             onChange={(e) => setConfirmPassword(e.target.value)}
             className="bg-gray-700 border-gray-600"
           />
         </div>
         <div className="space-y-2">
            <Label>{t('setup.password.autolock_timer')}</Label>
            <Select value={autoLockMinutes.toString()} onValueChange={(val) => setAutoLockMinutes(Number(val))}>
                <SelectTrigger className="bg-gray-700 border-gray-600">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="0">{t('settings.autolock.disabled')}</SelectItem>
                    <SelectItem value="1">{t('settings.autolock.minutes', { count: 1 })}</SelectItem>
                    <SelectItem value="5">{t('settings.autolock.minutes', { count: 5 })}</SelectItem>
                    <SelectItem value="15">{t('settings.autolock.minutes', { count: 15 })}</SelectItem>
                    <SelectItem value="30">{t('settings.autolock.minutes', { count: 30 })}</SelectItem>
                    <SelectItem value="60">{t('settings.autolock.hour', { count: 1 })}</SelectItem>
                </SelectContent>
            </Select>
         </div>
       </div>
        <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={onBack} disabled={appStatus === 'loading'}>{t('setup.back')}</Button>
            <Button onClick={handleCreateVault} disabled={appStatus === 'loading'}>
                {appStatus === 'loading' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t('setup.finish')}
            </Button>
        </div>
    </motion.div>
  )
}

export default function Setup() {
  const [step, setStep] = useState(1);
  const [selectedServiceTypeIds, setSelectedServiceTypeIds] = useState<string[]>([]);
  const { t } = useTranslation();

  const handleNextFromServices = (selectedIds: string[]) => {
    setSelectedServiceTypeIds(selectedIds);
    setStep(3);
  }

  const renderStep = () => {
    switch (step) {
      case 1:
        return <LanguageStep onNext={() => setStep(2)} />;
      case 2:
        return <ServiceSelectionStep onNext={handleNextFromServices} onBack={() => setStep(1)} />;
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
                <CardTitle className="text-center text-3xl font-bold">{t('setup.main_title')}</CardTitle>
                 <CardDescription className="text-center text-gray-400">
                    {t('setup.main_description')}
                </CardDescription>
            </CardHeader>
            <div className="flex justify-center gap-2 mb-4">
                {[1, 2, 3].map((s) => (
                    <div key={s} className={`w-3 h-3 rounded-full transition-colors ${step === s ? 'bg-blue-500' : 'bg-gray-600'}`}></div>
                ))}
            </div>
            <CardContent className="relative">
                <AnimatePresence mode="wait">
                    {renderStep()}
                </AnimatePresence>
            </CardContent>
        </Card>
    </div>
  )
}
