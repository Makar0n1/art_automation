# SEO Articles Generator

High-load service for AI-powered SEO article generation with real-time progress tracking.

## Features

- JWT authentication (14-day token)
- Projects and article generations management
- Real-time generation logs (Socket.IO)
- Parallel processing queue (Bull + Redis)
- Firecrawl integration for SERP analysis
- OpenRouter & Supabase API key management
- Modern dashboard UI

## Tech Stack

**Backend**: Node.js, Express, TypeScript, Socket.IO, Bull Queue, Redis, MongoDB
**Frontend**: Next.js 14, TypeScript, Tailwind CSS, Zustand, TanStack Query

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB 6+
- Redis 7+

### Using Docker (recommended)

Start MongoDB and Redis:

```bash
docker-compose up -d
```

### Manual Setup

1. Install MongoDB and Redis locally
2. Ensure they are running on default ports

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env if needed
npm install
npm run dev
```

Backend runs on http://localhost:3001

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on http://localhost:3000

## Default Credentials

- **Email**: admin@seoarticles.local
- **Password**: admin123

## Configuration

### Backend (.env)

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/seo_articles
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=14d
MAX_CONCURRENT_GENERATIONS=5
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

## Project Structure

```
articles_automation/
├── backend/              # Express API server
│   ├── src/
│   │   ├── controllers/  # Request handlers
│   │   ├── middleware/   # Auth, error handling
│   │   ├── models/       # Mongoose schemas
│   │   ├── queues/       # Bull job processor
│   │   ├── routes/       # API routes
│   │   ├── services/     # External services
│   │   ├── types/        # TypeScript types
│   │   └── utils/        # Helpers
│   └── package.json
├── frontend/             # Next.js dashboard
│   ├── src/
│   │   ├── app/          # Pages (App Router)
│   │   ├── components/   # UI components
│   │   ├── lib/          # API client, utils
│   │   ├── store/        # Zustand stores
│   │   └── types/        # TypeScript types
│   └── package.json
├── docker-compose.yml    # MongoDB + Redis
├── CLAUDE.md             # Development log
└── README.md
```

## API Endpoints

### Auth
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh token

### Settings
- `GET /api/settings/api-keys` - Get API keys status
- `PUT /api/settings/api-keys/openrouter` - Update OpenRouter key
- `POST /api/settings/api-keys/openrouter/test` - Test OpenRouter key
- `PUT /api/settings/api-keys/firecrawl` - Update Firecrawl key
- `POST /api/settings/api-keys/firecrawl/test` - Test Firecrawl key

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Generations
- `POST /api/projects/:id/generations` - Create generation
- `GET /api/generations` - List all generations
- `GET /api/generations/:id` - Get generation details
- `GET /api/generations/:id/logs` - Get generation logs
- `GET /api/generations/queue/stats` - Queue statistics

## Usage

1. Login with default credentials
2. Go to Settings and configure Firecrawl API key
3. Create a new project
4. Start a generation with your target keyword
5. Watch real-time logs as SERP is parsed
6. View results when complete

## License

MIT
