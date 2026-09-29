# Architecture: Regulatory Surveillance Platform

## System Context
The Compliance Surveillance Monitor operates as a stream processing topology that consumes normalized market data and matched trades to identify anomalous behaviors. 

## Upstream Dependencies
1. **Order Matching Engine (`order-matching-engine`)**: Emits `nte.trades.matched` and `nte.orderbook.snapshots`.
2. **Market Data Gateway (`market-data-gateway`)**: Provides reference data and pricing ticks.
3. **Trade Settlement System (`trade-settlement-system`)**: Emits `scfs.settlement.status` for post-trade tracking.

## Core Components
- **Kafka Streams Consumer**: Subscribes to GFMG Kafka clusters. Uses PySpark Structured Streaming for high-throughput ingestion.
- **Rules Engine**: Applies static heuristics (e.g., AML rules from `aml_config.json`).
- **ML Detection Models**:
  - `WashTradeDetector`: Graph-based self-matching detection.
  - `SpoofingDetector`: Time-series anomaly detection on orderbook imbalances.

## Data Persistence
Alerts are published to `gfmg.compliance.alerts` and written to BigQuery `gfmg_surveillance.alerts_log` for regulatory reporting.
