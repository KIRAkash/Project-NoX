import json
import logging
from consumers.kafka_streams import SurveillanceStreamProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SurveillanceMain")

def main():
    logger.info("Starting GFMG Compliance Surveillance Monitor (Project Apex)")
    
    with open('../rules/aml_config.json', 'r') as f:
        aml_rules = json.load(f)
    
    logger.info(f"Loaded {len(aml_rules['rules'])} AML rulesets.")
    
    processor = SurveillanceStreamProcessor(
        topics=["nte.trades.matched", "nte.orderbook.snapshots", "scfs.settlement.status"],
        bootstrap_servers="kafka.gfmg.internal:9092"
    )
    
    processor.start()

if __name__ == "__main__":
    main()
