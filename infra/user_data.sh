#!/bin/bash
# Runs once on first boot (cloud-init). Logs: /var/log/cloud-init-output.log
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker

# deploy.sh calls this script over SSM on every redeploy
cat > /usr/local/bin/deploy-app <<'EOF'
#!/bin/bash
set -euo pipefail
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}
docker pull ${image}
# dev-note: stop-then-start = a few seconds of downtime; blue/green behind an ALB if that matters
docker rm -f app 2>/dev/null || true
docker run -d --name app --restart unless-stopped -p 80:8000 -v app-data:/data ${image}
docker image prune -f
EOF
chmod +x /usr/local/bin/deploy-app

# The first image may not be pushed yet when the instance boots, so keep retrying
until /usr/local/bin/deploy-app; do sleep 20; done
