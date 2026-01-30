#!/bin/bash

echo "=== Socket.IO and Redis Pub/Sub Test ==="
echo ""

echo "1. Subscribe to Redis socket:events channel (will listen for 10 seconds):"
echo "   Starting listener..."
timeout 10 docker exec seo-articles-redis-1 redis-cli SUBSCRIBE socket:events &
LISTENER_PID=$!
sleep 2

echo ""
echo "2. Testing Redis Pub/Sub by publishing test message:"
docker exec seo-articles-redis-1 redis-cli PUBLISH socket:events '{"test":"message","room":"test:room","event":"test:event","data":{"hello":"world"}}'

echo ""
echo "3. Waiting for listener to capture message..."
wait $LISTENER_PID 2>/dev/null

echo ""
echo "4. Check Socket.IO connections in API server logs:"
docker logs --tail 20 seo-articles-backend-api-1 2>&1 | grep -i "socket\|connection\|redis" || echo "No Socket.IO messages found in recent logs"

echo ""
echo "5. Check if Redis Adapter is loaded in API server:"
docker logs seo-articles-backend-api-1 2>&1 | grep -i "redis.*adapter\|socket.io.*redis" | tail -5

echo ""
echo "=== Test Complete ==="
echo ""
echo "Expected behavior:"
echo "  - Listener should receive the test message"
echo "  - API logs should show Socket.IO server started"
echo "  - API logs should show Redis Adapter connected"
