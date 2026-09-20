"""Seed a funded test account for local testing.

Run once:  python seed_demo.py

Creates spyder300405@gmail.com (password Spyder@2005) if it doesn't exist and funds the
paper-trading wallet. The wallet is INR-denominated (USD trades convert via live FX), so the
"$100k" is credited as its rupee equivalent, capped at the ₹1 crore wallet limit.
"""
import time

import users
import portfolio

EMAIL = "spyder300405@gmail.com"
NAME = "Spyder"
PASSWORD = "Spyder@2005"

USD_AMOUNT = 100_000
USD_INR = 83  # approximate; the wallet stores INR
FUND_PAISE = min(USD_AMOUNT * USD_INR * 100, portfolio.MAX_WALLET_PAISE)


def main() -> None:
    user = users.authenticate(EMAIL, PASSWORD)
    if user:
        print(f"Account already exists: {EMAIL} (id={user['id']})")
    else:
        user = users.create(NAME, EMAIL, PASSWORD)
        print(f"Created account: {EMAIL} (id={user['id']})")

    uid = user["id"]
    with portfolio._Tx() as conn:
        current = portfolio._balance(conn, uid)
        target = FUND_PAISE
        if current >= target:
            print(f"Wallet already funded: Rs {current / 100:,.2f}")
            return
        portfolio._move(conn, uid, "demo_credit", target - current, "test funding")
        bal = portfolio._balance(conn, uid)
    print(f"Funded wallet to Rs {bal / 100:,.2f}  (~${USD_AMOUNT:,} at Rs {USD_INR}/$)")


if __name__ == "__main__":
    main()
