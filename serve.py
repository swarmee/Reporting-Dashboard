#!/usr/bin/env python3
"""
serve.py – Local development server for the ROGI dashboard.

Serves static files (index.html, assets/) from this directory and provides
a synthetic mock of the reporting API at GET /v1/reporting.

Quick start
-----------
Option A – Same-origin (recommended, no /etc/hosts change required):
    python3 serve.py                    # listens on port 8080
    # Open: http://localhost:8080/

Option B – Mimic production URL http://api/
    sudo python3 serve.py --port 80
    # Add to /etc/hosts:  127.0.0.1  api
    # Open: http://api/

The mock API generates synthetic daily counts from 1970-01-01 to today,
totalling approximately 2.5 billion, and respects the from_date / to_date
query parameters.
"""

import argparse
import http.server
import json
import math
import os
import random
import socket
import urllib.parse
from datetime import date, timedelta
from functools import lru_cache

_SEED      = 42
_BASE_YEAR = 1970


@lru_cache(maxsize=1)
def _generate_all_records() -> list[dict]:
    """
    Generate synthetic daily reporting data from _BASE_YEAR to today.
    The data uses a quadratic growth model with weekday, seasonal, and
    Gaussian noise factors, targeting ~2.5 billion total counts.
    """
    rng   = random.Random(_SEED)
    start = date(_BASE_YEAR, 1, 1)
    end   = date.today()
    d     = start
    records: list[dict] = []

    while d <= end:
        yr_offset = d.year - _BASE_YEAR + 1

        # Quadratic growth (targeting ~2.5 B total over ~56 years)
        base = 28_000 + yr_offset * 1_700 + yr_offset ** 2 * 28

        # Weekday boost (Mon–Fri ~10 % higher; Sat–Sun ~45 % lower)
        dow_factor = 1.10 if d.weekday() < 5 else 0.55

        # Seasonal sinusoid (peak around July)
        seasonal = 1.0 + 0.08 * math.sin((d.month - 3) * math.pi / 6)

        # Gaussian noise (σ = 10 %)
        noise = rng.gauss(1.0, 0.10)

        count = max(0, int(base * dow_factor * seasonal * noise))
        records.append({"date": str(d), "count": count})
        d += timedelta(days=1)

    return records


class _Handler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler – routes /v1/reporting to mock data."""

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/v1/reporting":
            self._serve_api(parsed.query)
        else:
            super().do_GET()

    def _serve_api(self, query_string: str) -> None:
        params    = urllib.parse.parse_qs(query_string)
        from_date = params.get("from_date", ["1970-01-01"])[0]
        to_date   = params.get("to_date",   [str(date.today())])[0]

        all_records = _generate_all_records()
        filtered = [
            r for r in all_records
            if from_date <= r["date"] <= to_date
        ]

        body = json.dumps({"content": filtered}).encode()
        self.send_response(200)
        self.send_header("Content-Type",                 "application/json")
        self.send_header("Content-Length",               str(len(body)))
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A002
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ROGI Dashboard — local development server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        "--port", type=int, default=8080,
        help="TCP port to listen on (default: 8080)"
    )
    parser.add_argument(
        "--host", default="0.0.0.0",
        help="Interface to bind (default: 0.0.0.0)"
    )
    args = parser.parse_args()

    # Serve from the directory that contains this script
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    server = http.server.HTTPServer((args.host, args.port), _Handler)

    hostname = socket.gethostname()
    base_url = f"http://localhost:{args.port}"
    print(f"\n  ROGI Dashboard dev server")
    print(f"  ──────────────────────────────────────────────────────")
    print(f"  Dashboard : {base_url}/")
    print(f"  Mock API  : {base_url}/v1/reporting"
          f"?from_date=1970-01-01&to_date={date.today()}")
    print(f"  Host      : {hostname}")
    print(f"\n  Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")


if __name__ == "__main__":
    main()
