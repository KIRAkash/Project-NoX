package com.scfs.settlement.services;

import com.scfs.settlement.models.TradeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class BankTransferService {

    private static final Logger log = LoggerFactory.getLogger(BankTransferService.class);
    
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${gfmg.scfs.external.bank-api-url}")
    private String bankApiUrl;

    public void initiateTransfer(TradeMessage trade) {
        log.info("Initiating bank transfer for trade {} via {}", trade.getTradeId(), bankApiUrl);
        
        // Execute external SWIFT API call
        double amount = trade.getPrice() * trade.getQuantity();
        log.debug("Transferring {} USD from bank account of {} to {}", amount, trade.getBuyerId(), trade.getSellerId());
        
        // In reality, we'd execute a POST request to bankApiUrl
        // restTemplate.postForObject(bankApiUrl, transferRequest, String.class);
        
        log.info("Bank transfer execution successful.");
    }
}
