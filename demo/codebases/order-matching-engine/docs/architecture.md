# Architecture - Order Matching Engine

## High-Level Overview

The Order Matching Engine (OME) is built for ultra-low latency. It implements a price-time priority matching algorithm. 
The core is purely memory-driven, utilizing lock-free data structures where possible or fine-grained sharding per symbol.

### Components

1.  **Ingress Layer:** Reads from `nte.orders.inbound` Kafka topic. Validates order parameters.
2.  **Matching Core:** Maintains the Limit Order Book (LOB). Applies Price/Time priority.
3.  **Egress Layer:** Asynchronously publishes events to `nte.trades.matched` and `nte.orderbook.snapshots`.

### Integration with GFMG ecosystem

*   **Trade Settlement System (TSS):** Needs real-time trade execution reports. We publish a standardized `TradeExecutedEvent` schema over Kafka.
*   **Market Data Gateway (MDG):** Needs L2 book depths. We publish a snapshot every 10ms if the book mutated.
*   **Compliance:** Listens to everything to run heuristic checks.

### Failure Modes & Recovery

In case of a crash, the OME rebuilds state by replaying Kafka offsets from the start of the current trading day. End-of-Day (EOD) snapshots are stored in S3/GCS.
