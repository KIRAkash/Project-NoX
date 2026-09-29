# Architecture: Trade Settlement System

## System Context
The TSS is a critical Tier-1 application within GFMG's infrastructure. It provides strict transactional guarantees for post-trade clearing.

## Data Flow
1. **Trade Matched Event**: The `TradeMatchedListener` consumes an event from the Kafka topic `nte.trades.matched` published by the `order-matching-engine`.
2. **Ledger Update**: The `LedgerService` debits/credits the respective counterparty accounts within a database transaction.
3. **Bank Transfer**: The `BankTransferService` communicates with external banking APIs to initiate fiat currency movement.
4. **Compliance Notification**: Upon success or failure, a settlement status message is published to `scfs.settlement.status`. The `compliance-surveillance-monitor` consumes this for reporting.

## Resiliency
- **Idempotency**: All Kafka consumers use the `tradeId` to guarantee idempotent processing.
- **Dead Letter Queue (DLQ)**: Unprocessable trades are routed to `nte.trades.matched.dlq`.

## Integration Points (Apex Org)
- Kafka: `kafka.internal.gfmg.com:9092`
- Database: PostgreSQL 14 (Primary/Replica)
- External: SWIFT Network Gateway Integration
