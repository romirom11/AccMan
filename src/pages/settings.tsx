import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { save, open } from '@tauri-apps/plugin-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Shield, Download, Upload, Trash2, Save, Languages, AlertTriangle } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store";
import type { Settings } from "@/types";
import { toast } from "sonner";

export default function SettingsPage() {
    const { vault, updateSettings, changePassword, exportVault, importVault } = useVaultStore();
    const { t, i18n } = useTranslation();
    const [settings, setSettings] = useState<Settings | null>(vault?.settings || null);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    
    // Export dialog state
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [exportPassword, setExportPassword] = useState("");
    const [exportConfirmPassword, setExportConfirmPassword] = useState("");
    
    // Import dialog state
    const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
    const [selectedImportFile, setSelectedImportFile] = useState<string | null>(null);
    const [importPassword, setImportPassword] = useState("");
    const [importStrategy, setImportStrategy] = useState<'replace' | 'merge'>('merge');

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

    const handleExportVault = async () => {
        if (!exportPassword) {
            toast.error(t('settings.backup.errors.password_required'));
            return;
        }
        if (exportPassword !== exportConfirmPassword) {
            toast.error(t('settings.backup.errors.passwords_dont_match'));
            return;
        }
        try {
            const filePath = await save({
                filters: [{
                    name: 'Vault Backup',
                    extensions: ['json']
                }],
                defaultPath: t('settings.backup.export_dialog.default_filename')
            });
            
            if (filePath) {
                await exportVault(filePath);
                setIsExportDialogOpen(false);
                setExportPassword("");
                setExportConfirmPassword("");
            }
        } catch (error) {
            // Error handling is done in the vault store
        }
    };

    const handleImportVault = async () => {
        if (!selectedImportFile) {
            toast.error(t('settings.backup.errors.file_required'));
            return;
        }
        
        if (!importPassword) {
            toast.error(t('settings.backup.errors.password_required'));
            return;
        }
        
        try {
            await importVault(selectedImportFile, importPassword, importStrategy);
            setIsImportDialogOpen(false);
            setImportPassword("");
            setSelectedImportFile(null);
        } catch (error) {
            // Error handling is done in the vault store
        }
    };

    const handleSelectImportFile = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Vault Backup',
                    extensions: ['json']
                }]
            });
            
            if (selected && typeof selected === 'string') {
                setSelectedImportFile(selected);
            }
        } catch (error) {
            console.error('Failed to select import file:', error);
        }
    };

  return (
    <>
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
            <Button 
              onClick={() => setIsExportDialogOpen(true)}
              variant="outline" 
              className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-700"
            >
              <Download className="w-4 h-4 mr-2" />
              {t('settings.backup.export_button')}
            </Button>
            <Button 
              onClick={() => setIsImportDialogOpen(true)}
              variant="outline" 
              className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-700"
            >
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
    
    {/* Export Dialog */}
    <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">{t('settings.backup.export_dialog.title')}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {t('settings.backup.export_dialog.description')}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="exportPassword" className="text-gray-300">
              {t('settings.backup.export_dialog.password_label')}
            </Label>
            <Input
              id="exportPassword"
              type="password"
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              placeholder={t('settings.backup.export_dialog.password_placeholder')}
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="exportConfirmPassword" className="text-gray-300">
              {t('settings.backup.export_dialog.confirm_password_label')}
            </Label>
            <Input
              id="exportConfirmPassword"
              type="password"
              value={exportConfirmPassword}
              onChange={(e) => setExportConfirmPassword(e.target.value)}
              placeholder={t('settings.backup.export_dialog.confirm_password_placeholder')}
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={() => setIsExportDialogOpen(false)}
            className="border-gray-600 text-gray-300"
          >
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={handleExportVault}
            className="bg-gradient-to-r from-blue-600 to-purple-700"
          >
            <Download className="w-4 h-4 mr-2" />
            {t('settings.backup.export_dialog.export_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    
    {/* Import Dialog */}
    <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">{t('settings.backup.import_dialog.title')}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {t('settings.backup.import_dialog.description')}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-gray-300">
              {t('settings.backup.import_dialog.file_label')}
            </Label>
            <div className="flex gap-2">
              <Input
                value={selectedImportFile || ''}
                readOnly
                placeholder="No file selected"
                className="bg-gray-700 border-gray-600 text-white flex-1"
              />
              <Button
                onClick={handleSelectImportFile}
                variant="outline"
                className="border-gray-600 text-gray-300"
              >
                {t('settings.backup.import_dialog.select_file_button')}
              </Button>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="importPassword" className="text-gray-300">
              {t('settings.backup.import_dialog.password_label')}
            </Label>
            <Input
              id="importPassword"
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              placeholder={t('settings.backup.import_dialog.password_placeholder')}
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>
          
          <div className="space-y-3">
            <Label className="text-gray-300">
              {t('settings.backup.import_dialog.strategy_label')}
            </Label>
            <RadioGroup 
              value={importStrategy} 
              onValueChange={(value) => setImportStrategy(value as 'replace' | 'merge')}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="merge" id="merge" className="border-gray-500" />
                <Label htmlFor="merge" className="text-gray-300 cursor-pointer">
                  {t('settings.backup.import_dialog.strategy_merge')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="replace" id="replace" className="border-gray-500" />
                <Label htmlFor="replace" className="text-gray-300 cursor-pointer">
                  {t('settings.backup.import_dialog.strategy_replace')}
                </Label>
              </div>
            </RadioGroup>
            
            {importStrategy === 'replace' && (
              <Alert className="bg-red-900/20 border-red-700">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <AlertDescription className="text-red-300">
                  {t('settings.backup.import_dialog.warnings.replace')}
                </AlertDescription>
              </Alert>
            )}
            
            {importStrategy === 'merge' && (
              <Alert className="bg-blue-900/20 border-blue-700">
                <AlertDescription className="text-blue-300">
                  {t('settings.backup.import_dialog.warnings.merge')}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
        
        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={() => setIsImportDialogOpen(false)}
            className="border-gray-600 text-gray-300"
          >
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={handleImportVault}
            className="bg-gradient-to-r from-blue-600 to-purple-700"
          >
            <Upload className="w-4 h-4 mr-2" />
            {t('settings.backup.import_dialog.import_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
