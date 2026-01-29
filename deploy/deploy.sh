#!/bin/bash
# =============================================================================
# SEO Articles - Deploy/Update Script
# =============================================================================
#
# This script:
# 1. Pulls latest Docker images from Docker Hub
# 2. Recreates containers with new images
# 3. Shows status
#
# Usage:
#   ./deploy.sh
#
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           SEO Articles - Deploy/Update                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running from correct directory
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}Error: docker-compose.yml not found!${NC}"
    echo "Please run this script from the deploy directory."
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env not found!${NC}"
    echo "Please run ./setup.sh first."
    exit 1
fi

# Record start time
START_TIME=$(date +%s)

# Pull latest images
echo -e "${BLUE}[1/3] Pulling latest images...${NC}"
docker compose pull

# Recreate containers
echo ""
echo -e "${BLUE}[2/3] Updating services...${NC}"
docker compose up -d --remove-orphans

# Wait for health checks
echo ""
echo -e "${BLUE}[3/3] Waiting for health checks...${NC}"
sleep 15

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Show status
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Deployment Complete! (${DURATION}s)                       ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Show container status
docker compose ps

echo ""
echo -e "${BLUE}Image versions:${NC}"
docker compose images | grep -E "seo-|IMAGE" | head -10

echo ""
echo -e "${BLUE}Quick health check:${NC}"
if docker compose exec -T seo-api wget --no-verbose --tries=1 --spider http://localhost:3001/api/health 2>/dev/null; then
    echo -e "${GREEN}✓ API is healthy${NC}"
else
    echo -e "${YELLOW}⚠ API health check failed (may still be starting)${NC}"
fi

echo ""
