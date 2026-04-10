# Database & Memory Configuration

## Database Adapters

n8n-mcp uses SQLite for storing node documentation. Two adapters are available:

1. **better-sqlite3** (Default in Docker)
   - Native C++ bindings for best performance
   - Direct disk writes (no memory overhead)
   - Enabled by default in Docker images (v2.20.2+)
   - Memory usage: ~100-120 MB stable

2. **sql.js** (Fallback)
   - Pure JavaScript implementation
   - In-memory database with periodic saves
   - Used when better-sqlite3 compilation fails
   - Memory usage: ~150-200 MB stable

## Memory Optimization (sql.js)

If using sql.js fallback, you can configure the save interval to balance between data safety and memory efficiency:

**Environment Variable:**
```bash
SQLJS_SAVE_INTERVAL_MS=5000  # Default: 5000ms (5 seconds)
```

**Usage:**
- Controls how long to wait after database changes before saving to disk
- Lower values = more frequent saves = higher memory churn
- Higher values = less frequent saves = lower memory usage
- Minimum: 100ms
- Recommended: 5000-10000ms for production

**Docker Configuration:**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e", "SQLJS_SAVE_INTERVAL_MS=10000",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

**docker-compose:**
```yaml
environment:
  SQLJS_SAVE_INTERVAL_MS: "10000"
```
