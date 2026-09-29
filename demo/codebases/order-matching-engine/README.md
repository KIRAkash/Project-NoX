# Order Matching Engine (OME)

**Parent Org:** Global Financial Markets Group (GFMG)
**Sub-Org:** Nexus Trading Exchange (NTE)
**GitHub Org:** Apex

The Order Matching Engine is the core critical system responsible for maintaining limit order books and executing trades for the Nexus Trading Exchange. It receives inbound FIX/REST orders, processes them in microseconds, and publishes resulting trades and snapshots to downstream consumers.

## Architecture & Sister Systems

This repository interacts heavily with sister systems within the Apex organization:
*   `market-data-gateway`: Consumes `nte.orderbook.snapshots` to broadcast L2/L3 market data.
*   `trade-settlement-system`: Consumes `nte.trades.matched` for post-trade clearing and settlement.
*   `compliance-surveillance-monitor`: Consumes `nte.trades.matched` and `nte.orders.rejected` for wash-trade and spoofing detection.

See `docs/architecture.md` for a deep dive.

## Getting Started

```bash
make build
make run-dev
```

## Kafka Topics
*   **Producer:** `nte.trades.matched`
*   **Producer:** `nte.orderbook.snapshots`
*   **Consumer:** `nte.orders.inbound`
