# ROGI — Daily UTC Time Reporting Dashboard

> **R-O-G-I reversed = I-G-O-R** *(named in honour of a team member)*

ROGI is a fully **static**, **offline-capable** web dashboard that visualises
daily reporting counts sourced from a local REST API.  All JavaScript and CSS
assets are bundled in this repository — no CDN or internet connectivity is
required at runtime.

---

## Table of Contents

1. [Application Structure](#application-structure)
2. [API Contract](#api-contract)
3. [Dashboard Panels](#dashboard-panels)
4. [Serving Locally](#serving-locally)
5. [Sample API Response](#sample-api-response)
6. [Print / PDF Support](#print--pdf-support)
7. [Configuration](#configuration)

---

## Application Structure

```
Reporting-Dashboard/
├── index.html                  # Single-page dashboard (entry point)
├── assets/
│   ├── css/
│   │   └── style.css           # Theme variables (light default, dark toggle) + print media query
│   └── js/
│       ├── chart.umd.min.js    # Chart.js v4.5.1 (bundled, no CDN needed)
│       ├── chartjs-chart-boxplot.min.js # Chart.js boxplot plugin (day-of-week/day-of-month)
│       ├── chartjs-chart-matrix.min.js  # Chart.js matrix plugin (heatmaps)
│       └── dashboard.js        # All data-fetching, processing & chart logic
├── serve.py                    # Local dev server — serves static files AND
│                               #   a synthetic mock of the reporting API
├── sample_response.json        # Small example showing the API response format
└── README.md
```

### Key files

| File | Purpose |
|------|---------|
| `index.html` | Defines the two-column grid layout, all panel skeletons, and links to assets. |
| `assets/css/style.css` | CSS custom-properties themes (light by default, plus dark and Ukraine via toggle). `@media print` block preserves dashboard colours in PDF output via `print-color-adjust: exact`. |
| `assets/js/dashboard.js` | Fetches data from the API, performs all calculations (totals, stats, regressions, moving averages), and renders all dashboard charts/tables (Chart.js + boxplot + matrix plugins). |
| `assets/js/chart.umd.min.js` | Chart.js v4.5.1 UMD bundle — **no internet required**. |
| `assets/js/chartjs-chart-boxplot.min.js` | Chart.js boxplot plugin bundle — **no internet required**. |
| `assets/js/chartjs-chart-matrix.min.js` | Chart.js matrix (heatmap) plugin bundle — **no internet required**. |
| `serve.py` | Python 3 HTTP server.  Serves static files via `http.server.SimpleHTTPRequestHandler` and intercepts `GET /v1/reporting` to return synthetic historical data (1970–today, ~2.5 B total). |

---

## API Contract

The dashboard fetches:

```
GET http://api/v1/reporting?from_date=1970-01-01&to_date=<YYYY-MM-DD>
```

* `from_date` is fixed to `1970-01-01`.
* `to_date` is set dynamically to **today's date** every time the page loads.

### Response format

```json
{
  "content": [
    { "date": "YYYY-MM-DD", "count": 123456789 },
    { "date": "YYYY-MM-DD", "count": 234567890 },
    ...
  ]
}
```

The `count` values can reach hundreds of millions per day; the dashboard
formats them compactly (e.g. `215.34 M`, `2.47 B`).

---

## Dashboard Panels

The dashboard uses a **two-panel-per-row** layout throughout.

| # | Panel | Contents |
|---|-------|---------|
| 1 | **Total Reporting Counts** | Total all-time, this year, this month |
| 2 | **Daily Reporting Stats** | Avg / Max / Min / Median for all time, last 12 months, last month |
| 3 | **Reporting Growth Metrics** | % change — last 12 mo vs previous 12 mo; last 30 days vs previous 30 days |
| 4 | **Day of Week Distribution — Last 365 Days** | Boxplot distribution by weekday |
| 5 | **Cumulative Yearly Chart** | Bar = running total by year; dashed line = linear-regression forecast for current year + next 2 |
| 6 | **Annual Reporting Volume** | Bar = yearly totals; dashed line = linear-regression forecast |
| 7 | **Cumulative Yearly Table** | Tabular data matching panel 5 |
| 8 | **Annual Reporting Table** | Tabular data matching panel 6 |
| 9 | **Weekly Reporting Chart** | Bar chart for the last 2 years + 4-week moving average line |
| 10 | **Weekly Reporting Table** | Tabular data matching panel 9 (most recent first) |
| 11 | **Monthly Reporting Chart** | Bar chart for the last 2 years + 3-month moving average line |
| 12 | **Monthly Reporting Table** | Tabular data matching panel 11 (most recent first) |
| 13 | **Weekly Cumulative Reporting Comparison — Last 4 Years** | Cumulative line chart by week-of-year for current and previous 3 calendar years |
| 14 | **Weekly Cumulative Reporting Comparison — Last 4 Years — Table** | Tabular cumulative weekly values for the same 4 years |
| 15 | **Yearly Share Pie Chart** | Pie chart of total count per year |
| 16 | **Day of Week Distribution Stats — Last 365 Days** | Tabular weekday average, minimum, and maximum values |
| 17 | **Day of Month Distribution — Last 2 Years** | Boxplot distribution by day of month |
| 18 | **Day of Month Distribution Stats — Last 2 Years — Table** | Tabular day-of-month average, minimum, and maximum values |
| 19 | **Month/Year Reporting Heatmap — Last 5 Years** | Heatmap of monthly totals by year and month |
| 20 | **Month/Year Reporting — Last 5 Years — Table** | Tabular month-by-month totals by year (same data as heatmap) |
| 21 | **Week/Year Reporting Heatmap — Last 5 Years** | Heatmap of weekly totals by year and week |
| 22 | **Week/Year Reporting — Last 5 Years — Table** | Tabular weekly totals by year (same data as heatmap) |

**Linear regression** uses the last 8 full calendar years (excluding the
current year) as the training set and predicts the current year and the next
two years.

**X-axis labels** are automatically thinned to a maximum of **10 labels**
to prevent clutter on any chart.

---

## Serving Locally

### Prerequisites

* Python 3.9 or later (standard library only — no `pip install` needed)
* A modern web browser (Chrome, Firefox, Edge, Safari)

### Option A — localhost (simplest, no system changes)

```bash
# 1. Clone / download the repository
git clone https://github.com/swarmee/Reporting-Dashboard.git
cd Reporting-Dashboard

# 2. Start the development server (default port 8080)
python3 serve.py

# 3. Open in your browser
#    http://localhost:8080/
```

The server:
* Serves `index.html` and `assets/` at `/`
* Serves the mock API at `/v1/reporting`

Because `dashboard.js` auto-detects `localhost` and uses a **relative URL**
for the API (`/v1/reporting`), everything works out of the box.

### Option B — mimic the production URL `http://api/`

If you want the browser address bar to show `http://api/` (identical to
production), map the hostname in your OS hosts file:

**Linux / macOS** (`/etc/hosts`):
```
127.0.0.1  api
```

**Windows** (`C:\Windows\System32\drivers\etc\hosts`):
```
127.0.0.1  api
```

Then start the server on port **80** (requires administrator / sudo):

```bash
# Linux / macOS
sudo python3 serve.py --port 80

# Windows (run as Administrator)
python serve.py --port 80
```

Open `http://api/` in your browser.

### Custom port

```bash
python3 serve.py --port 9000
# Open: http://localhost:9000/
```

---

## Sample API Response

`sample_response.json` contains 10 days of data (2024-01-01 → 2024-01-10)
and illustrates the exact format expected by the dashboard.

```json
{
  "content": [
    { "date": "2024-01-01", "count": 208063 },
    { "date": "2024-01-02", "count": 207455 },
    { "date": "2024-01-03", "count": 208755 },
    { "date": "2024-01-04", "count": 225924 },
    { "date": "2024-01-05", "count": 208411 },
    { "date": "2024-01-06", "count":  89747 },
    { "date": "2024-01-07", "count": 109060 },
    { "date": "2024-01-08", "count": 205461 },
    { "date": "2024-01-09", "count": 206525 },
    { "date": "2024-01-10", "count": 213551 }
  ]
}
```

The mock server (`serve.py`) generates a **full** synthetic dataset from
1970-01-01 to today (~20 000 records) so all charts and metrics display
meaningful data.  The synthetic model targets approximately **2.5 billion**
total counts, grows quadratically over time, includes weekday/seasonal
variation, and adds 10 % Gaussian noise for realism.

---

## Print / PDF Support

Open the dashboard in your browser, then use **File → Print** (or
`Ctrl + P` / `⌘ + P`) and choose **Save as PDF**. Printing uses the same
layout and sizing as the on-screen view (no print-specific resizing).
If your browser omits background colors by default, enable **Background
graphics** in the print dialog to preserve chart fills.

---

## Configuration

All runtime settings live at the top of `assets/js/dashboard.js`:

```js
const CONFIG = {
  API_BASE:           '',       // '' = same origin; 'http://api' = production
  FROM_DATE:          '1970-01-01',
  MAX_X_LABELS:       10,
  REGRESSION_YEARS:   8,
  MA_WINDOW_WEEKLY:   4,
  MA_WINDOW_MONTHLY:  3
};
```

`API_BASE` is **auto-detected** at runtime:

* When served from `localhost`, `127.0.0.1`, or `api` → relative URL (`''`)
* All other origins → `http://api`

To hard-code a different API host, replace the arrow-function with a string:

```js
API_BASE: 'http://my-api-server',
```
