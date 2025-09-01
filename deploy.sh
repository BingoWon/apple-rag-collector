#!/bin/bash

# Apple RAG Collector - Production Deployment Script
# Uses project PM2 for consistent dependency management

set -e

# Prevent infinite restart loops
if [[ "${DEPLOY_SCRIPT_RESTARTED}" == "true" ]]; then
  echo "Running with updated deploy script..."
  unset DEPLOY_SCRIPT_RESTARTED
fi

echo "Starting deployment..."

# Validate environment
if [ ! -f "package.json" ]; then
    echo "Error: Run from project root directory"
    exit 1
fi

if ! grep -q "apple-rag-collector" package.json; then
    echo "Error: Not apple-rag-collector project"
    exit 1
fi

# Handle script updates
CURRENT_COMMIT=$(git rev-parse HEAD)
git pull origin main

if [[ "${DEPLOY_SCRIPT_RESTARTED}" != "true" ]]; then
  NEW_COMMIT=$(git rev-parse HEAD)
  if [[ "$CURRENT_COMMIT" != "$NEW_COMMIT" ]] && git diff "$CURRENT_COMMIT" "$NEW_COMMIT" --name-only | grep -q "deploy.sh"; then
    echo "Deploy script updated, restarting..."
    export DEPLOY_SCRIPT_RESTARTED=true
    exec bash "$0" "$@"
  fi
fi

# Install dependencies and build
echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Building project..."
pnpm build

if [ ! -f "dist/index.js" ]; then
    echo "Build failed: dist/index.js not found"
    exit 1
fi

# PM2 management with project PM2
echo "Managing PM2 service..."
pnpm exec pm2 stop apple-rag-collector 2>/dev/null || true
pnpm exec pm2 start ecosystem.config.cjs

# Configure auto-startup
echo "Configuring auto-startup..."
pnpm exec pm2 startup
pnpm exec pm2 save

# Deployment complete
echo "Deployment completed successfully"
pnpm exec pm2 status
