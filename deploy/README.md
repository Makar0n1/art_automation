# SEO Articles - Production Deployment

Production deployment configuration for SEO Articles service with Nginx Proxy Manager, monitoring stack, and auto-SSL.

## Architecture

```
                         Internet
                            │
                     ┌──────┴──────┐
                     │  Ports 80,  │
                     │    443      │
                     └──────┬──────┘
                            │
┌───────────────────────────┴───────────────────────────────────────────────┐
│                    Nginx Proxy Manager                                    │
│   app.domain.com     → seo-frontend:3000                                  │
│   api.domain.com     → seo-api:3001 (+ WebSocket)                         │
│   grafana.domain.com → seo-grafana:3000                                   │
└───────────────────────────────────────────────────────────────────────────┘
                            │
                    Docker Network: seo_network
                            │
    ┌───────────────────────┴───────────────────────────────────────────┐
    │  Frontend │ Backend API │ Workers (x3) │ MongoDB │ Redis          │
    │  Grafana  │ Prometheus  │ Loki │ Promtail │ cAdvisor              │
    └───────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Linux server (Ubuntu 20.04+ recommended)
- Docker & Docker Compose v2 installed
- Domain names pointing to server IP
- Ports 80 and 443 open

## Quick Start

### 1. Clone and Setup

```bash
# Clone repository
git clone https://github.com/Makar0n1/art_automation.git /opt/seo-articles
cd /opt/seo-articles/deploy

# Run setup (creates .env, generates secrets)
./setup.sh
```

### 2. Configure Domains

Edit `.env` and set your domains:

```bash
FRONTEND_DOMAIN=app.yourdomain.com
API_DOMAIN=api.yourdomain.com
GRAFANA_DOMAIN=grafana.yourdomain.com
```

### 3. Start Services

```bash
./setup.sh  # Run again after editing .env
```

### 4. Configure Nginx Proxy Manager

1. Open NPM Admin: `http://YOUR_SERVER_IP:81`
2. Login with default: `admin@example.com` / `changeme`
3. **Change password immediately!**

Create 3 Proxy Hosts:

#### Frontend
- **Domain Names:** `app.yourdomain.com`
- **Scheme:** http
- **Forward Hostname:** `seo-frontend`
- **Forward Port:** `3000`
- **SSL Tab:** Request new SSL Certificate, Force SSL, HTTP/2

#### API (Important: Enable WebSocket!)
- **Domain Names:** `api.yourdomain.com`
- **Scheme:** http
- **Forward Hostname:** `seo-api`
- **Forward Port:** `3001`
- **Websockets Support:** ✓ **MUST BE ENABLED**
- **SSL Tab:** Request new SSL Certificate, Force SSL, HTTP/2
- **Advanced Tab → Custom Nginx Configuration:**
```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

#### Grafana
- **Domain Names:** `grafana.yourdomain.com`
- **Scheme:** http
- **Forward Hostname:** `seo-grafana`
- **Forward Port:** `3000`
- **SSL Tab:** Request new SSL Certificate, Force SSL, HTTP/2

### 5. Secure NPM Admin (Optional)

After configuration, remove public access to NPM admin:

```bash
# Edit docker-compose.yml
# Remove the line: - '81:81'
docker compose up -d
```

You can still access NPM via SSH tunnel:
```bash
ssh -L 8181:localhost:81 yourserver
# Then open http://localhost:8181
```

## Updating Services

When new versions are pushed to Docker Hub:

```bash
cd /opt/seo-articles/deploy
./deploy.sh
```

This will:
1. Pull latest images
2. Recreate containers
3. Show health status

## Useful Commands

```bash
# Check status
docker compose ps

# View logs
docker compose logs -f              # All services
docker compose logs -f seo-api      # API only
docker compose logs -f backend-worker  # Workers

# Restart a service
docker compose restart seo-api

# Scale workers
docker compose up -d --scale backend-worker=5

# Check disk usage
docker system df

# Clean up old images
docker image prune -f
```

## Monitoring

### Grafana
- URL: `https://grafana.yourdomain.com`
- Default user: `admin`
- Password: (shown after setup, also in `.env`)

### Available Dashboards
- **SEO Articles Overview** - CPU, Memory, Network, Error rates
- **SEO Articles Logs** - Real-time log viewer

### Prometheus Metrics
Backend exposes metrics at `/api/metrics`:
- `seo_articles_generations_total` - Total generations by status
- `seo_articles_http_requests_total` - HTTP request counts
- `seo_articles_queue_jobs_active` - Active queue jobs

## Backup

### Database Backup
```bash
# Backup MongoDB
docker compose exec seo-mongodb mongodump --out /data/backup
docker cp seo-mongodb:/data/backup ./mongodb-backup-$(date +%Y%m%d)

# Restore
docker cp ./mongodb-backup seo-mongodb:/data/restore
docker compose exec seo-mongodb mongorestore /data/restore
```

### Volume Backup
```bash
# List volumes
docker volume ls | grep seo_

# Backup a volume
docker run --rm -v seo_mongodb_data:/data -v $(pwd):/backup alpine tar cvf /backup/mongodb-data.tar /data
```

## Troubleshooting

### Services not starting
```bash
# Check logs
docker compose logs seo-api
docker compose logs seo-mongodb

# Check if ports are in use
netstat -tlnp | grep -E '80|443|81'
```

### WebSocket not working
1. Verify "Websockets Support" is enabled in NPM
2. Check API logs for connection errors
3. Test with: `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" https://api.domain.com/socket.io/`

### SSL Certificate issues
1. Make sure domain points to server IP: `dig app.yourdomain.com`
2. Ports 80/443 must be open
3. Check NPM logs: `docker compose logs seo-npm`

### Out of disk space
```bash
# Check usage
df -h
docker system df

# Clean up
docker system prune -a --volumes  # WARNING: Removes unused volumes!
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKERHUB_USERNAME` | Docker Hub username | `makar0n1` |
| `FRONTEND_DOMAIN` | Frontend domain | - |
| `API_DOMAIN` | API domain | - |
| `GRAFANA_DOMAIN` | Grafana domain | - |
| `JWT_SECRET` | JWT signing secret | Auto-generated |
| `ENCRYPTION_KEY` | API key encryption | Auto-generated |
| `WORKER_CONCURRENCY` | Jobs per worker | `2` |
| `WORKER_REPLICAS` | Number of workers | `3` |
| `GRAFANA_USER` | Grafana admin user | `admin` |
| `GRAFANA_PASSWORD` | Grafana admin password | Auto-generated |

## Security Recommendations

1. **Change NPM default password** immediately after first login
2. **Remove port 81** after NPM configuration
3. **Use strong passwords** for admin user and API keys
4. **Enable 2FA** in NPM if available
5. **Regular backups** of MongoDB and volumes
6. **Keep images updated** with `./deploy.sh`

## File Structure

```
deploy/
├── docker-compose.yml    # Main compose file
├── .env.example          # Environment template
├── .env                  # Your configuration (gitignored)
├── setup.sh              # Initial setup script
├── deploy.sh             # Update script
├── README.md             # This file
└── monitoring/
    ├── prometheus/
    │   └── prometheus.yml
    ├── loki/
    │   └── loki-config.yml
    ├── promtail/
    │   └── promtail-config.yml
    └── grafana/
        ├── provisioning/
        │   ├── datasources/
        │   └── dashboards/
        └── dashboards/
```
