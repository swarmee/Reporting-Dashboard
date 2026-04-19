'use strict';

/* ============================================================
   ROGI Dashboard – dashboard.js
   Daily UTC Time Reporting
   ============================================================ */

// ── Configuration ─────────────────────────────────────────
const CONFIG = {
  API_BASE: (() => {
    const h = window.location.hostname;
    if (h === 'api' || h === 'localhost' || h === '127.0.0.1') return '';
    return 'http://api';
  })(),
  FROM_DATE: '1970-01-01',
  MAX_X_LABELS: 10,
  REGRESSION_YEARS: 8,       // training window for linear regression (yearly)
  FORECAST_EXTRA_YEARS: 4,   // forecast years beyond current year
  WEEKLY_FORECAST: 3,        // weeks to forecast
  MONTHLY_FORECAST: 3,       // months to forecast
  DAILY60_FORECAST: 5        // days to forecast on 60-day chart
};

// ── Theme helpers ──────────────────────────────────────────
function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function getChartThemeColors() {
  const theme = getCurrentTheme();
  if (theme === 'light') {
    return {
      text: '#3a5a8a',
      border: '#c5d5ed',
      title: '#3a5a8a',
      grid: 'rgba(150,180,220,.4)',
      dowFill: 'rgba(76,142,247,.30)',
      domFill: 'rgba(26,191,191,.25)'
    };
  }
  if (theme === 'ukraine') {
    return {
      text: '#1f4d96',
      border: '#9ebeea',
      title: '#1f4d96',
      grid: 'rgba(126,168,223,.45)',
      dowFill: 'rgba(0,87,183,.28)',
      domFill: 'rgba(255,215,0,.25)'
    };
  }
  return {
    text: '#9ab3d8',
    border: '#1c3464',
    title: '#5a7aaa',
    grid: 'rgba(44,74,138,.35)',
    dowFill: 'rgba(76,142,247,.45)',
    domFill: 'rgba(26,191,191,.4)'
  };
}

function applyChartDefaultsForTheme() {
  const colors = getChartThemeColors();
  Chart.defaults.color = colors.text;
  Chart.defaults.borderColor = colors.border;
}

function updateThemeToggleButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const theme = getCurrentTheme();
  if (theme === 'light') {
    btn.textContent = '☀️';
    btn.title = 'Theme: Light (click to cycle to Dark)';
  } else if (theme === 'ukraine') {
    btn.textContent = '🇺🇦';
    btn.title = 'Theme: Ukraine (click to cycle to Light)';
  } else {
    btn.textContent = '🌙';
    btn.title = 'Theme: Dark (click to cycle to Ukraine)';
  }
}

// ── Chart defaults ─────────────────────────────────────────
applyChartDefaultsForTheme();
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
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// ── Date helpers ──────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function weekOfYear(d) {
  // Calendar week bin (Jan 1 starts week 1), used intentionally for
  // year-over-year overlay on a Jan→Dec timeline rather than ISO week-year.
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const dayNum = Math.floor((d - yearStart) / 86400000) + 1;
  return Math.floor((dayNum - 1) / 7) + 1;
}

function isoWeekLabel(d) {
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

function addMonths(yyyymm, n) {
  let [y, m] = yyyymm.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

// ── Fullscreen toggle ─────────────────────────────────────
function toggleFullscreen(el) {
  if (!document.fullscreenElement) {
    if (el.requestFullscreen) el.requestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}

function onFullscreenChange() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    // Exiting fullscreen — resize all charts so they return to original height
    setTimeout(() => {
      Object.values(chartInstances).forEach(chart => {
        try { chart.resize(); } catch (e) { /* ignore */ }
      });
      resizePlotlyCharts();
      snapDataTableWrapperHeights();
    }, 150);
  }
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

function syncLayoutForPrint() {
  Object.values(chartInstances).forEach(chart => {
    try { chart.resize(); } catch (e) { /* ignore */ }
  });
  resizePlotlyCharts(true, true);
  snapDataTableWrapperHeights();
}
window.addEventListener('beforeprint', () => {
  syncLayoutForPrint();
  setTimeout(syncLayoutForPrint, 100);
  requestAnimationFrame(syncLayoutForPrint);
});
window.addEventListener('afterprint', () => {
  setTimeout(() => {
    Object.values(chartInstances).forEach(chart => {
      try { chart.resize(); } catch (e) { /* ignore */ }
    });
    resizePlotlyCharts(true, false);
    snapDataTableWrapperHeights();
  }, 100);
});

if (window.matchMedia) {
  const printMedia = window.matchMedia('print');
  if (printMedia?.addEventListener) {
    printMedia.addEventListener('change', e => {
      if (e.matches) {
        syncLayoutForPrint();
        setTimeout(syncLayoutForPrint, 120);
      } else {
        setTimeout(() => {
          resizePlotlyCharts(true, false);
          snapDataTableWrapperHeights();
        }, 120);
      }
    });
  }
}

window.addEventListener('resize', () => {
  resizePlotlyCharts(false);
  snapDataTableWrapperHeights();
});

// ── Data processing ───────────────────────────────────────
function processData(raw) {
  const records = raw.content
    .map(r => ({ date: r.date, count: Number(r.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!records.length) throw new Error('API returned empty dataset.');

  const today       = todayStr();
  const currentYear = new Date().getFullYear();
  const currentMon  = today.slice(0, 7);
  const currentWeek = weekOfYear(parseLocalDate(today));

  const last365Start = addDays(today, -365);
  const prev365Start = addDays(today, -730);
  const last30Start  = addDays(today, -30);
  const prev30Start  = addDays(today, -60);
  const last7Start   = addDays(today, -7);
  const prev7Start   = addDays(today, -14);
  const twoYrStart   = addDays(today, -730);
  const fiveYrStart  = addDays(today, -1825);
  const last60Start  = addDays(today, -60);

  // Partitions
  const last365 = records.filter(r => r.date >= last365Start);
  const prev365 = records.filter(r => r.date >= prev365Start && r.date < last365Start);
  const last30  = records.filter(r => r.date >= last30Start);
  const prev30  = records.filter(r => r.date >= prev30Start && r.date < last30Start);
  const last7   = records.filter(r => r.date >= last7Start);
  const prev7   = records.filter(r => r.date >= prev7Start && r.date < last7Start);
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

  const sum7       = arrSum(last7.map(r => r.count));
  const sumPrev7   = arrSum(prev7.map(r => r.count));
  const growth7    = sumPrev7  > 0 ? ((sum7   - sumPrev7)   / sumPrev7)   * 100 : null;

  // Day-of-week averages (last 365 days), Mon=0 … Sun=6
  const dowBuckets = Array.from({ length: 7 }, () => []);
  last365.forEach(r => {
    const dow = (parseLocalDate(r.date).getDay() + 6) % 7;
    dowBuckets[dow].push(r.count);
  });
  const dowAvg = dowBuckets.map(b => arrMean(b));
  const dowMin = dowBuckets.map(b => b.length ? Math.min(...b) : null);
  const dowMax = dowBuckets.map(b => b.length ? Math.max(...b) : null);
  const dowRecent = Array(7).fill(null);
  let dowRemaining = 7;
  for (let i = records.length - 1; i >= 0 && dowRemaining > 0; i--) {
    const dow = (parseLocalDate(records[i].date).getDay() + 6) % 7;
    if (dowRecent[dow] == null) {
      dowRecent[dow] = records[i].count;
      dowRemaining--;
    }
  }

  // ── Day-of-Month averages (last 2 years) ───────────────
  const domBuckets = Array.from({ length: 31 }, () => []);
  records.filter(r => r.date >= twoYrStart).forEach(r => {
    const day = parseInt(r.date.slice(8, 10), 10) - 1;
    domBuckets[day].push(r.count);
  });
  const domAvg = domBuckets.map(b => b.length ? arrMean(b) : null);
  const domMin = domBuckets.map(b => b.length ? Math.min(...b) : null);
  const domMax = domBuckets.map(b => b.length ? Math.max(...b) : null);
  const domRecent = Array(31).fill(null);
  let domRemaining = 31;
  for (let i = records.length - 1; i >= 0 && domRemaining > 0; i--) {
    const day = parseInt(records[i].date.slice(8, 10), 10) - 1;
    if (domRecent[day] == null) {
      domRecent[day] = records[i].count;
      domRemaining--;
    }
  }

  // ── Month-of-Year averages (last 5 years) ──────────────
  // Group daily records into monthly totals, then average by month-of-year
  const moyMonthlyMap = {};
  records.filter(r => r.date >= fiveYrStart).forEach(r => {
    const m = r.date.slice(0, 7);
    moyMonthlyMap[m] = (moyMonthlyMap[m] || 0) + r.count;
  });
  const moyBuckets = Array.from({ length: 12 }, () => []);
  Object.entries(moyMonthlyMap).forEach(([m, v]) => {
    const mon = parseInt(m.slice(5, 7), 10) - 1;
    moyBuckets[mon].push(v);
  });
  const moyAvg = moyBuckets.map(b => b.length ? arrMean(b) : 0);
  const moyRecent = Array(12).fill(null);
  const sortedMoyMonths = Object.keys(moyMonthlyMap).sort();
  let moyRemaining = 12;
  for (let i = sortedMoyMonths.length - 1; i >= 0 && moyRemaining > 0; i--) {
    const m = sortedMoyMonths[i];
    const mon = parseInt(m.slice(5, 7), 10) - 1;
    if (moyRecent[mon] == null) {
      moyRecent[mon] = moyMonthlyMap[m];
      moyRemaining--;
    }
  }

  // ── Yearly aggregates ──────────────────────────────────
  const yearMap = {};
  records.forEach(r => {
    const y = r.date.slice(0, 4);
    yearMap[y] = (yearMap[y] || 0) + r.count;
  });
  const years   = Object.keys(yearMap).sort();
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

  const lastForecastYr = currentYear + CONFIG.FORECAST_EXTRA_YEARS;
  const forecastYrs = Array.from(
    { length: CONFIG.FORECAST_EXTRA_YEARS + 1 },
    (_, i) => currentYear + i
  );
  const regNonCum = linReg(trainYrs.map(Number), trainTots);
  const regCum    = linReg(trainYrs.map(Number), trainCums);

  const extraYrs = forecastYrs
    .filter(y => !years.includes(String(y)))
    .map(String);
  const allYearLabels = [...years, ...extraYrs];

  const lastTrainYr = trainYrs.length ? Number(trainYrs[trainYrs.length - 1]) : null;

  function buildForecastLine(reg) {
    return allYearLabels.map(y => {
      const yn = Number(y);
      if (forecastYrs.includes(yn)) return Math.max(0, regPredict(reg, yn));
      if (yn === lastTrainYr)       return Math.max(0, regPredict(reg, yn));
      return null;
    });
  }

  const forecastLineNonCum = buildForecastLine(regNonCum);
  const forecastLineCum    = buildForecastLine(regCum);

  const barNonCum = allYearLabels.map(y => yearMap[y] ?? null);
  const barCum    = allYearLabels.map(y => {
    const idx = years.indexOf(y);
    return idx >= 0 ? yCumulative[idx] : null;
  });

  // ── Daily 60-day ────────────────────────────────────────
  const daily60 = records.filter(r => r.date >= last60Start);
  const daily60Keys = daily60.map(r => r.date);
  const daily60Vals = daily60.map(r => r.count);
  const n60 = daily60Keys.length;

  // Fit regression on x = 0..n60-1
  const d60xs = daily60Vals.map((_, i) => i);
  const regDaily60 = linReg(d60xs, daily60Vals);

  // Forecast labels: last date + 1..DAILY60_FORECAST days
  const lastDaily60Date = n60 > 0 ? daily60Keys[n60 - 1] : today;
  const daily60ForecastDates = Array.from(
    { length: CONFIG.DAILY60_FORECAST },
    (_, i) => addDays(lastDaily60Date, i + 1)
  );
  const daily60AllLabels = [...daily60Keys, ...daily60ForecastDates];

  // Bar: actual values + nulls for forecast slots
  const daily60BarData = [
    ...daily60Vals,
    ...Array(CONFIG.DAILY60_FORECAST).fill(null)
  ];

  // Regression line: full fit over actual data + forecast extension
  // Anchor at last actual point so line connects
  const daily60RegLine = daily60AllLabels.map((_, i) => {
    if (i >= n60 - 1) return Math.max(0, regPredict(regDaily60, i));
    return null;
  });

  // 7-day moving average for daily60
  const daily60MA = daily60Vals.map((_, i) => {
    const start = Math.max(0, i - 6);
    return arrMean(daily60Vals.slice(start, i + 1));
  });

  // ── Weekly (last 2 years) ──────────────────────────────
  const weekMap = {};
  records
    .filter(r => r.date >= twoYrStart)
    .forEach(r => {
      const w = isoWeekLabel(parseLocalDate(r.date));
      weekMap[w] = (weekMap[w] || 0) + r.count;
    });
  const weekKeys = Object.keys(weekMap).sort();
  const weekVals = weekKeys.map(w => weekMap[w]);
  const nWeeks   = weekKeys.length;

  // Weekly linear regression
  const weekXs    = weekVals.map((_, i) => i);
  const regWeekly = linReg(weekXs, weekVals);

  // Full line of best fit for weekly (all actual weeks, no forecast)
  const weekBestFit = weekXs.map(x => Math.max(0, regPredict(regWeekly, x)));

  // Forecast next N weeks from the last date in the last week
  const lastWeekDate = records
    .filter(r => r.date >= twoYrStart)
    .reduce((latest, r) => r.date > latest ? r.date : latest, twoYrStart);
  const weekForecastKeys = Array.from(
    { length: CONFIG.WEEKLY_FORECAST },
    (_, i) => isoWeekLabel(parseLocalDate(addDays(lastWeekDate, 7 * (i + 1))))
  );
  const weekAllKeys = [...weekKeys, ...weekForecastKeys];

  // Bar: actual values + nulls for forecast slots
  const weekBarData = [
    ...weekVals,
    ...Array(CONFIG.WEEKLY_FORECAST).fill(null)
  ];

  // Regression line anchored at last actual week, extending through forecast
  const weekRegLine = weekAllKeys.map((_, i) => {
    if (i >= nWeeks - 1) return Math.max(0, regPredict(regWeekly, i));
    return null;
  });

  // ── Monthly (last 2 years) ─────────────────────────────
  const monMap = {};
  records
    .filter(r => r.date >= twoYrStart)
    .forEach(r => {
      const m = r.date.slice(0, 7);
      monMap[m] = (monMap[m] || 0) + r.count;
    });
  const monKeys = Object.keys(monMap).sort();
  const monVals = monKeys.map(m => monMap[m]);
  const nMons   = monKeys.length;

  // Monthly linear regression
  const monXs     = monVals.map((_, i) => i);
  const regMonthly = linReg(monXs, monVals);

  // Full line of best fit for monthly (all actual months, no forecast)
  const monBestFit = monXs.map(x => Math.max(0, regPredict(regMonthly, x)));

  // Forecast next N months
  const lastMonKey = monKeys.length ? monKeys[monKeys.length - 1] : currentMon;
  const monForecastKeys = Array.from(
    { length: CONFIG.MONTHLY_FORECAST },
    (_, i) => addMonths(lastMonKey, i + 1)
  );
  const monAllKeys = [...monKeys, ...monForecastKeys];

  // Bar: actual values + nulls for forecast slots
  const monBarData = [
    ...monVals,
    ...Array(CONFIG.MONTHLY_FORECAST).fill(null)
  ];

  // Regression line anchored at last actual month
  const monRegLine = monAllKeys.map((_, i) => {
    if (i >= nMons - 1) return Math.max(0, regPredict(regMonthly, i));
    return null;
  });

  // ── Weekly cumulative comparison (current + previous 3 years) ─────────────
  const weeklyCumYears = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(String);
  const maxWeeks = Math.max(
    ...weeklyCumYears.map(y => weekOfYear(new Date(Number(y), 11, 31)))
  );
  const weeklyCumWeekLabels = Array.from(
    { length: maxWeeks },
    (_, i) => `W${String(i + 1).padStart(2, '0')}`
  );
  const weeklyYearTotals = Object.fromEntries(
    weeklyCumYears.map(y => [y, Array(maxWeeks).fill(0)])
  );
  records.forEach(r => {
    const y = r.date.slice(0, 4);
    if (!weeklyYearTotals[y]) return;
    const w = weekOfYear(parseLocalDate(r.date)) - 1;
    if (w >= 0 && w < maxWeeks) weeklyYearTotals[y][w] += r.count;
  });
  const weeklyCumSeries = weeklyCumYears.map(y => {
    let running = 0;
    return weeklyYearTotals[y].map((v, idx) => {
      running += v;
      if (y === String(currentYear) && idx >= currentWeek) return null;
      return running;
    });
  });

  // ── Last 5 Year Summary ─────────────────────────────────────────
  const fiveYrSummary = [];
  for (let offset = 0; offset < 5; offset++) {
    const y = String(currentYear - offset);
    const yIdx = years.indexOf(y);
    const annTotal = yIdx >= 0 ? yTotals[yIdx] : 0;
    const prevY = String(currentYear - offset - 1);
    const prevYIdx = years.indexOf(prevY);
    const prevAnn = prevYIdx >= 0 ? yTotals[prevYIdx] : null;
    const annGrowth = (prevAnn != null && prevAnn > 0)
      ? ((annTotal - prevAnn) / prevAnn) * 100 : null;
    const cumTotal = yIdx >= 0 ? yCumulative[yIdx] : null;
    const prevCum = prevYIdx >= 0 ? yCumulative[prevYIdx] : null;
    const cumGrowth = (prevCum != null && prevCum > 0 && cumTotal != null)
      ? ((cumTotal - prevCum) / prevCum) * 100 : null;
    fiveYrSummary.push({ year: y, annTotal, annGrowth, cumTotal, cumGrowth });
  }
  // "Earlier Years" row (all years before currentYear-4)
  const cutoffYear = currentYear - 4;
  const earlierYrs = years.filter(y => Number(y) < cutoffYear);
  const earlierAnnTotal = arrSum(earlierYrs.map(y => yearMap[y] || 0));
  const lastEarlierIdx = earlierYrs.length > 0 ? years.indexOf(earlierYrs[earlierYrs.length - 1]) : -1;
  const earlierCumTotal = lastEarlierIdx >= 0 ? yCumulative[lastEarlierIdx] : 0;
  fiveYrSummary.push({ year: 'Earlier', annTotal: earlierAnnTotal, annGrowth: null, cumTotal: earlierCumTotal, cumGrowth: null });

  // ── Pie chart: top 10 years by total + "Other" ──────────────────
  const pieSorted = years.map((y, i) => ({ year: y, total: yTotals[i] }))
    .sort((a, b) => b.total - a.total);
  const pieTop10  = pieSorted.slice(0, 10);
  const pieOthers = pieSorted.slice(10);
  const pieOtherTotal = arrSum(pieOthers.map(x => x.total));
  const pieDisplayYears  = pieTop10.map(x => x.year);
  const pieDisplayTotals = pieTop10.map(x => x.total);
  if (pieOthers.length > 0) {
    pieDisplayYears.push('Other');
    pieDisplayTotals.push(pieOtherTotal);
  }

  const heatmapYears = Array.from({ length: 5 }, (_, i) => String(currentYear - 4 + i));
  const moyHeatmap = heatmapYears.map(y => (
    Array.from({ length: 12 }, (_, monthIdx) => {
      const key = `${y}-${String(monthIdx + 1).padStart(2, '0')}`;
      return moyMonthlyMap[key] ?? null;
    })
  ));

  const weekYearHeatmapYears = Array.from({ length: 5 }, (_, i) => String(currentYear - 4 + i));
  const maxWeekYearWeeks = Math.max(
    ...weekYearHeatmapYears.map(y => weekOfYear(new Date(Number(y), 11, 31)))
  );
  const weekYearWeekLabels = Array.from(
    { length: maxWeekYearWeeks },
    (_, i) => `W${String(i + 1).padStart(2, '0')}`
  );
  const weekYearTotals = Object.fromEntries(
    weekYearHeatmapYears.map(y => [y, Array(maxWeekYearWeeks).fill(null)])
  );
  weekYearHeatmapYears.forEach(y => {
    const weeksInYear = weekOfYear(new Date(Number(y), 11, 31));
    for (let i = 0; i < weeksInYear; i++) weekYearTotals[y][i] = 0;
  });
  records.forEach(r => {
    const y = r.date.slice(0, 4);
    if (!weekYearTotals[y]) return;
    const w = weekOfYear(parseLocalDate(r.date)) - 1;
    if (w >= 0 && w < maxWeekYearWeeks && weekYearTotals[y][w] != null) {
      weekYearTotals[y][w] += r.count;
    }
  });
  if (weekYearTotals[String(currentYear)]) {
    for (let i = currentWeek; i < maxWeekYearWeeks; i++) weekYearTotals[String(currentYear)][i] = null;
  }
  const weekYearHeatmap = weekYearHeatmapYears.map(y => weekYearTotals[y]);

  return {
    // totals
    totalAll, totalThisYear, totalThisMon,
    // daily stats
    dailyAll, daily365, daily30,
    // growth
    sum365, sumPrev365, growth365,
    sum30,  sumPrev30,  growth30,
    sum7,   sumPrev7,   growth7,
    // dow
    dowAvg, dowMin, dowMax, dowRecent, dowBuckets,
    // dom / moy
    domAvg, domMin, domMax, domRecent, domBuckets,
    moyAvg, moyRecent,
    heatmapYears, moyHeatmap,
    weekYearHeatmapYears, weekYearWeekLabels, weekYearHeatmap,
    // yearly
    years, yTotals, yCumulative,
    allYearLabels, barNonCum, barCum,
    forecastYrs, forecastLineNonCum, forecastLineCum,
    trainYrs,
    // daily 60
    daily60AllLabels, daily60BarData, daily60RegLine, daily60MA,
    daily60Keys, daily60Vals,
    n60, daily60ForecastDates,
    // weekly
    weekAllKeys, weekBarData, weekRegLine, weekBestFit,
    weekKeys, weekVals, weekForecastKeys,
    nWeeks,
    // monthly
    monAllKeys, monBarData, monRegLine, monBestFit,
    monKeys, monVals, monForecastKeys,
    nMons,
    // weekly cumulative comparison
    weeklyCumWeekLabels,
    weeklyCumYears,
    weeklyCumSeries,
    // 5-year summary
    fiveYrSummary,
    // pie
    pieDisplayYears, pieDisplayTotals,
    // metadata
    minDate: records[0].date,
    maxDate: records[records.length - 1].date
  };
}

// ── Chart factory helpers ─────────────────────────────────
const chartInstances = {};
const plotlyChartIds = ['chart-dow', 'chart-dom', 'chart-moy', 'chart-week-year'];

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

function yScale(title) {
  const colors = getChartThemeColors();
  return {
    grid: { color: colors.grid },
    ticks: {
      callback: v => fmtCompact(v),
      maxTicksLimit: 6,
      color: colors.text
    },
    title: title
      ? { display: true, text: title, color: colors.title, font: { size: 10 } }
      : undefined
  };
}

function xScale(maxLabels = CONFIG.MAX_X_LABELS) {
  const colors = getChartThemeColors();
  return {
    grid: { display: false },
    ticks: {
      maxTicksLimit: maxLabels,
      maxRotation: 40,
      minRotation: 0,
      color: colors.text,
      autoSkip: true
    }
  };
}

function resizePlotlyCharts(forceRelayout = false, lockToContainer = false) {
  if (!window.Plotly) return;
  plotlyChartIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      if (forceRelayout && !lockToContainer) {
        window.Plotly.relayout(el, { autosize: true, width: null, height: null });
      }
      window.Plotly.Plots.resize(el);
      if (forceRelayout && lockToContainer) {
        const container = el.closest('.chart-container');
        if (container) {
          const rect = container.getBoundingClientRect();
          const width = Math.max(0, Math.floor(rect.width || container.clientWidth));
          const height = Math.max(0, Math.floor(rect.height || container.clientHeight || el.clientHeight));
          if (width > 0 && height > 0) {
            window.Plotly.relayout(el, { width, height, autosize: false });
          }
        }
      }
    } catch (e) { /* ignore */ }
  });
}

// ── Panel renderers ───────────────────────────────────────

/* 1. Total Reporting Counts */
function renderTotalCounts(d) {
  document.getElementById('metric-total-all').textContent      = fmtCompact(d.totalAll);
  document.getElementById('metric-total-all-full').textContent = fmt(d.totalAll);
  document.getElementById('metric-total-yr').textContent       = fmtCompact(d.totalThisYear);
  document.getElementById('metric-total-yr-full').textContent  = fmt(d.totalThisYear);
  document.getElementById('metric-total-mon').textContent      = fmtCompact(d.totalThisMon);
  document.getElementById('metric-total-mon-full').textContent = fmt(d.totalThisMon);
}

/* 2. Daily Reporting Stats */
function renderDailyStats(d) {
  const rows = [
    { id: 'row-all', s: d.dailyAll },
    { id: 'row-365', s: d.daily365 },
    { id: 'row-30',  s: d.daily30  }
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
  setGrowth('g7d', d.growth7,   d.sum7,   d.sumPrev7);
  setGrowth('g1m', d.growth30,  d.sum30,  d.sumPrev30);
  setGrowth('g12', d.growth365, d.sum365, d.sumPrev365);
}

/* 4. Day-of-Week Bar Chart */
function renderDowChart(d) {
  if (!window.Plotly) return;
  const colors = getChartThemeColors();
  const x = [];
  const y = [];
  d.dowBuckets.forEach((bucket, i) => {
    bucket.forEach(v => {
      x.push(WEEKDAY_LABELS[i]);
      y.push(v);
    });
  });
  window.Plotly.react('chart-dow', [{
    type: 'box',
    x,
    y,
    boxpoints: 'suspectedoutliers',
    jitter: 0.3,
    whiskerwidth: 0.7,
    marker: { color: COLORS.amber, size: 3, opacity: 0.5 },
    line: { color: COLORS.blue, width: 2 },
    fillcolor: colors.dowFill,
    hovertemplate: '%{x}<br>%{y:,}<extra></extra>'
  }], {
    margin: { l: 50, r: 10, t: 8, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: colors.text, family: "'Segoe UI', system-ui, sans-serif", size: 11 },
    xaxis: {
      type: 'category',
      categoryorder: 'array',
      categoryarray: WEEKDAY_LABELS,
      tickfont: { color: colors.text }
    },
    yaxis: {
      tickformat: '~s',
      gridcolor: colors.grid,
      zeroline: false,
      tickfont: { color: colors.text }
    }
  }, { responsive: true, displayModeBar: false });
}

/* 5. Day-of-Month Bar Chart (last 2 years) */
function renderDomChart(d) {
  if (!window.Plotly) return;
  const colors = getChartThemeColors();
  const x = [];
  const y = [];
  d.domBuckets.forEach((bucket, i) => {
    bucket.forEach(v => {
      x.push(String(i + 1));
      y.push(v);
    });
  });
  window.Plotly.react('chart-dom', [{
    type: 'box',
    x,
    y,
    boxpoints: false,
    whiskerwidth: 0.6,
    line: { color: COLORS.teal, width: 1.5 },
    fillcolor: colors.domFill,
    hovertemplate: 'Day %{x}<br>%{y:,}<extra></extra>'
  }], {
    margin: { l: 50, r: 10, t: 8, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: colors.text, family: "'Segoe UI', system-ui, sans-serif", size: 11 },
    xaxis: {
      type: 'category',
      tickmode: 'array',
      tickvals: ['1', '5', '10', '15', '20', '25', '31'],
      tickfont: { color: colors.text }
    },
    yaxis: {
      tickformat: '~s',
      gridcolor: colors.grid,
      zeroline: false,
      tickfont: { color: colors.text }
    }
  }, { responsive: true, displayModeBar: false });
}

/* 6. Month-of-Year Bar Chart (last 5 years) */
function renderMoyChart(d) {
  if (!window.Plotly) return;
  const colors = getChartThemeColors();
  window.Plotly.react('chart-moy', [{
    type: 'heatmap',
    x: MONTH_LABELS,
    y: d.heatmapYears,
    z: d.moyHeatmap,
    colorscale: [
      [0, '#1f3b77'],
      [0.35, '#2f7ed8'],
      [0.6, '#36b1bf'],
      [0.8, '#f5a623'],
      [1, '#d64545']
    ],
    xgap: 2,
    ygap: 2,
    colorbar: {
      title: 'Count',
      tickformat: '~s',
      tickfont: { color: colors.text },
      titlefont: { color: colors.text }
    },
    hovertemplate: '%{y} %{x}<br>%{z:,}<extra></extra>'
  }], {
    margin: { l: 60, r: 30, t: 8, b: 35 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: colors.text, family: "'Segoe UI', system-ui, sans-serif", size: 11 },
    xaxis: {
      tickfont: { color: colors.text }
    },
    yaxis: {
      autorange: 'reversed',
      tickfont: { color: colors.text }
    }
  }, { responsive: true, displayModeBar: false });
}

/* 7. Cumulative Yearly Chart */
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

/* Week/Year Heatmap Chart (last 5 years) */
function renderWeekYearHeatmapChart(d) {
  if (!window.Plotly) return;
  const colors = getChartThemeColors();
  window.Plotly.react('chart-week-year', [{
    type: 'heatmap',
    x: d.weekYearWeekLabels,
    y: d.weekYearHeatmapYears,
    z: d.weekYearHeatmap,
    colorscale: [
      [0, '#1f3b77'],
      [0.35, '#2f7ed8'],
      [0.6, '#36b1bf'],
      [0.8, '#f5a623'],
      [1, '#d64545']
    ],
    xgap: 1,
    ygap: 2,
    colorbar: {
      title: 'Count',
      tickformat: '~s',
      tickfont: { color: colors.text },
      titlefont: { color: colors.text }
    },
    hovertemplate: '%{y} %{x}<br>%{z:,}<extra></extra>'
  }], {
    margin: { l: 60, r: 30, t: 8, b: 35 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: colors.text, family: "'Segoe UI', system-ui, sans-serif", size: 11 },
    xaxis: {
      tickmode: 'array',
      tickvals: d.weekYearWeekLabels.filter((_, i) => i % 4 === 0),
      tickfont: { color: colors.text }
    },
    yaxis: {
      autorange: 'reversed',
      tickfont: { color: colors.text }
    }
  }, { responsive: true, displayModeBar: false });
}

/* 8. Cumulative Yearly Table */
function renderCumTable(d) {
  const tbody = document.getElementById('tbody-cum');
  tbody.innerHTML = '';
  [...d.allYearLabels].reverse().forEach((y, revI) => {
    const i = d.allYearLabels.length - 1 - revI;
    const isForecast = d.forecastYrs.includes(Number(y)) && d.barCum[i] == null;
    const actual   = d.barCum[i];
    const forecast = d.forecastLineCum[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${y}${isForecast ? '<span class="tag-forecast">FORECAST</span>' : ''}</td>
      <td>${actual   != null ? fmt(actual)              : '—'}</td>
      <td>${forecast != null ? fmt(Math.round(forecast)) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 9. Annual (non-cumulative) Yearly Chart */
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

/* 10. Annual (non-cumulative) Yearly Table */
function renderNonCumTable(d) {
  const tbody = document.getElementById('tbody-noncum');
  tbody.innerHTML = '';
  [...d.allYearLabels].reverse().forEach((y, revI) => {
    const i = d.allYearLabels.length - 1 - revI;
    const isForecast = d.forecastYrs.includes(Number(y)) && d.barNonCum[i] == null;
    const actual   = d.barNonCum[i];
    const forecast = d.forecastLineNonCum[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${y}${isForecast ? '<span class="tag-forecast">FORECAST</span>' : ''}</td>
      <td>${actual   != null ? fmt(actual)              : '—'}</td>
      <td>${forecast != null ? fmt(Math.round(forecast)) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 11. Daily 60-day Chart */
function renderDaily60Chart(d) {
  makeChart('chart-daily60', {
    type: 'bar',
    data: {
      labels: d.daily60Keys,
      datasets: [
        {
          type: 'bar',
          label: 'Daily Count',
          data: d.daily60Vals,
          backgroundColor: COLORS.blueA,
          borderColor: COLORS.blue,
          borderWidth: 1,
          borderRadius: 2,
          order: 2
        },
        {
          type: 'line',
          label: '7-Day Moving Avg',
          data: d.daily60MA,
          borderColor: COLORS.green,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
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
      scales: { x: xScale(), y: yScale('Daily Count') }
    }
  });
}

/* 12. Daily 60-day Table */
function renderDaily60Table(d) {
  const tbody = document.getElementById('tbody-daily60');
  tbody.innerHTML = '';
  [...d.daily60Keys].reverse().forEach((date, revI) => {
    const i = d.n60 - 1 - revI;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${date}</td>
      <td>${fmt(d.daily60Vals[i])}</td>
      <td>${fmt(Math.round(d.daily60MA[i]))}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 13. Weekly Chart (last 2 years) */
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
          label: 'Line of Best Fit',
          data: d.weekBestFit,
          borderColor: COLORS.amber,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
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
      scales: { x: xScale(), y: yScale('Weekly Count') }
    }
  });
}

/* 14. Weekly Table */
function renderWeeklyTable(d) {
  const tbody = document.getElementById('tbody-weekly');
  tbody.innerHTML = '';

  [...d.weekKeys].reverse().forEach((w, revI) => {
    const i = d.nWeeks - 1 - revI;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${w}</td>
      <td>${fmt(d.weekVals[i])}</td>
      <td>${fmt(Math.round(d.weekBestFit[i]))}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 15. Monthly Chart (last 2 years) */
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
          label: 'Line of Best Fit',
          data: d.monBestFit,
          borderColor: COLORS.amber,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
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
      scales: { x: xScale(), y: yScale('Monthly Count') }
    }
  });
}

/* 16. Monthly Table */
function renderMonthlyTable(d) {
  const tbody = document.getElementById('tbody-monthly');
  tbody.innerHTML = '';

  [...d.monKeys].reverse().forEach((m, revI) => {
    const i = d.nMons - 1 - revI;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m}</td>
      <td>${fmt(d.monVals[i])}</td>
      <td>${fmt(Math.round(d.monBestFit[i]))}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* 17. Weekly cumulative comparison chart (last 4 years) */
function renderWeeklyCumulativeComparisonChart(d) {
  const lineColors = [COLORS.blue, COLORS.teal, COLORS.purple, COLORS.amber];
  makeChart('chart-weekly-cum-4yr', {
    type: 'line',
    data: {
      labels: d.weeklyCumWeekLabels,
      datasets: d.weeklyCumYears.map((year, i) => ({
        label: year,
        data: d.weeklyCumSeries[i],
        borderColor: lineColors[i] || COLORS.amber,
        backgroundColor: 'transparent',
        borderWidth: i === 0 ? 3.5 : 2,
        pointRadius: 0,
        tension: 0.2,
        spanGaps: false
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCompact(ctx.parsed.y)}` } }
      },
      scales: { x: xScale(10), y: yScale('Cumulative Volume') }
    }
  });
}

/* 18. Weekly cumulative comparison table (last 4 years) */
function renderWeeklyCumulativeComparisonTable(d) {
  const [y0, y1, y2, y3] = d.weeklyCumYears;
  const th0 = document.getElementById('th-weekly-cum-y0');
  const th1 = document.getElementById('th-weekly-cum-y1');
  const th2 = document.getElementById('th-weekly-cum-y2');
  const th3 = document.getElementById('th-weekly-cum-y3');
  if (th0) th0.textContent = `${y0} Cumulative`;
  if (th1) th1.textContent = `${y1} Cumulative`;
  if (th2) th2.textContent = `${y2} Cumulative`;
  if (th3) th3.textContent = `${y3} Cumulative`;

  const tbody = document.getElementById('tbody-weekly-cum-4yr');
  if (!tbody) return;
  tbody.innerHTML = '';
  d.weeklyCumWeekLabels.forEach((week, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${week}</td>
      <td>${d.weeklyCumSeries[0][i] != null ? fmt(d.weeklyCumSeries[0][i]) : '—'}</td>
      <td>${d.weeklyCumSeries[1][i] != null ? fmt(d.weeklyCumSeries[1][i]) : '—'}</td>
      <td>${d.weeklyCumSeries[2][i] != null ? fmt(d.weeklyCumSeries[2][i]) : '—'}</td>
      <td>${d.weeklyCumSeries[3][i] != null ? fmt(d.weeklyCumSeries[3][i]) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* Day-of-Week Table (last 365 days) */
function renderDowTable(d) {
  const tbody = document.getElementById('tbody-dow');
  if (!tbody) return;
  tbody.innerHTML = '';
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  labels.forEach((label, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td>${fmt(Math.round(d.dowAvg[i]))}</td>
      <td>${d.dowMin[i] != null ? fmt(d.dowMin[i]) : '—'}</td>
      <td>${d.dowMax[i] != null ? fmt(d.dowMax[i]) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* Day-of-Month Table (last 2 years) */
function renderDomTable(d) {
  const tbody = document.getElementById('tbody-dom');
  if (!tbody) return;
  tbody.innerHTML = '';
  d.domAvg.forEach((value, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${value != null ? fmt(Math.round(value)) : '—'}</td>
      <td>${d.domMin[i] != null ? fmt(d.domMin[i]) : '—'}</td>
      <td>${d.domMax[i] != null ? fmt(d.domMax[i]) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* Month-of-Year Table (last 5 years) */
function renderMoyTable(d) {
  const thead = document.getElementById('thead-moy');
  const tbody = document.getElementById('tbody-moy');
  if (!thead || !tbody) return;
  thead.innerHTML = '';
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th>Month</th>${d.heatmapYears.map(y => `<th>${y}</th>`).join('')}`;
  thead.appendChild(headerRow);
  tbody.innerHTML = '';
  MONTH_LABELS.forEach((month, monthIdx) => {
    const tr = document.createElement('tr');
    const yearCells = d.heatmapYears
      .map((_, yearIdx) => d.moyHeatmap[yearIdx][monthIdx])
      .map(v => `<td>${v != null ? fmt(v) : '—'}</td>`)
      .join('');
    tr.innerHTML = `<td>${month}</td>${yearCells}`;
    tbody.appendChild(tr);
  });
}

/* Week/Year Table (last 5 years) */
function renderWeekYearTable(d) {
  const thead = document.getElementById('thead-week-year');
  const tbody = document.getElementById('tbody-week-year');
  if (!thead || !tbody) return;

  thead.innerHTML = '';
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `<th>Week</th>${d.weekYearHeatmapYears.map(y => `<th>${y}</th>`).join('')}`;
  thead.appendChild(headerRow);

  tbody.innerHTML = '';
  d.weekYearWeekLabels.forEach((week, weekIdx) => {
    const tr = document.createElement('tr');
    const yearCells = d.weekYearHeatmap
      .map(yearValues => yearValues[weekIdx])
      .map(v => `<td>${v != null ? fmt(v) : '—'}</td>`)
      .join('');
    tr.innerHTML = `<td>${week}</td>${yearCells}`;
    tbody.appendChild(tr);
  });
}

function snapDataTableWrapperHeights() {
  document.querySelectorAll('.data-table-wrapper').forEach(wrapper => {
    const table = wrapper.querySelector('table');
    const headRow = table?.querySelector('thead tr');
    const bodyRow = table?.querySelector('tbody tr');
    if (!headRow || !bodyRow) return;

    if (!wrapper.dataset.baseMaxHeight) {
      const computedMaxHeight = getComputedStyle(wrapper).maxHeight;
      if (computedMaxHeight === 'none') return;
      const baseMaxHeight = parseFloat(computedMaxHeight);
      if (!Number.isFinite(baseMaxHeight) || baseMaxHeight <= 0) return;
      wrapper.dataset.baseMaxHeight = String(baseMaxHeight);
    }

    const baseMaxHeight = Number(wrapper.dataset.baseMaxHeight);
    const headerHeight = Math.ceil(headRow.getBoundingClientRect().height);
    const rowHeight = Math.ceil(bodyRow.getBoundingClientRect().height);
    if (!(baseMaxHeight > 0 && headerHeight > 0 && rowHeight > 0)) return;

    const visibleRows = Math.max(1, Math.floor((baseMaxHeight - headerHeight) / rowHeight));
    wrapper.style.maxHeight = `${headerHeight + (visibleRows * rowHeight)}px`;
  });
}

/* 19. Pie Chart – total reporting per year */
function renderPieChart(d) {
  const colors = pieColors(d.pieDisplayYears.length);
  makeChart('chart-pie', {
    type: 'pie',
    data: {
      labels: d.pieDisplayYears,
      datasets: [{
        data: d.pieDisplayTotals,
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
  d.pieDisplayYears.forEach((y, i) => {
    const pct = ((d.pieDisplayTotals[i] / d.totalAll) * 100).toFixed(1);
    const item = document.createElement('div');
    item.className = 'pie-legend-item';
    item.innerHTML = `
      <span class="pie-legend-dot" style="background:${colors[i]}"></span>
      <span class="pie-legend-label">${y}</span>
      <span class="pie-legend-value">${fmtCompact(d.pieDisplayTotals[i])} (${pct}%)</span>
    `;
    legendEl.appendChild(item);
  });
}

/* 20. Pie Table – total reporting per year */
function renderPieTable(d) {
  const tbody = document.getElementById('tbody-pie');
  tbody.innerHTML = '';
  d.pieDisplayYears.forEach((y, i) => {
    const pct = ((d.pieDisplayTotals[i] / d.totalAll) * 100).toFixed(1);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${y}</td>
      <td>${fmt(d.pieDisplayTotals[i])}</td>
      <td>${pct}%</td>
    `;
    tbody.appendChild(tr);
  });
}

/* Last 5 Year Summary Table */
function renderLast5YearSummary(d) {
  const tbody = document.getElementById('tbody-5yr');
  if (!tbody) return;
  tbody.innerHTML = '';
  d.fiveYrSummary.forEach(row => {
    const isEarlier = row.year === 'Earlier';
    const tr = document.createElement('tr');
    if (isEarlier) tr.style.cssText = 'border-top: 2px solid var(--border-light); color: var(--text-muted);';
    tr.innerHTML = `
      <td>${isEarlier ? 'Earlier Years' : row.year}</td>
      <td>${row.annTotal != null ? fmt(row.annTotal) : '—'}</td>
      <td>${row.annGrowth != null ? fmtPct(row.annGrowth) : '—'}</td>
      <td>${row.cumTotal != null ? fmt(row.cumTotal) : '—'}</td>
      <td>${row.cumGrowth != null ? fmtPct(row.cumGrowth) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* Theme toggle */
function toggleTheme() {
  const html = document.documentElement;
  const cycle = ['light', 'dark', 'ukraine'];
  const current = getCurrentTheme();
  const idx = cycle.indexOf(current);
  const nextTheme = cycle[(idx + 1 + cycle.length) % cycle.length];
  if (nextTheme === 'dark') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', nextTheme);
  }
  applyChartDefaultsForTheme();
  updateThemeToggleButton();
  if (window._dashData) {
    renderDowChart(window._dashData);
    renderDomChart(window._dashData);
    renderMoyChart(window._dashData);
    renderWeekYearHeatmapChart(window._dashData);
    renderCumulativeChart(window._dashData);
    renderNonCumChart(window._dashData);
    renderDaily60Chart(window._dashData);
    renderWeeklyChart(window._dashData);
    renderWeeklyCumulativeComparisonChart(window._dashData);
    renderMonthlyChart(window._dashData);
    renderPieChart(window._dashData);
  }
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
    updateThemeToggleButton();
    const raw  = await fetchData();
    const data = processData(raw);
    window._dashData = data;

    renderMeta(data);
    renderTotalCounts(data);
    renderDailyStats(data);
    renderGrowth(data);
    renderDowChart(data);
    renderDowTable(data);
    renderDomChart(data);
    renderDomTable(data);
    renderMoyChart(data);
    renderMoyTable(data);
    renderWeekYearHeatmapChart(data);
    renderWeekYearTable(data);
    renderCumulativeChart(data);
    renderCumTable(data);
    renderNonCumChart(data);
    renderNonCumTable(data);
    renderDaily60Chart(data);
    renderDaily60Table(data);
    renderWeeklyChart(data);
    renderWeeklyTable(data);
    renderWeeklyCumulativeComparisonChart(data);
    renderWeeklyCumulativeComparisonTable(data);
    renderMonthlyChart(data);
    renderMonthlyTable(data);
    renderPieChart(data);
    renderPieTable(data);
    renderLast5YearSummary(data);
    snapDataTableWrapperHeights();

    document.getElementById('loading-overlay').style.display = 'none';
  } catch (err) {
    document.getElementById('loading-overlay').style.display = 'none';
    document.getElementById('error-overlay').style.display   = 'flex';
    document.getElementById('error-detail').textContent      = err.message;
    console.error('[ROGI]', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
