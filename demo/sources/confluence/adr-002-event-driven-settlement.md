# ADR-002: Event-Driven Double-Entry Trade Settlement via Kafka

## Status
Accepted

## Context
Executing trade settlements synchronously within the matching engine creates tight coupling and compromises matching throughput. Furthermore, regulatory compliance requires an immutable double-entry ledger ensuring zero-sum balance invariants between counterparty clearing accounts.

## Decision
1. **Asynchronous Event Decoupling**: The matching engine emits a `TradeMatchedEvent` to Apache Kafka topic `trades.matched` (partitioned by `instrument_id` across 12 partitions).
2. **Spring Boot Settlement Consumer**: A consumer group in `trade-settlement-system` reads execution events, checks idempotency via unique `trade_id`, and executes double-entry postings.
3. **Strict Double-Entry Invariant**: Every execution records two matching ledger lines:
   - Debit buyer clearing balance / Credit buyer asset position.
   - Credit seller clearing balance / Debit seller asset position.
   - Verification: `SUM(debits) == SUM(credits)` enforced via database check constraints.
4. **Dead Letter Queue (DLQ)**: Any message failing schema validation or balance verification is diverted to `trades.settlement.dlq` for manual compliance remediation.

## Consequences
- **Positive**: Complete isolation between ultra-low-latency matching and transactional ledger persistence.
- **Positive**: Tamper-evident accounting audit trail compliant with SOC2 Type II.
- **Trade-off**: Requires eventual consistency management between order matching and settlement confirmation (P99 settlement delay < 25ms).
