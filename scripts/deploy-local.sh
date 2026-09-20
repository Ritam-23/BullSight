#!/usr/bin/env bash
# Build the images, load them into a local cluster, and apply the local overlay.
# Supports kind (default) or minikube. Usage:  ./scripts/deploy-local.sh [kind|minikube]
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER_TOOL="${1:-kind}"
API_IMG="bullsight-api:latest"
WEB_IMG="bullsight-web:latest"

echo "==> Ensuring secret manifests exist"
[ -f k8s/base/api-secret.yaml ] || {
  cp k8s/base/api-secret.example.yaml k8s/base/api-secret.yaml
  SECRET="$(python -c 'import secrets;print(secrets.token_urlsafe(48))' 2>/dev/null || openssl rand -base64 48)"
  # Fill the generated session secret (portable sed).
  sed -i.bak "s|REPLACE_WITH_LONG_RANDOM_STRING|${SECRET}|" k8s/base/api-secret.yaml && rm -f k8s/base/api-secret.yaml.bak
  echo "    created k8s/base/api-secret.yaml with a generated SESSION_SECRET"
}
[ -f k8s/base/web-secret.yaml ] || {
  cp k8s/base/web-secret.example.yaml k8s/base/web-secret.yaml
  echo "    created k8s/base/web-secret.yaml (edit it to enable receipt email)"
}

echo "==> Building images"
docker build -t "$API_IMG" ./backend
docker build -t "$WEB_IMG" ./frontend

echo "==> Loading images into $CLUSTER_TOOL"
case "$CLUSTER_TOOL" in
  kind)     kind load docker-image "$API_IMG" "$WEB_IMG" ;;
  minikube) minikube image load "$API_IMG"; minikube image load "$WEB_IMG" ;;
  *) echo "Unknown cluster tool: $CLUSTER_TOOL (use kind or minikube)"; exit 1 ;;
esac

echo "==> Applying manifests (local overlay)"
kubectl apply -k k8s/overlays/local

echo "==> Waiting for rollouts"
kubectl -n bullsight rollout status deploy/api  --timeout=180s
kubectl -n bullsight rollout status deploy/web  --timeout=180s

echo
echo "Done. Reach the app:"
echo "  kubectl -n bullsight port-forward svc/web 3000:80   # then open http://localhost:3000"
if [ "$CLUSTER_TOOL" = "minikube" ]; then
  echo "  # or:  minikube service web -n bullsight"
fi
