"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { AlertCircle, CheckCircle2, Copy, Eye, Hourglass, Loader2, Mail, PlugZap, RefreshCw, ShieldAlert, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { vaultApi } from "@/api/vault"
import { getErrorMessage, isApiError } from "@/lib/errors"
import { copyText } from "@/lib/clipboard"
import { currentLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import {
  CODE_WAIT_INTERVAL_MS,
  CODE_WAIT_TIMEOUT_MS,
  buildEmailSrcDoc,
  findNewCodeMessage,
  formatCountdown,
  formatEmailDate,
  sanitizeEmailHtml,
  type CodeMatch,
} from "@/lib/email-view"
import { useVaultStore } from "@/stores/vault-store"
import type { EmailMessage } from "@/types"

interface EmailViewerProps {
  email: string
  password: string
  /** Explicit IMAP server (the service's `imap_host`); overrides provider detection. */
  imapHost?: string
  imapPort?: number
  /** Name of the service, for the copy toasts. */
  serviceLabel?: string
}

type ConnectionStatus = "idle" | "connecting" | "connected" | "failed"

const FETCH_LIMIT = 10

/** Errors that will not go away by polling again. */
const FATAL_WAIT_ERRORS = ["EMAIL_AUTH", "EMAIL_UNSUPPORTED_PROVIDER"] as const

interface WaitSession {
  since: number
  deadline: number
  /**
   * Ids that never count as new: those shown before waiting, then also every id of the baseline
   * poll and of later polls.
   */
  knownIds: Set<string>
  /**
   * The next successful poll takes the baseline: in it only messages dated shortly before the
   * click count as new (see findNewCodeMessage).
   */
  baselinePending: boolean
  cancelled: boolean
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Inbox of an email service. Nothing connects until the user clicks Connect (the login goes out
 * from this computer's IP). Email HTML is never put into the app DOM: it is shown in a fully
 * sandboxed iframe with its own strict CSP (see lib/email-view.ts).
 */
export function EmailViewer({ email, password, imapHost, imapPort, serviceLabel }: EmailViewerProps) {
  const { t } = useTranslation()
  const locale = currentLanguage()
  const [status, setStatus] = useState<ConnectionStatus>("idle")
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<EmailMessage | null>(null)
  const [viewMode, setViewMode] = useState<"html" | "text">("text")
  const [waiting, setWaiting] = useState<{ since: number; deadline: number } | null>(null)
  const [waitOutcome, setWaitOutcome] = useState<"timeout" | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Bumped on every reset/unmount: results of older requests are ignored.
  const generation = useRef(0)
  // Generation of the running request. A request of an older generation does not block new ones:
  // its result is discarded anyway.
  const inFlightGen = useRef<number | null>(null)
  const waitRef = useRef<WaitSession | null>(null)
  const messagesRef = useRef<EmailMessage[]>([])
  messagesRef.current = messages

  const stopWaiting = useCallback(() => {
    const session = waitRef.current
    if (session) {
      session.cancelled = true
      if (session.timer !== null) clearTimeout(session.timer)
    }
    waitRef.current = null
    setWaiting(null)
  }, [])

  // Fresh state for other credentials (the page is also keyed by service id); stop on unmount/lock.
  useEffect(() => {
    const gen = generation
    gen.current++
    stopWaiting()
    setStatus("idle")
    setBusy(false)
    setMessages([])
    setError(null)
    setViewing(null)
    setWaitOutcome(null)
    setHighlightId(null)
    return () => {
      gen.current++
      stopWaiting()
    }
  }, [email, password, imapHost, imapPort, stopWaiting])

  // Countdown tick while waiting.
  useEffect(() => {
    if (!waiting) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waiting])

  const isFetchRunning = () => inFlightGen.current !== null && inFlightGen.current === generation.current

  /** One fetch; never overlaps another of the same credentials. Resolves to null when skipped or outdated. */
  const runFetch = useCallback(async (): Promise<EmailMessage[] | null> => {
    const gen = generation.current
    if (inFlightGen.current === gen) return null
    inFlightGen.current = gen
    setBusy(true)
    setStatus((prev) => (prev === "connected" ? prev : "connecting"))
    try {
      const result = await vaultApi.fetchRecentEmails(email, password, FETCH_LIMIT, imapHost, imapPort, { silent: true })
      if (gen !== generation.current) return null
      setMessages(result.messages)
      setStatus("connected")
      setError(null)
      return result.messages
    } catch (e) {
      if (gen === generation.current) {
        setError(getErrorMessage(e))
        setStatus("failed")
      }
      throw e
    } finally {
      if (inFlightGen.current === gen) inFlightGen.current = null
      if (gen === generation.current) setBusy(false)
    }
  }, [email, password, imapHost, imapPort])

  const handleFetch = async () => {
    setWaitOutcome(null)
    try {
      await runFetch()
    } catch {
      // Shown inline.
    }
  }

  const announceCode = useCallback(
    async (match: CodeMatch) => {
      // The vault may have been locked while the last request was running.
      const vault = useVaultStore.getState().vault
      if (!vault) return
      setHighlightId(match.message.id)
      const label = serviceLabel ? `${serviceLabel} · ${t("email_viewer.verification_code")}` : t("email_viewer.verification_code")
      const copy = await copyText(match.code, { secret: true, quiet: true, label })
      const description = [
        t("email_viewer.wait.code_from", {
          from: match.message.from,
          subject: match.message.subject || t("email_viewer.no_subject"),
        }),
        copy.ok && copy.autoClear ? t("clipboard.clears_in", { seconds: copy.autoClearSeconds }) : null,
      ]
        .filter(Boolean)
        .join("\n")
      toast.success(
        copy.ok ? t("email_viewer.wait.code_copied", { code: match.code }) : t("email_viewer.wait.code_found", { code: match.code }),
        { description, duration: 10_000 },
      )
    },
    [serviceLabel, t],
  )

  const poll = useCallback(
    async (session: WaitSession) => {
      if (session.cancelled) return
      let fetched: EmailMessage[] | null = null
      try {
        fetched = await runFetch()
      } catch (e) {
        if (session.cancelled) return
        if (isApiError(e, [...FATAL_WAIT_ERRORS])) {
          stopWaiting()
          return
        }
        // Transient (network, timeout): keep trying until the deadline; the error stays visible.
      }
      if (session.cancelled) return
      if (fetched) {
        const match = findNewCodeMessage(fetched, {
          knownIds: session.knownIds,
          baseline: session.baselinePending,
          since: session.since,
          now: Date.now(),
        })
        session.baselinePending = false
        for (const message of fetched) session.knownIds.add(message.id)
        if (match) {
          stopWaiting()
          await announceCode(match)
          return
        }
      }
      const remaining = session.deadline - Date.now()
      if (remaining <= 0) {
        stopWaiting()
        setWaitOutcome("timeout")
        return
      }
      session.timer = setTimeout(() => {
        session.timer = null
        void poll(session)
      }, Math.min(CODE_WAIT_INTERVAL_MS, remaining))
    },
    [announceCode, runFetch, stopWaiting],
  )

  const startWaiting = () => {
    if (waitRef.current) return
    const since = Date.now()
    const session: WaitSession = {
      since,
      deadline: since + CODE_WAIT_TIMEOUT_MS,
      knownIds: new Set(messagesRef.current.map((m) => m.id)),
      baselinePending: true,
      cancelled: false,
      timer: null,
    }
    waitRef.current = session
    setWaiting({ since, deadline: session.deadline })
    setWaitOutcome(null)
    setHighlightId(null)
    if (isFetchRunning()) {
      // A manual fetch is running: start polling after the interval instead of overlapping it.
      session.timer = setTimeout(() => {
        session.timer = null
        void poll(session)
      }, CODE_WAIT_INTERVAL_MS)
    } else {
      void poll(session)
    }
  }

  const openMessage = (message: EmailMessage) => {
    setViewMode(message.bodyHtml ? "html" : "text")
    setViewing(message)
  }

  const srcDoc = useMemo(
    () => (viewing?.bodyHtml ? buildEmailSrcDoc(sanitizeEmailHtml(viewing.bodyHtml)) : ""),
    [viewing],
  )

  if (!email || !password) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-6 text-center">
          <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-400">{t("email_viewer.credentials_required")}</p>
        </CardContent>
      </Card>
    )
  }

  const statusBadge = (() => {
    switch (status) {
      case "connecting":
        return (
          <Badge className="bg-gray-600 text-white">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            {t("email_viewer.status.connecting")}
          </Badge>
        )
      case "connected":
        return (
          <Badge className="bg-green-600 text-white">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            {t("email_viewer.status.connected")}
          </Badge>
        )
      case "failed":
        return (
          <Badge className="bg-red-600 text-white">
            <AlertCircle className="w-3 h-3 mr-1" />
            {t("email_viewer.status.failed")}
          </Badge>
        )
      default:
        return <Badge className="bg-gray-700 text-gray-300">{t("email_viewer.status.idle")}</Badge>
    }
  })()

  const fetchLabel =
    status === "failed"
      ? t("email_viewer.retry")
      : status === "connected"
        ? t("email_viewer.refresh")
        : t("email_viewer.connect")

  return (
    <div className="space-y-4">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Mail className="w-5 h-5" />
              {t("email_viewer.title")}
              {statusBadge}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {waiting ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={stopWaiting}
                  className="border-yellow-600 text-yellow-300 bg-transparent hover:bg-yellow-600/20"
                >
                  <X className="w-4 h-4 mr-2" />
                  {t("email_viewer.wait.cancel", { time: formatCountdown(waiting.deadline - now) })}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startWaiting}
                  disabled={busy}
                  title={t("email_viewer.wait.hint")}
                  className="border-blue-600 text-blue-300 bg-transparent hover:bg-blue-600/20"
                >
                  <Hourglass className="w-4 h-4 mr-2" />
                  {t("email_viewer.wait.start")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleFetch}
                disabled={busy || waiting !== null}
                className="border-gray-600 text-gray-300 bg-transparent"
              >
                {status === "idle" ? (
                  <PlugZap className="w-4 h-4 mr-2" />
                ) : (
                  <RefreshCw className={cn("w-4 h-4 mr-2", busy && "animate-spin")} />
                )}
                {busy ? t("common.loading") : fetchLabel}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2 text-sm">
          {status === "idle" && !waiting && <p className="text-gray-500">{t("email_viewer.ip_notice")}</p>}
          {waiting && (
            <p className="flex items-center gap-2 text-yellow-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("email_viewer.wait.waiting", { time: formatCountdown(waiting.deadline - now) })}
            </p>
          )}
          {waitOutcome === "timeout" && <p className="text-yellow-400">{t("email_viewer.wait.timeout")}</p>}
          {error && (
            <p className="flex items-start gap-2 text-red-400" role="alert">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {status === "connected" && messages.length === 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6 text-center text-gray-400">{t("email_viewer.no_messages")}</CardContent>
        </Card>
      )}

      {messages.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">{t("email_viewer.recent_emails", { count: messages.length })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "border rounded-lg p-4 bg-gray-750",
                  highlightId === message.id ? "border-green-500" : "border-gray-600",
                )}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white font-medium truncate">{message.subject || t("email_viewer.no_subject")}</h4>
                    <p className="text-gray-400 text-sm truncate">{message.from}</p>
                    <p className="text-gray-500 text-xs">{formatEmailDate(message.timestamp, message.date, locale)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {message.verificationCodes.length > 0 && (
                      <Badge className="bg-blue-600 text-white">{t("email_viewer.verification_code")}</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-gray-600 text-gray-300 bg-transparent"
                      onClick={() => openMessage(message)}
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      {t("common.view")}
                    </Button>
                  </div>
                </div>

                {message.verificationCodes.length > 0 && (
                  <div className="mt-3 p-3 bg-blue-900/20 border border-blue-600/30 rounded">
                    <p className="text-blue-400 text-sm font-medium mb-2">{t("email_viewer.verification_codes")}:</p>
                    <div className="flex flex-wrap gap-2">
                      {message.verificationCodes.map((code, index) => (
                        <Button
                          key={`${code}-${index}`}
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void copyText(code, {
                              secret: true,
                              label: serviceLabel
                                ? `${serviceLabel} · ${t("email_viewer.verification_code")}`
                                : t("email_viewer.verification_code"),
                            })
                          }
                          className="border-blue-600 text-blue-400 bg-transparent hover:bg-blue-600 hover:text-white font-mono"
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          {code}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {message.bodyPreview && <div className="mt-3 text-gray-300 text-sm break-words">{message.bodyPreview}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-3xl bg-gray-800 border-gray-700">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle className="text-white pr-6 break-words">
                  {viewing.subject || t("email_viewer.no_subject")}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="text-gray-400 text-sm">
                    <p className="break-words">
                      {t("email_viewer.from")}: {viewing.from}
                    </p>
                    <p>
                      {t("email_viewer.date")}: {formatEmailDate(viewing.timestamp, viewing.date, locale)}
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-2" role="group" aria-label={t("email_viewer.view_mode")}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!viewing.bodyHtml}
                  aria-pressed={viewMode === "html"}
                  onClick={() => setViewMode("html")}
                  className={cn(
                    "border-gray-600 bg-transparent",
                    viewMode === "html" ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700" : "text-gray-300",
                  )}
                >
                  {t("email_viewer.view_html")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={viewMode === "text"}
                  onClick={() => setViewMode("text")}
                  className={cn(
                    "border-gray-600 bg-transparent",
                    viewMode === "text" ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700" : "text-gray-300",
                  )}
                >
                  {t("email_viewer.view_text")}
                </Button>
                {!viewing.bodyHtml && <span className="text-xs text-gray-500">{t("email_viewer.no_html")}</span>}
              </div>

              {viewMode === "html" && viewing.bodyHtml ? (
                <div className="space-y-2">
                  <p className="flex items-start gap-2 text-xs text-yellow-300/90">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    {t("email_viewer.remote_blocked")}
                  </p>
                  {/* sandbox="" = no scripts, no same-origin, no forms, no top navigation. Never add allow-scripts or allow-same-origin. */}
                  <iframe
                    key={viewing.id}
                    title={t("email_viewer.frame_title")}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={srcDoc}
                    className="h-[60vh] w-full rounded border border-gray-600 bg-white"
                  />
                </div>
              ) : (
                <ScrollArea className="h-[60vh] w-full rounded border border-gray-600 p-4">
                  <pre className="text-gray-300 text-sm whitespace-pre-wrap break-words font-mono">{viewing.bodyContent}</pre>
                </ScrollArea>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
