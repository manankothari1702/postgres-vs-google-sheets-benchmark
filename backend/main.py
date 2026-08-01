import csv
import json
import os
import time
import urllib.request

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from faker import Faker

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "dbname": os.getenv("DB_NAME", "benchmark"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "postgres"),
}

CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "customers.csv")

APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

with psycopg.connect(**DB_CONFIG) as conn:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            city TEXT NOT NULL,
            status TEXT NOT NULL,
            purchase NUMERIC(10, 2) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


class GenerateRequest(BaseModel):
    rows: int = 100000


@app.post("/generate")
def generate(req: GenerateRequest):
    fake = Faker()
    statuses = ["active", "inactive", "pending"]

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["name", "email", "phone", "city", "status", "purchase", "created_at"]
        )
        for _ in range(req.rows):
            writer.writerow(
                [
                    fake.name(),
                    fake.email(),
                    fake.phone_number(),
                    fake.city(),
                    fake.random_element(statuses),
                    fake.pydecimal(left_digits=4, right_digits=2, positive=True),
                    fake.date_time_between(start_date="-1y"),
                ]
            )

    return {"rows": req.rows, "file": os.path.basename(CSV_PATH)}


@app.post("/import/postgres")
def import_postgres():
    if not os.path.exists(CSV_PATH):
        raise HTTPException(
            status_code=400, detail="customers.csv not found. Generate the CSV first."
        )

    with psycopg.connect(**DB_CONFIG) as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE customers RESTART IDENTITY")

            start = time.perf_counter()

            with open(CSV_PATH, "rb") as f:
                with cur.copy(
                    "COPY customers (name, email, phone, city, status, purchase, created_at)"
                    " FROM STDIN WITH (FORMAT CSV, HEADER)"
                ) as copy:
                    while chunk := f.read(65536):
                        copy.write(chunk)

            insert_time_ms = (time.perf_counter() - start) * 1000
            rows = cur.rowcount

    return {"rows": rows, "insertTimeMs": insert_time_ms}


@app.post("/import/google")
def import_google():
    if not os.path.exists(CSV_PATH):
        raise HTTPException(
            status_code=400, detail="customers.csv not found. Generate the CSV first."
        )

    if not APPS_SCRIPT_URL:
        raise HTTPException(
            status_code=400,
            detail="APPS_SCRIPT_URL is not set. Deploy apps-script/Code.gs as a web"
            " app and set APPS_SCRIPT_URL to its /exec URL.",
        )

    with open(CSV_PATH, "rb") as f:
        request = urllib.request.Request(
            APPS_SCRIPT_URL + "?action=import",
            data=f.read(),
            headers={"Content-Type": "text/csv"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=900) as response:
            return json.loads(response.read())


class SearchRequest(BaseModel):
    query: str = ""


class FilterRequest(BaseModel):
    city: str = ""
    status: str = ""


@app.post("/search")
def search(req: SearchRequest):
    with psycopg.connect(**DB_CONFIG) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            # Neutralise LIKE wildcards so the query is matched literally, the
            # way JavaScript indexOf does in the Apps Script search. Backslash
            # is escaped first, otherwise it would escape the escapes below.
            escaped = (
                req.query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            pattern = f"%{escaped}%"
            start = time.perf_counter()
            cur.execute(
                "SELECT COUNT(*) AS total FROM customers"
                " WHERE name ILIKE %s ESCAPE '\\' OR email ILIKE %s ESCAPE '\\'"
                " OR phone ILIKE %s ESCAPE '\\' OR city ILIKE %s ESCAPE '\\'",
                (pattern, pattern, pattern, pattern),
            )
            total = cur.fetchone()
            cur.execute(
                "SELECT id, name, city, status, purchase FROM customers"
                " WHERE name ILIKE %s ESCAPE '\\' OR email ILIKE %s ESCAPE '\\'"
                " OR phone ILIKE %s ESCAPE '\\' OR city ILIKE %s ESCAPE '\\'"
                " ORDER BY id LIMIT 100",
                (pattern, pattern, pattern, pattern),
            )
            data = cur.fetchall()
            duration_ms = (time.perf_counter() - start) * 1000

    return {
        "source": "PostgreSQL",
        "operation": "search",
        "durationMs": duration_ms,
        "totalMatches": total["total"],
        "displayedRows": len(data),
        "data": data,
    }


@app.post("/benchmark/google/search")
def google_search(req: SearchRequest):
    if not APPS_SCRIPT_URL:
        raise HTTPException(
            status_code=400,
            detail="APPS_SCRIPT_URL is not set. Deploy apps-script/Code.gs as a web"
            " app and set APPS_SCRIPT_URL to its /exec URL.",
        )

    request = urllib.request.Request(
        APPS_SCRIPT_URL + "?action=search",
        data=json.dumps({"query": req.query}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())


def escape_like(value: str) -> str:
    """Neutralise LIKE wildcards so the value is matched literally, the way
    JavaScript string comparison does in the Apps Script filter. Backslash is
    escaped first, otherwise it would escape the escapes below."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@app.post("/filter")
def filter_customers(req: FilterRequest):
    with psycopg.connect(**DB_CONFIG) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            city_pattern = f"%{escape_like(req.city)}%"
            # An empty status falls back to '%', which matches every row.
            status_pattern = escape_like(req.status) if req.status else "%"
            start = time.perf_counter()
            cur.execute(
                "SELECT COUNT(*) AS total FROM customers"
                " WHERE city ILIKE %s ESCAPE '\\' AND status ILIKE %s ESCAPE '\\'",
                (city_pattern, status_pattern),
            )
            total = cur.fetchone()
            cur.execute(
                "SELECT id, name, city, status, purchase FROM customers"
                " WHERE city ILIKE %s ESCAPE '\\' AND status ILIKE %s ESCAPE '\\'"
                " ORDER BY id LIMIT 100",
                (city_pattern, status_pattern),
            )
            data = cur.fetchall()
            duration_ms = (time.perf_counter() - start) * 1000

    return {
        "source": "PostgreSQL",
        "operation": "filter",
        "durationMs": duration_ms,
        "totalMatches": total["total"],
        "displayedRows": len(data),
        "data": data,
    }


@app.post("/benchmark/google/filter")
def google_filter(req: FilterRequest):
    if not APPS_SCRIPT_URL:
        raise HTTPException(
            status_code=400,
            detail="APPS_SCRIPT_URL is not set. Deploy apps-script/Code.gs as a web"
            " app and set APPS_SCRIPT_URL to its /exec URL.",
        )

    request = urllib.request.Request(
        APPS_SCRIPT_URL + "?action=filter",
        data=json.dumps({"city": req.city, "status": req.status}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())


@app.post("/sort")
def sort_customers():
    with psycopg.connect(**DB_CONFIG) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            start = time.perf_counter()
            cur.execute("SELECT COUNT(*) AS total FROM customers")
            total = cur.fetchone()
            cur.execute(
                "SELECT id, name, city, status, purchase FROM customers"
                " ORDER BY purchase DESC LIMIT 20"
            )
            data = cur.fetchall()
            duration_ms = (time.perf_counter() - start) * 1000

    return {
        "source": "PostgreSQL",
        "operation": "sort",
        "durationMs": duration_ms,
        "totalRows": total["total"],
        "displayedRows": len(data),
        "data": data,
    }


@app.post("/benchmark/google/sort")
def google_sort():
    if not APPS_SCRIPT_URL:
        raise HTTPException(
            status_code=400,
            detail="APPS_SCRIPT_URL is not set. Deploy apps-script/Code.gs as a web"
            " app and set APPS_SCRIPT_URL to its /exec URL.",
        )

    request = urllib.request.Request(
        APPS_SCRIPT_URL + "?action=sort",
        data=json.dumps({}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())


@app.post("/analytics")
def analytics():
    with psycopg.connect(**DB_CONFIG) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            start = time.perf_counter()
            cur.execute(
                "SELECT COUNT(*) AS total_customers,"
                " ROUND(AVG(purchase), 2) AS average_purchase,"
                " SUM(purchase) AS total_purchase FROM customers"
            )
            totals = cur.fetchone()
            cur.execute(
                "SELECT city, COUNT(*) AS customers FROM customers"
                " GROUP BY city ORDER BY COUNT(*) DESC, city LIMIT 20"
            )
            by_city = cur.fetchall()
            duration_ms = (time.perf_counter() - start) * 1000

    data = [
        {
            "totalCustomers": totals["total_customers"],
            "averagePurchase": totals["average_purchase"],
            "totalPurchase": totals["total_purchase"],
            "byCity": by_city,
        }
    ]

    return {
        "source": "PostgreSQL",
        "operation": "analytics",
        "durationMs": duration_ms,
        # total_customers is already COUNT(*) FROM customers, so it doubles as
        # the dataset row count the other benchmark endpoints report.
        "totalRows": totals["total_customers"],
        "data": data,
    }


@app.post("/benchmark/google/analytics")
def google_analytics():
    if not APPS_SCRIPT_URL:
        raise HTTPException(
            status_code=400,
            detail="APPS_SCRIPT_URL is not set. Deploy apps-script/Code.gs as a web"
            " app and set APPS_SCRIPT_URL to its /exec URL.",
        )

    request = urllib.request.Request(
        APPS_SCRIPT_URL + "?action=analytics",
        data=json.dumps({}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())


@app.post("/maintenance/postgres/clear")
def clear_postgres():
    with psycopg.connect(**DB_CONFIG) as conn:
        with conn.cursor() as cur:
            # TRUNCATE reports no row count, so the table is counted first to
            # report how much was removed.
            cur.execute("SELECT COUNT(*) FROM customers")
            rows_removed = cur.fetchone()[0]
            cur.execute("TRUNCATE customers RESTART IDENTITY")

    return {"rowsRemoved": rows_removed}


@app.post("/maintenance/google/clear")
def clear_google():
    if not APPS_SCRIPT_URL:
        raise HTTPException(
            status_code=400,
            detail="APPS_SCRIPT_URL is not set. Deploy apps-script/Code.gs as a web"
            " app and set APPS_SCRIPT_URL to its /exec URL.",
        )

    request = urllib.request.Request(
        APPS_SCRIPT_URL + "?action=clear",
        data=json.dumps({}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())
