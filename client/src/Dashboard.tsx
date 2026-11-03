import { useEffect, useState } from "react"
import { CircleAlert, CircleCheck } from "lucide-react"

type Stats = {
  links: number
  clicks: number
  daily: { day: string; n: number }[] // last 14 UTC days, oldest first, zeros included
  top: { code: string; url: string; hits: number }[]
}

const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [dbOk, setDbOk] = useState<boolean | null>(null)

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
    fetch("/health")
      .then((r) => setDbOk(r.ok))
      .catch(() => setDbOk(false))
  }, [])

  if (!stats) return <p className="text-muted-foreground">Loading stats…</p>

  const days = stats.daily
  const today = days[days.length - 1].n

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">Dashboard</h1>
        <p className="text-muted-foreground">How the links are being used, read live from the database.</p>
      </div>

      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card sm:grid-cols-4 [&>div]:border-border [&>div]:p-4 max-sm:[&>div:nth-child(-n+2)]:border-b sm:[&>div:not(:last-child)]:border-r max-sm:[&>div:nth-child(odd)]:border-r">
        <Tile label="Active links" value={stats.links.toLocaleString()} />
        <Tile label="Visits, 14 days" value={stats.clicks.toLocaleString()} />
        <Tile label="Visits today" value={today.toLocaleString()} />
        <div>
          <dt className="text-sm text-muted-foreground">Database</dt>
          <dd className="mt-1 flex items-center gap-1.5 font-heading text-xl font-semibold">
            {dbOk === false ? (
              <CircleAlert className="size-5 text-destructive" aria-hidden />
            ) : (
              <CircleCheck className="size-5 text-leaf" aria-hidden />
            )}
            {dbOk === null ? "…" : dbOk ? "Connected" : "Unreachable"}
          </dd>
        </div>
      </dl>

      <VisitsChart days={days} />

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-xl font-semibold">Most visited</h2>
        {stats.top.length === 0 ? (
          <p className="text-muted-foreground">No visits yet. Open a short link and it shows up here.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {stats.top.map((l) => (
              <li key={l.code} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
                <a href={`/${l.code}`} className="font-medium hover:underline">
                  /{l.code}
                </a>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 rounded-r-[4px] bg-leaf"
                    style={{ width: `${(l.hits / stats.top[0].hits) * 85}%` }}
                  />
                  <span className="text-sm tabular-nums">{l.hits}</span>
                </div>
                <p className="col-start-2 truncate text-sm text-muted-foreground">{l.url}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-heading text-3xl font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function VisitsChart({ days }: { days: { day: string; n: number }[] }) {
  const max = Math.max(...days.map((d) => d.n))
  const top = max <= 1 ? 1 : Math.ceil(max / 2) * 2 // clean, even axis max
  const ticks = top === 1 ? [0, 1] : [0, top / 2, top]
  const peak = days.findLastIndex((d) => d.n === max && max > 0)

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">Visits per day</h2>
        <p className="text-sm text-muted-foreground">Last {days.length} days, UTC</p>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        <div className="relative h-48 w-6 text-right text-xs text-muted-foreground tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative h-48">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex">
            {days.map((d, i) => (
              <div
                key={d.day}
                tabIndex={0}
                aria-label={`${fmtDay(d.day)}: ${d.n} visits`}
                className="group relative flex flex-1 items-end justify-center px-px outline-none"
              >
                <div
                  className="w-full max-w-6 rounded-t-[4px] bg-leaf group-hover:opacity-80"
                  style={{ height: `${(d.n / top) * 100}%` }}
                />
                {i === peak && (
                  <span
                    className="absolute text-xs font-medium tabular-nums group-hover:hidden group-focus-visible:hidden"
                    style={{ bottom: `calc(${(d.n / top) * 100}% + 4px)` }}
                  >
                    {d.n}
                  </span>
                )}
                <span className="pointer-events-none absolute -top-2 z-10 hidden -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-sm group-hover:block group-focus-visible:block">
                  {fmtDay(d.day)}: <b className="tabular-nums">{d.n}</b> {d.n === 1 ? "visit" : "visits"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="col-start-2 mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{fmtDay(days[0].day)}</span>
          <span>{fmtDay(days[Math.floor(days.length / 2)].day)}</span>
          <span>Today</span>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
        <table className="mt-2 w-full max-w-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">Day</th>
              <th className="py-1 text-right font-normal">Visits</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t">
                <td className="py-1">{fmtDay(d.day)}</td>
                <td className="py-1 text-right">{d.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
