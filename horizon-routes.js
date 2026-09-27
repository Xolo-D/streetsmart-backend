// horizon-routes.js â€” Phase 1: multi-day weather-aware demand prediction
// Exports a function that wires routes into the Express app.

// ---------- SA public holiday lookup ----------
function computeEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

function getHolidayName(date) {
  const d = date instanceof Date ? date : new Date(date);
  const md = `${d.getMonth() + 1}-${d.getDate()}`;
  const y  = d.getFullYear();

  const fixed = {
    '1-1':   "New Year's Day",
    '3-21':  'Human Rights Day',
    '4-27':  'Freedom Day',
    '5-1':   "Workers' Day",
    '6-16':  'Youth Day',
    '8-9':   "National Women's Day",
    '9-24':  'Heritage Day',
    '12-16': 'Day of Reconciliation',
    '12-25': 'Christmas Day',
    '12-26': 'Day of Goodwill'
  };
  if (fixed[md]) return fixed[md];

  const easter = computeEaster(y);
  const gf = new Date(easter); gf.setDate(easter.getDate() - 2);
  const fd = new Date(easter); fd.setDate(easter.getDate() + 1);
  if (sameDay(d, gf)) return 'Good Friday';
  if (sameDay(d, fd)) return 'Family Day';

  return null;
}

// ---------- Southern Hemisphere season ----------
function getSeason(date) {
  const m = (date instanceof Date ? date : new Date(date)).getMonth() + 1;
  if ([12, 1, 2].includes(m)) return 'Summer';
  if ([3, 4, 5].includes(m))  return 'Autumn';
  if ([6, 7, 8].includes(m))  return 'Winter';
  return 'Spring';
}

function dayName(date) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()];
}

// ---------- Weather: current + 5-day forecast ----------
function mapCondition(main) {
  if (main === 'Clouds') return 'Cloudy';
  if (['Rain','Drizzle','Thunderstorm'].includes(main)) return 'Rainy';
  return 'Sunny';
}

async function fetchForecast(city, apiKey) {
  const url = 'https://api.openweathermap.org/data/2.5/forecast?q='
            + encodeURIComponent(city) + ',ZA&appid=' + apiKey + '&units=metric';
  const r = await fetch(url);
  if (!r.ok) throw new Error('OpenWeatherMap returned ' + r.status);
  const data = await r.json();

  // Group by day, take the reading closest to noon
  const byDay = {};
  for (const entry of (data.list || [])) {
    const date = entry.dt_txt.slice(0, 10);   // "2026-09-27"
    const hour = parseInt(entry.dt_txt.slice(11, 13), 10);
    if (hour >= 11 && hour <= 14 && !byDay[date]) {
      byDay[date] = {
        date,
        condition: mapCondition(entry.weather[0].main),
        temp: Math.round(entry.main.temp),
        description: entry.weather[0].description
      };
    }
  }
  return Object.values(byDay).slice(0, 5);
}

// ---------- Feature vector: the EXACT 12 columns train.py expects ----------
function buildFeatureVector(product, date, weather, ctx) {
  const isHoliday = getHolidayName(date);
  const dow = date.getDay();
  return {
    Category:      product.category,
    Vendor_Type:   ctx.vendorType || 'Food Vendor',
    City:          ctx.city || 'Durban',
    Day_of_Week:   dayName(date),
    Season:        getSeason(date),
    Weather:       weather,
    Holiday:       isHoliday ? isHoliday : 'No',
    Is_Weekend:    (dow === 0 || dow === 6) ? 'Yes' : 'No',
    Month:         date.getMonth() + 1,
    Discount:      0.0,
    Cost_Price:    +(product.unit_price * 0.7).toFixed(2),
    Selling_Price: product.unit_price
  };
}


// ---------- Trend: last 7 days vs prior 7 days ----------
function computeTrend(productId, db) {
  const now = new Date();
  const d7  = new Date(now); d7.setDate(now.getDate() - 7);
  const d14 = new Date(now); d14.setDate(now.getDate() - 14);
  const iso = (d) => d.toISOString().slice(0, 10);

  const recent = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS q FROM sales_log WHERE product_id = ? AND sold_at >= ?'
  ).get(productId, iso(d7)).q;

  const prior = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS q FROM sales_log WHERE product_id = ? AND sold_at >= ? AND sold_at < ?'
  ).get(productId, iso(d14), iso(d7)).q;

  if (prior === 0 && recent === 0) return 0;
  if (prior === 0) return 100;
  return Math.round(((recent - prior) / prior) * 100);
}

// ---------- Plain-English sentence ----------
function buildPredictionSentence(prediction, ctx) {
  const { weather, isWeekend, isHoliday, season, trendPct, dayLabel } = ctx;
  const parts = [];

  if (isHoliday) parts.push('the ' + isHoliday + ' holiday');

  if (weather === 'Rainy')       parts.push('a rainy forecast');
  else if (weather === 'Cloudy') parts.push('cloudy weather');
  else if (weather === 'Sunny')  parts.push('sunny conditions');

  if (!isHoliday) {
    if (isWeekend) parts.push('weekend demand');
    else           parts.push('your usual weekday pattern');
  }

  if (trendPct === 0)         parts.push('steady ' + season.toLowerCase() + ' sales');
  else if (trendPct > 0)      parts.push(trendPct + '% rise over your last 30 days');
  else                        parts.push(Math.abs(trendPct) + '% dip over your last 30 days');

  const reasonText = parts.length === 1
    ? parts[0]
    : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];

  const units = Math.round(prediction);
  const dayWord = dayLabel === 'Tomorrow' ? 'tomorrow' : 'on ' + dayLabel;
  return "You'll sell about " + units + ' ' + (units === 1 ? 'unit' : 'units') +
         ' ' + dayWord + '. This is based on ' + reasonText + '.';
}

// ---------- Route installer ----------
export default function installHorizonRoutes(app, db, requireAuth, ML_SERVICE) {

  // ---- Current weather (single day) ----
  app.get('/api/weather/:city', requireAuth(), async (req, res) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'WEATHER_API_KEY not set' });
    try {
      const url = 'https://api.openweathermap.org/data/2.5/weather?q='
                + encodeURIComponent(req.params.city) + ',ZA&appid=' + apiKey + '&units=metric';
      const r = await fetch(url);
      const data = await r.json();
      const main = (data.weather && data.weather[0] && data.weather[0].main) || '';
      res.json({
        city: data.name,
        condition: mapCondition(main),
        temp: Math.round(data.main.temp),
        description: data.weather[0].description
      });
    } catch (err) {
      res.status(503).json({ error: 'weather unavailable: ' + err.message });
    }
  });

  // ---- 5-day forecast ----
  app.get('/api/weather/forecast/:city', requireAuth(), async (req, res) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'WEATHER_API_KEY not set' });
    try {
      const forecast = await fetchForecast(req.params.city, apiKey);
      res.json(forecast);
    } catch (err) {
      res.status(503).json({ error: 'forecast unavailable: ' + err.message });
    }
  });

  // ---- Multi-day, weather-aware demand prediction ----
  app.post('/api/predict/horizon', requireAuth(), async (req, res) => {
    const { product_ids = [], days = 1 } = req.body || {};
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ error: 'product_ids required' });
    }
    const n = Math.max(1, Math.min(5, parseInt(days, 10) || 1));

    const city = req.user.city || 'Durban';

    // Get forecast for the next N days
    let forecast = [];
    const apiKey = process.env.WEATHER_API_KEY;
    if (apiKey) {
      try {
        forecast = await fetchForecast(city, apiKey);
      } catch (e) {
        // fall back to sunny
        console.warn('[horizon] forecast failed, using defaults:', e.message);
      }
    }
    // Pad with Sunny defaults if forecast is short or missing
    const today = new Date();
    while (forecast.length < n) {
      const d = new Date(today);
      d.setDate(today.getDate() + forecast.length + 1);
      forecast.push({
        date: d.toISOString().slice(0, 10),
        condition: 'Sunny',
        temp: 24,
        description: 'clear sky'
      });
    }
    forecast = forecast.slice(0, n);

    const results = [];
    for (const pid of product_ids) {
      const product = db.prepare('SELECT id, name, category, unit_price, reorder_level FROM products WHERE id = ?').get(pid);
      if (!product) continue;

      // Fetch THIS vendor's stock for this product (falls back to 0)
      const vendorId = req.user.vendorId;
      const vpRow = vendorId
        ? db.prepare('SELECT current_stock FROM vendor_products WHERE vendor_id = ? AND product_id = ?').get(vendorId, pid)
        : null;
      const vendorStock = vpRow ? (vpRow.current_stock || 0) : 0;

      for (const day of forecast) {
        const date = new Date(day.date + 'T12:00:00');
        const features = buildFeatureVector(product, date, day.condition, {
          city,
          vendorType: req.user.type || 'Food Vendor'
        });

        let predicted = 0;
        try {
          const mlRes = await fetch(`${ML_SERVICE}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(features)
          });
          if (mlRes.ok) {
            const mlData = await mlRes.json();
            predicted = mlData.predicted_daily_demand ?? mlData.prediction ?? 0;
          }
        } catch (e) {
          // skip â€” predicted stays 0
        }

        const isWknd = (date.getDay() === 0 || date.getDay() === 6);
        const holiday = getHolidayName(date);
        const seasonStr = getSeason(date);
        const trendPct = computeTrend(product.id, db);

        const todayMid = new Date(); todayMid.setHours(0,0,0,0);
        const targetMid = new Date(date); targetMid.setHours(0,0,0,0);
        const diffDays = Math.round((targetMid - todayMid) / 86400000);
        const dayLabel = diffDays === 1 ? "Tomorrow" : dayName(date).slice(0, 3) + " " + date.getDate() + " " + date.toLocaleString("en-ZA", { month: "short" });

        const sentence = buildPredictionSentence(predicted, {
          weather: day.condition,
          isWeekend: isWknd,
          isHoliday: holiday,
          season: seasonStr,
          trendPct,
          dayLabel
        });

        results.push({
          product_id: product.id,
          product_name: product.name,
          category: product.category,
          date: day.date,
          day_label: dayLabel,
          weather: day.condition,
          temp: day.temp,
          is_weekend: isWknd,
          is_holiday: holiday,
          season: seasonStr,
          current_stock: vendorStock,
          predicted_demand: +predicted.toFixed(2),
          trend_pct: trendPct,
          sentence
        });
      }
    }

    res.json({ city, days: n, results });
  });
}
