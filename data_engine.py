import yfinance as yf
import pandas as pd
import numpy as np
from ta import add_all_ta_features

class StockDataEngine:
    """
    Engine to fetch and preprocess stock data from various exchanges.
    Supports NASDAQ, BSE, and S&P 500.
    """

    def __init__(self):
        # Suffixes for different exchanges in Yahoo Finance
        self.exchange_suffixes = {
            'nasdaq': '', # Usually no suffix or .O / .Q
            'bse': '.BO',
            'nse': '.NS'
        }

    def fetch_data(self, ticker, period="5y", interval="1d", exchange="nasdaq"):
        """
        Fetches historical data for a given ticker.
        """
        suffix = self.exchange_suffixes.get(exchange.lower(), '')
        full_ticker = f"{ticker}{suffix}"

        try:
            print(f"Fetching data for {full_ticker}...")
            df = yf.download(full_ticker, period=period, interval=interval)

            if df.empty:
                print(f"No data found for {full_ticker}")
                return None

            # Fix for yfinance MultiIndex columns when downloading a single ticker
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            return df
        except Exception as e:
            print(f"Error fetching data for {full_ticker}: {e}")
            return None

    def preprocess_data(self, df):
        """
        Adds technical indicators to the dataframe to improve model accuracy.
        We add RSI, MACD, and Moving Averages.
        """
        # Ensure we have a clean copy
        df = df.copy()

        # Add all technical analysis features from 'ta' library
        # This includes RSI, MACD, Bollinger Bands, etc.
        df = add_all_ta_features(
            df, open="Open", high="High", low="Low", close="Close", volume="Volume", fillna=True
        )

        # Drop any remaining NaNs resulting from indicators (like 200-day SMA)
        df.dropna(inplace=True)

        return df

    def get_suggestion_data(self, exchange="nasdaq", limit=10, filter_by="volume"):
        """
        A basic implementation of the suggestion engine.
        In a full app, this would query a database of scanned stocks.
        """
        # This is a placeholder. For a real app, you'd have a list of all tickers
        # for that exchange and iterate/rank them.
        print(f"Scanning {exchange} for best stocks based on {filter_by}...")
        # Logic: Fetch top 50 stocks -> Calculate Volume/Profit -> Sort -> Return Top N
        return {"message": "Suggestion engine logic requires a ticker list per exchange."}

if __name__ == "__main__":
    engine = StockDataEngine()
    # Example: Fetch Apple (NASDAQ)
    apple_data = engine.fetch_data("AAPL", exchange="nasdaq")
    if apple_data is not None:
        processed = engine.preprocess_data(apple_data)
        print("Processed Apple Data Head:\n", processed.head())

    # Example: Fetch Reliance (BSE)
    reliance_data = engine.fetch_data("RELIANCE", exchange="bse")
    if reliance_data is not None:
        processed_rel = engine.preprocess_data(reliance_data)
        print("\nProcessed Reliance Data Head:\n", processed_rel.head())
