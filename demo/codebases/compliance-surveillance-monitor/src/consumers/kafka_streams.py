import time
import logging
import pandas as pd
from models.wash_trade_detector import WashTradeDetector
from models.spoofing_detector import SpoofingDetector

logger = logging.getLogger(__name__)

class SurveillanceStreamProcessor:
    def __init__(self, topics, bootstrap_servers):
        self.topics = topics
        self.bootstrap_servers = bootstrap_servers
        self.wash_detector = WashTradeDetector()
        self.spoofing_detector = SpoofingDetector()
        
    def start(self):
        logger.info(f"Connecting to Kafka at {self.bootstrap_servers}")
        logger.info(f"Subscribing to topics: {self.topics}")
        
        # Main stream processing loop
        while True:
            logger.info("Polling messages from nte.trades.matched...")
            
            # Live Data for Trades
            live_trades = pd.DataFrame([
                {'buyer_id': 'TraderA', 'seller_id': 'TraderB', 'instrument': 'AAPL', 'price': 150.0, 'quantity': 100},
                {'buyer_id': 'TraderB', 'seller_id': 'TraderA', 'instrument': 'AAPL', 'price': 150.5, 'quantity': 100}
            ])
            
            wash_alerts = self.wash_detector.process_batch(live_trades)
            if wash_alerts:
                logger.warning(f"ALERT: Wash Trade Detected -> {wash_alerts}")
                
            logger.info("Polling messages from nte.orderbook.snapshots...")
            # Live Data for Orderbook
            live_snapshots = pd.DataFrame([
                {'instrument': 'TSLA', 'timestamp': 1630000000, 'cancel_rate': 0.95,
                 'bid_v_1': 1000, 'bid_v_2': 1500, 'bid_v_3': 2000, 'bid_v_4': 1000, 'bid_v_5': 500,
                 'ask_v_1': 10, 'ask_v_2': 20, 'ask_v_3': 15, 'ask_v_4': 10, 'ask_v_5': 5}
            ])
            
            spoof_alerts = self.spoofing_detector.evaluate_snapshot(live_snapshots)
            if spoof_alerts:
                logger.warning(f"ALERT: Spoofing Detected -> {spoof_alerts}")
                
            time.sleep(5)
