# Channel Export: #apex-architecture-discussion

### 💬 Thread: Migration from REST to gRPC for High-Throughput Ingestion
**@lead_architect** (2026-08-25 10:15:00 UTC):
> Team, we've observed high JSON serialization overhead on the `market-data-gateway` during peak market volatility (30k req/sec). We are proposing moving internal communication between `market-data-gateway` and `order-matching-engine` from HTTP/JSON to gRPC with Protocol Buffers v3.

**@core_dev_sarah** (2026-08-25 10:18:22 UTC):
> 💯 Agreed. We benchmarked protobuf serialization and saw a 65% reduction in CPU time and 4x higher throughput. The `.proto` schemas will live in `proto/order_service.proto`.

**@sec_eng_marcus** (2026-08-25 10:22:10 UTC):
> Make sure mTLS is enforced for all gRPC connections between pods in the Kubernetes cluster. I will update the service mesh cert-manager configuration.

---

### 💬 Message: Kafka Topic Expansion & Partitioning
**@lead_architect** (2026-08-26 14:00:00 UTC):
> Notice: We are expanding the Kafka partition count for `trades.matched` from 6 to 12 to handle increased volume on the crypto pairs. Consumers must ensure partition-key ordering is maintained using `instrument_id`.
