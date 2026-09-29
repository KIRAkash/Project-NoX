import pandas as pd
import networkx as nx
import logging

logger = logging.getLogger(__name__)

class WashTradeDetector:
    def __init__(self, time_window_ms=5000):
        self.time_window_ms = time_window_ms
        self.trade_graph = nx.DiGraph()
        
    def process_batch(self, trades_df: pd.DataFrame):
        """
        Process a DataFrame of matched trades from nte.trades.matched
        """
        alerts = []
        for _, row in trades_df.iterrows():
            buyer = row['buyer_id']
            seller = row['seller_id']
            instrument = row['instrument']
            
            # Add edge
            if self.trade_graph.has_edge(seller, buyer):
                self.trade_graph[seller][buyer]['weight'] += row['quantity']
            else:
                self.trade_graph.add_edge(seller, buyer, weight=row['quantity'], instrument=instrument)
                
            # Check for cycles (A -> B -> C -> A)
            try:
                cycles = nx.find_cycle(self.trade_graph, source=seller, orientation='original')
                if cycles:
                    alerts.append({
                        'type': 'WASH_TRADE_CYCLE',
                        'entities': [u for u, v, _ in cycles],
                        'instrument': instrument,
                        'confidence': 0.95
                    })
                    self.trade_graph.clear() # Reset after detection for simplicity
            except nx.NetworkXNoCycle:
                pass
                
        return alerts
