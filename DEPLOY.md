# Deploying BullSight (Docker → Kubernetes → AWS EKS)

BullSight runs as two containers:

| Tier | Image | Port | Exposure | State |
|------|-------|------|----------|-------|
| `web` | `frontend/` (Next.js) | 3000 | **public** | stateless (scales) |
| `api` | `backend/` (FastAPI) | 8000 | internal only | **stateful** — SQLite + files on a volume |

The browser only ever talks to `web`; `web` proxies `/api/*` to `api` over the cluster network.

> **Architecture note.** The backend stores everything (users, wallet, holdings, uploaded
> avatars, cached listings, session secret) in SQLite + local files on a **ReadWriteOnce**
> volume. That's why `api` runs as **exactly one replica** with a `Recreate` strategy — SQLite
> is single-writer and the EBS volume can't be shared. `web` is stateless and scales freely.
> To scale the backend horizontally later, migrate to Postgres (RDS) + S3.

---

## 0. Prerequisites

- Docker running (`docker info` works)
- For Kubernetes: `kubectl` and `kustomize`
- For local K8s: **kind** (`kind`) or **minikube**
- For AWS: `aws` CLI (logged in), `eksctl`, and a running EKS cluster

---

## 1. Local sanity check with Docker Compose (fastest)

```bash
cp .env.compose.example .env       # optionally fill SMTP_* to test receipt email
docker compose up --build
# open http://localhost:3000  (demo login is on)
```

`docker compose down` stops it; the `api-data` volume persists your data. This mirrors the
K8s topology (public web, internal api) so it's the quickest way to confirm the images work.

---

## 2. Local Kubernetes (kind / minikube)

```bash
# kind:
kind create cluster
./scripts/deploy-local.sh kind

# or minikube:
minikube start
./scripts/deploy-local.sh minikube
```

The script builds both images, loads them into the cluster (no registry needed), fills in a
generated `SESSION_SECRET`, and applies `k8s/overlays/local`. Then:

```bash
kubectl -n bullsight port-forward svc/web 3000:80
# open http://localhost:3000
```

To enable the **receipt email** locally, edit `k8s/base/web-secret.yaml` (SMTP_USER / SMTP_PASS)
and re-run the script.

---

## 3. AWS EKS

### 3a. One-time cluster setup

```bash
# 1. Create a cluster (if you don't have one). ~15 min.
eksctl create cluster --name bullsight --region ap-south-1 --nodes 2 --node-type t3.medium

# 2. Associate an IAM OIDC provider (needed by the controllers below).
eksctl utils associate-iam-oidc-provider --cluster bullsight --region ap-south-1 --approve

# 3. EBS CSI driver (for the gp3 data volume) — as a managed add-on.
eksctl create addon --name aws-ebs-csi-driver --cluster bullsight --region ap-south-1 --force

# 4. AWS Load Balancer Controller (for the ALB Ingress). Follow the official install:
#    https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/installation/
#    (creates an IAM policy + service account, then a Helm install). Summary:
eksctl create iamserviceaccount --cluster bullsight --region ap-south-1 \
  --namespace kube-system --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::<ACCOUNT>:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve
helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName=bullsight \
  --set serviceAccount.create=false --set serviceAccount.name=aws-load-balancer-controller
```

Point `kubectl` at the cluster:
```bash
aws eks update-kubeconfig --name bullsight --region ap-south-1
```

### 3b. Set your secret

```bash
cp k8s/base/api-secret.example.yaml k8s/base/api-secret.yaml
# set SESSION_SECRET:  python -c "import secrets;print(secrets.token_urlsafe(48))"
cp k8s/base/web-secret.example.yaml k8s/base/web-secret.yaml   # SMTP for receipt email
```

### 3c. Build, push, deploy

```bash
AWS_REGION=ap-south-1 ./scripts/deploy-aws.sh
```

This creates the ECR repos, pushes `linux/amd64` images, wires the `aws` overlay to them, and
applies everything. The ALB takes ~2-3 minutes to appear:

```bash
kubectl -n bullsight get ingress bullsight -w   # wait for ADDRESS
```

### 3d. Wire up the URL (important — or login breaks)

The backend derives **CORS origin** and the **cookie Secure flag** from `FRONTEND_URL`. Once the
ALB has a DNS name, set it and re-apply:

```bash
ALB=$(kubectl -n bullsight get ingress bullsight -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
cd k8s/overlays/aws
kustomize edit set ... # or edit kustomization.yaml: FRONTEND_URL patch -> "http://$ALB"
cd ../../.. && kubectl apply -k k8s/overlays/aws
kubectl -n bullsight rollout restart deploy/api
```

Open `http://<ALB-DNS>`.

---

## 4. HTTPS, OAuth & a real domain (optional, recommended)

Over plain HTTP the app works with **email/password + demo login**. Google/GitHub OAuth and
`Secure` cookies need HTTPS on a real domain:

1. Register a domain (Route53) and request an ACM certificate for it.
2. Uncomment the HTTPS annotations in `k8s/overlays/aws/ingress.yaml` (add the cert ARN).
3. Point a Route53 record at the ALB.
4. Set `FRONTEND_URL=https://your-domain` (cookies flip to Secure automatically) and re-apply.
5. Add `https://your-domain/api/auth/callback/google` to your Google OAuth redirect URIs, and
   put the client ID/secret in `k8s/base/api-secret.yaml`.

---

## 5. Operations

```bash
kubectl -n bullsight get pods
kubectl -n bullsight logs deploy/api -f
kubectl -n bullsight logs deploy/web -f
kubectl -n bullsight exec -it deploy/api -- sh   # inspect /app/data

# Seed the demo funded account (spyder300405@gmail.com) inside the running api pod:
kubectl -n bullsight exec -it deploy/api -- python seed_demo.py
```

**Teardown:**
```bash
kubectl delete -k k8s/overlays/aws          # app (the gp3 PVC is Retain — see below)
eksctl delete cluster --name bullsight --region ap-south-1
```
> The data StorageClass uses `reclaimPolicy: Retain`, so the EBS volume survives a PVC delete.
> Remove it manually in the EC2 console if you don't want to keep paying for it.

---

## 6. Gotchas baked into this setup

- **Never scale `api` past 1 replica** while it's on SQLite — you'll corrupt or split the DB.
- **Build for `linux/amd64`** (the AWS script does): your Windows Docker builds arm/amd depending
  on host, but EKS nodes here are amd64.
- The backend **re-downloads market listings on first boot** (a background warm-up), so the very
  first dashboard load after a fresh volume is slower. `/api/health` returns OK immediately regardless.
- Secrets (`api-secret.yaml`, `web-secret.yaml`) are **gitignored** — they never get committed.
