# ADR-006: Distributed API Key Authentication & HMAC Signatures

## Status
Accepted

## Context
Institutional trading systems cannot rely on session cookies or standard OAuth2 redirects due to latency and automated programmatic access requirements. Inbound trading API requests must be cryptographically verified with minimal CPU overhead while preventing replay attacks.

## Decision
1. **HMAC-SHA256 Signature Verification**: Every private REST/WebSocket request must include:
   - `X-Apex-ApiKey`: Public key identifier.
   - `X-Apex-Timestamp`: Unix epoch millisecond timestamp.
   - `X-Apex-Signature`: `HEX(HMAC-SHA256(SecretKey, HTTP_METHOD + PATH + TIMESTAMP + BODY))`.
2. **Replay Protection**: The auth middleware rejects requests where `|CurrentTime - X-Apex-Timestamp| > 5000ms`.
3. **In-Memory Distributed Rate Limiter**: Implemented in `mini-auth-service` using Redis sliding window log algorithm:
   - **Tier 1 (Standard)**: 5,000 requests/minute.
   - **Tier 2 (VIP Institutional)**: 50,000 requests/minute.
   - **Tier 3 (Market Maker Direct)**: 200,000 requests/minute with dedicated ingress ports.

## Consequences
- **Positive**: Sub-50µs cryptographic validation per request.
- **Positive**: Complete defense against man-in-the-middle tampering and replay exploits.
- **Trade-off**: Requires strict client clock synchronization via NTP servers.
