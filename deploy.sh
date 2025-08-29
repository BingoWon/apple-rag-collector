#!/bin/bash

# Apple RAG Collector - One-Click Deployment Script
# Automated production environment deployment workflow

set -e

# Prevent infinite restart loops
if [[ "${DEPLOY_SCRIPT_RESTARTED}" == "true" ]]; then
  echo "🔄 Running with updated deploy script..."
  unset DEPLOY_SCRIPT_RESTARTED
fi

echo "🚀 Starting Apple RAG Collector deployment..."

# Check current directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Check if we're in the correct project
if ! grep -q "apple-rag-collector" package.json; then
    echo "❌ Error: This doesn't appear to be the apple-rag-collector project"
    exit 1
fi

# Store current commit hash before pulling
CURRENT_COMMIT=$(git rev-parse HEAD)

# 1. Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin main

# 1.1. Check if deploy.sh was updated and restart if needed (only if not already restarted)
if [[ "${DEPLOY_SCRIPT_RESTARTED}" != "true" ]]; then
  NEW_COMMIT=$(git rev-parse HEAD)
  if [[ "$CURRENT_COMMIT" != "$NEW_COMMIT" ]] && git diff "$CURRENT_COMMIT" "$NEW_COMMIT" --name-only | grep -q "deploy.sh"; then
    echo "🔄 Deploy script was updated, restarting with new version..."
    export DEPLOY_SCRIPT_RESTARTED=true
    exec bash "$0" "$@"
  fi
fi

# 2. Install dependencies (if needed)
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# 3. Build project
echo "🔨 Building project..."
pnpm build

# 4. Verify build
if [ ! -f "dist/index.js" ]; then
    echo "❌ Build failed: dist/index.js not found"
    exit 1
fi

# 5. Stop existing PM2 process (if running)
echo "🛑 Stopping existing PM2 process..."
pm2 stop apple-rag-collector 2>/dev/null || echo "No existing process to stop"

# 6. Start/Restart PM2 service
echo "🔄 Starting PM2 service..."
pnpm pm2:start

# 7. Verify service status
echo "🔍 Checking service status..."
pm2 status apple-rag-collector

echo ""
echo "✅ Deployment completed successfully!"
echo "📋 Service status:"
pm2 info apple-rag-collector --no-color

echo ""
echo "📊 Recent logs:"
pm2 logs apple-rag-collector --lines 10 --no-color

echo ""
echo "🎯 Apple RAG Collector is now running!"
echo "📈 Monitor progress: pm2 logs apple-rag-collector"
echo "📊 Check status: pm2 status"
echo "🔄 Restart: pm2 restart apple-rag-collector"
