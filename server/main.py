import logging
import os
import secrets
import sqlite3
import string
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AnyHttpUrl, BaseModel

DB_PATH = os.getenv("DB_PATH", "links.db")
STATIC_DIR = Path(os.getenv("STATIC_DIR", "../client/dist"))
ALPHABET = string.ascii_letters + string.digits

# Links live 3 days; visit history 14 days (feeds the chart). Rows are purged on every create,
# the only path that grows the links table, so no background job is needed.
ACTIVE = "created_at > datetime('now', '-3 days')"
PURGE = (
    "DELETE FROM links WHERE NOT (" + ACTIVE + ")",
    "DELETE FROM clicks WHERE at < date('now', '-13 days')",
)

RATE_LIMIT, RATE_WINDOW = 5, 60.0  # new links per IP per minute
log = logging.getLogger("uvicorn.error")


def db() -> sqlite3.Connection:
    # dev-note: SQLite file on a Docker volume; swap for RDS Postgres if we ever run >1 instance
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@asynccontextmanager
async def lifespan(_: FastAPI):
    with closing(db()) as conn, conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS links (
                code TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                hits INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"""
        )
        # one row per redirect, feeds the clicks-per-day chart
        conn.execute(
            """CREATE TABLE IF NOT EXISTS clicks (
                code TEXT NOT NULL,
                at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"""
        )
    yield


app = FastAPI(title="Mango Links", lifespan=lifespan)

# dev-note: in-memory sliding window, fine for one process on one box; move to Redis or AWS WAF
# rate rules when there is more than one instance (each would otherwise count separately)
recent: dict[str, deque[float]] = defaultdict(deque)
recent_lock = threading.Lock()  # sync endpoints run in a threadpool


def rate_limit(ip: str) -> None:
    now = time.monotonic()
    with recent_lock:
        q = recent[ip]
        while q and now - q[0] >= RATE_WINDOW:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            wait = int(RATE_WINDOW - (now - q[0])) + 1
            raise HTTPException(
                429, f"Limit is {RATE_LIMIT} links per minute. Try again in {wait}s.",
                headers={"Retry-After": str(wait)},
            )
        q.append(now)
        if len(recent) > 10_000:  # forget idle IPs so memory stays bounded
            for k in [k for k, v in recent.items() if now - v[-1] >= RATE_WINDOW]:
                del recent[k]


class LinkIn(BaseModel):
    url: AnyHttpUrl  # http(s) only, so no javascript: links get stored


@app.get("/health")
def health():
    try:
        with closing(db()) as conn:
            count = conn.execute("SELECT count(*) FROM links").fetchone()[0]
        return {"status": "ok", "database": "ok", "links": count}
    except sqlite3.Error:
        log.exception("health check failed")
        return JSONResponse({"status": "error", "database": "unreachable"}, status_code=503)


@app.get("/api/links")
def list_links():
    with closing(db()) as conn:
        rows = conn.execute(
            "SELECT code, url, hits, created_at, datetime(created_at, '+3 days') AS expires_at"
            f" FROM links WHERE {ACTIVE} ORDER BY rowid DESC LIMIT 20"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/links", status_code=201)
def create_link(body: LinkIn, request: Request):
    # Docker's port mapping keeps the real source IP; X-Forwarded-For is ignored since anyone can fake it
    rate_limit(request.client.host if request.client else "unknown")
    url = str(body.url)
    with closing(db()) as conn, conn:
        for sql in PURGE:
            conn.execute(sql)
        for _ in range(5):
            code = "".join(secrets.choice(ALPHABET) for _ in range(6))
            try:
                conn.execute("INSERT INTO links (code, url) VALUES (?, ?)", (code, url))
                return {"code": code, "url": url, "hits": 0}
            except sqlite3.IntegrityError:
                continue  # code collision, roll again
    raise HTTPException(500, "could not allocate a short code")


@app.get("/api/stats")
def stats():
    with closing(db()) as conn:
        links = conn.execute(f"SELECT count(*) FROM links WHERE {ACTIVE}").fetchone()[0]
        daily = conn.execute(
            "SELECT date(at) AS day, count(*) AS n FROM clicks"
            " WHERE at >= date('now', '-13 days') GROUP BY day"
        ).fetchall()
        top = conn.execute(
            f"SELECT code, url, hits FROM links WHERE {ACTIVE} AND hits > 0"
            " ORDER BY hits DESC, rowid DESC LIMIT 5"
        ).fetchall()
    counts = {r["day"]: r["n"] for r in daily}
    today = datetime.now(UTC).date()
    days = [str(today - timedelta(days=i)) for i in range(13, -1, -1)]  # same UTC clock as SQLite
    return {
        "links": links,
        "clicks": sum(counts.values()),  # visits in the 14-day window, same as the chart
        "daily": [{"day": d, "n": counts.get(d, 0)} for d in days],
        "top": [dict(r) for r in top],
    }


if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")


@app.get("/{code}", include_in_schema=False)
def follow(code: str):
    with closing(db()) as conn, conn:
        row = conn.execute(
            f"UPDATE links SET hits = hits + 1 WHERE code = ? AND {ACTIVE} RETURNING url", (code,)
        ).fetchone()
        if row:
            conn.execute("INSERT INTO clicks (code) VALUES (?)", (code,))
    if not row:
        raise HTTPException(404, "link not found or expired")
    # 302, not 301: browsers cache 301s and we'd stop counting hits
    return RedirectResponse(row["url"], status_code=302)
