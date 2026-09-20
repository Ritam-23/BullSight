<p >
  <img src="image.png" alt="BullSight" width="350">
</p>

<br>
<br>
<p >
  Search every NASDAQ, NYSE, BSE and NSE listing, see backtested price forecasts,
  and screen exchanges by volume, buying pressure, profitability and momentum.
</p>


```
backend/   FastAPI: listings, market data, forecasting model, screener, OAuth
frontend/  Next.js 16 app (proxies /api/* to the backend)
```

## Run it

```bash
pip install -r backend/requirements.txt
```

```bash
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

```bash
npm --prefix frontend install
```

```bash
npm --prefix frontend run dev
```

Open http://localhost:3000. Until an OAuth provider is configured, the login page offers a demo account.

## OAuth setup

Copy `backend/.env.example` to `backend/.env` and fill in one or both providers:

| Provider | Where | Redirect / callback URL |
|---|---|---|
| Google | console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web) | `http://localhost:3000/api/auth/callback/google` |
| GitHub | github.com/settings/developers → New OAuth App | `http://localhost:3000/api/auth/callback/github` |

Set `SESSION_SECRET` to a long random string. Once a provider is configured, the demo login switches off
(`ALLOW_DEMO_LOGIN=auto`). For production, set `FRONTEND_URL` to your https domain and register that callback URL.

## Wallet, trading and watchlist (paper trading)

The Portfolio page has a wallet, holdings with live P&L, order history and a watchlist. Buy/Sell orders fill
at the live market price fetched by the server; US stocks are converted to INR at the live USD/INR rate.

**No real shares are bought or sold.** Stripe is a payment gateway, not a broker. Executing real trades
requires a SEBI-registered broker API (e.g. Zerodha Kite Connect, Upstox); swap `trade()` in
`backend/portfolio.py` for a broker order call to go live. To keep the wallet from ever collecting real
money, only Stripe **test** keys (`sk_test_...`) are accepted:

| Setting | Wallet "Add money" behaviour |
|---|---|
| No Stripe keys | Adds virtual funds (local development) |
| `STRIPE_SECRET_KEY=sk_test_...` (+ `STRIPE_PUBLISHABLE_KEY`) | Stripe Checkout in test mode (card 4242 4242 4242 4242); the server re-fetches the session from Stripe and credits once. Optional webhook: `stripe listen --forward-to localhost:8000/api/wallet/stripe/webhook`, then set `STRIPE_WEBHOOK_SECRET` |
| Live keys | Refused |

## Data sources (all free, no API keys)

| Data | Source |
|---|---|
| NASDAQ / NYSE listings | nasdaqtrader.com symbol directory |
| BSE listings (5,000+) | BSE India public scrip list |
| NSE listings, NIFTY 50 members, sector/theme lists (Defence, Energy, …) | NSE archives |
| S&P 500 / SENSEX members | datasets/s-and-p-500-companies, Wikipedia |
| Prices, fundamentals | Yahoo Finance via `yfinance` (delayed, unofficial, rate limited) |

Listings are cached for a week in `backend/data/`. Yahoo's BSE (`.BO`) history is currently truncated for most
large caps, so when that happens the app uses the same company's NSE series and says so on the page.

For production, swap `backend/market.py` for a licensed feed (e.g. Polygon, Alpaca or Twelve Data for US; a
broker API such as Zerodha Kite or Upstox for real-time NSE/BSE, which also exposes order-book depth that
would allow a true "buyers vs sellers" filter).

## The model & accuracy

### Model

For each horizon (1, 5, 10 and 20 trading days) the app predicts the **forward log return** from 23
technical features (lagged returns, momentum, volatility, RSI, MACD, moving-average gaps, Bollinger %B,
volume z-score) using an **ensemble of Ridge regression + a gradient-boosted tree**
(`HistGradientBoostingRegressor`), averaged. A naive **random-walk baseline** ("price stays the same")
competes against it; if nothing beats the baseline in validation, the app falls back to the flat forecast.

Evaluation is a **walk-forward backtest** (refit every ~4 months, no look-ahead): the model and its
shrink factor are chosen on a validation year, then scored on the following, **untouched** test year
(~185–210 trading days). Code: [`backend/model.py`](backend/model.py).

### Metrics

Every horizon's `backtest` returns the metrics below (via `/api/predict/{symbol}`). The `regression` block
reports **MSE, RMSE, MAE, R² and RSE** on two scales — the model's actual target (**log return**) and
reconstructed **price**:

| Metric | Meaning |
|---|---|
| `price_accuracy` | 100% − mean absolute % error, on price |
| `mape` / `naive_mape` | Mean abs % error — model vs random-walk baseline |
| `skill_vs_naive` | % improvement in MAPE over the baseline (≤0 ⇒ no edge) |
| `directional_accuracy` | % of moves where predicted sign = actual sign |
| `regression.log_return` / `regression.price` | `mse`, `rmse`, `mae`, `r2`, `rse` (residual standard error), `relative_squared_error` (= 1 − R²) |

**Reading the numbers (real backtest, 5y history):**

| | 1 day | 20 days |
|---|---|---|
| Price accuracy | **95–99%** | 90–96% |
| Price R² | 0.96–0.98 | 0.32–0.38 |
| **Log-return R²** | **≈ 0 (often slightly negative)** | ≈ 0 |
| Directional accuracy | ~48–61% | ~49–61% |

The headline **95%+ price accuracy is real but flattering** — a "no-change" forecast scores about the same,
because tomorrow's price is ~99% of today's. The honest measure of skill is **log-return R²**, which sits
near zero: short-horizon returns are close to unpredictable (weak-form efficiency), and the model beats the
random-walk baseline only occasionally. Both numbers are shown side by side so the app never overstates itself.

Inspect any ticker's metrics from the terminal:

```bash
python backend/show_metrics.py AAPL      # or RELIANCE.NS, TCS.NS, MSFT ...
```
