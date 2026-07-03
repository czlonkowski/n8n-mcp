#!/bin/sh
set -e

# Load configuration from JSON file if it exists
if [ -f "/app/config.json" ] && [ -f "/app/docker/parse-config.js" ]; then
    # Use Node.js to generate shell-safe export commands
    eval $(node /app/docker/parse-config.js /app/config.json)
fi

# Helper function for safe logging (prevents stdio mode corruption)
log_message() {
    [ "$MCP_MODE" != "stdio" ] && echo "$@"
}

# Environment variable validation
if [ "$MCP_MODE" = "http" ] && [ -z "$AUTH_TOKEN" ] && [ -z "$AUTH_TOKEN_FILE" ]; then
    log_message "ERROR: AUTH_TOKEN or AUTH_TOKEN_FILE is required for HTTP mode" >&2
    exit 1
fi

# Validate AUTH_TOKEN_FILE if provided
if [ -n "$AUTH_TOKEN_FILE" ] && [ ! -f "$AUTH_TOKEN_FILE" ]; then
    log_message "ERROR: AUTH_TOKEN_FILE specified but file not found: $AUTH_TOKEN_FILE" >&2
    exit 1
fi

# Initialize the database at $1. Prefer seeding from the pristine bundled
# copy (/app/.db-seed/nodes.db, kept outside /app/data because volume mounts
# mask that directory) — the runtime image has no n8n packages, so an
# in-container rebuild only works in dev images that ship them.
initialize_database() {
    target_db="$1"
    if [ -f "/app/.db-seed/nodes.db" ]; then
        log_message "Seeding database from bundled copy..."
        cp /app/.db-seed/nodes.db "$target_db"
    else
        cd /app && NODE_DB_PATH="$target_db" node dist/scripts/rebuild.js
    fi
}

# Database path configuration - respect NODE_DB_PATH if set
if [ -n "$NODE_DB_PATH" ]; then
    # Basic validation - must end with .db
    case "$NODE_DB_PATH" in
        *.db) ;;
        *) log_message "ERROR: NODE_DB_PATH must end with .db" >&2; exit 1 ;;
    esac
    
    # Use the path as-is (Docker paths should be absolute anyway)
    DB_PATH="$NODE_DB_PATH"
else
    DB_PATH="/app/data/nodes.db"
fi

DB_DIR=$(dirname "$DB_PATH")

# Ensure database directory exists with correct ownership
if [ ! -d "$DB_DIR" ]; then
    log_message "Creating database directory: $DB_DIR"
    if [ "$(id -u)" = "0" ]; then
        # Create as root but immediately fix ownership
        mkdir -p "$DB_DIR" && chown nodejs:nodejs "$DB_DIR"
    else
        mkdir -p "$DB_DIR"
    fi
fi

# Database initialization with file locking to prevent race conditions
if [ ! -f "$DB_PATH" ]; then
    log_message "Database not found at $DB_PATH. Initializing..."
    
    # Ensure lock directory exists before attempting to create lock
    mkdir -p "$DB_DIR"
    
    # Check if flock is available
    if command -v flock >/dev/null 2>&1; then
        # Use a lock file to prevent multiple containers from initializing simultaneously
        # Try to create lock file, handle permission errors gracefully
        LOCK_FILE="$DB_DIR/.db.lock"
        
        # Ensure we can create the lock file - fix permissions if running as root
        if [ "$(id -u)" = "0" ] && [ ! -w "$DB_DIR" ]; then
            chown nodejs:nodejs "$DB_DIR" 2>/dev/null || true
            chmod 755 "$DB_DIR" 2>/dev/null || true
        fi
        
        # Try to create lock file with proper error handling
        if touch "$LOCK_FILE" 2>/dev/null; then
            (
                flock -x 200
                # Double-check inside the lock
                if [ ! -f "$DB_PATH" ]; then
                    log_message "Initializing database at $DB_PATH..."
                    initialize_database "$DB_PATH" || log_message "WARNING: Could not initialize database at $DB_PATH (unwritable volume?). The server will attempt to open it and report an error if it is required." >&2
                fi
            ) 200>"$LOCK_FILE"
        else
            log_message "WARNING: Cannot create lock file at $LOCK_FILE, proceeding without file locking"
            # Fallback without locking if we can't create the lock file
            if [ ! -f "$DB_PATH" ]; then
                log_message "Initializing database at $DB_PATH..."
                initialize_database "$DB_PATH" || log_message "WARNING: Could not initialize database at $DB_PATH (unwritable volume?). The server will attempt to open it and report an error if it is required." >&2
            fi
        fi
    else
        # Fallback without locking (log warning)
        log_message "WARNING: flock not available, database initialization may have race conditions"
        if [ ! -f "$DB_PATH" ]; then
            log_message "Initializing database at $DB_PATH..."
            initialize_database "$DB_PATH" || log_message "WARNING: Could not initialize database at $DB_PATH (unwritable volume?). The server will attempt to open it and report an error if it is required." >&2
        fi
    fi
fi

# Fix permissions if running as root (for development)
if [ "$(id -u)" = "0" ]; then
    log_message "Running as root, fixing permissions..."
    chown -R nodejs:nodejs "$DB_DIR"
    # Also ensure /app/data exists for backward compatibility
    if [ -d "/app/data" ]; then
        chown -R nodejs:nodejs /app/data
    fi
    # Switch to nodejs user with proper exec chain for signal propagation
    # Build the command to execute
    if [ $# -eq 0 ]; then
        # No arguments provided, use default CMD from Dockerfile
        set -- node /app/dist/mcp/index.js
    fi
    # Export all needed environment variables
    export MCP_MODE="$MCP_MODE"
    export NODE_DB_PATH="$NODE_DB_PATH"
    export AUTH_TOKEN="$AUTH_TOKEN"
    export AUTH_TOKEN_FILE="$AUTH_TOKEN_FILE"
    
    # Ensure AUTH_TOKEN_FILE has restricted permissions for security
    if [ -n "$AUTH_TOKEN_FILE" ] && [ -f "$AUTH_TOKEN_FILE" ]; then
        chmod 600 "$AUTH_TOKEN_FILE" 2>/dev/null || true
        chown nodejs:nodejs "$AUTH_TOKEN_FILE" 2>/dev/null || true
    fi
    # Use exec with su-exec for proper signal handling (Alpine Linux)
    # su-exec advantages:
    # - Proper signal forwarding (critical for container shutdown)
    # - No intermediate shell process
    # - Designed for privilege dropping in containers
    if command -v su-exec >/dev/null 2>&1; then
        exec su-exec nodejs "$@"
    else
        # Fallback to su with preserved environment
        # Use safer approach to prevent command injection
        exec su -p nodejs -s /bin/sh -c 'exec "$0" "$@"' -- sh -c 'exec "$@"' -- "$@"
    fi
fi

# Handle special commands
if [ "$1" = "n8n-mcp" ] && [ "$2" = "serve" ]; then
    # Set HTTP mode for "n8n-mcp serve" command
    export MCP_MODE="http"
    shift 2  # Remove "n8n-mcp serve" from arguments
    set -- node /app/dist/mcp/index.js "$@"
fi

# Export NODE_DB_PATH so it's visible to child processes
if [ -n "$DB_PATH" ]; then
    export NODE_DB_PATH="$DB_PATH"
fi

# Execute the main command directly with exec
# This ensures our Node.js process becomes PID 1 and receives signals directly
if [ "$MCP_MODE" = "stdio" ]; then
    # Debug: Log to stderr to check if wrapper exists
    if [ "$DEBUG_DOCKER" = "true" ]; then
        echo "MCP_MODE is stdio, checking for wrapper..." >&2
        ls -la /app/dist/mcp/stdio-wrapper.js >&2 || echo "Wrapper not found!" >&2
    fi
    
    if [ -f "/app/dist/mcp/stdio-wrapper.js" ]; then
        # Use the stdio wrapper for clean JSON-RPC output
        # exec replaces the shell with node process as PID 1
        exec node /app/dist/mcp/stdio-wrapper.js
    else
        # Fallback: run with explicit environment
        exec env MCP_MODE=stdio DISABLE_CONSOLE_OUTPUT=true LOG_LEVEL=error node /app/dist/mcp/index.js
    fi
else
    # HTTP mode or other
    if [ $# -eq 0 ]; then
        # No arguments provided, use default
        exec node /app/dist/mcp/index.js
    else
        exec "$@"
    fi
fi