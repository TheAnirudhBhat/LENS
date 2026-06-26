# initial_stage/

Drop your two Groww `.xlsx` exports here (or upload them via the dashboard's
**Update Portfolio** button, which saves them here for you):

- a **Stocks** holdings statement (`Stocks_Holdings_Statement_*.xlsx`)
- a **Mutual Funds** holdings statement (`Holdings_Statement_*.xlsx`)

`convert_groww.py` reads the most recent of each and builds `portfolio.json`.
The `.xlsx` files themselves are gitignored (they're your personal data).
