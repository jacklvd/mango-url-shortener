import { useEffect, useState, type FormEvent } from "react"
import { CircleAlert, CircleCheck } from "lucide-react"

import { Dashboard } from "@/Dashboard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Link = { code: string; url: string; hits: number; expires_at?: string }

const shortUrl = (code: string) => `${location.origin}/${code}`
// SQLite timestamps are UTC without a zone ("2026-11-05 03:31:57")
const fmtExpiry = (ts: string) =>
  new Date(`${ts.replace(" ", "T")}Z`).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

// navigator.clipboard only exists in secure contexts (HTTPS or localhost).
// The live site is plain HTTP, so fall back to the old textarea + execCommand trick.
async function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.position = "fixed"
  ta.style.opacity = "0"
  document.body.append(ta)
  ta.select()
  document.execCommand("copy")
  ta.remove()
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (code: string) => {
    await copyText(shortUrl(code))
    setCopied(code)
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
  }
  return { copied, copy }
}

export function App() {
  const [view, setView] = useState(location.hash)
  const [healthy, setHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    const onHash = () => setView(location.hash)
    window.addEventListener("hashchange", onHash)
    fetch("/health")
      .then((r) => setHealthy(r.ok))
      .catch(() => setHealthy(false))
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const isDashboard = view === "#dashboard"

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <a href="#" className="flex items-center gap-2 font-heading text-lg font-semibold">
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
            <circle cx="11" cy="14" r="8.5" fill="var(--mango)" />
            <ellipse cx="17" cy="5" rx="4.5" ry="2" transform="rotate(-30 17 5)" fill="var(--leaf)" />
          </svg>
          Mango Links
        </a>
        <nav className="flex gap-1 text-sm">
          {[
            ["#", "Shorten", !isDashboard],
            ["#dashboard", "Dashboard", isDashboard],
          ].map(([href, label, active]) => (
            <a
              key={label as string}
              href={href as string}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground",
                active && "bg-secondary text-foreground"
              )}
            >
              {label}
            </a>
          ))}
        </nav>
        <a
          href="/health"
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          {healthy === false ? (
            <CircleAlert className="size-4 text-destructive" aria-hidden />
          ) : (
            <CircleCheck className={cn("size-4", healthy && "text-leaf")} aria-hidden />
          )}
          {healthy === null ? "Checking…" : healthy ? "All systems working" : "Database unreachable"}
        </a>
      </header>

      <main className="flex-1 py-10 sm:py-16">{isDashboard ? <Dashboard /> : <Shorten />}</main>

      <footer className="text-xs text-muted-foreground">
        Served from AWS EC2. Press <kbd>d</kbd> to switch between light and dark.
      </footer>
    </div>
  )
}

function Shorten() {
  const [url, setUrl] = useState("")
  const [links, setLinks] = useState<Link[] | null>(null)
  const [created, setCreated] = useState<Link | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const { copied, copy } = useCopy()

  const load = () =>
    fetch("/api/links")
      .then((r) => r.json())
      .then(setLinks)

  useEffect(() => {
    load()
  }, [])

  async function shorten(e: FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)
    const r = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).finally(() => setBusy(false))
    if (r.status === 429) return setError((await r.json()).detail)
    if (!r.ok) return setError("That doesn't look like a web address. Start it with http:// or https://")
    setCreated(await r.json())
    setUrl("")
    load()
  }

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Make a long link short.
          </h1>
          <p className="text-muted-foreground">
            Paste any web address. You get a six-character link that redirects to it and counts every visit.
            Links expire after 3 days.
          </p>
        </div>

        <form onSubmit={shorten} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            required
            placeholder="https://example.com/a/very/long/path"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Web address to shorten"
            aria-invalid={!!error}
            className="h-12 bg-card text-base"
          />
          <Button type="submit" disabled={busy} className="h-12 px-6 text-base font-semibold">
            {busy ? "Shortening…" : "Shorten"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="-mt-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {created && (
          <div
            key={created.code}
            className="flex animate-in flex-col gap-3 rounded-xl border-2 border-mango bg-card p-5 duration-300 fade-in slide-in-from-bottom-2 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <a
                href={`/${created.code}`}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-heading text-2xl font-semibold sm:text-3xl"
              >
                {shortUrl(created.code).replace(/^https?:\/\//, "")}
              </a>
              <p className="truncate text-sm text-muted-foreground">goes to {created.url}</p>
            </div>
            <Button size="lg" onClick={() => copy(created.code)} aria-live="polite">
              {copied === created.code ? "Copied" : "Copy link"}
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">Recent links</h2>
        {links?.length === 0 && (
          <p className="text-muted-foreground">No links yet. Shorten one above and it shows up here.</p>
        )}
        {!!links?.length && (
          <ul className="divide-y rounded-xl border bg-card">
            {links.map((l) => (
              <li key={l.code} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <a href={`/${l.code}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    /{l.code}
                  </a>
                  <p className="truncate text-sm text-muted-foreground">{l.url}</p>
                  {l.expires_at && (
                    <p className="text-xs text-muted-foreground">Expires {fmtExpiry(l.expires_at)}</p>
                  )}
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {l.hits} {l.hits === 1 ? "visit" : "visits"}
                </span>
                <Button variant="outline" size="sm" className="w-20" onClick={() => copy(l.code)} aria-live="polite">
                  {copied === l.code ? "Copied" : "Copy"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default App
