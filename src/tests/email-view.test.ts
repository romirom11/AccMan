import { test } from "node:test"
import assert from "node:assert/strict"
import type { EmailMessage } from "../types/index.ts"
import {
  CODE_WAIT_CLOCK_SKEW_MS,
  CODE_WAIT_RECENT_MS,
  EMAIL_FRAME_CSP,
  buildEmailSrcDoc,
  findNewCodeMessage,
  formatCountdown,
  formatEmailDate,
  parseImapPort,
  sanitizeEmailHtml,
  stripDangerousMarkup,
} from "../lib/email-view.ts"

function message(id: string, timestamp: number, codes: string[] = []): EmailMessage {
  return {
    id,
    subject: `Subject ${id}`,
    from: "noreply@example.com",
    date: "Wed, 12 Nov 2025 10:00:00 +0000",
    timestamp,
    bodyPreview: "",
    bodyContent: "",
    bodyHtml: null,
    hasVerificationCode: codes.length > 0,
    verificationCodes: codes,
  }
}

test("srcdoc starts with the strict CSP before any email content", () => {
  const doc = buildEmailSrcDoc('<meta http-equiv="Content-Security-Policy" content="default-src *"><p>Hi</p>')
  const cspIndex = doc.indexOf(`<meta http-equiv="Content-Security-Policy" content="${EMAIL_FRAME_CSP}">`)
  assert.ok(cspIndex > 0)
  assert.ok(cspIndex < doc.indexOf("default-src *"))
  assert.ok(cspIndex < doc.indexOf("<body>"))
  assert.match(EMAIL_FRAME_CSP, /default-src 'none'/)
  assert.match(EMAIL_FRAME_CSP, /img-src data:(;|$)/)
  assert.doesNotMatch(EMAIL_FRAME_CSP, /script-src|https?:/)
})

test("sanitizer fallback strips scripts, meta refresh, handlers and links", () => {
  // node has no DOMParser, so sanitizeEmailHtml uses the regex fallback here.
  const html =
    '<meta http-equiv="refresh" content="0;url=https://evil"><script>alert(1)</script>' +
    '<img src=x onerror="steal()"><a href="https://phish" target=_top>Login</a><iframe src="https://x"></iframe>'
  const out = sanitizeEmailHtml(html)
  assert.equal(out, stripDangerousMarkup(html))
  assert.doesNotMatch(out, /script|refresh|onerror|href|iframe|target/i)
  assert.match(out, /<a>Login<\/a>/)
})

test("countdown formatting", () => {
  assert.equal(formatCountdown(120_000), "2:00")
  assert.equal(formatCountdown(65_001), "1:06")
  assert.equal(formatCountdown(4_000), "0:04")
  assert.equal(formatCountdown(-5), "0:00")
})

test("dates use the timestamp in the locale, else the raw header", () => {
  const ts = Date.UTC(2025, 10, 12, 10, 0, 0)
  assert.notEqual(formatEmailDate(ts, "raw", "en"), "raw")
  assert.match(formatEmailDate(ts, "raw", "en"), /2025/)
  assert.equal(formatEmailDate(0, "raw header", "uk"), "raw header")
  assert.equal(formatEmailDate(undefined, "", "en"), "")
})

test("IMAP port parsing", () => {
  assert.equal(parseImapPort("993"), 993)
  assert.equal(parseImapPort(" 143 "), 143)
  assert.equal(parseImapPort("0"), undefined)
  assert.equal(parseImapPort("70000"), undefined)
  assert.equal(parseImapPort("99a"), undefined)
  assert.equal(parseImapPort(undefined), undefined)
})

test("sanitizer fallback drops template (declarative shadow DOM), svg and math subtrees", () => {
  const html =
    '<div id=host><template shadowrootmode=open><a href="https://phish.example/login">Verify</a>' +
    '<img src="https://t.example/p.gif"></template></div>' +
    '<svg><a><set attributeName="href" to="https://phish.example/x"/><text>Click</text></a></svg>' +
    '<SVG><animate attributeName="href" values="https://phish.example/y"/></SVG>' +
    '<math><mtext><a href="https://phish.example/m">m</a></mtext></math><p shadowrootmode="open">ok</p>'
  const out = sanitizeEmailHtml(html)
  assert.equal(out, stripDangerousMarkup(html))
  assert.doesNotMatch(out, /phish|template|shadowroot|<svg|<\/svg|<set|<animate|<math|t\.example/i)
  assert.match(out, /<div id=host><\/div>/)
  assert.match(out, /<p>ok<\/p>/)
})

test("wait for code: the baseline poll ignores old messages, later polls match any unseen id", () => {
  const baselineMessages = [message("10", 1_000, ["101010"]), message("11", 2_000, ["111111"])]
  assert.equal(findNewCodeMessage(baselineMessages, { knownIds: new Set(), baseline: true }), null)
  assert.equal(
    findNewCodeMessage(baselineMessages, { knownIds: new Set(), baseline: true, since: 1_000_000, now: 1_002_000 }),
    null,
  )
  const known = new Set(baselineMessages.map((m) => m.id))
  assert.equal(findNewCodeMessage(baselineMessages, { knownIds: known, baseline: false }), null)
  // Delivered late with a Date header far older than the click (or a skewed clock): still new.
  const backDated = message("12", 500, ["121212"])
  assert.equal(findNewCodeMessage([...baselineMessages, backDated], { knownIds: known, baseline: false })?.code, "121212")
})

test("wait for code: a code mail delivered just before the click is matched on the baseline poll", () => {
  const since = Date.UTC(2026, 10, 12, 10, 0, 0)
  const now = since + 1_500
  const justArrived = message("30", since - 5_000, ["303030"])
  const match = findNewCodeMessage([message("29", since - 3_600_000, ["292929"]), justArrived], {
    knownIds: new Set(),
    baseline: true,
    since,
    now,
  })
  assert.equal(match?.message.id, "30")
  assert.equal(match?.code, "303030")
  // Edge of the window: 90 s plus the clock-skew tolerance before the click.
  const edge = message("31", since - CODE_WAIT_RECENT_MS - CODE_WAIT_CLOCK_SKEW_MS, ["313131"])
  assert.equal(findNewCodeMessage([edge], { knownIds: new Set(), baseline: true, since, now })?.code, "313131")
  // Arrived between the click and the baseline poll.
  const afterClick = message("32", since + 1_000, ["323232"])
  assert.equal(findNewCodeMessage([afterClick], { knownIds: new Set(), baseline: true, since, now })?.code, "323232")
})

test("wait for code: old, undated, future-dated and already displayed mail is baseline only", () => {
  const since = Date.UTC(2026, 10, 12, 10, 0, 0)
  const now = since + 1_500
  const opts = { knownIds: new Set<string>(), baseline: true, since, now }
  // Older than the recent window.
  const old = message("40", since - CODE_WAIT_RECENT_MS - CODE_WAIT_CLOCK_SKEW_MS - 1, ["404040"])
  assert.equal(findNewCodeMessage([old], opts), null)
  assert.equal(findNewCodeMessage([message("41", since - 3_600_000, ["414141"])], opts), null)
  // No usable timestamp.
  assert.equal(findNewCodeMessage([message("42", 0, ["424242"])], opts), null)
  assert.equal(findNewCodeMessage([message("43", Number.NaN, ["434343"])], opts), null)
  // Dated far in the future.
  assert.equal(findNewCodeMessage([message("44", now + CODE_WAIT_CLOCK_SKEW_MS + 1, ["444444"])], opts), null)
  // Recent, but already shown in the list before the user pressed the button.
  const shown = message("45", since - 5_000, ["454545"])
  assert.equal(findNewCodeMessage([shown], { ...opts, knownIds: new Set(["45"]) }), null)
})

test("wait for code: a new id on a later poll matches regardless of its Date", () => {
  const since = Date.UTC(2026, 10, 12, 10, 0, 0)
  const baselineMessages = [message("50", since - 3_600_000, ["505050"])]
  const known = new Set<string>()
  assert.equal(findNewCodeMessage(baselineMessages, { knownIds: known, baseline: true, since, now: since }), null)
  for (const m of baselineMessages) known.add(m.id)
  const now = since + 10_000
  for (const ts of [since - 86_400_000, 0, since + 5_000, since + 86_400_000]) {
    const later = message("51", ts, ["515151"])
    assert.equal(
      findNewCodeMessage([...baselineMessages, later], { knownIds: known, baseline: false, since, now })?.code,
      "515151",
    )
  }
  // Seen by the baseline poll: never matched later, even though it carries a code.
  assert.equal(findNewCodeMessage(baselineMessages, { knownIds: known, baseline: false, since, now }), null)
})

test("wait for code: newest by UID first, timestamp only when ids are not UIDs, first code", () => {
  const messages = [
    message("20", 9_000, ["202020", "999999"]),
    message("21", 1_000, ["212121"]),
    message("22", 5_000),
  ]
  const match = findNewCodeMessage(messages, { knownIds: new Set(), baseline: false })
  assert.equal(match?.message.id, "21")
  assert.equal(findNewCodeMessage(messages, { knownIds: new Set(["21"]), baseline: false })?.code, "202020")
  const seq = [message("seq-1", 1_000, ["000001"]), message("seq-2", 3_000, ["000002"]), message("seq-3", 0, ["000003"])]
  assert.equal(findNewCodeMessage(seq, { knownIds: new Set(), baseline: false })?.code, "000002")
  assert.equal(findNewCodeMessage(seq.slice(2), { knownIds: new Set(), baseline: false })?.code, "000003")
})
