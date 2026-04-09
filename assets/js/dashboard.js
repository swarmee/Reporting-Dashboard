'use strict';

/* ============================================================
   ROGI Dashboard – dashboard.js
   Daily UTC Time Reporting
   ============================================================ */

// ── Configuration ─────────────────────────────────────────
const CONFIG = {
  // Auto-detect: use relative URL when served from the same origin
  // (works for http://api/  and  http://localhost:<port>/)
  // Override here if needed, e.g. 'http://api' or 'http://localhost:8080'
  API_BASE: (() => {
    const h = window.location.hostname;
    if (h === 'api' || h === 'localhost' || h === '127.0.0.1') return '';
    return 'http://api';
  })(),
  FROM_DATE: '1970-01-01',
  MAX_X_LABELS: 10,
  REGRESSION_YEARS: 8,   // training window for linear regression
  MA_WINDOW_WEEKLY: 4,   // moving-average window (weeks)
  MA_WINDOW_MONTHLY: 3   // moving-average window (months)
};

// ── Chart defaults ─────────────────────────────────────────
Chart.defaults.color = '#9ab3d8';
Chart.defaults.borderColor = '#1c3464';
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size = 11;

// ── Colour palette ─────────────────────────────────────────
const COLORS = {
  blue:   '#4c8ef7',
  teal:   '#1abfbf',
  amber:  '#f5a623',
  green:  '#2dd4a0',
  red:    '#f55a5a',
  purple: '#a78bfa',
  blueA:  'rgba(76,142,247,.25)',
  tealA:  'rgba(26,191,191,.25)',
  amberA: 'rgba(245,166,35,.25)'
};

function pieColors(n) {
  return Array.from({ length: n }, (_, i) =>
    `hsl(${Math.round((i * 360) / n)},65%,55%)`
  );
}

// ── Number formatting ─────────────────────────────────────
function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US');
}

function fmtCompact(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + ' T';
  if (a >= 1e9)  return (n / 1e9).toFixed(2)  + ' B';
  if (a >= 1e6)  return (n / 1e6).toFixed(2)  + ' M';
  if (a >= 1e3)  return (n / 1e3).toFixed(1)  + ' K';
  return Number(n).toLocaleString('en-US');
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

// ── Maths helpers ─────────────────────────────────────────
function arrSum(a)  { return a.reduce((s, v) => s + v, 0); }
function arrMean(a) { return a.length ? arrSum(a) / a.length : 0; }

function arrMedian(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function arrStats(a) {
  if (!a.length) return { avg: 0, max: 0, min: 0, med: 0 };
  return {
    avg: arrMean(a),
    max: Math.max(...a),
    min: Math.min(...a),
    med: arrMedian(a)
  };
}

function linReg(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const sx  = arrSum(xs);
  const sy  = arrSum(ys);
  const sxy = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sxx = xs.reduce((acc, x) => acc + x * x, 0);
  const d   = n * sxx - sx * sx;
  if (d === 0) return { slope: 0, intercept: sy / n };
  const slope     = (n * sxy - sx * sy) / d;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function regPredict(reg, x) { return reg.slope * x + reg.intercept; }

function movAvg(values, w) {
  return values.map((_, i) => {
    const sl = values.slice(Math.max(0, i - w + 1), i + 1);
    return arrMean(sl);
  });
}

// ── Date helpers ──────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isoWeekLabel(d) {
  // Returns "YYYY-Www" per ISO 8601
  const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  nd.setDate(nd.getDate() + 3 - ((nd.getDay() + 6) % 7));
  const w1 = new Date(nd.getFullYear(), 0, 4);
  const wn = 1 + Math.round(
    ((nd - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7
  );
  return `${nd.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}


// ── Data processing ───────────────────────────────────────
function processData(raw) {
  const records = raw.content
    .map(r => ({ date: r.date, count: Number(r.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!records.length) throw new Error('API returned empty dataset.');

  const today       = todayStr();
  const currentYear = new Date().getFullYear();
  const currentMon  = today.slice(0, 7);         // 'YYYY-MM'

  const last365Start = addDays(today, -365);
  const prev365Start = addDays(today, -730);
  const last30Start  = addDays(today, -30);
  const prev30Start  = addDays(today, -60);
  const twoYrStart   = addDays(today, -730);

  // Partitions
  const last365 = records.filter(r => r.date >= last365Start);
  const prev365 = records.filter(r => r.date >= prev365Start && r.date < last365Start);
  const last30  = records.filter(r => r.date >= last30Start);
  const prev30  = records.filter(r => r.date >= prev30Start && r.date < last30Start);
  const thisYr  = records.filter(r => r.date.startsWith(String(currentYear)));
  const thisMon = records.filter(r => r.date.startsWith(currentMon));

  // Totals
  const totalAll      = arrSum(records.map(r => r.count));
  const totalThisYear = arrSum(thisYr.map(r => r.count));
  const totalThisMon  = arrSum(thisMon.map(r => r.count));

  // Daily stats
  const dailyAll   = arrStats(records.map(r => r.count));
  const daily365   = arrStats(last365.map(r => r.count));
  const daily30    = arrStats(last30.map(r => r.count));

  // Growth
  const sum365     = arrSum(last365.map(r => r.count));
  const sumPrev365 = arrSum(prev365.map(r => r.count));
  const growth365  = sumPrev365 > 0 ? ((sum365 - sumPrev365) / sumPrev365) * 100 : null;

  const sum30      = arrSum(last30.map(r => r.count));
  const sumPrev30  = arrSum(prev30.map(r => r.count));
  const growth30   = sumPrev30  > 0 ? ((sum30  - sumPrev30)  / sumPrev30)  * 100 : null;

  // Day-of-week averages (last 365 days), Mon=0 … Sun=6
  const dowBuckets = Array.from({ length: 7 }, () => []);
  last365.forEach(r => {
    const dow = (parseLocalDate(r.date).getDay() + 6) % 7; // shift so Mon=0
    dowBuckets[dow].push(r.count);
  });
  const dowAvg = dowBuckets.map(b => arrMean(b));

  // ── Yearly aggregates ──────────────────────────────────
  const yearMap = {};
  records.forEach(r => {
    const y = r.date.slice(0, 4);
    yearMap[y] = (yearMap[y] || 0) + r.count;
  });
  const years  = Object.keys(yearMap).sort();
  const yTotals = years.map(y => yearMap[y]);

  // Cumulative
  let cum = 0;
  const yCumulative = yTotals.map(v => { cum += v; return cum; });

  // Regression training set: last REGRESSION_YEARS full years before current
  const fullYears = years.filter(y => Number(y) < currentYear);
  const trainYrs  = fullYears.slice(-CONFIG.REGRESSION_YEARS);
  const trainTots = trainYrs.map(y => yearMap[y]);
  const trainCums = trainYrs.map(y => {
    const idx = years.indexOf(y);
    return yCumulative[idx];
  });

  const forecastYrs = [currentYear, currentYear + 1, currentYear + 2];
  const regNonCum   = linReg(trainYrs.map(Number), trainTots);
  const regCum      = linReg(trainYrs.map(Number), trainCums);

  // Full label set including forecast years not yet in data
  const extraYrs = forecastYrs
    .filter(y => !years.includes(String(y)))
    .map(String);
  const allYearLabels = [...years, ...extraYrs];

  // Forecast line data aligned to allYearLabels
  // Anchor starts at the last training year so the line connects visually
  const lastTrainYr = trainYrs.length ? Number(trainYrs[trainYrs.length - 1]) : null;

  function buildForecastLine(reg, source) {
    return allYearLabels.map(y => {
      const yn = Number(y);
      if (forecastYrs.includes(yn)) return Math.max(0, regPredict(reg, yn));
      if (yn === lastTrainYr)       return Math.max(0, regPredict(reg, yn));
      return null;
    });
  }

  const forecastLineNonCum = buildForecastLine(regNonCum, 'nonCum');
  const forecastLineCum    = buildForecastLine(regCum,    'cum');

  // Bar data aligned to allYearLabels
  const barNonCum = allYearLabels.map(y => yearMap[y] ?? null);
  const barCum    = allYearLabels.map(y => {
    const idx = years.indexOf(y);
    return idx >= 0 ? yCumulative[idx] : null;
  });

  // ── Weekly (last 2 years) ──────────────────────────────
  const weekMap = {};
  records
    .filter(r => r.date >= twoYrStart)
    .forEach(r => {
      const w = isoWeekLabel(parseLocalDate(r.date));
      weekMap[w] = (weekMap[w] || 0) + r.count;
    });
  const weekKeys   = Object.keys(weekMap).sort();
  const weekVals   = weekKeys.map(w => weekMap[w]);
  const weekMA     = movAvg(weekVals, CONFIG.MA_WINDOW_WEEKLY);

  // ── Monthly (last 2 years) ─────────────────────────────
  const monMap = {};
  records
    .filter(r => r.date >= twoYrStart)
    .forEach(r => {
      const m = r.date.slice(0, 7);
      monMap[m] = (monMap[m] || 0) + r.count;
    });
  const monKeys  = Object.keys(monMap).sort();
  const monVals  = monKeys.map(m => monMap[m]);
  const monMA    = movAvg(monVals, CONFIG.MA_WINDOW_MONTHLY);

  return {
    // totals
    totalAll, totalThisYear, totalThisMon,
    // daily stats
    dailyAll, daily365, daily30,
    // growth
    sum365, sumPrev365, growth365,
    sum30,  sumPrev30,  growth30,
    // dow
    dowAvg,
    // yearly
    years, yTotals, yCumulative,
    allYearLabels, barNonCum, barCum,
    forecastYrs, forecastLineNonCum, forecastLineCum,
    trainYrs,
    // weekly
    weekKeys, weekVals, weekMA,
    // monthly
    monKeys, monVals, monMA,
    // metadata
    minDate: records[0].date,
    maxDate: records[records.length - 1].date
  };
}

// ── Chart factory helpers ─────────────────────────────────
const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function makeChart(canvasId, config) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, config);
  return chartInstances[canvasId];
}

// Common scale options
function yScale(title) {
  return {
    grid: { color: 'rgba(44,74,138,.35)' },
    ticks: {
      callback: v => fmtCompact(v),
      maxTicksLimit: 6,
      color: '#9ab3d8'
    },
    title: title
      ? { display: true, text: title, color: '#5a7aaa', font: { size: 10 } }
      : undefined
  };
}

function xScale(maxLabels = CONFIG.MAX_X_LABELS) {
  return {
    grid: { display: false },
    ticks: {
      maxTicksLimit: maxLabels,
      maxRotation: 40,
      minRotation: 0,
      color: '#9ab3d8',
      autoSkip: true
    }
  };
}

// ── Panel renderers ───────────────────────────────────────

/* 1. Total Reporting Counts */
function renderTotalCounts(d) {
  document.getElementById('metric-total-all').textContent   = fmtCompact(d.totalAll);
  document.getElementById('metric-total-all-full').textContent = fmt(d.totalAll);

  document.getElementById('metric-total-yr').textContent    = fmtCompact(d.totalThisYear);
  document.getElementById('metric-total-yr-full').textContent = fmt(d.totalThisYear);

  document.getElementById('metric-total-mon').textContent   = fmtCompact(d.totalThisMon);
  document.getElementById('metric-total-mon-full').textContent = fmt(d.totalThisMon);
}

/* 2. Daily Reporting Stats */
function renderDailyStats(d) {
  const rows = [
    { id: 'row-all',    s: d.dailyAll  },
    { id: 'row-365',    s: d.daily365  },
    { id: 'row-30',     s: d.daily30   }
  ];
  rows.forEach(({ id, s }) => {
    document.getElementById(`${id}-avg`).textContent = fmtCompact(s.avg);
    document.getElementById(`${id}-max`).textContent = fmtCompact(s.max);
    document.getElementById(`${id}-min`).textContent = fmtCompact(s.min);
    document.getElementById(`${id}-med`).textContent = fmtCompact(s.med);
  });
}

/* 3. Reporting Growth Metrics */
function renderGrowth(d) {
  function setGrowth(prefix, pct, recent, previous) {
    const el = document.getElementById(`${prefix}-pct`);
    el.textContent = fmtPct(pct);
    el.className = 'growth-value ' +
      (pct == null ? 'neutral' : pct >= 0 ? 'positive' : 'negative');
    document.getElementById(`${prefix}-recent`).textContent   = fmtCompact(recent);
    document.getElementById(`${prefix}-previous`).textContent = fmtCompact(previous);
  }
  setGrowth('g12', d.growth365, d.sum365, d.sumPrev365);
  setGrowth('g1m', d.growth30,  d.sum30,  d.sumPrev30);
}

/* 4. Day-of-Week Bar Chart */
function renderDowChart(d) {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  makeChart('chart-dow', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg Daily Count',
        data: d.dowAvg,
        backgroundColor: labels.map((_, i) =>
          i < 5 ? COLORS.blueA.replace('.25', '.7') : COLORS.tealA.replace('.25', '.7')
        ),
        borderColor: labels.map((_, i) => i < 5 ? COLORS.blue : COLORS.teal),
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + fmtCompact(ctx.parsed.y) } }
      },
      scales: { x: xScale(7), y: yScale() }
    }
  });
}

/* 5. Cumulative Yearly Chart */
function renderCumulativeChart(d) {
  makeChart('chart-cum-yearly', {
    type: 'bar',
    data: {
      labels: d.allYearLabels,
      datasets: [
        {
          type: 'bar',
          label: 'Cumulative Volume',
          data: d.barCum,
          backgroundColor: COLORS.blueA,
          borderColor: COLORS.blue,
          borderWidth: 1.5,
          borderRadius: 3,
          order: 2
        },
        {
          type: 'line',
          label: 'Forecast (linear regression)',
          data: d.forecastLineCum,
          borderColor: COLORS.amber,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: ctx => d.forecastYrs.includes(Number(d.allYearLabels[ctx.dataIndex])) ? 5 : 0,
          pointBackgroundColor: COLORS.amber,
          spanGaps: false,
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.parsed.y)}` } }
      },
      scales: { x: xScale(), y: yScale('Cumulative Count') }
    }
  });
}

/* 6. Non-cumulative Yearly Chart */
function renderNonCumChart(d) {
  makeChart('chart-noncum-yearly', {
    type: 'bar',
    data: {
      labels: d.allYearLabels,
      datasets: [
        {
          type: 'bar',
          label: 'Annual Total',
          data: d.barNonCum,
          backgroundColor: COLORS.tealA,
          borderColor: COLORS.teal,
          borderWidth: 1.5,
          borderRadius: 3,
          order: 2
        },
        {
          type: 'line',
          label: 'Forecast (linear regression)',
          data: d.forecastLineNonCum,
          borderColor: COLORS.amber,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: ctx => d.forecastYrs.includes(Number(d.allYearLabels[ctx.dataIndex])) ? 5 : 0,
          pointBackgroundColor: COLORS.amber,
          spanGaps: false,
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.parsed.y)}` } }
      },
      scales: { x: xScale(), y: yScale('Annual Count') }
    }
  });
}


/* 7. Cumulative Yearly Table */
function renderCumTable(d) {
  const tbody = document.getElementById('tbody-cum');
  tbody.innerHTML = '';
  d.allYearLabels.forEach((y, i) => {
    const isForecast = d.forecastYrs.includes(Number(y)) && d.barCum[i] == null;
    const actual = d.barCum[i];
    const forecast = d.forecastLineCum[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${y}${isForecast ? '<span class="tag-forecast">FORECAST</span>' : ''}</td>
      <td>${actual   != null ? fmt(actual)   : '—'}</td>
      <td>${forecast != null ? fmt(Math.round(forecast)) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 8. Non-cumulative Yearly Table */
function renderNonCumTable(d) {
  const tbody = document.getElementById('tbody-noncum');
  tbody.innerHTML = '';
  d.allYearLabels.forEach((y, i) => {
    const isForecast = d.forecastYrs.includes(Number(y)) && d.barNonCum[i] == null;
    const actual   = d.barNonCum[i];
    const forecast = d.forecastLineNonCum[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${y}${isForecast ? '<span class="tag-forecast">FORECAST</span>' : ''}</td>
      <td>${actual   != null ? fmt(actual)   : '—'}</td>
      <td>${forecast != null ? fmt(Math.round(forecast)) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 9. Weekly Chart (last 2 years) */
function renderWeeklyChart(d) {
  makeChart('chart-weekly', {
    type: 'bar',
    data: {
      labels: d.weekKeys,
      datasets: [
        {
          type: 'bar',
          label: 'Weekly Count',
          data: d.weekVals,
          backgroundColor: COLORS.blueA,
          borderColor: COLORS.blue,
          borderWidth: 1,
          borderRadius: 2,
          order: 2
        },
        {
          type: 'line',
          label: `${CONFIG.MA_WINDOW_WEEKLY}-Week Moving Avg`,
          data: d.weekMA,
          borderColor: COLORS.amber,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.parsed.y)}` } }
      },
      scales: { x: xScale(), y: yScale('Weekly Count') }
    }
  });
}

/* 10. Weekly Table */
function renderWeeklyTable(d) {
  const tbody = document.getElementById('tbody-weekly');
  tbody.innerHTML = '';
  // Show all weeks (reverse order: most recent first)
  [...d.weekKeys].reverse().forEach((w, i) => {
    const ri = d.weekKeys.length - 1 - i;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${w}</td>
      <td>${fmt(d.weekVals[ri])}</td>
      <td>${fmt(Math.round(d.weekMA[ri]))}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 11. Monthly Chart (last 2 years) */
function renderMonthlyChart(d) {
  makeChart('chart-monthly', {
    type: 'bar',
    data: {
      labels: d.monKeys,
      datasets: [
        {
          type: 'bar',
          label: 'Monthly Count',
          data: d.monVals,
          backgroundColor: COLORS.tealA,
          borderColor: COLORS.teal,
          borderWidth: 1,
          borderRadius: 3,
          order: 2
        },
        {
          type: 'line',
          label: `${CONFIG.MA_WINDOW_MONTHLY}-Month Moving Avg`,
          data: d.monMA,
          borderColor: COLORS.amber,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.parsed.y)}` } }
      },
      scales: { x: xScale(), y: yScale('Monthly Count') }
    }
  });
}

/* 12. Monthly Table */
function renderMonthlyTable(d) {
  const tbody = document.getElementById('tbody-monthly');
  tbody.innerHTML = '';
  [...d.monKeys].reverse().forEach((m, i) => {
    const ri = d.monKeys.length - 1 - i;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m}</td>
      <td>${fmt(d.monVals[ri])}</td>
      <td>${fmt(Math.round(d.monMA[ri]))}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 13. Pie Chart – total reporting per year */
function renderPieChart(d) {
  const colors = pieColors(d.years.length);
  makeChart('chart-pie', {
    type: 'pie',
    data: {
      labels: d.years,
      datasets: [{
        data: d.yTotals,
        backgroundColor: colors,
        borderColor: 'rgba(10,22,40,.6)',
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx =>
              ` ${ctx.label}: ${fmtCompact(ctx.parsed)} (${((ctx.parsed / d.totalAll) * 100).toFixed(1)}%)`
          }
        }
      }
    }
  });

  // Custom legend
  const legendEl = document.getElementById('pie-legend');
  legendEl.innerHTML = '';
  d.years.forEach((y, i) => {
    const pct = ((d.yTotals[i] / d.totalAll) * 100).toFixed(1);
    const item = document.createElement('div');
    item.className = 'pie-legend-item';
    item.innerHTML = `
      <span class="pie-legend-dot" style="background:${colors[i]}"></span>
      <span class="pie-legend-label">${y}</span>
      <span class="pie-legend-value">${fmtCompact(d.yTotals[i])} (${pct}%)</span>
    `;
    legendEl.appendChild(item);
  });
}

// ── Header metadata ───────────────────────────────────────
function renderMeta(d) {
  const now = new Date();
  const genStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  document.getElementById('generated-dt').textContent = genStr;
  document.getElementById('data-period').textContent  = `${d.minDate} → ${d.maxDate}`;
}

// ── Fetch & bootstrap ─────────────────────────────────────
async function fetchData() {
  const to  = todayStr();
  const url = `${CONFIG.API_BASE}/v1/reporting?from_date=${CONFIG.FROM_DATE}&to_date=${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  return res.json();
}

async function init() {
  try {
    const raw  = await fetchData();
    const data = processData(raw);

    renderMeta(data);
    renderTotalCounts(data);
    renderDailyStats(data);
    renderGrowth(data);
    renderDowChart(data);
    renderCumulativeChart(data);
    renderNonCumChart(data);
    renderCumTable(data);
    renderNonCumTable(data);
    renderWeeklyChart(data);
    renderWeeklyTable(data);
    renderMonthlyChart(data);
    renderMonthlyTable(data);
    renderPieChart(data);

    document.getElementById('loading-overlay').style.display = 'none';
  } catch (err) {
    document.getElementById('loading-overlay').style.display = 'none';
    document.getElementById('error-overlay').style.display   = 'flex';
    document.getElementById('error-detail').textContent      = err.message;
    console.error('[ROGI]', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
