# BuildCheck v3 — Deploy to AWS EC2

Assumes an existing Ubuntu EC2 instance with Docker + `docker compose` v2 installed (your BuildCheck v1 host qualifies).

## 1. Get the code onto the box

Either `git push` this repo and `git clone` on the box, or rsync:

```bash
# from your Windows machine (Git Bash / WSL):
rsync -avz --exclude node_modules --exclude dist --exclude test-files --exclude .env \
  ./buildcheck-v3/ ubuntu@YOUR_EC2_HOST:/home/ubuntu/buildcheck-v3/
```

## 2. Fill the env file (on the EC2 box)

```bash
cd /home/ubuntu/buildcheck-v3
cp .env.production.example .env
nano .env
# set: ANTHROPIC_API_KEY, JWT_SECRET (64+ random chars), POSTGRES_PASSWORD
```

## 3. Deploy

```bash
./scripts/deploy.sh
```

This builds the server + client images (server image bundles Python + ezdxf + poppler), starts Postgres with healthcheck, runs `prisma migrate deploy` on boot, and serves the client on `HTTP_PORT` (default 8080).

## 4. Put it behind your existing Nginx

Your v1 Nginx already handles TLS. Add a new server block (or route) that proxies to the v3 client container. Example:

```nginx
server {
  listen 443 ssl http2;
  server_name buildcheck-v3.your-domain.com;
  # ssl_certificate … (reuse v1's cert or get a new one via certbot)

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 120m;
    proxy_read_timeout 600s;
  }
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`.

If you'd rather skip TLS and test over HTTP, just open port 8080 in the EC2 security group and hit `http://EC2_PUBLIC_IP:8080`.

## 5. Verify

```bash
# Health
curl http://localhost:8080/api/health

# Container status + logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f server
```

Register the first user via the UI — that user becomes the admin of a new company.

## Updates

```bash
git pull
./scripts/deploy.sh   # rebuilds changed images and restarts
```

## Data persistence

- Postgres → named volume `buildcheck-v3-pgdata`
- Uploaded DXF/PDF → named volume `buildcheck-v3-uploads`

Backup with `docker run --rm -v buildcheck-v3-pgdata:/data -v $PWD:/backup busybox tar czf /backup/pg-$(date +%F).tgz /data`.

## Rollback

```bash
docker compose -f docker-compose.prod.yml down
git checkout <previous-sha>
./scripts/deploy.sh
```

## Known caveats

- The Python viewport extractor has **not** been tested against a real DXF in this build. If the classifier misfires on your permit files, tune `classify_viewport()` in `server/python/dxf_viewport_extractor.py` — the rest of the pipeline consumes whatever it emits.
- PDF OCR fallback uses Claude Vision (costs per page). For scanned תב"ע docs expect a few dollars per analysis. Cached per `TavaFile.extractedText` so re-runs are free.
- v1 at `/home/ubuntu/buildcheck-ai` is untouched; choose different ports / different Nginx server_name so they don't collide.
