import os
import tempfile

os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")

import sqlite3  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from main import DB_PATH, app, recent  # noqa: E402


def test_shorten_list_redirect_health():
    recent.clear()
    with TestClient(app) as c:
        assert c.get("/health").json()["database"] == "ok"

        r = c.post("/api/links", json={"url": "https://mangoapps.com"})
        assert r.status_code == 201
        code = r.json()["code"]

        r = c.get(f"/{code}", follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] == "https://mangoapps.com/"

        latest = c.get("/api/links").json()[0]
        assert (latest["code"], latest["hits"]) == (code, 1)
        s = c.get("/api/stats").json()
        assert (s["links"], s["clicks"], len(s["daily"]), s["daily"][-1]["n"]) == (1, 1, 14, 1)
        assert s["top"][0]["code"] == code

        assert c.get("/nope00").status_code == 404
        assert c.post("/api/links", json={"url": "javascript:alert(1)"}).status_code == 422


def test_rate_limit_per_ip():
    recent.clear()
    with TestClient(app) as c:
        for _ in range(5):
            assert c.post("/api/links", json={"url": "https://a.com"}).status_code == 201
        r = c.post("/api/links", json={"url": "https://a.com"})
        assert r.status_code == 429
        assert 1 <= int(r.headers["retry-after"]) <= 61
        # another IP is unaffected
        other = TestClient(app, client=("203.0.113.9", 50000))
        assert other.post("/api/links", json={"url": "https://a.com"}).status_code == 201


def test_links_expire_after_3_days():
    recent.clear()
    with TestClient(app) as c:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO links (code, url, created_at) VALUES ('old123', 'https://old.com', datetime('now', '-4 days'))"
            )
        assert c.get("/old123", follow_redirects=False).status_code == 404
        assert "old123" not in [l["code"] for l in c.get("/api/links").json()]

        c.post("/api/links", json={"url": "https://new.com"})  # creating a link purges expired rows
        with sqlite3.connect(DB_PATH) as conn:
            assert conn.execute("SELECT count(*) FROM links WHERE code = 'old123'").fetchone()[0] == 0
