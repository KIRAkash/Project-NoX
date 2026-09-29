# Trade Settlement System (TSS)

## Overview
Part of the Global Financial Markets Group (GFMG) - SecureClear Financial Services (SCFS) division.
The Trade Settlement System is responsible for the post-trade lifecycle, including clearing, ledger updates, and bank transfers.

## Architecture Context
This service integrates closely with sister repositories within the `Apex` Github organization:
- `order-matching-engine`: Upstream system. We consume `nte.trades.matched` to initiate settlement.
- `market-data-gateway`: Provides reference data for pricing and forex conversions during settlement.
- `compliance-surveillance-monitor`: Downstream system. We publish to `scfs.settlement.status` for regulatory and AML monitoring.

## Setup
Requires Java 17+ and Maven. Kafka must be running locally for development.
```bash
mvn clean install
mvn spring-boot:run
```

## Contact
Maintainer: SCFS Core Settlement Team (scfs-core-settlement@gfmg.internal)
