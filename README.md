# Workspace — FastAPI Deployment Guide

## Architecture

```
[Cloudflare Pages]  ──HTTPS──►  [Ubuntu Server :3001]
   frontend/                       backend/
   index.html                      main.py          ← FastAPI app
   css/style.css                   config.py        ← settings
   js/api.js                       routes/
   js/notebook.js                    auth.py
   js/tasks.js                       notebooks.py
   js/app.js                         tasks.py
                                   middleware/
                                     auth.py        ← JWT
                                   storage/
                                     disk.py        ← file I/O
                                   /var/workspace-data/users/
                                     {username}/
                                       auth.json
                                       notebooks/
                                       tasks/
```

---

## 1. Ubuntu Server — Backend Setup

### Install Python 3.11+
```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip
```

### Copy backend files to server
```bash
sudo mkdir -p /opt/workspace-backend
sudo cp -r backend/* /opt/workspace-backend/
cd /opt/workspace-backend
```

### Create virtual environment and install dependencies
```bash
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Create data directory
```bash
sudo mkdir -p /var/workspace-data/users
sudo chown -R www-data:www-data /var/workspace-data
```

### Configure environment
```bash
sudo cp .env.example .env
sudo nano .env
```

Fill in values:
```
PORT=3001
FRONTEND_URL=https://your-app.pages.dev
JWT_SECRET=<generate below>
DATA_ROOT=/var/workspace-data
```

Generate a strong JWT secret:
```bash
python3 -c "import secrets; print(secrets.token_hex(48))"
```

### Test it manually first
```bash
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 3001
# Visit http://YOUR_SERVER_IP:3001/api/docs to see Swagger UI
```

### Install as systemd service
```bash
sudo cp /path/to/workspace.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable workspace
sudo systemctl start workspace
sudo systemctl status workspace
```

---

## 2. Open Firewall Port

```bash
sudo ufw allow 3001/tcp
sudo ufw reload
```

### Recommended: Nginx + HTTPS (Let's Encrypt)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/workspace`:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 300;
        client_max_body_size 25M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/workspace /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com
```

---

## 3. Frontend — Set API URL

Edit `frontend/index.html`, find this line and update it:
```html
<script>window.WS_API_URL = 'http://YOUR_SERVER_IP:3001/api';</script>
```
→ change to your server IP or domain:
```html
<script>window.WS_API_URL = 'https://api.yourdomain.com/api';</script>
```

---

## 4. Deploy Frontend to Cloudflare Pages

**Option A — Drag & Drop (quickest)**
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create
2. Choose "Pages" → "Upload assets"
3. Drag the `frontend/` folder in
4. You get a `your-project.pages.dev` URL instantly

**Option B — Git (best for updates)**
```bash
cd frontend/
git init && git add . && git commit -m "initial"
# push to GitHub, then connect repo in Cloudflare Pages dashboard
```

---

## 5. Update CORS on Server

After you have your Pages URL, update `.env`:
```
FRONTEND_URL=https://your-actual-app.pages.dev
```
Then: `sudo systemctl restart workspace`

---

## API Reference

FastAPI auto-generates interactive docs at:
```
http://YOUR_SERVER_IP:3001/api/docs       ← Swagger UI
http://YOUR_SERVER_IP:3001/api/redoc      ← ReDoc
```

### Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/signup | — | Create account |
| POST | /api/auth/signin | — | Sign in, get JWT |
| POST | /api/auth/change-password | Bearer | Change password |
| GET | /api/notebooks/ | Bearer | List notebooks |
| POST | /api/notebooks/ | Bearer | Create notebook |
| PUT | /api/notebooks/{id} | Bearer | Rename notebook |
| DELETE | /api/notebooks/{id} | Bearer | Delete notebook |
| GET | /api/notebooks/{id}/content | Bearer | Get HTML content |
| PUT | /api/notebooks/{id}/content | Bearer | Save HTML content |
| POST | /api/notebooks/{id}/images | Bearer | Upload image (base64) |
| GET | /api/notebooks/{id}/images/{file} | ?token= | Serve image |
| DELETE | /api/notebooks/{id}/images/{file} | Bearer | Delete image |
| GET | /api/tasks/ | Bearer | List tasks |
| POST | /api/tasks/ | Bearer | Add task |
| PUT | /api/tasks/{id} | Bearer | Update task |
| DELETE | /api/tasks/{id} | Bearer | Delete task |

---

## Logs & Maintenance

```bash
# Live logs
sudo journalctl -u workspace -f

# Restart after code changes
sudo systemctl restart workspace

# Update backend dependencies
cd /opt/workspace-backend
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart workspace
```

## Data Location
```
/var/workspace-data/users/
  alice/
    auth.json              ← SHA-256 hashed password
    notebooks/
      index.json           ← list of notebooks
      {uuid}/
        content.html
        images/
          img_xxx.png
    tasks/
      tasks.json
  bob/
    ...
```
