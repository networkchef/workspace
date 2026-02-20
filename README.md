# Workspace — Deployment Guide

## Architecture
```
[Cloudflare Pages]  ──HTTPS──►  [Your Ubuntu Server :3001]
   frontend/                        backend/
   index.html                       server.js
   css/style.css                    /data/users/<username>/
   js/api.js                          auth.json
   js/notebook.js                     notebooks/
   js/tasks.js                        tasks/
   js/app.js
```

---

## 1. Ubuntu Server Setup

### Install Node.js 20+
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Copy backend files
```bash
sudo mkdir -p /opt/workspace-backend
sudo cp -r backend/* /opt/workspace-backend/
cd /opt/workspace-backend
sudo npm install --production
```

### Create data directory
```bash
sudo mkdir -p /var/workspace-data/users
sudo chown www-data:www-data /var/workspace-data
```

### Configure environment
```bash
sudo cp /opt/workspace-backend/.env.example /opt/workspace-backend/.env
sudo nano /opt/workspace-backend/.env
```

Fill in:
```
PORT=3001
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
DATA_ROOT=/var/workspace-data
FRONTEND_URL=https://your-app.pages.dev
```

### Install as systemd service
```bash
sudo cp workspace.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable workspace
sudo systemctl start workspace
sudo systemctl status workspace
```

---

## 2. Open Firewall Port
```bash
# Allow port 3001 from anywhere (or restrict to Cloudflare IPs)
sudo ufw allow 3001/tcp
sudo ufw reload
```

Or use Nginx as a reverse proxy (recommended for HTTPS):
```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 3. Frontend — Edit API URL

In `frontend/index.html`, change:
```html
<script>window.WS_API_URL = 'http://YOUR_SERVER_IP:3001/api';</script>
```
to your actual server IP or domain:
```html
<script>window.WS_API_URL = 'https://api.yourdomain.com/api';</script>
```

---

## 4. Deploy Frontend to Cloudflare Pages

### Option A — Drag & Drop
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Pages
2. Create a project → "Upload assets"
3. Drag the `frontend/` folder in
4. Done — you get a `.pages.dev` URL

### Option B — Git (recommended for updates)
```bash
git init frontend/
cd frontend/
git add .
git commit -m "initial"
# Connect to Cloudflare Pages via GitHub/GitLab
```

---

## 5. Update CORS

After you have your Cloudflare Pages URL, update `.env` on the server:
```
FRONTEND_URL=https://your-actual-app.pages.dev
```
Then restart: `sudo systemctl restart workspace`

---

## Data Structure on Disk
```
/var/workspace-data/
  users/
    alice/
      auth.json          ← hashed password + metadata
      notebooks/
        index.json       ← list of notebooks
        <uuid>/
          content.html   ← notebook HTML content
          images/
            img_xxx.png
      tasks/
        tasks.json
    bob/
      ...
```

---

## Logs
```bash
sudo journalctl -u workspace -f
```

## Restart after changes
```bash
sudo systemctl restart workspace
```
