"""Proof: run the REAL forecaster and print the regression metrics block
exactly as /api/predict/{symbol} returns it."""
import json
import sys
import yfinance as yf
import model

sym = (sys.argv[1] if len(sys.argv) > 1 else "AAPL").upper()
df = yf.Ticker(sym).history(period="5y", interval="1d", auto_adjust=True)
out = model.forecast(sym, df)

print(f"\n########  {sym}   last_close={out['last_close']}   outlook={out['outlook']}  ########")
for h in out["horizons"]:
    print(f"\n----- horizon {h['days']}d  (model={h['model']}, beats_naive={h['beats_naive']}) -----")
    print(json.dumps(h["backtest"]["regression"], indent=2))
