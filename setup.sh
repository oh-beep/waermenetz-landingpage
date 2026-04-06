#!/bin/bash
set -e

echo "=== Waermenetz Setup ==="

# 1. Web-Verzeichnis
mkdir -p /var/www/waermenetz.hhb-agrarenergie.de/assets
chown -R deploy:deploy /var/www/waermenetz.hhb-agrarenergie.de
echo "[1/5] Verzeichnis OK"

# 2. Dateien von GitHub
cd /tmp && rm -rf waermenetz-landingpage
git clone https://github.com/oh-beep/waermenetz-landingpage.git
cp waermenetz-landingpage/index.html waermenetz-landingpage/datenschutz.html /var/www/waermenetz.hhb-agrarenergie.de/
cp waermenetz-landingpage/assets/* /var/www/waermenetz.hhb-agrarenergie.de/assets/
rm -rf /tmp/waermenetz-landingpage
echo "[2/5] Dateien OK"

# 3. SSH-Key
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILtH8w27k+WKV1BakrTPhMgXXUEtglrB61lN5Fh3p3gB oliver@mac-mini" >> /root/.ssh/authorized_keys
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILtH8w27k+WKV1BakrTPhMgXXUEtglrB61lN5Fh3p3gB oliver@mac-mini" >> /home/deploy/.ssh/authorized_keys
echo "[3/5] SSH-Key OK"

# 4. nginx
cat > /etc/nginx/sites-available/waermenetz.hhb-agrarenergie.de << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name waermenetz.hhb-agrarenergie.de;
    root /var/www/waermenetz.hhb-agrarenergie.de;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location ~* \.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/waermenetz.hhb-agrarenergie.de /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
echo "[4/5] nginx OK"

# 5. SSL
certbot --nginx -d waermenetz.hhb-agrarenergie.de --non-interactive --agree-tos --email info@hhb-agrarenergie.de || echo "[5/5] SSL kommt spaeter"

echo ""
echo "=== FERTIG ==="
echo "https://waermenetz.hhb-agrarenergie.de"
