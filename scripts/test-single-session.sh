#!/bin/bash
# Test script for single-session HTTP server

set -e

echo "🧪 Testing Single-Session HTTP Server..."
echo

# Generate test auth token if not set
if [ -z "$AUTH_TOKEN" ]; then
  export AUTH_TOKEN="test-token-$(date +%s)"
  echo "Generated test AUTH_TOKEN: $AUTH_TOKEN"
fi

# Start server in background
echo "Starting server..."
MCP_MODE=http npm start > server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 3

# Check health endpoint
echo
echo "Testing health endpoint..."
curl -s http://localhost:3000/health | jq .

# Test authentication failure
echo
echo "Testing authentication failure..."
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong-token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq .

# Test successful request
echo
echo "Testing successful request..."
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq .

# Test session reuse
echo
echo "Testing session reuse (second request)..."
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"get_database_statistics","id":2}' | jq .

# Liveness check (health body is intentionally minimal per GHSA-75hx-xj24-mqrw)
echo
echo "Liveness check..."
curl -s http://localhost:3000/health | jq .

# Clean up
echo
echo "Stopping server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo
echo "✅ Test complete! Check server.log for details."