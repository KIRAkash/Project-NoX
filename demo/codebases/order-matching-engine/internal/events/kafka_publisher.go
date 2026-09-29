package events

import (
	"encoding/json"

	"github.com/Apex/order-matching-engine/models"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/sirupsen/logrus"
)

type KafkaPublisher struct {
	producer      *kafka.Producer
	tradeTopic    string
	snapshotTopic string
	log           *logrus.Logger
}

func NewKafkaPublisher(brokers, tradeTopic, snapshotTopic string, log *logrus.Logger) (*KafkaPublisher, error) {
	p, err := kafka.NewProducer(&kafka.ConfigMap{
		"bootstrap.servers": brokers,
		"acks":              "all",
		"linger.ms":         1, // Optimize for low latency, slight batching
	})
	if err != nil {
		return nil, err
	}
	return &KafkaPublisher{
		producer:      p,
		tradeTopic:    tradeTopic,
		snapshotTopic: snapshotTopic,
		log:           log,
	}, nil
}

// PublishTrades sends matched trades to 'nte.trades.matched'
// Consumed by: trade-settlement-system, compliance-surveillance-monitor
func (kp *KafkaPublisher) PublishTrades(trades []models.TradeExecution) {
	for _, t := range trades {
		payload, err := json.Marshal(t)
		if err != nil {
			kp.log.Errorf("Failed to marshal trade: %v", err)
			continue
		}

		kp.producer.Produce(&kafka.Message{
			TopicPartition: kafka.TopicPartition{Topic: &kp.tradeTopic, Partition: kafka.PartitionAny},
			Value:          payload,
		}, nil)
	}
}

// PublishSnapshot sends L2 book snapshots to 'nte.orderbook.snapshots'
// Consumed by: market-data-gateway
func (kp *KafkaPublisher) PublishSnapshot(symbol string, snapshot interface{}) {
	payload, _ := json.Marshal(snapshot) // Omit error handling for brevity
	kp.producer.Produce(&kafka.Message{
		TopicPartition: kafka.TopicPartition{Topic: &kp.snapshotTopic, Partition: kafka.PartitionAny},
		Value:          payload,
		Key:            []byte(symbol), // Partition by symbol
	}, nil)
}
