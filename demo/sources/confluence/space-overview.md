# Space Overview: Apex Trading & Settlement Platform (APEX)

## System Architecture Summary
Apex Institutional Platform is a mission-critical distributed financial trading system designed to process over 250,000 orders per second with sub-millisecond end-to-end latency. The platform is partitioned into 5 decoupled core microservices:

1. **Order Matching Engine (`order-matching-engine`)** (Go):
   - In-memory deterministic matching core utilizing B-Trees for price-level indexing and doubly-linked lists for FIFO time priority.
   - Lock-free ring buffer (Disruptor pattern) for zero-allocation order ingestion.
   - Write-Ahead Log (WAL) with snapshot journaling for crash recovery.

2. **Trade Settlement System (`trade-settlement-system`)** (Java / Spring Boot):
   - Event-driven double-entry bookkeeping ledger guaranteeing exact debit/credit balance integrity.
   - High-throughput Kafka consumer group processing `trades.matched` with out-of-order deduplication.
   - TimescaleDB time-series storage with automated monthly range partitioning and columnar compression.

3. **Market Data Gateway (`market-data-gateway`)** (TypeScript / Node.js):
   - Ultra-low latency WebSocket and gRPC broadcaster for Level 2 (top 50 levels) and Level 3 (full market depth) feeds.
   - Protocol Buffers v3 binary framing reducing payload size by 65%.
   - Redis cluster for real-time market depth caching and delta diffing.

4. **Compliance & Surveillance Monitor (`compliance-surveillance-monitor`)** (Python / FastAPI):
   - Real-time stream analytics for spoofing, layering, and wash trading detection.
   - Rule-based pre-trade risk controls (SEC Rule 15c3-5, MiFID II compliance).
   - Automated anomaly flagging with sub-5ms alerting to risk officers.

5. **Mini Auth Service (`mini-auth-service`)** (Go / Python):
   - High-performance HMAC-SHA256 request signature verification and JWT token claims validation.
   - Distributed token-bucket rate limiter backed by Redis sliding windows.

---

## Data Flow Pipeline
```
[Trader Terminal / API]
         │  (HTTPS / HMAC-SHA256)
         ▼
 ┌───────────────┐
 │ Auth Gateway  │── (Rate Limit / Signature Check)
 └───────┬───────┘
         ▼
 ┌─────────────────────┐
 │ Order Matching Core │── (Lock-Free Ingestion Ring Buffer)
 └───────┬─────────────┘
         │  (Dispatched Match Event)
         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Apache Kafka Cluster: Topic `trades.matched` (12 Partitions)│
 └───────┬───────────────────────────────┬─────────────────────┘
         │                               │
         ▼                               ▼
 ┌──────────────────────────┐    ┌──────────────────────────────┐
 │ Trade Settlement System  │    │ Compliance & Surveillance    │
 │ (Double-Entry Ledger)    │    │ (Spoofing & Wash Sale Engine)│
 └──────────────────────────┘    └──────────────────────────────┘
```

---

## Service SLA & Performance Targets
| Service | Primary Metric | Target SLA | Measured P99 |
|---|---|---|---|
| `order-matching-engine` | Match Loop Latency | < 50 µs | 32 µs |
| `market-data-gateway` | WebSocket Ticker Dispatch | < 500 µs | 280 µs |
| `trade-settlement-system` | Settlement Confirmation | < 50 ms | 18 ms |
| `compliance-surveillance` | Anomaly Detection Window | < 10 ms | 4.2 ms |
| `mini-auth-service` | Auth Verification Overhead | < 100 µs | 45 µs |
