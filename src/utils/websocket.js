// Native WebSocket utility for real-time updates
import { WebSocketServer } from 'ws';
import { parse } from 'url';

let wss = null;
const connectedClients = new Map(); // Map<userId, Set<WebSocket>>

/**
 * Initialize WebSocket server
 * @param {http.Server} server - HTTP server instance
 * @returns {WebSocketServer} WebSocket server instance
 */
export function initializeWebSocket(server) {
  wss = new WebSocketServer({ 
    server,
    path: '/ws',
    perMessageDeflate: false, // Disable compression for better performance
  });

  wss.on('connection', (ws, req) => {
    const { query } = parse(req.url, true);
    const userId = query?.userId;
    
    console.log(`✅ WebSocket client connected: ${ws.readyState === 1 ? 'OPEN' : 'CONNECTING'}`);

    // Store user connection
    if (userId) {
      if (!connectedClients.has(userId)) {
        connectedClients.set(userId, new Set());
      }
      connectedClients.get(userId).add(ws);
      ws.userId = userId;
      console.log(`✅ User ${userId} connected (${connectedClients.get(userId).size} connections)`);
    }

    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle authentication
        if (data.type === 'authenticate' && data.userId) {
          const userId = data.userId;
          if (!connectedClients.has(userId)) {
            connectedClients.set(userId, new Set());
          }
          connectedClients.get(userId).add(ws);
          ws.userId = userId;
          
          // Send confirmation
          ws.send(JSON.stringify({
            type: 'authenticated',
            userId: userId,
            timestamp: new Date().toISOString(),
          }));
          
          console.log(`✅ User ${userId} authenticated via WebSocket`);
        }
        
        // Handle ping/pong for keepalive
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    // Handle connection close
    ws.on('close', () => {
      if (ws.userId) {
        const userConnections = connectedClients.get(ws.userId);
        if (userConnections) {
          userConnections.delete(ws);
          if (userConnections.size === 0) {
            connectedClients.delete(ws.userId);
          }
        }
        console.log(`❌ User ${ws.userId} disconnected (${userConnections?.size || 0} remaining)`);
      } else {
        console.log(`❌ WebSocket client disconnected`);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket connection established',
      timestamp: new Date().toISOString(),
    }));
  });

  // Set up ping interval to keep connections alive
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000); // Ping every 30 seconds

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  console.log('✅ WebSocket server initialized on /ws');
  return wss;
}

/**
 * Get WebSocket server instance
 * @returns {WebSocketServer|null} WebSocket server instance
 */
export function getWebSocketServer() {
  return wss;
}

/**
 * Emit event to specific user
 * @param {string} userId - User ID
 * @param {string} event - Event name
 * @param {any} data - Data to send
 */
export function emitToUser(userId, event, data) {
  if (!wss) return;
  
  const userConnections = connectedClients.get(userId);
  if (userConnections && userConnections.size > 0) {
    const message = JSON.stringify({
      type: event,
      data: data,
      timestamp: new Date().toISOString(),
    });
    
    let sentCount = 0;
    userConnections.forEach((ws) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(message);
        sentCount++;
      }
    });
    
    if (sentCount > 0) {
      console.log(`📤 Emitted ${event} to user ${userId} (${sentCount} connection(s))`);
    }
  }
}

/**
 * Emit event to all connected clients
 * @param {string} event - Event name
 * @param {any} data - Data to send
 */
export function emitToAll(event, data) {
  if (!wss) return;
  
  const message = JSON.stringify({
    type: event,
    data: data,
    timestamp: new Date().toISOString(),
  });
  
  let sentCount = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
      sentCount++;
    }
  });
  
  if (sentCount > 0) {
    console.log(`📤 Emitted ${event} to all clients (${sentCount} connection(s))`);
  }
}

/**
 * Emit event to all users except sender
 * @param {WebSocket} senderWs - WebSocket connection to exclude
 * @param {string} event - Event name
 * @param {any} data - Data to send
 */
export function emitToOthers(senderWs, event, data) {
  if (!wss) return;
  
  const message = JSON.stringify({
    type: event,
    data: data,
    timestamp: new Date().toISOString(),
  });
  
  let sentCount = 0;
  wss.clients.forEach((ws) => {
    if (ws !== senderWs && ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
      sentCount++;
    }
  });
  
  if (sentCount > 0) {
    console.log(`📤 Emitted ${event} to all except sender (${sentCount} connection(s))`);
  }
}
