# Architecture: Market Data Gateway

## Sub-System Context
The Market Data Gateway (MDG) bridges the internal trading core with the external world. It ensures market data fairness by guaranteeing that all subscribed clients receive data simultaneously.

## Data Flow
1. **Order Matching Engine** publishes to Kafka topics `nte.trades.matched` and `nte.orderbook.snapshots`.
2. **MDG Consumers** (`OrderBookConsumer`, `TradeConsumer`) ingest these topics in real-time.
3. **Internal Cache** (Redis) maintains the latest L2 order book state for fast recovery and new client snapshots.
4. **WebSocket ClientManager** broadcasts delta updates and trade ticks to subscribed clients.

## Integrations
- GitHub Org: Apex
- Sister Repos: 
  - `apex/order-matching-engine`
  - `apex/compliance-surveillance-monitor`
  - `apex/trade-settlement-system`
