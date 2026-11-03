#!/usr/bin/env bash
# Build the image, push it to ECR, and tell the EC2 instance to pull and restart.
set -euo pipefail
cd "$(dirname "$0")"

tf() { terraform -chdir=infra output -raw "$1"; }
REPO=$(tf ecr_repository_url)
REGION=$(tf region)
INSTANCE=$(tf instance_id)

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${REPO%%/*}"
# t3.micro is x86; build for it even on Apple Silicon.
# No provenance attestation: it adds 2 extra ECR entries per push and eats into the keep-3 lifecycle rule
docker buildx build --platform linux/amd64 --provenance=false -t "$REPO:latest" --push .

# Wait for first-boot cloud-init to finish, else deploy-app may not exist yet (see README: problems)
CMD_ID=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["cloud-init status --wait > /dev/null; /usr/local/bin/deploy-app"]' \
  --query Command.CommandId --output text)
aws ssm wait command-executed --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE" ||
  { aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE" \
      --query StandardErrorContent --output text; exit 1; }

echo "Deployed. Check: $(tf url)/health"
