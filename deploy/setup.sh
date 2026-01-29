#!/bin/bash
# =============================================================================
# SEO Articles - Initial Setup Script
# =============================================================================
#
# This script:
# 1. Creates .env with auto-generated secrets (first run)
# 2. Pulls Docker images
# 3. Starts all services
# 4. Creates admin user (interactive)
#
# Usage:
#   ./setup.sh
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
echo "║           SEO Articles - Production Setup                     ║"
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
    echo -e "${YELLOW}Creating .env from template...${NC}"

    if [ ! -f ".env.example" ]; then
        echo -e "${RED}Error: .env.example not found!${NC}"
        exit 1
    fi

    cp .env.example .env

    # Generate secrets
    echo -e "${BLUE}Generating secure secrets...${NC}"

    JWT_SECRET=$(openssl rand -hex 64)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    GRAFANA_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=')

    # Replace placeholders (works on both Linux and macOS)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/generate-with-openssl-rand-hex-64/$JWT_SECRET/" .env
        sed -i '' "s/generate-with-openssl-rand-hex-32/$ENCRYPTION_KEY/" .env
        sed -i '' "s/your-secure-grafana-password/$GRAFANA_PASSWORD/" .env
    else
        # Linux
        sed -i "s/generate-with-openssl-rand-hex-64/$JWT_SECRET/" .env
        sed -i "s/generate-with-openssl-rand-hex-32/$ENCRYPTION_KEY/" .env
        sed -i "s/your-secure-grafana-password/$GRAFANA_PASSWORD/" .env
    fi

    echo -e "${GREEN}✓ Secrets generated!${NC}"
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}IMPORTANT: Edit .env and set your domains:${NC}"
    echo ""
    echo "   FRONTEND_DOMAIN=app.yourdomain.com"
    echo "   API_DOMAIN=api.yourdomain.com"
    echo "   GRAFANA_DOMAIN=grafana.yourdomain.com"
    echo ""
    echo -e "${YELLOW}Then run this script again: ./setup.sh${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
    exit 0
fi

# Check if domains are configured
source .env
if [[ "$FRONTEND_DOMAIN" == "app.yourdomain.com" ]]; then
    echo -e "${YELLOW}Warning: Default domains detected in .env${NC}"
    echo "Please edit .env and set your actual domains before continuing."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check monitoring directory
if [ ! -d "monitoring/prometheus" ]; then
    echo -e "${RED}Error: monitoring directory not found!${NC}"
    echo "Please make sure monitoring configs are in place."
    exit 1
fi

# Pull images
echo ""
echo -e "${BLUE}Pulling Docker images...${NC}"
docker compose pull

# Start services
echo ""
echo -e "${BLUE}Starting services...${NC}"
docker compose up -d

# Wait for services
echo ""
echo -e "${BLUE}Waiting for services to be healthy (45s)...${NC}"
sleep 45

# Check if API is healthy
echo ""
echo -e "${BLUE}Checking API health...${NC}"
if docker compose exec -T seo-api wget --no-verbose --tries=1 --spider http://localhost:3001/api/health 2>/dev/null; then
    echo -e "${GREEN}✓ API is healthy!${NC}"
else
    echo -e "${YELLOW}Warning: API health check failed. It may still be starting.${NC}"
    echo "Check logs with: docker compose logs seo-api"
fi

# Create admin user
echo ""
echo -e "${BLUE}Creating admin user...${NC}"
echo -e "${YELLOW}You will be prompted to enter email, password, and PIN.${NC}"
echo ""
docker compose exec -T seo-api npm run setup:user

# Final output
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Setup Complete!                            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next steps - Configure Nginx Proxy Manager:${NC}"
echo ""
echo "1. Open NPM Admin: http://$(hostname -I | awk '{print $1}'):81"
echo "   Default login: admin@example.com / changeme"
echo "   (Change password immediately!)"
echo ""
echo "2. Create Proxy Hosts:"
echo ""
echo "   ${GREEN}Frontend:${NC}"
echo "   • Domain: $FRONTEND_DOMAIN"
echo "   • Forward: seo-frontend:3000"
echo "   • Enable SSL (Let's Encrypt)"
echo ""
echo "   ${GREEN}API (Enable WebSocket!):${NC}"
echo "   • Domain: $API_DOMAIN"
echo "   • Forward: seo-api:3001"
echo "   • ✓ Websockets Support"
echo "   • Enable SSL"
echo "   • Advanced → Custom Nginx:"
echo "     proxy_set_header X-Real-IP \$remote_addr;"
echo "     proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
echo "     proxy_set_header X-Forwarded-Proto \$scheme;"
echo ""
echo "   ${GREEN}Grafana:${NC}"
echo "   • Domain: $GRAFANA_DOMAIN"
echo "   • Forward: seo-grafana:3000"
echo "   • Enable SSL"
echo ""
echo "3. After setup, optionally remove port 81 for security:"
echo "   • Edit docker-compose.yml"
echo "   • Remove '- 81:81' line"
echo "   • Run: docker compose up -d"
echo ""
echo -e "${GREEN}Grafana password: $GRAFANA_PASSWORD${NC}"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  docker compose ps            # Check status"
echo "  docker compose logs -f       # View all logs"
echo "  docker compose logs seo-api  # View API logs"
echo "  ./deploy.sh                  # Update services"
echo ""
