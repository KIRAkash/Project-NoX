import { ClientManager } from './websockets/ClientManager';
import { OrderBookConsumer } from './consumers/OrderBookConsumer';
import { TradeConsumer } from './consumers/TradeConsumer';
// import { MetricsRegistry } from '@apex/nte-telemetry';

// Logger implementation wrapping @apex/nte-logger
const logger = {
    info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta || ''),
    error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta || '')
};

async function bootstrap() {
    logger.info('Initializing Nexus Trading Exchange - Market Data Gateway');
    
    const clientManager = new ClientManager(8080);
    
    const obConsumer = new OrderBookConsumer(clientManager);
    const tradeConsumer = new TradeConsumer(clientManager);
    
    await obConsumer.start();
    await tradeConsumer.start();
    
    logger.info('MDG successfully connected to nte.orderbook.snapshots and nte.trades.matched');
}

bootstrap().catch(err => {
    logger.error('Fatal error during bootstrap', { error: err });
    process.exit(1);
});
