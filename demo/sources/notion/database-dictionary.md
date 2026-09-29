# Enterprise Data Dictionary & Storage Topology

## Database Architecture Overview
Apex utilizes a polyglot persistence architecture optimized for write throughput, query performance, and regulatory retention.

| Entity | Primary Key | Key Attributes | Storage Backend | Partitioning Strategy | Retention |
|---|---|---|---|---|---|
| `Account` | `id (UUID)` | `org_id`, `tier`, `balance_usd`, `margin_rate`, `status` | PostgreSQL 16 | Primary Key B-Tree Index | Permanent |
| `ApiKey` | `key_id (VARCHAR)` | `account_id`, `hashed_secret`, `rate_tier`, `permissions` | Redis / PostgreSQL | In-Memory Hash + Read Replica | Permanent |
| `Order` | `order_id (UUID)` | `account_id`, `symbol`, `side`, `price`, `qty`, `order_type`, `status` | Redis / PostgreSQL | Active: In-Memory / Historical: Monthly Partition | 7 Years |
| `TradeExecution` | `trade_id (UUID)` | `match_id`, `buy_order_id`, `sell_order_id`, `price`, `qty`, `fee_usd`, `executed_at` | TimescaleDB | 1-Day Chunks on `executed_at` | 7 Years (Compressed after 7d) |
| `LedgerEntry` | `entry_id (BIGSERIAL)` | `trade_id`, `account_id`, `debit_amount`, `credit_amount`, `currency`, `hash` | PostgreSQL (WORM) | Append-only with sequence hashes | 10 Years |
| `SurveillanceAlert` | `alert_id (UUID)` | `account_id`, `alert_type`, `risk_score`, `raw_payload`, `status`, `created_at` | MongoDB / PostgreSQL | Monthly Date Partition | 7 Years |
| `MarketTick` | `tick_id (BIGSERIAL)` | `symbol`, `best_bid`, `best_ask`, `bid_qty`, `ask_qty`, `timestamp` | TimescaleDB | 1-Day Chunks with Continuous Aggregates | 90 Days Raw / 7 Years OHLCV |
