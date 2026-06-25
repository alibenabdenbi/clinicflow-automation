# Deployment Guide — clinicflowautomation.com

Two deployable pieces exist in this project:

| What | File | Needs Node? | Best host |
|---|---|---|---|
| Credibility landing page | `public/index.html` | No | Netlify, GitHub Pages, Zoho Sites |
| Admin + outreach server | `src/server.js` | Yes (Node 18+) | Railway, Render, VPS |

---

## Option A — Static landing page only (fastest, free, live in 10 minutes)

The landing page (`public/index.html`) is fully self-contained — no backend required.

### Deploy to Netlify (recommended)

1. Go to https://app.netlify.com → **Add new site** → **Deploy manually**
2. Drag and drop the `public/` folder into the upload box
3. Netlify gives you a URL like `https://abc123.netlify.app`
4. Go to **Domain settings** → **Add custom domain** → enter `clinicflowautomation.com`
5. Netlify shows you the DNS records to add (see DNS section below)
6. Done — SSL is automatic

### Deploy to GitHub Pages

1. Push the repo to GitHub (or just the `public/` folder)
2. Go to repo **Settings** → **Pages** → Source: `main` branch, folder: `/public`
3. GitHub gives you `https://yourusername.github.io/repo-name`
4. Add a custom domain in Pages settings → enter `clinicflowautomation.com`
5. Add DNS records (see below)

### Deploy to Zoho Sites

1. Log into Zoho Sites → create a new site
2. Use the HTML widget or custom page option
3. Paste the full contents of `public/index.html` into the HTML editor
4. Publish and connect your `clinicflowautomation.com` domain through Zoho Sites settings

---

## Option B — Full Node.js server (Railway)

Railway is the fastest way to deploy a Node.js app with zero config.

### Steps

1. Push this project to a GitHub repository (private is fine)

2. Go to https://railway.app → **New Project** → **Deploy from GitHub repo**

3. Select this repository — Railway auto-detects Node.js

4. Set environment variables in Railway dashboard (Settings → Variables):
   Copy every key from `.env.example` and fill in the values

5. Railway assigns a URL like `https://ore-engine-production.up.railway.app`

6. Add your custom domain:
   - Railway dashboard → Settings → Domains → Add domain
   - Enter: `clinicflowautomation.com`
   - Railway shows you a CNAME target — add it to your DNS (see below)

7. Railway handles SSL automatically via Let's Encrypt

**Cost:** Free tier includes 500 hours/month (enough for 24/7 on one service). $5/mo for always-on.

**Persistent data note:** Railway's filesystem is ephemeral — `data/*.json` files reset on redeploy. For production, move data files to a mounted volume or use Railway's built-in Postgres. For now (outreach at small scale), redeploys are infrequent enough that this is acceptable.

---

## Option C — Full Node.js server (Render)

1. Go to https://render.com → **New** → **Web Service**
2. Connect GitHub repo
3. Build command: `npm install`
4. Start command: `node src/server.js`
5. Add environment variables (copy from `.env.example`)
6. Render assigns `https://your-app.onrender.com`
7. Go to Settings → Custom Domains → add `clinicflowautomation.com`
8. Add DNS records shown by Render

**Cost:** Free tier spins down after 15 min inactivity (cold start ~30s). $7/mo for always-on.

---

## Option D — Basic VPS (DigitalOcean, Hetzner, Vultr)

### Server setup

```bash
# 1. SSH into your VPS (Ubuntu 22.04)
ssh root@YOUR_SERVER_IP

# 2. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Install PM2 (keeps the app running)
npm install -g pm2

# 4. Clone or upload the project
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /app
cd /app

# 5. Install dependencies
npm install

# 6. Create .env from the example
cp .env.example .env
nano .env   # fill in all values

# 7. Start with PM2
pm2 start src/server.js --name clinicflow
pm2 save
pm2 startup   # follow the printed command to enable auto-restart on reboot

# 8. Install Nginx as reverse proxy
apt-get install -y nginx certbot python3-certbot-nginx

# 9. Nginx config
cat > /etc/nginx/sites-available/clinicflow << 'EOF'
server {
    server_name clinicflowautomation.com www.clinicflowautomation.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -s /etc/nginx/sites-available/clinicflow /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 10. SSL certificate (free via Let's Encrypt)
certbot --nginx -d clinicflowautomation.com -d www.clinicflowautomation.com
```

Point your domain A record to the VPS IP before running certbot.

---

## DNS Records

### For Netlify (static site)

Add these at your domain registrar (Namecheap, GoDaddy, Google Domains, etc.):

| Type | Name | Value |
|------|------|-------|
| `A` | `@` | `75.2.60.5` |
| `CNAME` | `www` | `apex-loadbalancer.netlify.com` |

> Netlify will give you the exact values in their dashboard — use those if different.

### For Railway or Render (Node.js server)

| Type | Name | Value |
|------|------|-------|
| `CNAME` | `@` or `www` | `your-app.up.railway.app` (Railway gives you this) |

> Note: Some registrars don't allow CNAME on the root (`@`). Use an ALIAS or ANAME record instead if available, or point `www` to the CNAME and redirect `@` → `www`.

### For VPS (your own server IP)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| `A` | `@` | `YOUR_VPS_IP` | 300 |
| `A` | `www` | `YOUR_VPS_IP` | 300 |

DNS changes propagate in 5–30 minutes (TTL 300 = 5 min). Use https://dnschecker.org to verify.

---

## Fastest path to live today

**If you just want the credibility page live (10 minutes):**
1. Go to https://app.netlify.com
2. Drag the `public/` folder into the deploy box — done
3. Add custom domain in Netlify → copy their DNS records → paste into your registrar
4. Wait 5–30 min for DNS to propagate

**If you want the full admin server live:**
1. Push repo to GitHub (private)
2. Connect to Railway — 5 minutes
3. Set env vars from `.env.example`
4. Add custom domain in Railway
5. Update DNS at your registrar

Both paths get you HTTPS automatically at no cost.
