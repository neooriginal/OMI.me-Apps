# 🚀 Deployment Guide for OMI Apps

## DigitalOcean App Platform (Recommended)

### Option 1: 1-Click Deploy

Click the deploy button in the README or use this link:
[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/eulicesl/OMI.me-Apps/tree/main)

### Option 2: Manual Setup

1. **Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)**

2. **Click "Create App"**

3. **Choose GitHub** and authorize access to your repository

4. **Select Repository**: `eulicesl/OMI.me-Apps`

5. **DigitalOcean will auto-detect the app configuration** from `.do/app.yaml`

6. **Update Environment Variables**:
   - Replace `YOUR_SUPABASE_URL` with your actual Supabase URL
   - Replace `YOUR_SUPABASE_ANON_KEY` with your Supabase anon key
   - Replace `YOUR_OPENROUTER_API_KEY` with your OpenRouter API key
   - Replace `YOUR_SESSION_SECRET` with a random string

7. **Review and Launch**

## Environment Variables Required

All apps need these environment variables:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
OPENROUTER_API_KEY=your-openrouter-api-key
SESSION_SECRET=any-random-string-for-sessions
```

## Post-Deployment Setup

### 1. Update OMI App Store Webhooks

Once deployed, update your webhook URLs in the OMI App Store:

- **Brain**: `https://your-app.ondigitalocean.app/api/process-text`
- **Friend**: `https://your-app.ondigitalocean.app/friend/webhook`
- **Jarvis**: `https://your-app.ondigitalocean.app/jarvis/webhook`

### 2. Database Setup

Run the `setup-supabase.sql` file in your Supabase SQL editor to create required tables.

### 3. Custom Domain (Optional)

1. Go to App Settings > Domains
2. Add your custom domain
3. Update DNS records as instructed

## Alternative Deployment Options

### Docker Deployment

```bash
# Clone the repository
git clone https://github.com/eulicesl/OMI.me-Apps.git
cd OMI.me-Apps

# Create .env file with your variables
cp docker.env.example .env
# Edit .env with your actual values

# Deploy with Docker Compose
docker-compose up -d
```

### Individual App Deployment

Each app can be deployed separately to any Node.js hosting service:

1. **Heroku**
2. **Railway.app**
3. **Render.com**
4. **Fly.io**
5. **AWS App Runner**
6. **Google Cloud Run**

## Monitoring

After deployment, monitor your apps:

1. **DigitalOcean Dashboard** - View logs, metrics, and alerts
2. **Health Checks** - All apps have health endpoints
3. **Supabase Dashboard** - Monitor database usage

## Scaling

To scale your apps:

1. Go to App Settings > Resources
2. Adjust instance size or count
3. Enable autoscaling if needed

## Cost Estimation

- **Basic (1 instance per app)**: ~$15/month ($5 × 3 apps)
- **Production (2 instances per app)**: ~$30/month
- **High Availability (with load balancing)**: ~$60/month

## Support

For issues or questions:
- Check logs in DigitalOcean dashboard
- Review Supabase logs for database issues
- Open an issue on GitHub