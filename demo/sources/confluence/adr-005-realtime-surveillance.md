# ADR-005: Real-Time Anomaly & Market Abuse Surveillance Architecture

## Status
Accepted

## Context
Under SEC Rule 15c3-5 and MiFID II Regulatory Technical Standards (RTS 6 & RTS 25), trading venues must implement automated algorithmic surveillance to detect manipulative behavior such as spoofing, layering, quote stuffing, and wash trading in real time.

## Decision
1. **FastAPI & Async Streaming Engine**: The `compliance-surveillance-monitor` subscribes to the Kafka `trades.matched` topic and internal order intent feeds via dedicated high-priority consumer partitions.
2. **Sliding-Window Behavioral Algorithms**:
   - **Spoofing / Layering**: Evaluates the ratio of order cancellations to total order submissions within rolling 30-second intervals (`Cancel-to-Fill Ratio > 0.85` triggers a Level 1 alert).
   - **Wash Sale Detection**: Analyzes bipartite graphs of buyer/seller account IDs sharing identical beneficial ownership tax identifiers within 60-second execution windows.
3. **Automated Trading Throttle (Kill Switch)**: If an API Key exceeds critical risk score thresholds, the surveillance engine automatically emits a suspension event to `mini-auth-service`, immediately revoking active session tokens.

## Consequences
- **Positive**: Zero-touch automated compliance auditing meeting regulatory examination requirements.
- **Positive**: Sub-5ms detection latency from trade execution to alert generation.
- **Trade-off**: Requires ongoing heuristic threshold calibration to minimize false positives during high-volatility market opens.
