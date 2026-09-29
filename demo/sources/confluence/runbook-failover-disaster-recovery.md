# Runbook: Matching Engine Failover & Disaster Recovery Protocol

## 1. Trigger Conditions
- Matching engine primary heartbeat loss for > 3 consecutive intervals (1,500ms).
- Unhandled panic or NVMe write failure detected on primary order book worker node.
- Network split-brain detection between primary and standby Kubernetes availability zones.

## 2. Emergency Failover Procedure (RTO < 30 seconds, RPO = 0)
1. **Quarantine Primary Node**:
   - Issue automated network isolation command: `kubectl cordon <node-id>` and terminate the crashed matching pod.
2. **Promote Standby Matching Instance**:
   - Activate the warm-standby matching core in secondary availability zone.
   - Replay latest snapshot from `/mnt/nvme-journal/snapshots/latest.snap`.
   - Sequential replay of uncommitted WAL records from shared NVMe sync stream.
3. **Kafka Partition Offset Verification**:
   - Verify `trades.matched` offset alignment against the replayed matching state.
4. **Unpause Ingress Gateways**:
   - Signal `market-data-gateway` to resume accepting incoming order packets.
   - Broadcast order state resync notice to all connected WebSocket clients.

## 3. Post-Failover Validation Checklist
- [ ] Verify matching latency P99 is under 50µs.
- [ ] Confirm `trade-settlement-system` consumer lag on Kafka is 0 messages.
- [ ] Validate double-entry ledger balance integrity via automated reconciliation query.
- [ ] File Incident Post-Mortem in Jira with timestamped latency metrics.
