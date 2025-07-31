"use client"

import type React from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"

export default function LockScreen() {
  const { t } = useTranslation();
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  
  const { appStatus, error, unlock, resetError } = useVaultStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (appStatus === 'error') {
        resetError();
        return;
    }

    await unlock(password).catch(() => { /* Error is handled by the store */ })
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-900">
      <Card className="w-full max-w-md bg-gray-800 border-gray-700">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-white rounded-full flex items-center justify-center">
            <img src="/accman.png" alt="AccMan" className="w-10 h-10" />
          </div>
          <CardTitle className="text-2xl font-bold text-white">AccMan</CardTitle>
          <CardDescription className="text-gray-400">
            {t('lock_screen.title')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">
                {t('lock_screen.password_label')}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-gray-700 border-gray-600 text-white pr-10"
                  placeholder={t('lock_screen.password_placeholder')}
                  required
                  disabled={appStatus === 'loading'}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:text-white"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={appStatus === 'loading'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {appStatus === "error" && error && (
              <div className="text-red-400 text-sm text-center p-2 bg-red-900/20 rounded-md">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 flex items-center justify-center gap-2"
              disabled={appStatus === 'loading'}
            >
              {appStatus === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
              {appStatus === 'error' ? t('lock_screen.retry_button') : t('lock_screen.unlock_button')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
