# Jira Project Export: APEX (Apex Trading Platform)

## 📌 APEX-101 (Epic): Real-Time Trade Settlement Ledger Overhaul
- **Type**: Epic
- **Status**: In Progress
- **Priority**: High
- **Assignee**: Sarah Jenkins
- **Description**: Migrate settlement ledger from single PostgreSQL transactions to an event-sourced audit log using Kafka `trades.matched` with double-entry validation.
- **Acceptance Criteria**:
  1. Ledger must guarantee debit-credit equality for all trades.
  2. P99 settlement confirmation under 100ms.
  3. Automatic reconciliation worker detecting discrepancies every 60 seconds.

---

## 📌 APEX-102 (Story): Implement Idempotency Middleware for Order Ingestion
- **Type**: Story
- **Status**: Completed (Done)
- **Priority**: Critical
- **Assignee**: Alex Rivera
- **Description**: Intercept incoming order requests, hash client headers (`X-Idempotency-Key`), and store execution tokens in Redis with a 60-minute TTL.

---

## 📌 APEX-103 (Task): Configure TimescaleDB Range Partitioning
- **Type**: Task
- **Status**: Open (To Do)
- **Priority**: Medium
- **Assignee**: Marcus Vance
- **Description**: Setup automated monthly partition creation for `trade_records` hyper-table.
