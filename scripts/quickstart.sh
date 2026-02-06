#!/usr/bin/env bash
# =============================================================================
# Flux Operations Center - Quick Deploy Script
# =============================================================================
# This script automates the FULL deployment of Flux Ops Center to Snowflake SPCS,
# including building, pushing, and deploying the service and Postgres instance.
#
# Features:
#   - Interactive step selection (run all or pick specific steps)
#   - Automatic rollback on failure
#   - Progress tracking and clear status output
#
# Usage:
#   ./scripts/quickstart.sh              # Interactive mode
#   ./scripts/quickstart.sh --all        # Run all steps non-interactively
#   ./scripts/quickstart.sh --skip-build # Skip frontend/docker build steps
#
# Prerequisites:
#   - Docker installed and running
#   - Node.js and npm installed
#   - Snowflake CLI (snow) installed and configured with a connection
#
# Environment Variables (optional - will prompt if not set):
#   SNOWFLAKE_ACCOUNT      - Snowflake account (org-account format)
#   SNOWFLAKE_USER         - Snowflake username
#   SNOWFLAKE_DATABASE     - Target database
#   SNOWFLAKE_SCHEMA       - Target schema
#   SNOWFLAKE_WAREHOUSE    - Warehouse to use
#   COMPUTE_POOL           - SPCS compute pool name
#   SNOWFLAKE_CONNECTION   - Snowflake CLI connection name
#   SETUP_POSTGRES=false   - Set to skip Postgres setup
# =============================================================================

# Don't use set -e - we handle errors ourselves for rollback
# set -e

# =============================================================================
# COLORS AND FORMATTING
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Box drawing characters
BOX_TL="╔"
BOX_TR="╗"
BOX_BL="╚"
BOX_BR="╝"
BOX_H="═"
BOX_V="║"
CHECK="✓"
CROSS="✗"
ARROW="➜"
BULLET="•"

# =============================================================================
# CONFIGURATION
# =============================================================================
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
SNOWFLAKE_CONNECTION="${SNOWFLAKE_CONNECTION:-}"
POSTGRES_INSTANCE="${POSTGRES_INSTANCE:-FLUX_OPS_POSTGRES}"
POSTGRES_COMPUTE_FAMILY="${POSTGRES_COMPUTE_FAMILY:-HIGHMEM_XL}"
POSTGRES_STORAGE_GB="${POSTGRES_STORAGE_GB:-100}"
POSTGRES_VERSION="${POSTGRES_VERSION:-17}"
SETUP_POSTGRES="${SETUP_POSTGRES:-true}"

# =============================================================================
# STEP TRACKING AND ROLLBACK STATE
# =============================================================================
# Use simple variables instead of associative arrays for compatibility
STEP_1_RUN=false; STEP_2_RUN=false; STEP_3_RUN=false; STEP_4_RUN=false; STEP_5_RUN=false
STEP_6_RUN=false; STEP_7_RUN=false; STEP_8_RUN=false; STEP_9_RUN=false
STEP_1_DONE=false; STEP_2_DONE=false; STEP_3_DONE=false; STEP_4_DONE=false; STEP_5_DONE=false
STEP_6_DONE=false; STEP_7_DONE=false; STEP_8_DONE=false; STEP_9_DONE=false
ROLLBACK_SERVICE=false
ROLLBACK_POSTGRES=false
ROLLBACK_DOCKER=false
ROLLBACK_SQL=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SQL_FILE=""
POSTGRES_SQL_FILE=""
FULL_IMAGE=""
INTERACTIVE_MODE=true
SKIP_BUILD=false

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

print_banner() {
    echo ""
    echo -e "${CYAN}${BOX_TL}$(printf '%0.s═' {1..77})${BOX_TR}${NC}"
    echo -e "${CYAN}${BOX_V}${NC}${BOLD}                    FLUX OPERATIONS CENTER - QUICK DEPLOY                    ${NC}${CYAN}${BOX_V}${NC}"
    echo -e "${CYAN}${BOX_V}${NC}${DIM}              Real-time Grid Visualization & GNN Risk Prediction              ${NC}${CYAN}${BOX_V}${NC}"
    echo -e "${CYAN}${BOX_BL}$(printf '%0.s═' {1..77})${BOX_BR}${NC}"
    echo ""
}

print_header() {
    local step_num=$1
    local title=$2
    echo ""
    echo -e "${BLUE}┌─────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC} ${BOLD}STEP ${step_num}:${NC} ${title}"
    echo -e "${BLUE}└─────────────────────────────────────────────────────────────────────────────┘${NC}"
}

print_subheader() {
    echo ""
    echo -e "${CYAN}  ─── $1 ───${NC}"
}

print_step() {
    echo -e "  ${GREEN}${ARROW}${NC} $1"
}

print_substep() {
    echo -e "    ${DIM}${BULLET}${NC} $1"
}

print_warning() {
    echo -e "  ${YELLOW}⚠${NC}  $1"
}

print_error() {
    echo -e "  ${RED}${CROSS}${NC} $1"
}

print_success() {
    echo -e "  ${GREEN}${CHECK}${NC} $1"
}

print_info() {
    echo -e "  ${BLUE}ℹ${NC}  $1"
}

print_progress() {
    local current=$1
    local total=$2
    local desc=$3
    local pct=$((current * 100 / total))
    local filled=$((pct / 5))
    local empty=$((20 - filled))
    printf "  ${DIM}[${NC}${GREEN}%s${NC}${DIM}%s${NC}${DIM}]${NC} %3d%% %s\r" \
        "$(printf '%0.s█' $(seq 1 $filled 2>/dev/null) )" \
        "$(printf '%0.s░' $(seq 1 $empty 2>/dev/null) )" \
        "$pct" "$desc"
}

print_box() {
    local title=$1
    local content=$2
    echo ""
    echo -e "  ${MAGENTA}┌─ ${title} ─────────────────────────────────────────────────────────┐${NC}"
    echo "$content" | while IFS= read -r line; do
        printf "  ${MAGENTA}│${NC}  %-70s ${MAGENTA}│${NC}\n" "$line"
    done
    echo -e "  ${MAGENTA}└──────────────────────────────────────────────────────────────────────────┘${NC}"
}

confirm() {
    local prompt=$1
    local default=${2:-n}
    
    if [ "$default" = "y" ]; then
        prompt="$prompt [Y/n]: "
    else
        prompt="$prompt [y/N]: "
    fi
    
    echo -ne "  ${YELLOW}?${NC} $prompt"
    read -r response
    response=${response:-$default}
    
    [[ "$response" =~ ^[Yy]$ ]]
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

# =============================================================================
# ROLLBACK FUNCTIONS
# =============================================================================

execute_rollback() {
    local has_rollback=false
    
    if [ "$ROLLBACK_SERVICE" = true ] || [ "$ROLLBACK_POSTGRES" = true ] || \
       [ "$ROLLBACK_DOCKER" = true ] || [ "$ROLLBACK_SQL" = true ]; then
        has_rollback=true
    fi
    
    if [ "$has_rollback" = false ]; then
        return
    fi
    
    echo ""
    echo -e "${RED}┌─────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${RED}│${NC} ${BOLD}ROLLBACK IN PROGRESS${NC} - Reverting changes due to error"
    echo -e "${RED}└─────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    # Rollback in reverse order
    if [ "$ROLLBACK_SERVICE" = true ]; then
        print_step "Rolling back: SPCS service..."
        if [ -n "$SNOWFLAKE_CONNECTION" ]; then
            snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "DROP SERVICE IF EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}" 2>/dev/null || true
            print_success "Dropped SPCS service"
        fi
    fi
    
    if [ "$ROLLBACK_POSTGRES" = true ]; then
        print_step "Rolling back: Postgres instance..."
        if [ -n "$SNOWFLAKE_CONNECTION" ]; then
            snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "DROP POSTGRES INSTANCE IF EXISTS ${POSTGRES_INSTANCE}" 2>/dev/null || true
            print_success "Dropped Postgres instance"
        fi
    fi
    
    if [ "$ROLLBACK_DOCKER" = true ]; then
        print_step "Rolling back: Docker images..."
        docker rmi "flux_ops_center:${IMAGE_TAG}" 2>/dev/null || true
        [ -n "$FULL_IMAGE" ] && docker rmi "$FULL_IMAGE" 2>/dev/null || true
        print_success "Removed Docker images"
    fi
    
    if [ "$ROLLBACK_SQL" = true ]; then
        print_step "Rolling back: Generated SQL files..."
        [ -f "$SQL_FILE" ] && rm -f "$SQL_FILE"
        [ -f "$POSTGRES_SQL_FILE" ] && rm -f "$POSTGRES_SQL_FILE"
        print_success "Cleaned up generated SQL files"
    fi
    
    echo ""
    print_info "Rollback completed. Please check the errors above and try again."
}

# Trap for cleanup on script exit
cleanup_on_error() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        execute_rollback
    fi
    exit $exit_code
}

trap cleanup_on_error EXIT

# =============================================================================
# STEP DEFINITIONS
# =============================================================================

STEP_NAMES=(
    "1:Prerequisites & Configuration"
    "2:Login to Snowflake Registry"
    "3:Build Frontend"
    "4:Build Docker Image"
    "5:Push to Registry"
    "6:Generate Deployment SQL"
    "7:Deploy SPCS Service"
    "8:Create Postgres Instance"
    "9:Wait for Services"
)

show_step_menu() {
    echo ""
    echo -e "${BOLD}Select steps to run:${NC}"
    echo ""
    echo -e "  ${CYAN}[A]${NC} Run ALL steps (full deployment)"
    echo -e "  ${CYAN}[D]${NC} Deploy only (steps 6-9, skip build)"
    echo -e "  ${CYAN}[B]${NC} Build only (steps 1-5, skip deploy)"
    echo -e "  ${CYAN}[C]${NC} Custom selection"
    echo -e "  ${CYAN}[Q]${NC} Quit"
    echo ""
    echo -ne "  ${YELLOW}?${NC} Your choice: "
    read -r choice
    
    case "${choice^^}" in
        A)
            STEP_1_RUN=true; STEP_2_RUN=true; STEP_3_RUN=true; STEP_4_RUN=true; STEP_5_RUN=true
            STEP_6_RUN=true; STEP_7_RUN=true; STEP_8_RUN=true; STEP_9_RUN=true
            ;;
        D)
            STEP_1_RUN=true  # Always need config
            STEP_6_RUN=true; STEP_7_RUN=true; STEP_8_RUN=true; STEP_9_RUN=true
            ;;
        B)
            STEP_1_RUN=true; STEP_2_RUN=true; STEP_3_RUN=true; STEP_4_RUN=true; STEP_5_RUN=true
            STEP_6_RUN=true  # Generate SQL
            ;;
        C)
            custom_step_selection
            ;;
        Q)
            echo ""
            print_info "Deployment cancelled."
            exit 0
            ;;
        *)
            print_error "Invalid choice. Please try again."
            show_step_menu
            ;;
    esac
}

custom_step_selection() {
    echo ""
    echo -e "${BOLD}Select individual steps (enter numbers separated by spaces):${NC}"
    echo ""
    
    for step in "${STEP_NAMES[@]}"; do
        local num="${step%%:*}"
        local name="${step#*:}"
        echo -e "  ${CYAN}[$num]${NC} $name"
    done
    
    echo ""
    echo -ne "  ${YELLOW}?${NC} Enter step numbers (e.g., 1 3 4 5 7): "
    read -r selections
    
    # Always include step 1 (prerequisites)
    STEP_1_RUN=true
    
    for num in $selections; do
        case "$num" in
            1) STEP_1_RUN=true ;;
            2) STEP_2_RUN=true ;;
            3) STEP_3_RUN=true ;;
            4) STEP_4_RUN=true ;;
            5) STEP_5_RUN=true ;;
            6) STEP_6_RUN=true ;;
            7) STEP_7_RUN=true ;;
            8) STEP_8_RUN=true ;;
            9) STEP_9_RUN=true ;;
        esac
    done
    
    # Show what will be run
    echo ""
    echo -e "${BOLD}Steps to run:${NC}"
    local step_runs=("$STEP_1_RUN" "$STEP_2_RUN" "$STEP_3_RUN" "$STEP_4_RUN" "$STEP_5_RUN" "$STEP_6_RUN" "$STEP_7_RUN" "$STEP_8_RUN" "$STEP_9_RUN")
    local i=0
    for step in "${STEP_NAMES[@]}"; do
        local num="${step%%:*}"
        local name="${step#*:}"
        if [ "${step_runs[$i]}" = true ]; then
            echo -e "  ${GREEN}${CHECK}${NC} Step $num: $name"
        else
            echo -e "  ${DIM}${CROSS} Step $num: $name${NC}"
        fi
        ((i++))
    done
    
    if ! confirm "Proceed with these steps?" "y"; then
        show_step_menu
    fi
}

# =============================================================================
# STEP 1: PREREQUISITES & CONFIGURATION
# =============================================================================

step_1_prerequisites() {
    print_header "1" "Prerequisites & Configuration"
    
    print_subheader "Checking Required Tools"
    
    local missing_tools=false
    
    # Check Node.js
    if command -v node &> /dev/null; then
        print_success "Node.js $(node --version)"
    else
        print_error "Node.js is NOT installed"
        print_substep "Install via: brew install node (macOS) or nvm install node"
        missing_tools=true
    fi
    
    # Check npm
    if command -v npm &> /dev/null; then
        print_success "npm $(npm --version)"
    else
        print_error "npm is NOT installed"
        missing_tools=true
    fi
    
    # Check Snowflake CLI
    if command -v snow &> /dev/null; then
        print_success "Snowflake CLI $(snow --version 2>&1 | head -1)"
    else
        print_error "Snowflake CLI (snow) is NOT installed"
        print_substep "Install via: pip install snowflake-cli-labs"
        missing_tools=true
    fi
    
    # Check Docker
    if command -v docker &> /dev/null; then
        print_success "Docker installed"
        if docker info &> /dev/null; then
            print_success "Docker daemon is running"
        else
            print_error "Docker daemon is NOT running"
            print_substep "Start Docker Desktop or run: sudo systemctl start docker"
            missing_tools=true
        fi
    else
        print_error "Docker is NOT installed"
        missing_tools=true
    fi
    
    if [ "$missing_tools" = true ]; then
        print_error "Missing required tools. Please install them and try again."
        exit 1
    fi
    
    print_subheader "Snowflake Configuration"
    
    # Prompt for missing variables
    [ -z "$SNOWFLAKE_ACCOUNT" ] && { echo -ne "  ${YELLOW}?${NC} Snowflake Account (org-account): "; read SNOWFLAKE_ACCOUNT; }
    [ -z "$SNOWFLAKE_USER" ] && { echo -ne "  ${YELLOW}?${NC} Snowflake Username: "; read SNOWFLAKE_USER; }
    [ -z "$SNOWFLAKE_DATABASE" ] && { echo -ne "  ${YELLOW}?${NC} Database name: "; read SNOWFLAKE_DATABASE; }
    [ -z "$SNOWFLAKE_SCHEMA" ] && { echo -ne "  ${YELLOW}?${NC} Schema name: "; read SNOWFLAKE_SCHEMA; }
    [ -z "$SNOWFLAKE_WAREHOUSE" ] && { echo -ne "  ${YELLOW}?${NC} Warehouse name: "; read SNOWFLAKE_WAREHOUSE; }
    [ -z "$COMPUTE_POOL" ] && { echo -ne "  ${YELLOW}?${NC} Compute Pool name: "; read COMPUTE_POOL; }
    
    # Snowflake CLI connection
    print_subheader "Snowflake CLI Connection"
    
    if [ -z "$SNOWFLAKE_CONNECTION" ]; then
        local connections=$(snow connection list 2>/dev/null | grep -E "^\w" | awk '{print $1}' | head -10)
        if [ -n "$connections" ]; then
            echo -e "  ${DIM}Available connections:${NC}"
            echo "$connections" | while read conn; do echo -e "    ${DIM}${BULLET} $conn${NC}"; done
        fi
        echo -ne "  ${YELLOW}?${NC} Connection name: "
        read SNOWFLAKE_CONNECTION
    fi
    
    # Validate connection
    if snow connection test -c "$SNOWFLAKE_CONNECTION" &> /dev/null; then
        print_success "Connection '$SNOWFLAKE_CONNECTION' verified"
    else
        print_warning "Connection test failed - will try anyway"
    fi
    
    # Postgres configuration
    if [ "$SETUP_POSTGRES" = "true" ] && [ "${STEP_8_RUN}" = true ]; then
        print_subheader "Postgres Configuration"
        
        echo -ne "  ${YELLOW}?${NC} Postgres instance name [${POSTGRES_INSTANCE}]: "
        read input; POSTGRES_INSTANCE="${input:-$POSTGRES_INSTANCE}"
        
        echo -ne "  ${YELLOW}?${NC} Compute family (HIGHMEM_XL/HIGHMEM_L/STANDARD_M) [${POSTGRES_COMPUTE_FAMILY}]: "
        read input; POSTGRES_COMPUTE_FAMILY="${input:-$POSTGRES_COMPUTE_FAMILY}"
        
        echo -ne "  ${YELLOW}?${NC} Storage GB (10-65535) [${POSTGRES_STORAGE_GB}]: "
        read input; POSTGRES_STORAGE_GB="${input:-$POSTGRES_STORAGE_GB}"
    fi
    
    # Validate required variables
    print_subheader "Validating Configuration"
    
    local missing=false
    for var in SNOWFLAKE_ACCOUNT SNOWFLAKE_USER SNOWFLAKE_DATABASE SNOWFLAKE_SCHEMA SNOWFLAKE_WAREHOUSE COMPUTE_POOL; do
        if [ -z "${!var}" ]; then
            print_error "Missing: $var"
            missing=true
        fi
    done
    
    if [ "$missing" = true ]; then
        print_error "Missing required configuration. Exiting."
        exit 1
    fi
    
    # Validate formats
    if [[ "$SNOWFLAKE_ACCOUNT" == *" "* ]]; then
        print_error "SNOWFLAKE_ACCOUNT contains spaces. Use org-account format."
        exit 1
    fi
    
    # Derive registry URL (lowercase for Docker)
    REGISTRY_URL="${SNOWFLAKE_ACCOUNT}.registry.snowflakecomputing.com"
    REGISTRY_URL_LOWER=$(echo "$REGISTRY_URL" | tr '[:upper:]' '[:lower:]')
    DB_LOWER=$(echo "$SNOWFLAKE_DATABASE" | tr '[:upper:]' '[:lower:]')
    SCHEMA_LOWER=$(echo "$SNOWFLAKE_SCHEMA" | tr '[:upper:]' '[:lower:]')
    REPO_LOWER=$(echo "$IMAGE_REPO" | tr '[:upper:]' '[:lower:]')
    FULL_IMAGE="${REGISTRY_URL_LOWER}/${DB_LOWER}/${SCHEMA_LOWER}/${REPO_LOWER}/flux_ops_center:${IMAGE_TAG}"
    
    # SQL file paths
    SQL_FILE="$PROJECT_ROOT/deploy_generated.sql"
    POSTGRES_SQL_FILE="$PROJECT_ROOT/postgres_setup_generated.sql"
    
    # Show configuration summary
    local config_summary="Account:      $SNOWFLAKE_ACCOUNT
Database:     $SNOWFLAKE_DATABASE
Schema:       $SNOWFLAKE_SCHEMA
Warehouse:    $SNOWFLAKE_WAREHOUSE
Compute Pool: $COMPUTE_POOL
Connection:   $SNOWFLAKE_CONNECTION
Image:        $FULL_IMAGE"
    
    if [ "$SETUP_POSTGRES" = "true" ]; then
        config_summary="$config_summary
Postgres:     $POSTGRES_INSTANCE ($POSTGRES_COMPUTE_FAMILY)"
    fi
    
    print_box "Configuration Summary" "$config_summary"
    
    if ! confirm "Proceed with this configuration?" "y"; then
        print_info "Deployment cancelled."
        exit 0
    fi
    
    STEP_1_DONE=true
    print_success "Prerequisites check completed"
}

# =============================================================================
# STEP 2: LOGIN TO REGISTRY
# =============================================================================

step_2_registry_login() {
    print_header "2" "Login to Snowflake Registry"
    
    print_step "Logging in to $REGISTRY_URL_LOWER..."
    print_info "Enter your Snowflake password when prompted."
    echo ""
    
    if ! docker login "$REGISTRY_URL_LOWER" -u "$SNOWFLAKE_USER"; then
        print_error "Failed to login to Snowflake registry"
        print_warning "Check your password and ensure the image repository exists"
        exit 1
    fi
    
    STEP_2_DONE=true
    print_success "Logged in to Snowflake registry"
}

# =============================================================================
# STEP 3: BUILD FRONTEND
# =============================================================================

step_3_build_frontend() {
    print_header "3" "Build Frontend"
    
    cd "$PROJECT_ROOT"
    
    print_step "Installing dependencies (npm ci)..."
    if ! npm ci 2>&1 | while read line; do print_substep "$line"; done; then
        print_error "npm ci failed"
        exit 1
    fi
    print_success "Dependencies installed"
    
    print_step "Building frontend (npm run build)..."
    if ! npm run build 2>&1 | tail -5 | while read line; do print_substep "$line"; done; then
        print_error "Frontend build failed"
        exit 1
    fi
    
    if [ ! -d "dist" ]; then
        print_error "dist/ directory not found after build"
        exit 1
    fi
    
    STEP_3_DONE=true
    print_success "Frontend built successfully (dist/ created)"
}

# =============================================================================
# STEP 4: BUILD DOCKER IMAGE
# =============================================================================

step_4_build_docker() {
    print_header "4" "Build Docker Image"
    
    cd "$PROJECT_ROOT"
    
    local dockerfile="Dockerfile"
    if [ -f "Dockerfile.spcs" ]; then
        dockerfile="Dockerfile.spcs"
        print_info "Using Dockerfile.spcs for SPCS deployment"
    fi
    
    print_step "Building Docker image..."
    
    if ! docker build -t "flux_ops_center:${IMAGE_TAG}" -f "$dockerfile" . 2>&1 | \
        grep -E "^(Step|Successfully|COPY|RUN|FROM)" | while read line; do print_substep "$line"; done; then
        print_error "Docker build failed"
        exit 1
    fi
    
    ROLLBACK_DOCKER=true
    
    STEP_4_DONE=true
    print_success "Docker image built: flux_ops_center:${IMAGE_TAG}"
}

# =============================================================================
# STEP 5: PUSH TO REGISTRY
# =============================================================================

step_5_push_image() {
    print_header "5" "Push to Snowflake Registry"
    
    print_step "Tagging image..."
    docker tag "flux_ops_center:${IMAGE_TAG}" "$FULL_IMAGE"
    print_success "Tagged as: $FULL_IMAGE"
    
    print_step "Pushing image to Snowflake..."
    if ! docker push "$FULL_IMAGE" 2>&1 | grep -E "^[a-f0-9]+:|latest:|Pushed|Digest" | while read line; do print_substep "$line"; done; then
        print_error "Failed to push image"
        print_warning "Ensure the image repository exists:"
        print_substep "CREATE IMAGE REPOSITORY IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${IMAGE_REPO};"
        exit 1
    fi
    
    STEP_5_DONE=true
    print_success "Image pushed successfully"
}

# =============================================================================
# STEP 6: GENERATE DEPLOYMENT SQL
# =============================================================================

step_6_generate_sql() {
    print_header "6" "Generate Deployment SQL"
    
    print_step "Generating SPCS service SQL..."
    
    cat > "$SQL_FILE" << EOF
-- =============================================================================
-- Flux Operations Center - Auto-Generated Deployment SQL
-- Generated: $(date)
-- =============================================================================

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
        SNOWFLAKE_DATABASE: ${SNOWFLAKE_DATABASE}
        SNOWFLAKE_SCHEMA: ${SNOWFLAKE_SCHEMA}
        SNOWFLAKE_WAREHOUSE: ${SNOWFLAKE_WAREHOUSE}
        SNOWFLAKE_ROLE: ${SNOWFLAKE_ROLE}
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
    COMMENT = 'Flux Operations Center - Real-time Grid Visualization';

SELECT SYSTEM\$GET_SERVICE_STATUS('${SERVICE_NAME}');
SHOW ENDPOINTS IN SERVICE ${SERVICE_NAME};
EOF
    
    print_success "Generated: $SQL_FILE"
    ROLLBACK_SQL=true
    
    # Generate Postgres SQL if needed
    if [ "$SETUP_POSTGRES" = "true" ]; then
        print_step "Generating Postgres setup SQL..."
        
        cat > "$POSTGRES_SQL_FILE" << EOF
-- =============================================================================
-- Flux Operations Center - Snowflake Postgres Setup
-- Generated: $(date)
-- =============================================================================

USE ROLE ACCOUNTADMIN;

-- Network rules for Postgres
CREATE NETWORK RULE IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_INGRESS_RULE
    TYPE = IPV4
    VALUE_LIST = ('0.0.0.0/0')
    MODE = POSTGRES_INGRESS
    COMMENT = 'Ingress rule for ${POSTGRES_INSTANCE}';

CREATE NETWORK RULE IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_EGRESS_RULE
    TYPE = IPV4
    VALUE_LIST = ('0.0.0.0/0')
    MODE = POSTGRES_EGRESS
    COMMENT = 'Egress rule for ${POSTGRES_INSTANCE}';

CREATE NETWORK POLICY IF NOT EXISTS ${POSTGRES_INSTANCE}_NETWORK_POLICY
    ALLOWED_NETWORK_RULE_LIST = (
        ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_INGRESS_RULE,
        ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${POSTGRES_INSTANCE}_EGRESS_RULE
    );

-- Create Postgres instance
-- IMPORTANT: Save the credentials shown below!
CREATE POSTGRES INSTANCE IF NOT EXISTS ${POSTGRES_INSTANCE}
    COMPUTE_FAMILY = '${POSTGRES_COMPUTE_FAMILY}'
    STORAGE_SIZE_GB = ${POSTGRES_STORAGE_GB}
    AUTHENTICATION_AUTHORITY = POSTGRES
    POSTGRES_VERSION = ${POSTGRES_VERSION}
    NETWORK_POLICY = '${POSTGRES_INSTANCE}_NETWORK_POLICY'
    HIGH_AVAILABILITY = FALSE
    COMMENT = 'Flux Ops Center operational database';

SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}';
EOF
        
        print_success "Generated: $POSTGRES_SQL_FILE"
    fi
    
    STEP_6_DONE=true
}

# =============================================================================
# STEP 7: DEPLOY SPCS SERVICE
# =============================================================================

step_7_deploy_service() {
    print_header "7" "Deploy SPCS Service"
    
    print_step "Creating image repository and SPCS service..."
    
    if ! snow sql -c "$SNOWFLAKE_CONNECTION" -f "$SQL_FILE" 2>&1 | while read line; do print_substep "$line"; done; then
        print_error "Failed to deploy SPCS service"
        exit 1
    fi
    
    ROLLBACK_SERVICE=true
    
    STEP_7_DONE=true
    print_success "SPCS service deployment initiated"
}

# =============================================================================
# STEP 8: CREATE POSTGRES INSTANCE
# =============================================================================

step_8_create_postgres() {
    if [ "$SETUP_POSTGRES" != "true" ]; then
        print_info "Skipping Postgres setup (SETUP_POSTGRES=false)"
        return
    fi
    
    print_header "8" "Create Postgres Instance"
    
    echo ""
    echo -e "  ${RED}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "  ${RED}║${NC} ${BOLD}IMPORTANT: Save the Postgres credentials shown below!${NC}                   ${RED}║${NC}"
    echo -e "  ${RED}║${NC} ${DIM}They cannot be retrieved later.${NC}                                         ${RED}║${NC}"
    echo -e "  ${RED}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    print_step "Creating Postgres instance and network rules..."
    
    if ! snow sql -c "$SNOWFLAKE_CONNECTION" -f "$POSTGRES_SQL_FILE" 2>&1 | while read line; do
        # Highlight credential lines
        if [[ "$line" == *"password"* ]] || [[ "$line" == *"PASSWORD"* ]]; then
            echo -e "    ${RED}${BOLD}>>> $line${NC}"
        else
            print_substep "$line"
        fi
    done; then
        print_error "Failed to create Postgres instance"
        print_warning "You can run manually: snow sql -c $SNOWFLAKE_CONNECTION -f $POSTGRES_SQL_FILE"
        # Don't exit - SPCS might still work without Postgres
    else
        ROLLBACK_POSTGRES=true
        print_success "Postgres instance creation initiated"
    fi
    
    STEP_8_DONE=true
}

# =============================================================================
# STEP 9: WAIT FOR SERVICES
# =============================================================================

step_9_wait_for_services() {
    print_header "9" "Wait for Services"
    
    print_step "Waiting for SPCS service to become ready..."
    print_info "This may take 2-5 minutes..."
    echo ""
    
    local max_attempts=30
    local attempt=0
    local service_ready=false
    
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        
        local status=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SELECT SYSTEM\$GET_SERVICE_STATUS('${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}')" 2>/dev/null | \
            grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
        
        print_progress $attempt $max_attempts "Status: ${status:-checking...}"
        
        if [ "$status" = "READY" ]; then
            service_ready=true
            echo ""
            print_success "SPCS service is READY!"
            break
        elif [ "$status" = "FAILED" ]; then
            echo ""
            print_error "SPCS service FAILED to start"
            snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "SELECT SYSTEM\$GET_SERVICE_STATUS('${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}')" 2>/dev/null
            exit 1
        fi
        
        sleep 10
    done
    
    echo ""
    
    if [ "$service_ready" = true ]; then
        print_step "Getting service endpoints..."
        echo ""
        snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW ENDPOINTS IN SERVICE ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}" 2>/dev/null
    else
        print_warning "Service not ready after ${max_attempts} attempts"
        print_info "Check status with: SELECT SYSTEM\$GET_SERVICE_STATUS('${SERVICE_NAME}')"
    fi
    
    # Check Postgres if enabled
    if [ "$SETUP_POSTGRES" = "true" ] && [ "${STEP_8_DONE}" = true ]; then
        print_subheader "Postgres Instance Status"
        snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null
        echo ""
        print_warning "Remember to save your Postgres credentials!"
        print_info "If missed, reset with: ALTER POSTGRES INSTANCE ${POSTGRES_INSTANCE} RESET CREDENTIALS;"
    fi
    
    STEP_9_DONE=true
}

# =============================================================================
# COMPLETION SUMMARY
# =============================================================================

show_completion_summary() {
    echo ""
    echo -e "${GREEN}╔═════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}                      ${BOLD}DEPLOYMENT COMPLETE!${NC}                                  ${GREEN}║${NC}"
    echo -e "${GREEN}╚═════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    echo -e "${BOLD}Steps Completed:${NC}"
    local step_runs=("$STEP_1_RUN" "$STEP_2_RUN" "$STEP_3_RUN" "$STEP_4_RUN" "$STEP_5_RUN" "$STEP_6_RUN" "$STEP_7_RUN" "$STEP_8_RUN" "$STEP_9_RUN")
    local step_dones=("$STEP_1_DONE" "$STEP_2_DONE" "$STEP_3_DONE" "$STEP_4_DONE" "$STEP_5_DONE" "$STEP_6_DONE" "$STEP_7_DONE" "$STEP_8_DONE" "$STEP_9_DONE")
    local i=0
    for step in "${STEP_NAMES[@]}"; do
        local num="${step%%:*}"
        local name="${step#*:}"
        if [ "${step_dones[$i]}" = true ]; then
            echo -e "  ${GREEN}${CHECK}${NC} Step $num: $name"
        elif [ "${step_runs[$i]}" = true ]; then
            echo -e "  ${YELLOW}○${NC} Step $num: $name ${DIM}(skipped/failed)${NC}"
        else
            echo -e "  ${DIM}─ Step $num: $name (not selected)${NC}"
        fi
        ((i++))
    done
    
    echo ""
    echo -e "${BOLD}Next Steps:${NC}"
    echo -e "  ${CYAN}1.${NC} Open the 'app' endpoint URL in your browser"
    
    if [ "$SETUP_POSTGRES" = "true" ]; then
        echo -e "  ${CYAN}2.${NC} Load PostGIS data: python backend/scripts/load_postgis_data.py --host <POSTGRES_HOST>"
        echo -e "  ${CYAN}3.${NC} Update SPCS service with Postgres host if needed"
    fi
    
    echo ""
    echo -e "${BOLD}Useful Commands:${NC}"
    echo -e "  ${DIM}# Check service status${NC}"
    echo -e "  snow sql -c $SNOWFLAKE_CONNECTION -q \"SELECT SYSTEM\\\$GET_SERVICE_STATUS('${SERVICE_NAME}')\""
    echo ""
    echo -e "  ${DIM}# View service logs${NC}"
    echo -e "  snow sql -c $SNOWFLAKE_CONNECTION -q \"CALL SYSTEM\\\$GET_SERVICE_LOGS('${SERVICE_NAME}', 0, 'flux-ops-center')\""
    echo ""
    
    print_success "Happy demo-ing!"
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

main() {
    # Parse command line arguments
    for arg in "$@"; do
        case $arg in
            --all)
                INTERACTIVE_MODE=false
                STEP_1_RUN=true; STEP_2_RUN=true; STEP_3_RUN=true; STEP_4_RUN=true; STEP_5_RUN=true
                STEP_6_RUN=true; STEP_7_RUN=true; STEP_8_RUN=true; STEP_9_RUN=true
                ;;
            --skip-build)
                SKIP_BUILD=true
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --all         Run all steps non-interactively"
                echo "  --skip-build  Skip frontend and Docker build steps"
                echo "  --help        Show this help message"
                exit 0
                ;;
        esac
    done
    
    print_banner
    
    # Show step menu if interactive
    if [ "$INTERACTIVE_MODE" = true ]; then
        show_step_menu
    fi
    
    # Apply --skip-build if set
    if [ "$SKIP_BUILD" = true ]; then
        STEP_3_RUN=false
        STEP_4_RUN=false
        STEP_5_RUN=false
    fi
    
    # Execute selected steps
    [ "${STEP_1_RUN}" = true ] && step_1_prerequisites
    [ "${STEP_2_RUN}" = true ] && step_2_registry_login
    [ "${STEP_3_RUN}" = true ] && step_3_build_frontend
    [ "${STEP_4_RUN}" = true ] && step_4_build_docker
    [ "${STEP_5_RUN}" = true ] && step_5_push_image
    [ "${STEP_6_RUN}" = true ] && step_6_generate_sql
    [ "${STEP_7_RUN}" = true ] && step_7_deploy_service
    [ "${STEP_8_RUN}" = true ] && step_8_create_postgres
    [ "${STEP_9_RUN}" = true ] && step_9_wait_for_services
    
    show_completion_summary
}

# Run main
main "$@"
