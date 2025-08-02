import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Shield, Download, Upload, Trash2, Save, Languages } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store";
import type { Settings } from "@/types";
import { toast } from "sonner";

export default function SettingsPage() {
    const { vault, updateSettings, changePassword } = useVaultStore();
    const { t, i18n } = useTranslation();
    const [settings, setSettings] = useState<Settings | null>(vault?.settings || null);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    useEffect(() => {
        if(vault?.settings) {
            setSettings(vault.settings);
        }
    }, [vault?.settings]);

    const handleSettingsChange = (change: Partial<Settings>) => {
        if(settings) {
            setSettings({ ...settings, ...change });
        }
    }

    const handleSave = async () => {
        if(settings) {
            await updateSettings(settings);
            toast.success(t('settings.notifications.saved'));
        }
    }

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
    }

    const handleChangePassword = async () => {
        if (newPassword !== confirmPassword) {
            toast.error(t('settings.notifications.passwords_do_not_match'));
            return;
        }
        if (newPassword.length < 8) {
            toast.error(t('settings.notifications.password_too_short'));
            return;
        }
        try {
            await changePassword(currentPassword, newPassword);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            toast.success(t('settings.notifications.password_changed'));
        } catch (error) {
            // Error toast is shown by the API layer
        }
    }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-3xl font-bold text-white mb-2">{t('settings.title')}</h1>
            <p className="text-gray-400">{t('settings.description')}</p>
        </div>
        <Button onClick={handleSave} className="bg-gradient-to-r from-blue-600 to-purple-700">
            <Save className="w-4 h-4 mr-2" />
            {t('settings.save_button')}
        </Button>
      </div>

      {/* Language Settings */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-purple-500" />
            <CardTitle className="text-white">{t('settings.language.title')}</CardTitle>
          </div>
          <CardDescription className="text-gray-400">{t('settings.language.description')}</CardDescription>
        </CardHeader>
        <CardContent>
            <Select value={i18n.language} onValueChange={changeLanguage}>
                <SelectTrigger className="w-48 bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="uk">Українська</SelectItem>
                </SelectContent>
            </Select>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-white">{t('settings.security.title')}</CardTitle>
          </div>
          <CardDescription className="text-gray-400">{t('settings.security.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="autoLockTime" className="text-gray-300">
                {t('settings.autolock.label')}
              </Label>
              <p className="text-sm text-gray-400">{t('settings.autolock.description')}</p>
              <Select 
                value={String(settings?.autoLockMinutes || 0)}
                onValueChange={(value) => handleSettingsChange({ autoLockMinutes: Number(value) })}
              >
                <SelectTrigger className="w-48 bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
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

          <Separator className="bg-gray-700" />

          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white">{t('settings.password.title')}</h3>
            <p className="text-sm text-gray-400">{t('settings.password.description')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword" className="text-gray-300">
                  {t('settings.password.current')}
                </Label>
                <Input id="currentPassword" type="password" className="bg-gray-700 border-gray-600 text-white" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-gray-300">
                  {t('settings.password.new')}
                </Label>
                <Input id="newPassword" type="password" className="bg-gray-700 border-gray-600 text-white" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-300">
                  {t('settings.password.confirm')}
                </Label>
                <Input id="confirmPassword" type="password" className="bg-gray-700 border-gray-600 text-white" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleChangePassword} className="bg-gradient-to-r from-blue-600 to-purple-700">{t('settings.password.change_button')}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Backup & Export */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-green-500" />
            <CardTitle className="text-white">{t('settings.backup.title')}</CardTitle>
          </div>
          <CardDescription className="text-gray-400">{t('settings.backup.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Button variant="outline" className="border-gray-600 text-gray-300 bg-transparent" disabled>
              <Download className="w-4 h-4 mr-2" />
              {t('settings.backup.export_button')}
            </Button>
            <Button variant="outline" className="border-gray-600 text-gray-300 bg-transparent" disabled>
              <Upload className="w-4 h-4 mr-2" />
              {t('settings.backup.import_button')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="bg-gray-800 border-red-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-500" />
            <CardTitle className="text-white">{t('settings.danger.title')}</CardTitle>
          </div>
          <CardDescription className="text-gray-400">{t('settings.danger.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
            <h3 className="text-lg font-medium text-red-400 mb-2">{t('settings.danger.delete_title')}</h3>
            <p className="text-sm text-gray-400 mb-4">{t('settings.danger.delete_description')}</p>
            <Button variant="destructive" className="bg-red-600 hover:bg-red-700" disabled>
              <Trash2 className="w-4 h-4 mr-2" />
              {t('settings.danger.delete_button')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <CardTitle className="text-white">{t('settings.about.title', 'About AccMan')}</CardTitle>
          </div>
          <CardDescription className="text-gray-400">{t('settings.about.description', 'Information about the application')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-400">
              {t('settings.about.developer', 'Developer')}: 
              <a href="https://github.com/romirom11" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">@romirom11</a>
            </p>
            <p className="text-sm text-gray-400">
              {t('settings.about.repository', 'Repository')}: 
              <a href="https://github.com/romirom11/AccMan" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">github.com/romirom11/AccMan</a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
