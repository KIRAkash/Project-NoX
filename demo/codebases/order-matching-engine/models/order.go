package models

import "time"

type Side string
type OrderType string

const (
	SideBuy  Side = "BUY"
	SideSell Side = "SELL"

	OrderTypeLimit  OrderType = "LIMIT"
	OrderTypeMarket OrderType = "MARKET"
)

// Order represents an inbound request from the market-data-gateway/broker.
type Order struct {
	ID              string    `json:"id"`
	Symbol          string    `json:"symbol"`
	TraderID        string    `json:"trader_id"`
	Side            Side      `json:"side"`
	Type            OrderType `json:"type"`
	Price           float64   `json:"price,omitempty"`
	Quantity        float64   `json:"quantity"`
	IsIceberg       bool      `json:"is_iceberg"`                 // Indicates if this is an Iceberg order
	DisplayQuantity float64   `json:"display_quantity,omitempty"` // For Iceberg orders, the visible portion shown to market
	HiddenQuantity  float64   `json:"hidden_quantity,omitempty"`  // For Iceberg orders, the remaining hidden portion
	Timestamp       time.Time `json:"timestamp"`
}
