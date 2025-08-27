"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Mail, RefreshCw, Copy, AlertCircle, CheckCircle2, Eye } from "lucide-react"
import { vaultApi } from "@/api/vault"
import type { EmailMessage, EmailFetchResult, EmailConnection } from "@/types"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

interface EmailViewerProps {
  email: string
  password: string
}

export function EmailViewer({ email, password }: EmailViewerProps) {
  const { t } = useTranslation()
  const [emails, setEmails] = useState<EmailMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connection, setConnection] = useState<EmailConnection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedEmail, setExpandedEmail] = useState<EmailMessage | null>(null)

  const testConnection = async () => {
    setTestingConnection(true)
    setError(null)
    try {
      const result = await vaultApi.testEmailConnection(email, password)
      setConnection(result)
      if (!result.isConnected) {
        setError(result.lastError || t('email_viewer.connection_failed'))
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setTestingConnection(false)
    }
  }

  const fetchEmails = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await vaultApi.fetchRecentEmails(email, password, 5)
      setEmails(result.messages)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success(t("common.copied_to_clipboard"))
  }

  useEffect(() => {
    if (email && password) {
      testConnection()
    }
  }, [email, password])

  if (!email || !password) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-6 text-center">
          <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-400">{t('email_viewer.credentials_required')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Connection Status */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Mail className="w-5 h-5" />
              {t('email_viewer.title')}
            </CardTitle>
            <div className="flex items-center gap-2">
              {connection?.isConnected ? (
                <Badge className="bg-green-600 text-white">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {t('email_viewer.status.connected')}
                </Badge>
              ) : (
                <Badge className="bg-red-600 text-white">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {t('email_viewer.status.disconnected')}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={fetchEmails}
                disabled={loading || testingConnection || !connection?.isConnected}
                className="border-gray-600 text-gray-300"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                {loading ? t('common.loading') : t('email_viewer.fetch_emails')}
              </Button>
            </div>
          </div>
        </CardHeader>
        {error && (
          <CardContent className="pt-0">
            <div className="text-red-400 text-sm">{error}</div>
          </CardContent>
        )}
      </Card>

      {/* Emails List */}
      {emails.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">{t('email_viewer.recent_emails', { count: emails.length })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {emails.map((email) => (
              <div key={email.id} className="border border-gray-600 rounded-lg p-4 bg-gray-750">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white font-medium truncate">{email.subject}</h4>
                    <p className="text-gray-400 text-sm">{email.from}</p>
                    <p className="text-gray-500 text-xs">{email.date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {email.hasVerificationCode && (
                      <Badge className="bg-blue-600 text-white">
                        {t('email_viewer.verification_code')}
                      </Badge>
                    )}
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" className="border-gray-600 text-gray-300">
                          <Eye className="w-3 h-3 mr-1" />
                          {t('common.view')}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl max-h-[80vh] bg-gray-800 border-gray-700">
                        <DialogHeader>
                          <DialogTitle className="text-white">{email.subject}</DialogTitle>
                          <div className="text-gray-400 text-sm">
                            <p>{t('email_viewer.from')}: {email.from}</p>
                            <p>{t('email_viewer.date')}: {email.date}</p>
                          </div>
                        </DialogHeader>
                        <ScrollArea className="h-96 w-full rounded border border-gray-600 p-4">
                          {email.bodyHtml ? (
                            <div 
                              className="text-gray-300 text-sm prose prose-invert max-w-none"
                              dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
                              style={{
                                color: '#d1d5db',
                                backgroundColor: 'transparent'
                              }}
                            />
                          ) : (
                            <pre className="text-gray-300 text-sm whitespace-pre-wrap font-mono">
                              {email.bodyContent}
                            </pre>
                          )}
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
                
                {email.hasVerificationCode && email.verificationCodes.length > 0 && (
                  <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                    <p className="text-blue-400 text-sm font-medium mb-2">{t('email_viewer.verification_codes')}:</p>
                    <div className="flex flex-wrap gap-2">
                      {email.verificationCodes.map((code, index) => (
                        <Button
                          key={index}
                          size="sm"
                          variant="outline"
                          onClick={() => copyToClipboard(code)}
                          className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white font-mono"
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          {code}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="mt-3 text-gray-300 text-sm">
                  {email.bodyPreview}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}