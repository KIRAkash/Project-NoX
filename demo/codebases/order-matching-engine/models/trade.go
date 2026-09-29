package models

import "time"

// TradeExecution represents a matched trade.
// Used heavily by trade-settlement-system and compliance-surveillance-monitor.
type TradeExecution struct {
	TradeID      string    `json:"trade_id"`
	Symbol       string    `json:"symbol"`
	Price        float64   `json:"price"`
	Quantity     float64   `json:"quantity"`
	BuyerID      string    `json:"buyer_id"`
	SellerID     string    `json:"seller_id"`
	BuyOrderID   string    `json:"buy_order_id"`
	SellOrderID  string    `json:"sell_order_id"`
	ExecutedAt   time.Time `json:"executed_at"`
	ExchangeID   string    `json:"exchange_id"`
	MatchPhase   string    `json:"match_phase"` // e.g., "CONTINUOUS", "AUCTION"
}
