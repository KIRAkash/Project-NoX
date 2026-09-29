# Compliance Surveillance Monitor

**Org:** Global Financial Markets Group (GFMG)  
**Sub-Org:** SecureClear Financial Services (SCFS)  
**GitHub Org:** Apex

## Overview
The `compliance-surveillance-monitor` is the Regulatory Surveillance Platform for the GFMG financial exchange. It runs complex ML models and rulesets to detect fraudulent activities, wash trading, spoofing, and other market manipulations in real-time.

It integrates deeply with sister repositories:
- `order-matching-engine`
- `market-data-gateway`
- `trade-settlement-system`

## Kafka Topics Consumed
- `nte.trades.matched`: Consumed from the matching engine.
- `nte.orderbook.snapshots`: Consumed from the matching engine.
- `scfs.settlement.status`: Consumed from the settlement system.

## Setup
```bash
pip install -r requirements.txt
python src/main.py
```
