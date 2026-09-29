package com.scfs.settlement.listeners;

import com.scfs.settlement.models.TradeMessage;
import com.scfs.settlement.services.LedgerService;
import com.scfs.settlement.services.BankTransferService;
import com.scfs.settlement.publishers.SettlementStatusPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class TradeMatchedListener {
    
    private static final Logger log = LoggerFactory.getLogger(TradeMatchedListener.class);

    @Autowired
    private LedgerService ledgerService;

    @Autowired
    private BankTransferService bankTransferService;

    @Autowired
    private SettlementStatusPublisher statusPublisher;

    /**
     * Consumes nte.trades.matched from order-matching-engine
     */
    @KafkaListener(topics = "${gfmg.scfs.topics.inbound.trade-matched}", groupId = "${spring.kafka.consumer.group-id}")
    public void onTradeMatched(TradeMessage trade) {
        log.info("Received matched trade {} from order-matching-engine", trade.getTradeId());
        
        try {
            // 1. Update internal ledgers
            ledgerService.updateLedger(trade);
            
            // 2. Initiate fiat transfer
            bankTransferService.initiateTransfer(trade);
            
            // 3. Notify compliance
            statusPublisher.publishStatus(trade.getTradeId(), "SETTLED");
            
            log.info("Trade {} settled successfully", trade.getTradeId());
        } catch (Exception e) {
            log.error("Failed to settle trade {}", trade.getTradeId(), e);
            statusPublisher.publishStatus(trade.getTradeId(), "FAILED");
            // In a real scenario, this would throw to trigger a DLQ or retry
        }
    }
}
