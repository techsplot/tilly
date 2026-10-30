# Tilly Quick Deploy Script
# Run this after setting your credentials below

param(
    [Parameter(Mandatory=$false)]
    [string]$DockerUsername = "your-dockerhub-username",
    
    [Parameter(Mandatory=$false)]
    [string]$DatabaseUrl = "",
    
    [Parameter(Mandatory=$false)]
    [string]$NebiusApiKey = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild = $false,
    
    [Parameter(Mandatory=$false)]
    [switch]$LocalTest = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=== Tilly Deployment Script ===" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Write-Host "ERROR: Docker not found. Please install Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Docker found" -ForegroundColor Green

# Validate inputs
if ($DockerUsername -eq "your-dockerhub-username") {
    Write-Host "ERROR: Please edit deploy.ps1 and set your DockerUsername" -ForegroundColor Red
    Write-Host "Or run: .\deploy.ps1 -DockerUsername 'yourname'" -ForegroundColor Yellow
    exit 1
}

if (-not $DatabaseUrl) {
    $DatabaseUrl = $env:DATABASE_URL
    if (-not $DatabaseUrl) {
        Write-Host "ERROR: DATABASE_URL not set" -ForegroundColor Red
        Write-Host "Set it with: `$env:DATABASE_URL = 'postgresql://...'" -ForegroundColor Yellow
        exit 1
    }
}

if (-not $NebiusApiKey) {
    $NebiusApiKey = $env:NEBIUS_API_KEY
    if (-not $NebiusApiKey) {
        Write-Host "ERROR: NEBIUS_API_KEY not set" -ForegroundColor Red
        Write-Host "Set it with: `$env:NEBIUS_API_KEY = 'your-key'" -ForegroundColor Yellow
        exit 1
    }
}

$ImageName = "$DockerUsername/tilly:latest"

# Step 1: Merge phase-11 if needed
Write-Host ""
Write-Host "Step 1: Checking git branch..." -ForegroundColor Yellow
$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -eq "phase-11") {
    Write-Host "You're on phase-11. Merge to main first:" -ForegroundColor Yellow
    Write-Host "  git checkout main" -ForegroundColor Cyan
    Write-Host "  git merge phase-11" -ForegroundColor Cyan
    Write-Host "  git push origin main" -ForegroundColor Cyan
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y") {
        exit 0
    }
}
Write-Host "✓ On branch: $currentBranch" -ForegroundColor Green

# Step 2: Run migrations
Write-Host ""
Write-Host "Step 2: Running database migrations..." -ForegroundColor Yellow
$env:DATABASE_URL = $DatabaseUrl
npm run db:migrate
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Migration failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Migrations complete" -ForegroundColor Green

# Step 3: Build Docker image
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "Step 3: Building Docker image..." -ForegroundColor Yellow
    docker build -t $ImageName .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker build failed" -ForegroundColor Red
        exit 1
    }
    
    $imageSize = docker images $ImageName --format "{{.Size}}"
    Write-Host "✓ Image built: $ImageName ($imageSize)" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Step 3: Skipping build (using existing image)" -ForegroundColor Yellow
}

# Step 4: Local test or push
if ($LocalTest) {
    Write-Host ""
    Write-Host "Step 4: Testing locally..." -ForegroundColor Yellow
    Write-Host "Starting container on http://localhost:3000" -ForegroundColor Cyan
    Write-Host "Press CTRL+C to stop" -ForegroundColor Cyan
    Write-Host ""
    
    docker run -p 3000:3000 `
        -e DATABASE_URL="$DatabaseUrl" `
        -e NEBIUS_API_KEY="$NebiusApiKey" `
        -e NEBIUS_MODEL_EXTRACTION="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" `
        -e NEBIUS_MODEL_ANSWER="nvidia/nemotron-3-super-120b-a12b" `
        -e NEBIUS_BASE_URL="https://api.tokenfactory.nebius.com/v1/" `
        -e MODEL_DAILY_LIMIT="3000" `
        $ImageName
} else {
    Write-Host ""
    Write-Host "Step 4: Pushing to Docker Hub..." -ForegroundColor Yellow
    docker push $ImageName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker push failed. Run 'docker login' first" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Image pushed: $ImageName" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "=== Next Steps ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Go to Nebius Console: https://console.nebius.com/" -ForegroundColor White
    Write-Host "2. Create Serverless Endpoint with:" -ForegroundColor White
    Write-Host "   - Image: $ImageName" -ForegroundColor Yellow
    Write-Host "   - Port: 3000" -ForegroundColor Yellow
    Write-Host "   - Platform: CPU" -ForegroundColor Yellow
    Write-Host "   - Visibility: Public" -ForegroundColor Yellow
    Write-Host "   - Health check: /api/health" -ForegroundColor Yellow
    Write-Host "   - Environment variables:" -ForegroundColor Yellow
    Write-Host "     DATABASE_URL=$DatabaseUrl" -ForegroundColor Gray
    Write-Host "     NEBIUS_API_KEY=$NebiusApiKey" -ForegroundColor Gray
    Write-Host "     NEBIUS_MODEL_EXTRACTION=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" -ForegroundColor Gray
    Write-Host "     NEBIUS_MODEL_ANSWER=nvidia/nemotron-3-super-120b-a12b" -ForegroundColor Gray
    Write-Host "     NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/" -ForegroundColor Gray
    Write-Host "     MODEL_DAILY_LIMIT=3000" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Test endpoint URL in private browser" -ForegroundColor White
    Write-Host "4. Update README.md with live URL" -ForegroundColor White
    Write-Host ""
}

Write-Host ""
Write-Host "=== Deployment Complete ===" -ForegroundColor Green
