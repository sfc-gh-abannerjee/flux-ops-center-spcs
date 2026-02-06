# Docker Images

Pre-built Docker images are published to GitHub Container Registry on every push to `main`.

**Registry:** `ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs`

---

## Multi-Architecture Support

Images are built **natively** on dedicated runners for each architecture (no slow QEMU emulation):

| Architecture | Platform | Use Case | Build Runner |
|--------------|----------|----------|--------------|
| **amd64** | `linux/amd64` | Snowflake SPCS, Linux servers, Intel Macs | `ubuntu-latest` |
| **arm64** | `linux/arm64` | Apple Silicon (M1/M2/M3/M4), AWS Graviton | `ubuntu-24.04-arm` |

Docker automatically selects the correct architecture when you pull. For cross-platform pulls, use `--platform`.

---

## Available Tags

| Tag | Description | Use Case |
|-----|-------------|----------|
| `main` | Latest build from main branch | Development, demos |
| `sha-xxxxxxx` | Specific commit (first 7 chars) | Reproducible deployments |
| `v1.x.x` | Semantic versioned releases | Production |

---

## Deploy to Snowflake SPCS

Snowflake SPCS runs on **amd64** infrastructure. Follow these steps to deploy:

### Step 1: Pull the Image

```bash
# On Apple Silicon, explicitly request amd64
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# On Intel/AMD machines, this is automatic
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

### Step 2: Get Your Snowflake Registry URL

```sql
-- Run in Snowflake
SHOW IMAGE REPOSITORIES IN SCHEMA FLUX_DB.PUBLIC;
-- Copy the repository_url value
```

### Step 3: Tag and Push to Snowflake

```bash
# Login to Snowflake registry
docker login <org>-<account>.registry.snowflakecomputing.com

# Tag for Snowflake
docker tag ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main \
    <org>-<account>.registry.snowflakecomputing.com/flux_db/public/flux_ops_center_images/flux-ops-center:latest

# Push
docker push <org>-<account>.registry.snowflakecomputing.com/flux_db/public/flux_ops_center_images/flux-ops-center:latest
```

### Step 4: Create the SPCS Service

```sql
CREATE SERVICE FLUX_DB.PUBLIC.FLUX_OPS_CENTER_SERVICE
IN COMPUTE POOL FLUX_OPS_CENTER_POOL
FROM SPECIFICATION $$
spec:
  containers:
  - name: flux-ops-center
    image: /flux_db/public/flux_ops_center_images/flux-ops-center:latest
    env:
      SNOWFLAKE_WAREHOUSE: "FLUX_WH"
  endpoints:
  - name: ui
    port: 8080
    public: true
$$
QUERY_WAREHOUSE = FLUX_WH;
```

---

## Run Locally on Apple Silicon

The arm64 image runs natively on M1/M2/M3/M4 Macs without Rosetta emulation:

```bash
# Pull (auto-selects arm64 on Apple Silicon)
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main

# Run with Snowflake credentials
docker run -p 8080:8080 \
    -e SNOWFLAKE_ACCOUNT=your_account \
    -e SNOWFLAKE_USER=your_user \
    -e SNOWFLAKE_PASSWORD=your_password \
    -e SNOWFLAKE_WAREHOUSE=FLUX_WH \
    -e POSTGRES_HOST=your_postgres_host \
    -e POSTGRES_USER=application \
    -e POSTGRES_PASSWORD=your_pg_password \
    ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

Open http://localhost:8080 in your browser.

### Using Snowflake CLI Connection

If you have a configured Snow CLI connection:

```bash
docker run -p 8080:8080 \
    -v ~/.snowflake:/root/.snowflake:ro \
    -e SNOWFLAKE_CONNECTION_NAME=my_connection \
    ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

---

## Run Locally on Intel/AMD

Same as Apple Silicon, but pulls the amd64 image automatically:

```bash
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
docker run -p 8080:8080 \
    -e SNOWFLAKE_ACCOUNT=your_account \
    -e SNOWFLAKE_USER=your_user \
    -e SNOWFLAKE_PASSWORD=your_password \
    ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SNOWFLAKE_ACCOUNT` | Yes* | Snowflake account identifier |
| `SNOWFLAKE_USER` | Yes* | Snowflake username |
| `SNOWFLAKE_PASSWORD` | Yes* | Snowflake password |
| `SNOWFLAKE_CONNECTION_NAME` | Yes* | Alternative: use Snow CLI connection |
| `SNOWFLAKE_WAREHOUSE` | Yes | Warehouse for queries |
| `POSTGRES_HOST` | For maps | Snowflake Postgres host |
| `POSTGRES_USER` | For maps | Postgres username (default: `application`) |
| `POSTGRES_PASSWORD` | For maps | Postgres password |
| `CORTEX_AGENT_NAME` | For chat | Cortex Agent name |
| `CORTEX_AGENT_DATABASE` | For chat | Database containing agent |
| `CORTEX_AGENT_SCHEMA` | For chat | Schema containing agent |

*Either provide account/user/password OR connection_name

---

## Build Your Own Image

If you need to customize the image:

```bash
# Clone the repository
git clone https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs.git
cd flux-ops-center-spcs

# Build frontend
npm ci && npm run build

# Build Docker image
docker build -t flux-ops-center:custom .

# For SPCS (must be amd64)
docker build --platform linux/amd64 -t flux-ops-center:custom .
```

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/docker-publish.yml`) builds images on every push to `main`:

```
┌─────────────────────┐
│   build-frontend    │  npm ci + npm run build
│   (ubuntu-latest)   │
└──────────┬──────────┘
           │ artifact: dist/
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐
│  amd64  │ │  arm64  │   Native builds (parallel)
│ ubuntu- │ │ ubuntu- │
│ latest  │ │24.04-arm│
└────┬────┘ └────┬────┘
     │           │
     └─────┬─────┘
           ▼
   ┌───────────────┐
   │merge-manifests│   Creates multi-arch manifest
   │ (ubuntu-latest)│
   └───────────────┘
           │
           ▼
   ghcr.io/.../flux-ops-center-spcs:main
   (supports both amd64 and arm64)
```

Build time: ~3-4 minutes (native builds are fast)

---

## Troubleshooting

### "exec format error" on Apple Silicon

You're running an amd64 image on arm64. Pull with the correct platform:

```bash
docker pull ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
# Or explicitly:
docker pull --platform linux/arm64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

### Image won't start in SPCS

SPCS requires amd64. Ensure you pulled with `--platform linux/amd64`:

```bash
docker pull --platform linux/amd64 ghcr.io/sfc-gh-abannerjee/flux-ops-center-spcs:main
```

### "manifest unknown" error

The tag doesn't exist. Check available tags:

```bash
# List tags via GitHub API
curl -s https://api.github.com/users/sfc-gh-abannerjee/packages/container/flux-ops-center-spcs/versions | jq '.[].metadata.container.tags'
```

### Slow image pull

Large images (~1GB). Use a wired connection or wait. Subsequent pulls use cached layers.

---

## See Also

- [Deployment Options](./deployment/) - Full deployment guides
- [Local Development Guide](./LOCAL_DEVELOPMENT_GUIDE.md) - Development without Docker
- [Main README](../README.md) - Project overview
