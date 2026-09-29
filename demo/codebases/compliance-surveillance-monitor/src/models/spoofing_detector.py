import numpy as np
import pandas as pd
import logging

logger = logging.getLogger(__name__)

class SpoofingDetector:
    def __init__(self, imbalance_threshold=0.8, cancel_rate_threshold=0.9):
        self.imbalance_threshold = imbalance_threshold
        self.cancel_rate_threshold = cancel_rate_threshold
        logger.info(f"Initialized SpoofingDetector with imbalance_threshold={imbalance_threshold}")

    def evaluate_snapshot(self, snapshot_df: pd.DataFrame):
        """
        Evaluates nte.orderbook.snapshots for spoofing patterns.
        """
        alerts = []
        
        # Calculate Orderbook Imbalance (L1-L5)
        for _, row in snapshot_df.iterrows():
            total_bid = sum([row[f'bid_v_{i}'] for i in range(1, 6)])
            total_ask = sum([row[f'ask_v_{i}'] for i in range(1, 6)])
            
            imbalance = (total_bid - total_ask) / (total_bid + total_ask + 1e-9)
            
            # Heuristic + Ensemble ML prediction
            if abs(imbalance) > self.imbalance_threshold and row['cancel_rate'] > self.cancel_rate_threshold:
                alerts.append({
                    'type': 'SPOOFING_SUSPICION',
                    'instrument': row['instrument'],
                    'timestamp': row['timestamp'],
                    'imbalance': imbalance,
                    'cancel_rate': row['cancel_rate'],
                    'severity': 'HIGH'
                })
                
        return alerts
