#!/usr/bin/env bash
# Delete everything Terraform created (EC2, Elastic IP, ECR repo + images, IAM role, VPC).
# Shows the destroy plan first and only applies that exact plan after you type "yes".
set -euo pipefail
cd "$(dirname "$0")/infra"

terraform plan -destroy -input=false -out=destroy.tfplan
read -rp "Destroy all of the above? Type 'yes': " answer
[[ $answer == yes ]] || { echo "Aborted."; rm -f destroy.tfplan; exit 1; }
terraform apply -input=false destroy.tfplan
rm -f destroy.tfplan
