from typing import List, Optional
from pydantic import BaseModel, Field

class TradeMatchedEvent(BaseModel):
    trade_id: str = Field(..., description="Unique identifier for the trade")
    buyer_id: str = Field(..., description="ID of the buyer")
    seller_id: str = Field(..., description="ID of the seller")
    instrument: str = Field(..., description="Symbol of the traded instrument")
    price: float = Field(..., description="Execution price")
    quantity: float = Field(..., description="Execution quantity")
    timestamp: int = Field(..., description="Epoch timestamp of match")

class OrderbookSnapshotEvent(BaseModel):
    instrument: str = Field(..., description="Symbol of the instrument")
    timestamp: int = Field(..., description="Epoch timestamp of snapshot")
    cancel_rate: float = Field(..., description="Rate of cancelled orders in the last second")
    bid_v_1: float
    bid_v_2: float
    bid_v_3: float
    bid_v_4: float
    bid_v_5: float
    ask_v_1: float
    ask_v_2: float
    ask_v_3: float
    ask_v_4: float
    ask_v_5: float

class SettlementStatusEvent(BaseModel):
    trade_id: str
    status: str = Field(..., description="E.g., SETTLED, PENDING, FAILED")
    settlement_time: int
