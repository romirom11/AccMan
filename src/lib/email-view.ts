// Pure helpers for the email viewer: the sandboxed HTML document, inert links, dates and the
// "wait for code" matching. Only type imports from "@/", so it also runs under `node --test`.
import type { EmailMessage } from "@/types"

/**
 * CSP of the email document. Nothing may load (no remote images, fonts, styles, frames or
 * scripts); only inline styles and data: images/fonts are allowed. The iframe is additionally
 * sandboxed with `sandbox=""` (no scripts, no same-origin, no navigation of the app, no forms).
 */
export const EMAIL_FRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'"

/** Readable dark-on-light defaults: most HTML mail is designed for a white background. */
export const EMAIL_FRAME_BASE_STYLE = [
  "html{color-scheme:light}",
  "body{margin:0;padding:16px;background:#ffffff;color:#111827;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}",
  "img{max-width:100%;height:auto}",
  "table{max-width:100%}",
  "pre{white-space:pre-wrap}",
  "a,a[data-href]{color:#2563eb;text-decoration:underline;cursor:default}",
].join("")

/**
 * The complete `srcdoc` for the email iframe. The CSP meta comes first in <head>, before any email
 * content, so it applies to everything the email contains.
 */
export function buildEmailSrcDoc(bodyHtml: string): string {
  return (
    "<!DOCTYPE html><html><head>" +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${EMAIL_FRAME_CSP}">` +
    '<meta name="referrer" content="no-referrer">' +
    `<style>${EMAIL_FRAME_BASE_STYLE}</style>` +
    `</head><body>${bodyHtml}</body></html>`
  )
}

/**
 * Removed together with everything inside them. <template> (declarative shadow DOM: its content is
 * invisible to querySelectorAll but becomes live markup in the iframe), and whole <svg>/<math>
 * subtrees (SVG animation elements such as <set>/<animate> can re-create a link target, and foreign
 * content parses differently); legitimate mail does not need them.
 */
const REMOVED_ELEMENTS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "link",
  "meta",
  "portal",
  "template",
  "svg",
  "math",
])
const URL_ATTRIBUTES = new Set(["src", "background", "poster", "data", "lowsrc", "dynsrc"])

/**
 * Makes email HTML inert before it goes into the sandboxed iframe (defence in depth; the sandbox
 * and the CSP are the actual protection): removes scripts, frames, <base>, <link>, every <meta>
 * (refresh), <template>, <svg> and <math>, event handlers and remote resource URLs, and turns
 * links into plain text whose URL is only shown as a tooltip. Uses DOMParser, whose documents never
 * run scripts or load anything.
 */
export function sanitizeEmailHtml(html: string): string {
  if (typeof DOMParser === "undefined") return stripDangerousMarkup(html)
  const doc = new DOMParser().parseFromString(html, "text/html")
  // Compared by lower-cased tag name: selectors are case-sensitive for foreign (SVG) elements.
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (el.isConnected && REMOVED_ELEMENTS.has(el.tagName.toLowerCase())) el.remove()
  }
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (
        name.startsWith("on") ||
        name.startsWith("shadowroot") ||
        name === "srcset" ||
        name === "ping" ||
        name === "action" ||
        name === "formaction" ||
        name === "target" ||
        name === "http-equiv"
      ) {
        el.removeAttribute(attr.name)
      } else if (name === "href" || name.endsWith(":href")) {
        const href = attr.value.trim()
        el.removeAttribute(attr.name)
        if (href && el.tagName.toLowerCase() === "a") {
          el.setAttribute("data-href", href)
          if (!el.hasAttribute("title")) el.setAttribute("title", href)
        }
      } else if (URL_ATTRIBUTES.has(name) && !/^\s*data:/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  })
  const headStyles = Array.from(doc.head.querySelectorAll("style"))
    .map((style) => style.outerHTML)
    .join("")
  return headStyles + doc.body.innerHTML
}

/** Regex fallback used only where DOMParser does not exist (tests); never relied on for safety. */
export function stripDangerousMarkup(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:script|iframe|frame|frameset|object|embed|applet|base|link|meta|portal|template|svg|math)\b[^>]*>/gi, "")
    .replace(/<\/(?:iframe|frameset|object|applet|portal)\s*>/gi, "")
    .replace(
      /\s(?:on[a-z]+|href|xlink:href|srcset|action|formaction|target|ping|shadowroot[a-z]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
}

/** "1:05" for 65 000 ms; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

/** Date of a message in the app locale, falling back to the raw Date header. */
export function formatEmailDate(timestamp: number | null | undefined, raw: string, locale: string): string {
  if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0) {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))
    } catch {
      // Fall through to the raw header.
    }
  }
  return raw
}

/** Port from the `imap_port` field: an integer 1..65535, otherwise undefined (backend default 993). */
export function parseImapPort(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!/^\d{1,5}$/.test(trimmed)) return undefined
  const port = Number(trimmed)
  return port >= 1 && port <= 65535 ? port : undefined
}

// ---------------------------------------------------------------------------------------------
// "Wait for code"

export const CODE_WAIT_INTERVAL_MS = 5_000
export const CODE_WAIT_TIMEOUT_MS = 120_000
/**
 * On the baseline poll, a message not shown before waiting counts as new when its Date is at most
 * this long before the click: the code was often requested (and delivered) a few seconds before
 * the user switched to the app and pressed the button.
 */
export const CODE_WAIT_RECENT_MS = 90_000
/** Tolerance for clocks that disagree (sender vs. this computer) when comparing Date headers. */
export const CODE_WAIT_CLOCK_SKEW_MS = 10_000

export interface CodeMatch {
  message: EmailMessage
  code: string
}

export interface CodeMatchOptions {
  /**
   * Ids never matched. On the baseline poll: the messages shown before waiting. On later polls:
   * those plus every message of the baseline poll and of each later poll.
   */
  knownIds: ReadonlySet<string>
  /**
   * True for the poll that takes the baseline when the user starts waiting. An old message cannot
   * be told from a new one by id yet, so in it only messages whose Date lies in the recent window
   * around the click (`since`) count as new; everything else (including messages without a usable
   * timestamp) is baseline only.
   */
  baseline: boolean
  /** When the user started waiting (ms since epoch). Required for the baseline poll to match. */
  since?: number
  /** When the poll ran (ms since epoch); defaults to `since`. Bounds future-dated messages. */
  now?: number
}

/** True when a baseline-poll message's Date lies in the window around the click. */
function isRecentOnBaseline(message: EmailMessage, since: number, now: number): boolean {
  const ts = message.timestamp
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return false
  return ts >= since - CODE_WAIT_RECENT_MS - CODE_WAIT_CLOCK_SKEW_MS && ts <= Math.max(now, since) + CODE_WAIT_CLOCK_SKEW_MS
}

/** Numeric IMAP UID of a message id ("42"), or null for fallback ids such as "seq-5". */
function messageUid(id: string): number | null {
  return /^\d+$/.test(id) ? Number(id) : null
}

/** Newest first: by IMAP UID (UIDs only grow), by timestamp when a UID is unavailable. */
function compareNewestFirst(a: EmailMessage, b: EmailMessage): number {
  const uidA = messageUid(a.id)
  const uidB = messageUid(b.id)
  if (uidA !== null && uidB !== null && uidA !== uidB) return uidB - uidA
  return (b.timestamp || 0) - (a.timestamp || 0)
}

/**
 * The newest new message that carries a verification code, with its first code. A message is never
 * new when its id is known (it was shown before waiting or seen by an earlier poll).
 *
 * - Baseline poll: an unknown message is new only if its Date is within CODE_WAIT_RECENT_MS (plus
 *   the clock-skew tolerance) before the click, so a code delivered just before the button was
 *   pressed is still found. Older or undated messages are baseline only.
 * - Later polls: any unknown id is new; the Date header does not matter (it may be back-dated or
 *   the clocks may disagree).
 */
export function findNewCodeMessage(messages: readonly EmailMessage[], options: CodeMatchOptions): CodeMatch | null {
  let isNew: (message: EmailMessage) => boolean = () => true
  if (options.baseline) {
    const since = options.since
    if (typeof since !== "number" || !Number.isFinite(since)) return null
    const now = options.now ?? since
    isNew = (message) => isRecentOnBaseline(message, since, now)
  }
  const candidates = messages
    .filter((message) => message.verificationCodes.length > 0 && !options.knownIds.has(message.id) && isNew(message))
    .sort(compareNewestFirst)
  const message = candidates[0]
  return message ? { message, code: message.verificationCodes[0] } : null
}
