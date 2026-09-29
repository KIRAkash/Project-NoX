# ADR-003: High-Throughput TimescaleDB Range Partitioning & Compression

## Status
Accepted

## Context
Apex processes upwards of 50 million trade executions per day. Ingesting this volume into standard monolithic PostgreSQL tables degrades B-Tree index performance once table sizes exceed RAM capacity, causing write degradation from 80k writes/sec down to 4k writes/sec.

## Decision
1. **TimescaleDB Hypertables**: Convert `trade_records` and `market_ticks` into partitioned hypertables partitioned on `executed_at` with 1-day chunk intervals.
2. **Automated Columnar Compression**: Chunks older than 7 days are automatically compressed using TimescaleDB columnar compression, achieving an estimated 85% to 90% disk reduction.
3. **Continuous Aggregates**: Materialized rollups for 1-second, 1-minute, and 5-minute OHLCV candlestick bars are computed incrementally upon chunk writes.
4. **Data Retention Policy**: Raw trade execution chunks older than 90 days are archived to AWS S3 Glacier in Parquet format, maintaining 7-year regulatory retention compliance.

## Consequences
- **Positive**: Consistent 100,000+ writes/sec ingestion rate without index bloat degradation.
- **Positive**: 88% reduction in storage costs for historical analytics datasets.
- **Trade-off**: Updates to compressed chunks require manual decompression or append-only reconciliation adjustments.
