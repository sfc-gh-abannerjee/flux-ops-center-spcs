#!/bin/bash
# =============================================================================
# Flux Operations Center - Quick Deploy Script
# =============================================================================
# This script automates the deployment of Flux Ops Center to Snowflake SPCS.
#
# Usage:
#   ./scripts/quickstart.sh
#
# Prerequisites:
#   - Docker installed and running
#   - Snowflake CLI (snow) installed, OR manual registry login
#   - Environment variables set (see below)
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# CONFIGURATION - Set these or export as environment variables
# -----------------------------------------------------------------------------
SNOWFLAKE_ACCOUNT="${SNOWFLAKE_ACCOUNT:-}"
SNOWFLAKE_USER="${SNOWFLAKE_USER:-}"
SNOWFLAKE_DATABASE="${SNOWFLAKE_DATABASE:-}"
SNOWFLAKE_SCHEMA="${SNOWFLAKE_SCHEMA:-}"
SNOWFLAKE_WAREHOUSE="${SNOWFLAKE_WAREHOUSE:-}"
SNOWFLAKE_ROLE="${SNOWFLAKE_ROLE:-SYSADMIN}"
COMPUTE_POOL="${COMPUTE_POOL:-}"
IMAGE_REPO="${IMAGE_REPO:-FLUX_OPS_CENTER_REPO}"
SERVICE_NAME="${SERVICE_NAME:-FLUX_OPS_CENTER_SERVICE}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Snowflake Postgres configuration (dual-backend architecture)
POSTGRES_INSTANCE="${POSTGRES_INSTANCE:-FLUX_OPS_POSTGRES}"
POSTGRES_COMPUTE_FAMILY="${POSTGRES_COMPUTE_FAMILY:-HIGHMEM_XL}"
POSTGRES_STORAGE_GB="${POSTGRES_STORAGE_GB:-100}"
POSTGRES_VERSION="${POSTGRES_VERSION:-17}"
SETUP_POSTGRES="${SETUP_POSTGRES:-true}"  # Set to false to skip Postgres setup

# -----------------------------------------------------------------------------
# HELPER FUNCTIONS
# -----------------------------------------------------------------------------

print_header() {
    echo ""
    echo -e "${BLUE}=============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}=============================================================================${NC}"
}

print_step() {
    echo -e "${GREEN}> $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}! $1${NC}"
}

print_error() {
    echo -e "${RED}x $1${NC}"
}

print_success() {
    echo -e "${GREEN}+ $1${NC}"
}

check_required_var() {
    local var_name=$1
    local var_value=${!var_name}
    
    if [ -z "$var_value" ]; then
        print_error "Missing required variable: $var_name"
        return 1
    fi
    return 0
}

# -----------------------------------------------------------------------------
# PRE-FLIGHT CHECKS
# -----------------------------------------------------------------------------

print_header "Flux Operations Center - Quick Deploy"

echo ""
echo "This script will:"
echo "  1. Validate configuration"
echo "  2. Build Docker image (multi-container: frontend + backend)"
echo "  3. Push to Snowflake Image Registry"
echo "  4. Generate deployment SQL"
echo ""

# Check for Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi
print_success "Docker found"

# Check Docker is running
if ! docker info &> /dev/null; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi
print_success "Docker is running"

# -----------------------------------------------------------------------------
# INTERACTIVE CONFIGURATION
# -----------------------------------------------------------------------------

print_header "Configuration"

# Prompt for missing variables
if [ -z "$SNOWFLAKE_ACCOUNT" ]; then
    echo -n "Snowflake Account (org-account format): "
    read SNOWFLAKE_ACCOUNT
fi

if [ -z "$SNOWFLAKE_USER" ]; then
    echo -n "Snowflake Username: "
    read SNOWFLAKE_USER
fi

if [ -z "$SNOWFLAKE_DATABASE" ]; then
    echo -n "Database name: "
    read SNOWFLAKE_DATABASE
fi

if [ -z "$SNOWFLAKE_SCHEMA" ]; then
    echo -n "Schema name: "
    read SNOWFLAKE_SCHEMA
fi

if [ -z "$SNOWFLAKE_WAREHOUSE" ]; then
    echo -n "Warehouse name: "
    read SNOWFLAKE_WAREHOUSE
fi

if [ -z "$COMPUTE_POOL" ]; then
    echo -n "Compute Pool name: "
    read COMPUTE_POOL
fi

# Postgres configuration
if [ "$SETUP_POSTGRES" = "true" ]; then
    echo ""
    print_step "Snowflake Postgres Configuration (Dual-Backend Architecture)"
    echo "  Flux Ops Center uses Snowflake Postgres for real-time operational queries."
    echo "  Press Enter to accept defaults, or enter custom values."
    echo ""
    
    if [ -z "$POSTGRES_INSTANCE" ] || [ "$POSTGRES_INSTANCE" = "FLUX_OPS_POSTGRES" ]; then
        echo -n "Postgres instance name [FLUX_OPS_POSTGRES]: "
        read input
        POSTGRES_INSTANCE="${input:-FLUX_OPS_POSTGRES}"
    fi
    
    echo -n "Postgres compute family (HIGHMEM_XL/HIGHMEM_L/STANDARD_M) [HIGHMEM_XL]: "
    read input
    POSTGRES_COMPUTE_FAMILY="${input:-HIGHMEM_XL}"
    
    echo -n "Postgres storage GB (10-65535) [100]: "
    read input
    POSTGRES_STORAGE_GB="${input:-100}"
    
    echo -n "Postgres version (16/17/18) [17]: "
    read input
    POSTGRES_VERSION="${input:-17}"
fi

# Validate all required variables
print_step "Validating configuration..."
MISSING=0
check_required_var "SNOWFLAKE_ACCOUNT" || MISSING=1
check_required_var "SNOWFLAKE_USER" || MISSING=1
check_required_var "SNOWFLAKE_DATABASE" || MISSING=1
check_required_var "SNOWFLAKE_SCHEMA" || MISSING=1
check_required_var "SNOWFLAKE_WAREHOUSE" || MISSING=1
check_required_var "COMPUTE_POOL" || MISSING=1

if [ $MISSING -eq 1 ]; then
    print_error "Missing required configuration. Exiting."
    exit 1
fi

# Derive registry URL
REGISTRY_URL="${SNOWFLAKE_ACCOUNT}.registry.snowflakecomputing.com"
FULL_IMAGE="${REGISTRY_URL}/${SNOWFLAKE_DATABASE}/${SNOWFLAKE_SCHEMA}/${IMAGE_REPO}/flux_ops_center:${IMAGE_TAG}"

echo ""
print_success "Configuration validated"
echo ""
echo "  Account:      $SNOWFLAKE_ACCOUNT"
echo "  Database:     $SNOWFLAKE_DATABASE"
echo "  Schema:       $SNOWFLAKE_SCHEMA"
echo "  Warehouse:    $SNOWFLAKE_WAREHOUSE"
echo "  Compute Pool: $COMPUTE_POOL"
echo "  Image:        $FULL_IMAGE"
if [ "$SETUP_POSTGRES" = "true" ]; then
echo "  Postgres:     $POSTGRES_INSTANCE ($POSTGRES_COMPUTE_FAMILY, ${POSTGRES_STORAGE_GB}GB, v$POSTGRES_VERSION)"
fi
echo ""

# Confirm
echo -n "Proceed with deployment? (y/N): "
read CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

# -----------------------------------------------------------------------------
# STEP 1: LOGIN TO REGISTRY
# -----------------------------------------------------------------------------

print_header "Step 1: Login to Snowflake Registry"

print_step "Logging in to $REGISTRY_URL..."
echo "Enter your Snowflake password when prompted."

if ! docker login "$REGISTRY_URL" -u "$SNOWFLAKE_USER"; then
    print_error "Failed to login to Snowflake registry"
    print_warning "Make sure your password is correct and the image repository exists"
    exit 1
fi
print_success "Logged in to Snowflake registry"

# -----------------------------------------------------------------------------
# STEP 2: BUILD DOCKER IMAGE
# -----------------------------------------------------------------------------

print_header "Step 2: Build Docker Image"

# Find script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

print_step "Building Docker image from $PROJECT_ROOT..."

cd "$PROJECT_ROOT"

# Use the SPCS-specific Dockerfile if it exists
if [ -f "Dockerfile.spcs" ]; then
    print_step "Using Dockerfile.spcs for SPCS deployment..."
    if ! docker build -t "flux_ops_center:${IMAGE_TAG}" -f Dockerfile.spcs .; then
        print_error "Docker build failed"
        exit 1
    fi
else
    if ! docker build -t "flux_ops_center:${IMAGE_TAG}" .; then
        print_error "Docker build failed"
        exit 1
    fi
fi
print_success "Docker image built successfully"

# -----------------------------------------------------------------------------
# STEP 3: TAG AND PUSH
# -----------------------------------------------------------------------------

print_header "Step 3: Push to Snowflake Registry"

print_step "Tagging image..."
docker tag "flux_ops_center:${IMAGE_TAG}" "$FULL_IMAGE"

print_step "Pushing image to Snowflake..."
if ! docker push "$FULL_IMAGE"; then
    print_error "Failed to push image"
    print_warning "Make sure the image repository exists in Snowflake:"
    echo "  CREATE IMAGE REPOSITORY IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${IMAGE_REPO};"
    exit 1
fi
print_success "Image pushed successfully"

# -----------------------------------------------------------------------------
# STEP 4: GENERATE DEPLOYMENT SQL
# -----------------------------------------------------------------------------

print_header "Step 4: Deployment SQL"

SQL_FILE="$PROJECT_ROOT/deploy_generated.sql"

cat > "$SQL_FILE" << EOF
-- =============================================================================
-- Flux Operations Center - Auto-Generated Deployment SQL
-- Generated: $(date)
-- =============================================================================
-- This SQL deploys Flux Ops Center as an SPCS service with:
--   - React frontend (MapLibre GL grid visualization)
--   - FastAPI backend (GNN risk prediction, cascade analysis)
--   - Dual-backend: Snowflake analytics + Postgres real-time spatial
-- =============================================================================

-- Use your database and schema
USE DATABASE ${SNOWFLAKE_DATABASE};
USE SCHEMA ${SNOWFLAKE_SCHEMA};
USE WAREHOUSE ${SNOWFLAKE_WAREHOUSE};

-- Create image repository (if not exists)
CREATE IMAGE REPOSITORY IF NOT EXISTS ${IMAGE_REPO}
    COMMENT = 'Image repository for Flux Operations Center';

-- Create SPCS Service
CREATE SERVICE IF NOT EXISTS ${SERVICE_NAME}
    IN COMPUTE POOL ${COMPUTE_POOL}
    FROM SPECIFICATION \$\$
spec:
  containers:
    - name: flux-ops-center
      image: /${SNOWFLAKE_DATABASE}/${SNOWFLAKE_SCHEMA}/${IMAGE_REPO}/flux_ops_center:${IMAGE_TAG}
      env:
        # Snowflake configuration
        SNOWFLAKE_DATABASE: ${SNOWFLAKE_DATABASE}
        SNOWFLAKE_SCHEMA: ${SNOWFLAKE_SCHEMA}
        SNOWFLAKE_WAREHOUSE: ${SNOWFLAKE_WAREHOUSE}
        SNOWFLAKE_ROLE: ${SNOWFLAKE_ROLE}
        APPLICATIONS_SCHEMA: APPLICATIONS
        ML_SCHEMA: ML_DEMO
        CASCADE_SCHEMA: CASCADE_ANALYSIS
        # Postgres configuration (dual-backend architecture)
        # NOTE: Update VITE_POSTGRES_HOST after running postgres_setup_generated.sql
        VITE_POSTGRES_HOST: \${POSTGRES_HOST:-UPDATE_AFTER_POSTGRES_SETUP}
        VITE_POSTGRES_PORT: "5432"
        VITE_POSTGRES_DATABASE: postgres
      resources:
        requests:
          cpu: 2
          memory: 4Gi
        limits:
          cpu: 4
          memory: 8Gi
  endpoints:
    - name: app
      port: 8080
      public: true
    - name: api
      port: 8000
      public: true
\$\$
    COMMENT = 'Flux Operations Center - Real-time Grid Visualization & GNN Risk Prediction';

-- Check service status
SELECT SYSTEM\$GET_SERVICE_STATUS('${SERVICE_NAME}');

-- Get service URL
SHOW ENDPOINTS IN SERVICE ${SERVICE_NAME};
EOF

# Generate Postgres setup SQL if enabled
if [ "$SETUP_POSTGRES" = "true" ]; then
    POSTGRES_SQL_FILE="$PROJECT_ROOT/postgres_setup_generated.sql"
    
    cat > "$POSTGRES_SQL_FILE" << EOF
-- =============================================================================
-- Flux Operations Center - Snowflake Postgres Setup (Auto-Generated)
-- Generated: $(date)
-- =============================================================================
-- This SQL sets up Snowflake Postgres for the dual-backend architecture:
--   - Snowflake: Analytics, ML, large-scale data processing
--   - Postgres: Real-time operational queries, PostGIS geospatial
--
-- IMPORTANT: Save the credentials displayed after running CREATE POSTGRES INSTANCE!
--            They cannot be retrieved later.
-- =============================================================================

USE ROLE ACCOUNTADMIN;

-- =============================================================================
-- 1. NETWORK POLICY SETUP
-- =============================================================================

-- Create network rule for Postgres ingress (MODE = POSTGRES_INGRESS is required)
-- NOTE: 0.0.0.0/0 allows all IPs - restrict to specific CIDR ranges in production!
CREATE NETWORK RULE IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_INGRESS_RULE
    TYPE = IPV4
    VALUE_LIST = ('0.0.0.0/0')
    MODE = POSTGRES_INGRESS
    COMMENT = 'Ingress rule for ${POSTGRES_INSTANCE} - restrict in production';

-- Create egress rule for Postgres FDW connections
CREATE NETWORK RULE IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_EGRESS_RULE
    TYPE = IPV4
    VALUE_LIST = ('0.0.0.0/0')
    MODE = POSTGRES_EGRESS
    COMMENT = 'Egress rule for ${POSTGRES_INSTANCE} FDW - restrict in production';

-- Create network policy combining both rules
CREATE NETWORK POLICY IF NOT EXISTS ${POSTGRES_INSTANCE}_NETWORK_POLICY
    ALLOWED_NETWORK_RULE_LIST = (
        ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_INGRESS_RULE,
        ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_EGRESS_RULE
    )
    COMMENT = 'Network policy for ${POSTGRES_INSTANCE}';

-- =============================================================================
-- 2. CREATE POSTGRES INSTANCE
-- =============================================================================
-- SAVE THE CREDENTIALS DISPLAYED BELOW - THEY CANNOT BE RETRIEVED LATER!

CREATE POSTGRES INSTANCE IF NOT EXISTS ${POSTGRES_INSTANCE}
    COMPUTE_FAMILY = '${POSTGRES_COMPUTE_FAMILY}'
    STORAGE_SIZE_GB = ${POSTGRES_STORAGE_GB}
    AUTHENTICATION_AUTHORITY = POSTGRES
    POSTGRES_VERSION = ${POSTGRES_VERSION}
    NETWORK_POLICY = '${POSTGRES_INSTANCE}_NETWORK_POLICY'
    HIGH_AVAILABILITY = FALSE
    COMMENT = 'Flux Ops Center operational database - PostGIS for geospatial queries';

-- Show instance details (including host for connection)
SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}';

-- =============================================================================
-- 3. POSTGRES SYNC SCHEMA
-- =============================================================================

USE DATABASE ${SNOWFLAKE_DATABASE};

CREATE SCHEMA IF NOT EXISTS POSTGRES_SYNC
    COMMENT = 'Procedures for syncing Snowflake data to Postgres';

USE SCHEMA POSTGRES_SYNC;

-- Sync log table
CREATE TABLE IF NOT EXISTS SYNC_LOG (
    SYNC_ID VARCHAR(50) DEFAULT UUID_STRING() PRIMARY KEY,
    SYNC_OPERATION VARCHAR(100) NOT NULL,
    TABLE_NAME VARCHAR(100) NOT NULL,
    RECORDS_SYNCED INTEGER,
    STATUS VARCHAR(20) NOT NULL,
    ERROR_MESSAGE VARCHAR(2000),
    DURATION_SECONDS NUMBER(10,2),
    SYNC_TIMESTAMP TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- =============================================================================
-- NEXT STEPS
-- =============================================================================
-- 1. SAVE the Postgres credentials from CREATE POSTGRES INSTANCE output
-- 2. Update .env with POSTGRES_HOST from SHOW POSTGRES INSTANCES
-- 3. Configure FastAPI to connect to both backends
-- 4. Run: SELECT * FROM POSTGRES_SYNC.SYNC_LOG; to monitor sync operations
-- =============================================================================
EOF

    print_success "Postgres setup SQL generated: $POSTGRES_SQL_FILE"
fi

print_success "Deployment SQL generated: $SQL_FILE"

# -----------------------------------------------------------------------------
# NEXT STEPS
# -----------------------------------------------------------------------------

print_header "Deployment Complete!"

echo ""
echo "Next steps:"
echo ""
echo "  1. Run the generated SQL in Snowflake Worksheets:"
echo "     $SQL_FILE"
echo ""
if [ "$SETUP_POSTGRES" = "true" ]; then
echo "  2. Set up Snowflake Postgres (dual-backend architecture):"
echo "     $POSTGRES_SQL_FILE"
echo "     IMPORTANT: Save the credentials shown after CREATE POSTGRES INSTANCE!"
echo ""
echo "  3. Wait for services to reach READY state:"
echo "     SELECT SYSTEM\$GET_SERVICE_STATUS('${SERVICE_NAME}');"
echo "     SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}';"
echo ""
echo "  4. Load PostGIS spatial data (REQUIRED for map visualization):"
echo "     python backend/scripts/load_postgis_data.py --service <pg_service_name>"
echo "     See: https://github.com/sfc-gh-abannerjee/flux-ops-center-spcs/releases/tag/v1.0.0-data"
echo ""
echo "  5. Update service with Postgres host (from SHOW POSTGRES INSTANCES):"
echo "     ALTER SERVICE ${SERVICE_NAME} SET"
echo "       SPECIFICATION_FILE = ... -- Update VITE_POSTGRES_HOST"
echo ""
echo "  6. Get the application URL:"
else
echo "  2. Wait for service to reach READY state:"
echo "     SELECT SYSTEM\$GET_SERVICE_STATUS('${SERVICE_NAME}');"
echo ""
echo "  3. Get the application URL:"
fi
echo "     SHOW ENDPOINTS IN SERVICE ${SERVICE_NAME};"
echo ""
echo "  $([ "$SETUP_POSTGRES" = "true" ] && echo "7" || echo "4"). Open the 'app' endpoint URL in your browser"
echo ""
echo "  $([ "$SETUP_POSTGRES" = "true" ] && echo "8" || echo "5"). (Optional) Connect to Flux Data Forge for streaming AMI data"
echo ""
print_success "Happy demo-ing!"
