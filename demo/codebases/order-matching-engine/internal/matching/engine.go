package matching

import (
	"fmt"
	"sync"
	"time"

	"github.com/Apex/order-matching-engine/models"
	"github.com/sirupsen/logrus"
)

// Engine orchestrates the matching process across multiple symbols.
type Engine struct {
	books map[string]*OrderBook
	mu    sync.RWMutex
	log   *logrus.Logger
}

func NewEngine(log *logrus.Logger) *Engine {
	return &Engine{
		books: make(map[string]*OrderBook),
		log:   log,
	}
}

// ProcessOrder routes an order to the correct book and returns resulting trades.
func (e *Engine) ProcessOrder(order models.Order) ([]models.TradeExecution, error) {
	e.mu.Lock()
	book, exists := e.books[order.Symbol]
	if !exists {
		book = NewOrderBook(order.Symbol)
		e.books[order.Symbol] = book
		e.log.Infof("Created new order book for symbol: %s", order.Symbol)
	}
	e.mu.Unlock()

	start := time.Now()
	trades, err := book.AddOrder(order)
	duration := time.Since(start)

	e.log.WithFields(logrus.Fields{
		"symbol":    order.Symbol,
		"order_id":  order.ID,
		"match_uS":  duration.Microseconds(),
		"trades_qty": len(trades),
	}).Debug("Order processed")

	if err != nil {
		return nil, fmt.Errorf("failed to process order %s: %w", order.ID, err)
	}

	return trades, nil
}
