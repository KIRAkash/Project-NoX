import { WebSocketServer, WebSocket } from 'ws';

export class ClientManager {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();

    constructor(port: number) {
        this.wss = new WebSocketServer({ port });
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            ws.on('close', () => this.clients.delete(ws));
        });
    }

    broadcastOrderBook(snapshot: string) {
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'L2_UPDATE', data: snapshot }));
            }
        }
    }

    broadcastTrade(trade: string) {
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'TRADE_TICK', data: trade }));
            }
        }
    }
}
