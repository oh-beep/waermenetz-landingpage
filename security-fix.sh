#!/bin/bash
set -e

echo "========================================="
echo "SECURITY FIX — hof-holtermann Server"
echo "========================================="
echo ""

# 1. FIREWALL (UFW)
echo "[1/4] Firewall einrichten..."
apt-get install -y ufw > /dev/null 2>&1 || true
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
echo "y" | ufw enable
ufw status
echo "[1/4] Firewall OK — nur SSH, HTTP, HTTPS offen"
echo ""

# 2. NGINX SECURITY HEADERS + VERSION VERSTECKEN
echo "[2/4] nginx Security Headers..."

# Version verstecken
if ! grep -q "server_tokens off" /etc/nginx/nginx.conf; then
    sed -i '/http {/a \\tserver_tokens off;' /etc/nginx/nginx.conf
fi

# Security Headers als Snippet erstellen
cat > /etc/nginx/snippets/security-headers.conf << 'HEADERS'
# HSTS — erzwingt HTTPS fuer 1 Jahr
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Clickjacking-Schutz
add_header X-Frame-Options "SAMEORIGIN" always;

# MIME-Sniffing verhindern
add_header X-Content-Type-Options "nosniff" always;

# Referrer einschraenken
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Permissions Policy
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

# XSS-Schutz (Legacy-Browser)
add_header X-XSS-Protection "1; mode=block" always;
HEADERS

# Security Headers in alle aktiven nginx-Sites einbinden
for site in /etc/nginx/sites-available/*; do
    if [ -f "$site" ] && ! grep -q "security-headers" "$site"; then
        sed -i '/server_name/a \\n    # Security Headers\n    include snippets/security-headers.conf;' "$site"
    fi
done

# Snippets-Verzeichnis sicherstellen
mkdir -p /etc/nginx/snippets

nginx -t && systemctl reload nginx
echo "[2/4] Security Headers OK"
echo ""

# 3. SSH HAERTEN
echo "[3/4] SSH haerten..."
# Passwort-Login deaktivieren (nur Key-Auth)
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
# Root-Login nur mit Key
sed -i 's/#PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload sshd
echo "[3/4] SSH gehaertet — nur Key-Auth, kein Passwort"
echo ""

# 4. FAIL2BAN (Brute-Force-Schutz)
echo "[4/4] Fail2Ban installieren..."
apt-get install -y fail2ban > /dev/null 2>&1 || true
cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3

[nginx-http-auth]
enabled = true
F2B
systemctl enable fail2ban
systemctl restart fail2ban
echo "[4/4] Fail2Ban OK — sperrt IPs nach 3 Fehlversuchen"
echo ""

echo "========================================="
echo "SECURITY FIX ABGESCHLOSSEN"
echo ""
echo "Firewall:  nur 22, 80, 443 offen"
echo "Headers:   HSTS, X-Frame, X-Content-Type, Referrer"
echo "nginx:     Version versteckt"
echo "SSH:       nur Key-Auth, kein Passwort"
echo "Fail2Ban:  Brute-Force-Schutz aktiv"
echo "========================================="
