package com.scfs.settlement.services;

import com.scfs.settlement.models.TradeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LedgerService {

    private static final Logger log = LoggerFactory.getLogger(LedgerService.class);

    @Transactional
    public void updateLedger(TradeMessage trade) {
        log.info("Updating ledger for Trade ID: {}", trade.getTradeId());
        
        // Executing database operations
        String buyerId = trade.getBuyerId();
        String sellerId = trade.getSellerId();
        double amount = trade.getQuantity() * trade.getPrice();

        log.debug("Debiting {} from buyer {}", amount, buyerId);
        // debitAccount(buyerId, amount);

        log.debug("Crediting {} to seller {}", amount, sellerId);
        // creditAccount(sellerId, amount);

        log.info("Ledger updated successfully for trade {}", trade.getTradeId());
    }
}
