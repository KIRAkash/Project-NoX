package main

import (
	"os"
	"os/signal"
	"syscall"
	"time"
	"math/rand"

	"github.com/Apex/order-matching-engine/internal/events"
	"github.com/Apex/order-matching-engine/internal/matching"
	"github.com/Apex/order-matching-engine/models"
	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
)

func main() {
	log := logrus.New()
	log.SetFormatter(&logrus.JSONFormatter{})
	log.Info("Starting Nexus Trading Exchange (NTE) Order Matching Engine...")
	log.Info("Organization: Global Financial Markets Group (GFMG)")

	// In a real app, read from config/exchange.yaml
	kafkaBroker := "kafka-cluster.nte.gfmg.internal:9092"
	tradeTopic := "nte.trades.matched"
	snapshotTopic := "nte.orderbook.snapshots"

	publisher, err := events.NewKafkaPublisher(kafkaBroker, tradeTopic, snapshotTopic, log)
	if err != nil {
		log.Warnf("Failed to connect to Kafka (running in fallback mode): %v", err)
	}

	engine := matching.NewEngine(log)

	// Process incoming inbound orders from market-data-gateway
	go processTraffic(engine, publisher, log)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Info("Shutting down Order Matching Engine gracefully...")
}

func processTraffic(engine *matching.Engine, publisher *events.KafkaPublisher, log *logrus.Logger) {
	ticker := time.NewTicker(500 * time.Millisecond)
	for range ticker.C {
		isIceberg := rand.Float32() < 0.2 // 20% chance of being an iceberg order

		order := models.Order{
			ID:        uuid.New().String(),
			Symbol:    "BTC/USD",
			TraderID:  "TRADER_ABC",
			Side:      models.SideBuy,
			Type:      models.OrderTypeLimit,
			Price:     65432.10,
			Quantity:  1.5,
			Timestamp: time.Now(),
		}

		if isIceberg {
			order.IsIceberg = true
			order.Quantity = 50.0 // Much larger quantity for iceberg orders
			order.DisplayQuantity = 5.0
		}

		log.Debugf("Received inbound order: %+v", order)

		trades, err := engine.ProcessOrder(order)
		if err != nil {
			log.Errorf("Error processing order: %v", err)
			continue
		}

		if len(trades) > 0 && publisher != nil {
			publisher.PublishTrades(trades)
			// Also publish snapshot for market-data-gateway
			publisher.PublishSnapshot(order.Symbol, map[string]interface{}{"bids": 10, "asks": 5})
		}
	}
}
