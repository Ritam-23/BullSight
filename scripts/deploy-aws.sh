#!/usr/bin/env bash
# Build, push to ECR, and deploy to EKS (aws overlay).
# Prereqs (see DEPLOY.md): aws CLI logged in, kubectl pointed at your EKS cluster, the AWS Load
# Balancer Controller + EBS CSI driver installed, and Docker running.
#
# Usage:
#   AWS_REGION=ap-south-1 ./scripts/deploy-aws.sh [tag]
# Env vars:
#   AWS_REGION   (required)  e.g. ap-south-1
#   TAG          (optional)  image tag; defaults to the arg, then git sha, then "latest"
set -euo pipefail
cd "$(dirname "$0")/.."

: "${AWS_REGION:?Set AWS_REGION (e.g. ap-south-1)}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
TAG="${1:-${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}}"
API_REPO="bullsight-api"
WEB_REPO="bullsight-web"

echo "==> Account $ACCOUNT_ID  Region $AWS_REGION  Tag $TAG"

echo "==> Ensuring ECR repositories exist"
for repo in "$API_REPO" "$WEB_REPO"; do
  aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$repo" --region "$AWS_REGION" >/dev/null
done

echo "==> Logging Docker in to ECR"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Building + pushing images (linux/amd64 for EKS nodes)"
docker build --platform linux/amd64 -t "$REGISTRY/$API_REPO:$TAG" ./backend
docker build --platform linux/amd64 -t "$REGISTRY/$WEB_REPO:$TAG" ./frontend
docker push "$REGISTRY/$API_REPO:$TAG"
docker push "$REGISTRY/$WEB_REPO:$TAG"

echo "==> Ensuring secret manifests exist"
[ -f k8s/base/api-secret.yaml ] || { cp k8s/base/api-secret.example.yaml k8s/base/api-secret.yaml; echo "    EDIT k8s/base/api-secret.yaml (set SESSION_SECRET) then re-run"; exit 1; }
[ -f k8s/base/web-secret.yaml ] || { cp k8s/base/web-secret.example.yaml k8s/base/web-secret.yaml; echo "    created k8s/base/web-secret.yaml (edit to enable receipt email)"; }

echo "==> Pointing the aws overlay at your ECR images"
( cd k8s/overlays/aws
  kustomize edit set image \
    "bullsight-api=$REGISTRY/$API_REPO:$TAG" \
    "bullsight-web=$REGISTRY/$WEB_REPO:$TAG" )

echo "==> Applying manifests (aws overlay)"
kubectl apply -k k8s/overlays/aws

echo "==> Waiting for rollouts"
kubectl -n bullsight rollout status deploy/api --timeout=300s
kubectl -n bullsight rollout status deploy/web --timeout=300s

echo
echo "==> Ingress (the ALB takes ~2-3 min to provision):"
kubectl -n bullsight get ingress bullsight
echo
echo "Next: copy the ALB ADDRESS above, then set it as FRONTEND_URL so login cookies work —"
echo "  see DEPLOY.md 'Wire up the URL'."
