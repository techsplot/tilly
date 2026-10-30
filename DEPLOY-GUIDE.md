# Tilly Deployment Guide

**Target**: Nebius Serverless AI Endpoint (CPU, public)  
**Deadline**: Oct 30, 2026 10:00 PDT

## Prerequisites

1. **Nebius CLI installed**: https://docs.nebius.com/cli/install
2. **Docker installed** and running
3. **Nebius account** with Token Factory access
4. **Production database** (Neon PostgreSQL recommended)

## Quick Deploy Steps

### 1. Merge Phase 11 (if not done)

```powershell
cd c:\Users\Ayomide Olofinsawe\Documents\tilly-publish
git checkout main
git merge phase-11
git push origin main
```

### 2. Set Up Production Database

If you don't have a production PostgreSQL database yet:

**Option A: Neon (Recommended - Free tier available)**
1. Go to https://neon.tech/
2. Create a new project
3. Copy the connection string (looks like `postgresql://user:pass@host.neon.tech/dbname`)

**Option B: Nebius Managed PostgreSQL**
```powershell
# Create a PostgreSQL cluster (if using Nebius)
nebius postgres cluster create --name tilly-db --environment production
```

### 3. Run Database Migrations

```powershell
# Set production DATABASE_URL
$env:DATABASE_URL = "postgresql://your-production-connection-string"

# Run migrations
npm run db:migrate

# Verify
npm run db:migrate  # Should show "No new migrations to apply"
```

### 4. Build and Push Docker Image

**Option A: Push to Docker Hub (Easiest)**

```powershell
# Build the image
docker build -t your-dockerhub-username/tilly:latest .

# Test locally first
docker run -p 3000:3000 `
  -e DATABASE_URL="postgresql://..." `
  -e NEBIUS_API_KEY="your-key" `
  -e NEBIUS_MODEL_EXTRACTION="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" `
  -e NEBIUS_MODEL_ANSWER="nvidia/nemotron-3-super-120b-a12b" `
  your-dockerhub-username/tilly:latest

# Test in browser: http://localhost:3000
# CTRL+C to stop

# Push to Docker Hub
docker login
docker push your-dockerhub-username/tilly:latest
```

**Option B: Use Nebius Container Registry**

```powershell
# Authenticate
nebius container registry login

# Build and tag
docker build -t cr.nebius.com/your-registry/tilly:latest .

# Push
docker push cr.nebius.com/your-registry/tilly:latest
```

### 5. Create Nebius Serverless Endpoint

**Method 1: Via Nebius Console (Easiest)**

1. Go to https://console.nebius.com/
2. Navigate to **Serverless → Endpoints**
3. Click **Create Endpoint**
4. Configure:
   - **Name**: `tilly-production`
   - **Platform**: CPU
   - **Visibility**: Public
   - **Container Image**: Your image from step 4
   - **Container Port**: `3000`
   - **Environment Variables**:
     ```
     DATABASE_URL=postgresql://your-neon-connection-string
     NEBIUS_API_KEY=your-token-factory-key
     NEBIUS_MODEL_EXTRACTION=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
     NEBIUS_MODEL_ANSWER=nvidia/nemotron-3-super-120b-a12b
     NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
     MODEL_DAILY_LIMIT=3000
     NODE_ENV=production
     ```
   - **Health Check Path**: `/api/health`
   - **Memory**: 512MB-1GB
   - **CPU**: 0.5-1 vCPU

5. Click **Create**
6. Wait for endpoint to become "Running"
7. Copy the public URL (will be like `https://xxxx.nebius-endpoint.com`)

**Method 2: Via Nebius CLI**

```powershell
# Create endpoint
nebius serverless endpoint create `
  --name tilly-production `
  --container-image your-dockerhub-username/tilly:latest `
  --container-port 3000 `
  --platform cpu `
  --public `
  --env DATABASE_URL="postgresql://..." `
  --env NEBIUS_API_KEY="your-key" `
  --env NEBIUS_MODEL_EXTRACTION="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" `
  --env NEBIUS_MODEL_ANSWER="nvidia/nemotron-3-super-120b-a12b" `
  --env NEBIUS_BASE_URL="https://api.tokenfactory.nebius.com/v1/" `
  --env MODEL_DAILY_LIMIT="3000" `
  --health-check-path /api/health

# Get endpoint URL
nebius serverless endpoint get tilly-production
```

### 6. Test Production Deployment

Open the endpoint URL in an **incognito/private browser window**:

1. ✅ Page loads
2. ✅ Click "Try a sample farm"
3. ✅ Type: "I weeded the north field today"
4. ✅ See recorded receipt with Undo button
5. ✅ Click Undo - record disappears
6. ✅ Ask: "What did I do this week?"
7. ✅ See answer with cited records
8. ✅ Open menu → My records (drawer opens)
9. ✅ Voice input works (Chrome/Edge only)

### 7. Deploy Reminder Job (Optional but Recommended)

**Nebius Serverless Job Configuration:**

```yaml
Name: tilly-reminder-job
Runtime: Node.js
Entry Command: npm run reminder-job
Environment Variables:
  DATABASE_URL: <same as endpoint>
Schedule: 0 * * * *  # Every hour
Timeout: 5 minutes
Memory: 512MB
```

Or use the same Docker image:
```powershell
nebius serverless job create `
  --name tilly-reminder-job `
  --container-image your-dockerhub-username/tilly:latest `
  --command "npm run reminder-job" `
  --schedule "0 * * * *" `
  --env DATABASE_URL="postgresql://..." `
  --timeout 300
```

### 8. Update README

```powershell
# Open README.md and replace this line:
# **Live demo:** _coming soon_

# With your actual URL:
**Live demo:** https://your-endpoint.nebius-endpoint.com
```

Commit and push:
```powershell
git add README.md
git commit -m "Add live demo URL"
git push origin main
```

## Alternative: Quick Deploy to Other Platforms

If Nebius is blocked, you can deploy to:

### Render.com (Free tier, fast)
1. Go to https://render.com
2. New → Web Service
3. Connect GitHub repo
4. Configure:
   - **Build**: `npm run build`
   - **Start**: `npm start`
   - Add all environment variables
5. Get URL in ~5 minutes

### Railway.app (Free $5 credit)
1. Go to https://railway.app
2. New Project → Deploy from GitHub
3. Add environment variables
4. Get URL immediately

### Fly.io
```powershell
flyctl launch --name tilly
flyctl deploy
```

## Troubleshooting

### Endpoint shows 503
- Check logs: `nebius serverless endpoint logs tilly-production`
- Verify DATABASE_URL is accessible from endpoint
- Check `/api/health` directly

### Database connection fails
- Whitelist Nebius IP ranges in Neon/database firewall
- Verify connection string has `?sslmode=require`

### Rate limits too aggressive
- Increase MODEL_DAILY_LIMIT environment variable
- Restart endpoint after changes

### Image too large
```powershell
# Check size
docker images | grep tilly

# Should be ~200-300MB
# If larger, verify .dockerignore excludes node_modules, tests, .git
```

## Cost Estimates

**Neon PostgreSQL**: Free tier (0.5GB, 10M rows)  
**Nebius Endpoint**: ~$0.05-0.10/hour for CPU 0.5 vCPU, 512MB  
**Nebius Reminder Job**: ~$0.01/run (hourly = ~$7/month)

**Total for hackathon**: ~$20-30 until Dec 15, 2026

## Emergency Fallback

If deployment fails completely, you can:
1. Record a video using `npm run dev` locally
2. Explain in submission that deployment was attempted but blocked
3. Provide Docker image and full deployment instructions
4. Include screenshots of local running app

But **try deployment first** - judges want a live URL!
