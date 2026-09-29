# ADR-001: In-Memory B-Tree Orderbook with Write-Ahead Journaling

## Status
Accepted

## Context
High-frequency order processing requires order matching latency strictly under 50 microseconds at 250,000 orders/sec. Standard relational database writes per tick introduce disk I/O bottlenecks exceeding 4 milliseconds, which is unacceptable for institutional market makers.

## Decision
1. **In-Memory B-Tree Indexing**: Maintain all active limit orders in memory using a concurrent B-Tree structure segregated by `Bids` (descending price index) and `Asks` (ascending price index). Each price level contains a doubly-linked list of order nodes enforcing deterministic FIFO time priority.
2. **Lock-Free Ring Buffer (Disruptor Pattern)**: Inbound order requests from the API gateway are ingested into a pre-allocated 65,536-slot ring buffer, eliminating Go runtime garbage collector pause overhead.
3. **Write-Ahead Logging (WAL)**: All state-mutating events are sequentially flushed to an append-only binary journal on local NVMe storage using `O_DIRECT` before memory modification.
4. **Periodic Memory Snapshots**: A dedicated worker thread serializes full order book states every 10,000 executed matches to enable sub-second cold restart recovery.

## Consequences
- **Positive**: Sub-35µs P99 matching latency at sustained peak load (300k ops/sec).
- **Positive**: Zero garbage collection pauses in the critical matching path.
- **Trade-off**: Requires dedicated RAM allocation (32 GB reserved per matching core instance).
- **Trade-off**: Crash recovery requires sequential playback of WAL entries since the latest snapshot.
