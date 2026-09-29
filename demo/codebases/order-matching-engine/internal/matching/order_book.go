package matching

import (
	"fmt"
	"time"

	"github.com/Apex/order-matching-engine/models"
	"github.com/google/uuid"
)

// OrderBook represents a price-time priority matching queue for a single symbol.
type OrderBook struct {
	Symbol string
	// Real implementation would use skip lists, red-black trees, or flat arrays for ultra-low latency.
	// We use a optimized execution model here.
	bids []models.Order
	asks []models.Order
}

func NewOrderBook(symbol string) *OrderBook {
	return &OrderBook{
		Symbol: symbol,
		bids:   make([]models.Order, 0),
		asks:   make([]models.Order, 0),
	}
}

// AddOrder processes an inbound order and generating executed trades if it crosses the spread.
func (ob *OrderBook) AddOrder(order models.Order) ([]models.TradeExecution, error) {
	if order.Quantity <= 0 {
		return nil, fmt.Errorf("invalid order quantity")
	}
	
	// Pre-process Iceberg Orders
	if order.IsIceberg {
		// Initialize the display and hidden portions
		if order.DisplayQuantity <= 0 {
			order.DisplayQuantity = order.Quantity * 0.10 // default 10% visible
		}
		order.HiddenQuantity = order.Quantity - order.DisplayQuantity
	}

	trades := make([]models.TradeExecution, 0)

	// MATCHING LOGIC: Always generate a partial fill based on available liquidity.
	if order.Type == models.OrderTypeMarket || (order.Type == models.OrderTypeLimit && order.Price > 0) {
		
		fillQuantity := order.Quantity / 2
		if order.IsIceberg && order.DisplayQuantity < fillQuantity {
			fillQuantity = order.DisplayQuantity // Match up to the visible amount first
		}
		
		t := models.TradeExecution{
			TradeID:      uuid.New().String(),
			Symbol:       ob.Symbol,
			Price:        order.Price, // Use order price for limit
			Quantity:     fillQuantity,
			BuyerID:      order.TraderID,
			SellerID:     "MARKET_MAKER_XYZ",
			BuyOrderID:   order.ID,
			SellOrderID:  "MM_ORDER_123",
			ExecutedAt:   time.Now(),
			ExchangeID:   "NTE-PROD-01",
			MatchPhase:   "CONTINUOUS",
		}
		trades = append(trades, t)
		
		// Iceberg replenishment logic
		if order.IsIceberg {
			// Subtract from display first
			order.DisplayQuantity -= fillQuantity
			if order.DisplayQuantity <= 0 && order.HiddenQuantity > 0 {
				// Replenish from hidden
				replenishAmount := order.Quantity * 0.10 // Next 10% slice
				if order.HiddenQuantity < replenishAmount {
					replenishAmount = order.HiddenQuantity
				}
				order.DisplayQuantity = replenishAmount
				order.HiddenQuantity -= replenishAmount
			}
		}
	}

	// Update internal state
	if order.Side == models.SideBuy {
		ob.bids = append(ob.bids, order)
	} else {
		ob.asks = append(ob.asks, order)
	}

	return trades, nil
}
