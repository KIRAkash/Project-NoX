# Security, Compliance & Regulatory Architecture Matrix

## 1. Regulatory Standards Alignment
Apex operates under institutional compliance frameworks with continuous monitoring and automated controls.

| Standard | Scope | Enforcing Service | Enforcement Mechanism |
|---|---|---|---|
| **SEC Rule 15c3-5** | Market Access Risk Controls | `compliance-surveillance-monitor` | Pre-trade capital thresholds, credit limit checks, price collar boundaries. |
| **MiFID II RTS 6 & 25** | Algorithmic Trading & Time Sync | `order-matching-engine` | Microsecond clock synchronization via PTP/NTP, comprehensive order record keeping. |
| **SOC2 Type II** | Security, Confidentiality, Integrity | `mini-auth-service` / Infrastructure | AES-256 encryption at rest, TLS 1.3 in transit, role-based access control (RBAC). |
| **FinCEN / AML** | Anti-Money Laundering & Sanctions | `trade-settlement-system` | Real-time wallet address screening, velocity limits, suspicious activity reporting (SAR). |

## 2. Threat Vector Mitigations
- **Replay Attack Defense**: `mini-auth-service` validates 5,000ms timestamp tolerance window and deduplicates request hashes in Redis.
- **Distributed Denial of Service (DDoS)**: Cloudflare Magic Transit + BGP Anycast routing with hardware rate limiters at edge ingress.
- **Insider Threat & Tampering**: Immutable WORM (Write Once, Read Many) audit tables with cryptographic hash chains.
