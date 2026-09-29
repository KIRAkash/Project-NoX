export interface TradeEvent {
    tradeId: string;
    symbol: string;
    price: number;
    quantity: number;
    matchedAt: number;
    takerSide: 'BUY' | 'SELL';
}

export interface OrderBookEvent {
    symbol: string;
    bids: PriceLevel[];
    asks: PriceLevel[];
    timestamp: number;
}

export interface PriceLevel {
    price: number;
    quantity: number;
    orderCount: number;
}
