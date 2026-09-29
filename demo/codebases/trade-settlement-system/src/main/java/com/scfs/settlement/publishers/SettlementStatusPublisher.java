package com.scfs.settlement.publishers;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
public class SettlementStatusPublisher {

    private static final Logger log = LoggerFactory.getLogger(SettlementStatusPublisher.class);

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    @Value("${gfmg.scfs.topics.outbound.settlement-status}")
    private String statusTopic;

    /**
     * Publishes to scfs.settlement.status for compliance-surveillance-monitor
     */
    public void publishStatus(String tradeId, String status) {
        String message = String.format("{\"tradeId\":\"%s\", \"status\":\"%s\", \"timestamp\":%d}", 
                                       tradeId, status, System.currentTimeMillis());
        log.info("Publishing settlement status to topic {}: {}", statusTopic, message);
        kafkaTemplate.send(statusTopic, tradeId, message);
    }
}
