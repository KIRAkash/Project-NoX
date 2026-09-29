# ADR-004: Market Data Gateway Streaming with Protocol Buffers and WebSockets

## Status
Accepted

## Context
Market makers and institutional trading bots require real-time Level 2 (top 50 price levels) and Level 3 (individual order granularity) market depth streams. JSON serialization over standard WebSockets resulted in excessive bandwidth overhead (1.4 GB/hr per client) and high deserialization CPU usage in client runtime environments.

## Decision
1. **Binary Protobuf Framing**: Adopt Protocol Buffers v3 (`market_feed.proto`) as the universal message format across gRPC and WebSocket stream channels.
2. **Snapshot + Incremental Delta Architecture**:
   - Initial subscription receives a full L2/L3 order book snapshot.
   - Subsequent broadcasts deliver incremental deltas (`PriceLevelUpdated`, `OrderInserted`, `OrderDeleted`) with monotonically increasing sequence numbers.
3. **Sequence Gap Detection**: Clients detect missed packets via sequence number gaps and automatically trigger an out-of-band snapshot resync via gRPC unary endpoint.
4. **Redis Pub/Sub Fanout**: Use Redis Cluster Pub/Sub as an internal broadcast backplane connecting matching engine workers to edge WebSocket gateway instances.

## Consequences
- **Positive**: 65% reduction in outbound network bandwidth and 4x increase in client deserialization throughput.
- **Positive**: Sub-300µs broadcast latency from match execution to client socket buffer.
- **Trade-off**: Clients must compile Protobuf stubs into their trading algorithms.
