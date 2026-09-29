# Model Lineage

## Wash Trade Detector
- **Type**: Graph Traversal & Cycle Detection
- **Features**: 
  - `buyer_id`, `seller_id`, `instrument`, `price`, `quantity`
- **Source Topic**: `nte.trades.matched`
- **Description**: Uses network analysis to identify circular trading patterns among colluding entities within a configurable time window.

## Spoofing Detector
- **Type**: LSTM Autoencoder
- **Features**:
  - `bid_volume_L1_to_L5`, `ask_volume_L1_to_L5`, `cancel_rate`
- **Source Topic**: `nte.orderbook.snapshots`
- **Description**: Detects sudden non-bona-fide liquidity injections followed by rapid cancellations before execution.
