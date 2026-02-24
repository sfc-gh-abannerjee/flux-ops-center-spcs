#!/usr/bin/env bash
# =============================================================================
# Flux Operations Center - Complete Deployment Script
# =============================================================================
# This script automates the FULL deployment of Flux Ops Center to Snowflake SPCS,
# including database setup, building, pushing, deploying, and data loading.
#
# Features:
#   - Interactive step selection (run all or pick specific steps)
#   - Automatic rollback on failure
#   - Progress tracking and clear status output
#   - Status check for existing deployments
#
# Usage:
#   ./scripts/quickstart.sh              # Interactive mode
#   ./scripts/quickstart.sh --all        # Run all steps non-interactively
#   ./scripts/quickstart.sh --skip-build # Skip frontend/docker build steps
#   ./scripts/quickstart.sh --status     # Check current deployment status
#
# Steps:
#   1.  Prerequisites & Configuration
#   2.  Initialize Database & Schemas
#   3.  Create Compute Pool
#   4.  Login to Snowflake Registry
#   5.  Build Frontend
#   6.  Build Docker Image
#   7.  Push to Registry
#   8.  Deploy SPCS Service
#   9.  Create Postgres Instance
#   10. Configure External Access
#   11. Load PostGIS Data
#   12. Setup Cortex AI (optional)
#   13. Health Check & Validation
#
# Prerequisites:
#   - Docker installed and running
#   - Node.js and npm installed
#   - Python 3.9+ with pip
#   - Snowflake CLI (snow) installed and configured with a connection
#
# Environment Variables (optional - will prompt if not set):
#   SNOWFLAKE_ACCOUNT      - Snowflake account (org-account format)
#   SNOWFLAKE_USER         - Snowflake username
#   SNOWFLAKE_DATABASE     - Target database (default: FLUX_DB)
#   SNOWFLAKE_SCHEMA       - Target schema (default: APPLICATIONS)
#   SNOWFLAKE_WAREHOUSE    - Warehouse to use (default: FLUX_WH)
#   COMPUTE_POOL           - SPCS compute pool name
#   SNOWFLAKE_CONNECTION   - Snowflake CLI connection name
#   SETUP_POSTGRES=false   - Set to skip Postgres setup
#   SETUP_CORTEX=false     - Set to skip Cortex AI setup
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
SNOWFLAKE_DATABASE="${SNOWFLAKE_DATABASE:-FLUX_DB}"
SNOWFLAKE_SCHEMA="${SNOWFLAKE_SCHEMA:-APPLICATIONS}"
SNOWFLAKE_WAREHOUSE="${SNOWFLAKE_WAREHOUSE:-FLUX_WH}"
SNOWFLAKE_ROLE="${SNOWFLAKE_ROLE:-SYSADMIN}"
COMPUTE_POOL="${COMPUTE_POOL:-}"
COMPUTE_POOL_SIZE="${COMPUTE_POOL_SIZE:-STANDARD_2}"
IMAGE_REPO="${IMAGE_REPO:-FLUX_OPS_CENTER_REPO}"
SERVICE_NAME="${SERVICE_NAME:-FLUX_OPS_CENTER_SERVICE}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SNOWFLAKE_CONNECTION="${SNOWFLAKE_CONNECTION:-}"
POSTGRES_INSTANCE="${POSTGRES_INSTANCE:-FLUX_OPS_POSTGRES}"
POSTGRES_COMPUTE_FAMILY="${POSTGRES_COMPUTE_FAMILY:-STANDARD_M}"
POSTGRES_STORAGE_GB="${POSTGRES_STORAGE_GB:-100}"
POSTGRES_VERSION="${POSTGRES_VERSION:-17}"
SETUP_POSTGRES="${SETUP_POSTGRES:-true}"
SETUP_CORTEX="${SETUP_CORTEX:-false}"
POSTGRES_HOST=""
POSTGRES_USER=""
POSTGRES_PASSWORD=""

# =============================================================================
# STEP TRACKING AND ROLLBACK STATE (13 steps)
# =============================================================================
# Use simple variables instead of associative arrays for bash 3.x compatibility
STEP_1_RUN=false; STEP_2_RUN=false; STEP_3_RUN=false; STEP_4_RUN=false; STEP_5_RUN=false
STEP_6_RUN=false; STEP_7_RUN=false; STEP_8_RUN=false; STEP_9_RUN=false; STEP_10_RUN=false
STEP_11_RUN=false; STEP_12_RUN=false; STEP_13_RUN=false
STEP_1_DONE=false; STEP_2_DONE=false; STEP_3_DONE=false; STEP_4_DONE=false; STEP_5_DONE=false
STEP_6_DONE=false; STEP_7_DONE=false; STEP_8_DONE=false; STEP_9_DONE=false; STEP_10_DONE=false
STEP_11_DONE=false; STEP_12_DONE=false; STEP_13_DONE=false

ROLLBACK_SERVICE=false
ROLLBACK_POSTGRES=false
ROLLBACK_DOCKER=false
ROLLBACK_SQL=false
ROLLBACK_DATABASE=false
ROLLBACK_COMPUTE_POOL=false
ROLLBACK_EXTERNAL_ACCESS=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SQL_FILE=""
POSTGRES_SQL_FILE=""
FULL_IMAGE=""
INTERACTIVE_MODE=true
SKIP_BUILD=false
STATUS_CHECK=false

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
       [ "$ROLLBACK_DOCKER" = true ] || [ "$ROLLBACK_SQL" = true ] || \
       [ "$ROLLBACK_EXTERNAL_ACCESS" = true ]; then
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
    
    if [ "$ROLLBACK_EXTERNAL_ACCESS" = true ]; then
        print_step "Rolling back: External access integration..."
        if [ -n "$SNOWFLAKE_CONNECTION" ]; then
            snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "DROP INTEGRATION IF EXISTS FLUX_POSTGRES_INTEGRATION" 2>/dev/null || true
            snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "DROP SECRET IF EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.POSTGRES_CREDENTIALS" 2>/dev/null || true
            print_success "Dropped external access integration"
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
# STEP DEFINITIONS (13 steps)
# =============================================================================

STEP_NAMES=(
    "1:Prerequisites & Configuration"
    "2:Initialize Database & Schemas"
    "3:Create Compute Pool"
    "4:Login to Snowflake Registry"
    "5:Build Frontend"
    "6:Build Docker Image"
    "7:Push to Registry"
    "8:Deploy SPCS Service"
    "9:Create Postgres Instance"
    "10:Configure External Access"
    "11:Load PostGIS Data"
    "12:Setup Cortex AI"
    "13:Health Check & Validation"
)

show_step_menu() {
    echo ""
    echo -e "${BOLD}Select steps to run:${NC}"
    echo ""
    echo -e "  ${CYAN}[A]${NC} Run ALL steps (full deployment)"
    echo -e "  ${CYAN}[F]${NC} Fresh install (steps 1-11, skip Cortex)"
    echo -e "  ${CYAN}[D]${NC} Deploy only (steps 4,8-13, skip build - image must exist)"
    echo -e "  ${CYAN}[B]${NC} Build only (steps 1,4-7, skip deploy)"
    echo -e "  ${CYAN}[P]${NC} Postgres setup only (steps 1,9-11)"
    echo -e "  ${CYAN}[C]${NC} Custom selection"
    echo -e "  ${CYAN}[Q]${NC} Quit"
    echo ""
    echo -ne "  ${YELLOW}?${NC} Your choice: "
    read -r choice
    
    case "${choice^^}" in
        A)
            STEP_1_RUN=true; STEP_2_RUN=true; STEP_3_RUN=true; STEP_4_RUN=true; STEP_5_RUN=true
            STEP_6_RUN=true; STEP_7_RUN=true; STEP_8_RUN=true; STEP_9_RUN=true; STEP_10_RUN=true
            STEP_11_RUN=true; STEP_12_RUN=true; STEP_13_RUN=true
            ;;
        F)
            STEP_1_RUN=true; STEP_2_RUN=true; STEP_3_RUN=true; STEP_4_RUN=true; STEP_5_RUN=true
            STEP_6_RUN=true; STEP_7_RUN=true; STEP_8_RUN=true; STEP_9_RUN=true; STEP_10_RUN=true
            STEP_11_RUN=true; STEP_13_RUN=true
            ;;
        D)
            STEP_1_RUN=true  # Always need config
            STEP_4_RUN=true  # Registry login
            STEP_8_RUN=true; STEP_9_RUN=true; STEP_10_RUN=true
            STEP_11_RUN=true; STEP_12_RUN=true; STEP_13_RUN=true
            ;;
        B)
            STEP_1_RUN=true; STEP_4_RUN=true; STEP_5_RUN=true; STEP_6_RUN=true; STEP_7_RUN=true
            ;;
        P)
            STEP_1_RUN=true; STEP_9_RUN=true; STEP_10_RUN=true; STEP_11_RUN=true
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
    echo -ne "  ${YELLOW}?${NC} Enter step numbers (e.g., 1 2 3 8 9 13): "
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
            10) STEP_10_RUN=true ;;
            11) STEP_11_RUN=true ;;
            12) STEP_12_RUN=true ;;
            13) STEP_13_RUN=true ;;
        esac
    done
    
    # Show what will be run
    echo ""
    echo -e "${BOLD}Steps to run:${NC}"
    local step_runs=("$STEP_1_RUN" "$STEP_2_RUN" "$STEP_3_RUN" "$STEP_4_RUN" "$STEP_5_RUN" "$STEP_6_RUN" "$STEP_7_RUN" "$STEP_8_RUN" "$STEP_9_RUN" "$STEP_10_RUN" "$STEP_11_RUN" "$STEP_12_RUN" "$STEP_13_RUN")
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
# STATUS CHECK FUNCTION
# =============================================================================

check_deployment_status() {
    print_banner
    echo -e "${BOLD}Checking current deployment status...${NC}"
    echo ""
    
    # Check connection first
    if [ -z "$SNOWFLAKE_CONNECTION" ]; then
        local connections=$(snow connection list 2>/dev/null | grep -E "^\w" | awk '{print $1}' | head -10)
        if [ -n "$connections" ]; then
            echo -e "  ${DIM}Available connections:${NC}"
            echo "$connections" | while read conn; do echo -e "    ${DIM}${BULLET} $conn${NC}"; done
        fi
        echo -ne "  ${YELLOW}?${NC} Connection name: "
        read SNOWFLAKE_CONNECTION
    fi
    
    print_subheader "Database & Schemas"
    local db_exists=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q "SHOW DATABASES LIKE '${SNOWFLAKE_DATABASE}'" 2>/dev/null | grep -c "${SNOWFLAKE_DATABASE}" || echo "0")
    if [ "$db_exists" -gt 0 ]; then
        print_success "Database ${SNOWFLAKE_DATABASE} exists"
        
        # Check schemas
        local schemas=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q "SHOW SCHEMAS IN DATABASE ${SNOWFLAKE_DATABASE}" 2>/dev/null)
        for schema in PRODUCTION APPLICATIONS ML_DEMO CASCADE_ANALYSIS RAW; do
            if echo "$schemas" | grep -q "$schema"; then
                print_success "  Schema $schema exists"
            else
                print_warning "  Schema $schema missing"
            fi
        done
    else
        print_warning "Database ${SNOWFLAKE_DATABASE} does not exist"
    fi
    
    print_subheader "Compute Pool"
    local pool_status=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q "SHOW COMPUTE POOLS LIKE '${COMPUTE_POOL:-FLUX%}'" 2>/dev/null | grep -E "ACTIVE|IDLE|STARTING" | head -1)
    if [ -n "$pool_status" ]; then
        print_success "Compute pool found: $pool_status"
    else
        print_warning "No compute pool found matching '${COMPUTE_POOL:-FLUX%}'"
    fi
    
    print_subheader "SPCS Service"
    local service_status=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SELECT SYSTEM\$GET_SERVICE_STATUS('${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}')" 2>/dev/null | \
        grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$service_status" ]; then
        if [ "$service_status" = "READY" ]; then
            print_success "SPCS Service: ${service_status}"
            
            # Get endpoints
            echo ""
            print_step "Service Endpoints:"
            snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "SHOW ENDPOINTS IN SERVICE ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}" 2>/dev/null | \
                grep -E "ingress_url|name" | while read line; do print_substep "$line"; done
        else
            print_warning "SPCS Service: ${service_status}"
        fi
    else
        print_warning "SPCS Service not found or not accessible"
    fi
    
    print_subheader "Postgres Instance"
    local pg_status=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | grep -E "RUNNING|STARTING|SUSPENDED" | head -1)
    if [ -n "$pg_status" ]; then
        print_success "Postgres Instance: found"
        print_substep "$pg_status"
    else
        print_warning "Postgres Instance '${POSTGRES_INSTANCE}' not found"
    fi
    
    print_subheader "External Access Integration"
    local integration=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SHOW EXTERNAL ACCESS INTEGRATIONS LIKE 'FLUX_POSTGRES%'" 2>/dev/null | grep -c "FLUX_POSTGRES" || echo "0")
    if [ "$integration" -gt 0 ]; then
        print_success "External access integration configured"
    else
        print_warning "External access integration not configured"
    fi
    
    print_subheader "Cortex Search Services"
    local cortex=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SHOW CORTEX SEARCH SERVICES IN DATABASE ${SNOWFLAKE_DATABASE}" 2>/dev/null | grep -c "SEARCH" || echo "0")
    if [ "$cortex" -gt 0 ]; then
        print_success "Cortex Search services: $cortex found"
    else
        print_info "Cortex Search services: not configured"
    fi
    
    echo ""
    exit 0
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
    
    # Check Python
    if command -v python3 &> /dev/null; then
        print_success "Python $(python3 --version 2>&1 | cut -d' ' -f2)"
    else
        print_error "Python 3 is NOT installed"
        print_substep "Install via: brew install python (macOS)"
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
    
    # In non-interactive mode (--all), require env vars; in interactive mode, prompt
    if [ "$INTERACTIVE_MODE" = true ]; then
        # Interactive: prompt for missing variables
        [ -z "$SNOWFLAKE_ACCOUNT" ] && { echo -ne "  ${YELLOW}?${NC} Snowflake Account (org-account): "; read SNOWFLAKE_ACCOUNT; }
        [ -z "$SNOWFLAKE_USER" ] && { echo -ne "  ${YELLOW}?${NC} Snowflake Username: "; read SNOWFLAKE_USER; }
        
        # Database with default
        echo -ne "  ${YELLOW}?${NC} Database name [${SNOWFLAKE_DATABASE}]: "
        read input; SNOWFLAKE_DATABASE="${input:-$SNOWFLAKE_DATABASE}"
        
        # Schema with default
        echo -ne "  ${YELLOW}?${NC} Schema name [${SNOWFLAKE_SCHEMA}]: "
        read input; SNOWFLAKE_SCHEMA="${input:-$SNOWFLAKE_SCHEMA}"
        
        # Warehouse with default
        echo -ne "  ${YELLOW}?${NC} Warehouse name [${SNOWFLAKE_WAREHOUSE}]: "
        read input; SNOWFLAKE_WAREHOUSE="${input:-$SNOWFLAKE_WAREHOUSE}"
        
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
        if [ "$SETUP_POSTGRES" = "true" ]; then
            print_subheader "Postgres Configuration"
            
            echo -ne "  ${YELLOW}?${NC} Postgres instance name [${POSTGRES_INSTANCE}]: "
            read input; POSTGRES_INSTANCE="${input:-$POSTGRES_INSTANCE}"
            
            echo -ne "  ${YELLOW}?${NC} Compute family (STANDARD_M/HIGHMEM_L/HIGHMEM_XL) [${POSTGRES_COMPUTE_FAMILY}]: "
            read input; POSTGRES_COMPUTE_FAMILY="${input:-$POSTGRES_COMPUTE_FAMILY}"
            
            echo -ne "  ${YELLOW}?${NC} Storage GB (10-65535) [${POSTGRES_STORAGE_GB}]: "
            read input; POSTGRES_STORAGE_GB="${input:-$POSTGRES_STORAGE_GB}"
        fi
        
        # Cortex configuration
        if confirm "Setup Cortex AI (search services for chat)?" "n"; then
            SETUP_CORTEX=true
        fi
    else
        # Non-interactive (--all): validate required environment variables
        print_info "Non-interactive mode: using environment variables"
        
        local missing_vars=false
        if [ -z "$SNOWFLAKE_ACCOUNT" ]; then
            print_error "SNOWFLAKE_ACCOUNT environment variable is required with --all"
            missing_vars=true
        fi
        if [ -z "$SNOWFLAKE_USER" ]; then
            print_error "SNOWFLAKE_USER environment variable is required with --all"
            missing_vars=true
        fi
        if [ -z "$COMPUTE_POOL" ]; then
            print_error "COMPUTE_POOL environment variable is required with --all"
            missing_vars=true
        fi
        if [ -z "$SNOWFLAKE_CONNECTION" ]; then
            print_error "SNOWFLAKE_CONNECTION environment variable is required with --all"
            missing_vars=true
        fi
        
        if [ "$missing_vars" = true ]; then
            echo ""
            print_error "Missing required environment variables for --all mode."
            print_info "Set these before running:"
            echo -e "  export SNOWFLAKE_ACCOUNT=org-account"
            echo -e "  export SNOWFLAKE_USER=your_username"
            echo -e "  export COMPUTE_POOL=your_compute_pool"
            echo -e "  export SNOWFLAKE_CONNECTION=your_connection_name"
            exit 1
        fi
        
        # Show what we're using
        print_success "SNOWFLAKE_ACCOUNT: $SNOWFLAKE_ACCOUNT"
        print_success "SNOWFLAKE_USER: $SNOWFLAKE_USER"
        print_success "SNOWFLAKE_DATABASE: $SNOWFLAKE_DATABASE (default or from env)"
        print_success "SNOWFLAKE_SCHEMA: $SNOWFLAKE_SCHEMA (default or from env)"
        print_success "SNOWFLAKE_WAREHOUSE: $SNOWFLAKE_WAREHOUSE (default or from env)"
        print_success "COMPUTE_POOL: $COMPUTE_POOL"
        print_success "SNOWFLAKE_CONNECTION: $SNOWFLAKE_CONNECTION"
        
        # Validate connection
        if snow connection test -c "$SNOWFLAKE_CONNECTION" &> /dev/null; then
            print_success "Connection '$SNOWFLAKE_CONNECTION' verified"
        else
            print_warning "Connection test failed - will try anyway"
        fi
        
        # Postgres uses defaults in non-interactive mode
        if [ "$SETUP_POSTGRES" = "true" ]; then
            print_info "Postgres config: instance=$POSTGRES_INSTANCE, family=$POSTGRES_COMPUTE_FAMILY, storage=${POSTGRES_STORAGE_GB}GB"
        fi
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
    
    # Get registry URL from Snowflake CLI (handles account name normalization correctly)
    # Snowflake normalizes account identifiers: underscores become hyphens in registry URLs
    print_step "Getting registry URL from Snowflake..."
    REGISTRY_URL=$(snow spcs image-registry url --connection "$SNOWFLAKE_CONNECTION" 2>/dev/null | tr -d '[:space:]')
    if [ -z "$REGISTRY_URL" ]; then
        # Fallback to manual construction if CLI fails (e.g., no image repo exists yet)
        print_warning "Could not get registry URL from Snowflake CLI, using manual construction"
        print_info "Note: If your account has underscores, they become hyphens in registry URLs"
        REGISTRY_URL="${SNOWFLAKE_ACCOUNT}.registry.snowflakecomputing.com"
    fi
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
    
    if [ "$SETUP_CORTEX" = "true" ]; then
        config_summary="$config_summary
Cortex AI:    Enabled"
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
# STEP 2: INITIALIZE DATABASE & SCHEMAS
# =============================================================================

step_2_init_database() {
    print_header "2" "Initialize Database & Schemas"
    
    # Check if database already exists
    print_step "Checking if database exists..."
    local db_exists=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SHOW DATABASES LIKE '${SNOWFLAKE_DATABASE}'" 2>/dev/null | grep -c "${SNOWFLAKE_DATABASE}" || echo "0")
    
    if [ "$db_exists" -gt 0 ]; then
        print_success "Database ${SNOWFLAKE_DATABASE} already exists"
        
        # Check schemas
        print_step "Verifying schemas..."
        local schemas_ok=true
        for schema in PRODUCTION APPLICATIONS ML_DEMO CASCADE_ANALYSIS RAW; do
            local schema_exists=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "SHOW SCHEMAS LIKE '${schema}' IN DATABASE ${SNOWFLAKE_DATABASE}" 2>/dev/null | grep -c "${schema}" || echo "0")
            if [ "$schema_exists" -gt 0 ]; then
                print_success "  Schema $schema exists"
            else
                print_warning "  Schema $schema missing - will create"
                snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                    "CREATE SCHEMA IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${schema}" 2>/dev/null
            fi
        done
    else
        print_step "Creating database and schemas..."
        
        # Check if standalone quickstart SQL exists
        local quickstart_sql="$PROJECT_ROOT/scripts/sql/00_standalone_quickstart.sql"
        if [ -f "$quickstart_sql" ]; then
            print_info "Running standalone quickstart SQL..."
            if ! snow sql -c "$SNOWFLAKE_CONNECTION" -f "$quickstart_sql" 2>&1 | \
                grep -E "^(CREATE|USE|INSERT|SELECT)" | head -20 | while read line; do print_substep "$line"; done; then
                print_warning "Some SQL statements may have failed - checking results..."
            fi
            ROLLBACK_DATABASE=true
        else
            # Create database and schemas manually
            print_step "Creating database ${SNOWFLAKE_DATABASE}..."
            snow sql -c "$SNOWFLAKE_CONNECTION" -q "
                CREATE DATABASE IF NOT EXISTS ${SNOWFLAKE_DATABASE}
                DATA_RETENTION_TIME_IN_DAYS = 7
                COMMENT = 'Flux Operations Center - Grid Analytics & Visualization'
            " 2>/dev/null
            
            print_step "Creating warehouse ${SNOWFLAKE_WAREHOUSE}..."
            snow sql -c "$SNOWFLAKE_CONNECTION" -q "
                CREATE WAREHOUSE IF NOT EXISTS ${SNOWFLAKE_WAREHOUSE}
                WAREHOUSE_SIZE = 'MEDIUM'
                AUTO_SUSPEND = 300
                AUTO_RESUME = TRUE
                INITIALLY_SUSPENDED = FALSE
            " 2>/dev/null
            
            print_step "Creating schemas..."
            for schema in PRODUCTION APPLICATIONS ML_DEMO CASCADE_ANALYSIS RAW; do
                snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                    "CREATE SCHEMA IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${schema}" 2>/dev/null
                print_substep "Created schema: $schema"
            done
            
            ROLLBACK_DATABASE=true
        fi
    fi
    
    # Verify database is accessible
    print_step "Verifying database access..."
    if snow sql -c "$SNOWFLAKE_CONNECTION" -q "USE DATABASE ${SNOWFLAKE_DATABASE}" 2>/dev/null; then
        print_success "Database ${SNOWFLAKE_DATABASE} is accessible"
    else
        print_error "Cannot access database ${SNOWFLAKE_DATABASE}"
        exit 1
    fi
    
    STEP_2_DONE=true
    print_success "Database initialization completed"
}

# =============================================================================
# STEP 3: CREATE COMPUTE POOL
# =============================================================================

step_3_create_compute_pool() {
    print_header "3" "Create Compute Pool"
    
    # Check if compute pool already exists
    print_step "Checking if compute pool exists..."
    local pool_exists=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SHOW COMPUTE POOLS LIKE '${COMPUTE_POOL}'" 2>/dev/null | grep -c "${COMPUTE_POOL}" || echo "0")
    
    if [ "$pool_exists" -gt 0 ]; then
        print_success "Compute pool ${COMPUTE_POOL} already exists"
        
        # Check status
        local pool_state=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW COMPUTE POOLS LIKE '${COMPUTE_POOL}'" 2>/dev/null | grep -oE "ACTIVE|IDLE|STARTING|SUSPENDED" | head -1)
        
        if [ "$pool_state" = "SUSPENDED" ]; then
            print_step "Resuming suspended compute pool..."
            snow sql -c "$SNOWFLAKE_CONNECTION" -q "ALTER COMPUTE POOL ${COMPUTE_POOL} RESUME" 2>/dev/null
            print_success "Compute pool resumed"
        else
            print_success "Compute pool state: ${pool_state}"
        fi
    else
        print_step "Creating compute pool ${COMPUTE_POOL}..."
        
        # Prompt for compute pool size
        echo -ne "  ${YELLOW}?${NC} Compute pool instance family [${COMPUTE_POOL_SIZE}]: "
        read input; COMPUTE_POOL_SIZE="${input:-$COMPUTE_POOL_SIZE}"
        
        if ! snow sql -c "$SNOWFLAKE_CONNECTION" -q "
            CREATE COMPUTE POOL IF NOT EXISTS ${COMPUTE_POOL}
                MIN_NODES = 1
                MAX_NODES = 2
                INSTANCE_FAMILY = ${COMPUTE_POOL_SIZE}
                AUTO_SUSPEND_SECS = 3600
                AUTO_RESUME = TRUE
                COMMENT = 'Compute pool for Flux Operations Center SPCS'
        " 2>&1 | while read line; do print_substep "$line"; done; then
            print_error "Failed to create compute pool"
            print_warning "You may need ACCOUNTADMIN role to create compute pools"
            exit 1
        fi
        
        ROLLBACK_COMPUTE_POOL=true
        print_success "Compute pool ${COMPUTE_POOL} created"
        
        # Wait for pool to be ready
        print_step "Waiting for compute pool to be ready..."
        local max_attempts=30
        local attempt=0
        while [ $attempt -lt $max_attempts ]; do
            attempt=$((attempt + 1))
            local state=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "SHOW COMPUTE POOLS LIKE '${COMPUTE_POOL}'" 2>/dev/null | grep -oE "ACTIVE|IDLE|STARTING" | head -1)
            
            if [ "$state" = "ACTIVE" ] || [ "$state" = "IDLE" ]; then
                print_success "Compute pool is ready (${state})"
                break
            fi
            
            print_progress $attempt $max_attempts "State: ${state:-checking...}"
            sleep 10
        done
        echo ""
    fi
    
    STEP_3_DONE=true
    print_success "Compute pool setup completed"
}

# =============================================================================
# STEP 4: LOGIN TO REGISTRY
# =============================================================================

step_4_registry_login() {
    print_header "4" "Login to Snowflake Registry"
    
    print_step "Logging in to Snowflake image registry..."
    print_info "Using snow CLI for authentication (connection: $SNOWFLAKE_CONNECTION)"
    echo ""
    
    # Use snow CLI for registry login - handles auth properly and works with all auth methods
    if ! snow spcs image-registry login --connection "$SNOWFLAKE_CONNECTION"; then
        print_error "Failed to login to Snowflake registry"
        print_warning "Ensure your role has READ privilege on an image repository"
        print_info "To push images, your role also needs WRITE privilege:"
        echo -e "  GRANT WRITE ON IMAGE REPOSITORY $SNOWFLAKE_DATABASE.$SNOWFLAKE_SCHEMA.$IMAGE_REPO TO ROLE <your_role>;"
        exit 1
    fi
    
    STEP_4_DONE=true
    print_success "Logged in to Snowflake registry"
}

# =============================================================================
# STEP 5: BUILD FRONTEND
# =============================================================================

step_5_build_frontend() {
    print_header "5" "Build Frontend"
    
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
    
    STEP_5_DONE=true
    print_success "Frontend built successfully (dist/ created)"
}

# =============================================================================
# STEP 6: BUILD DOCKER IMAGE
# =============================================================================

step_6_build_docker() {
    print_header "6" "Build Docker Image"
    
    cd "$PROJECT_ROOT"
    
    local dockerfile="Dockerfile"
    if [ -f "Dockerfile.spcs" ]; then
        dockerfile="Dockerfile.spcs"
        print_info "Using Dockerfile.spcs for SPCS deployment"
    fi
    
    print_step "Building Docker image (linux/amd64 for SPCS compatibility)..."
    
    # Build with explicit AMD64 platform for SPCS compatibility (Apple Silicon builds ARM by default)
    local build_output
    build_output=$(docker build --platform linux/amd64 -t "flux_ops_center:${IMAGE_TAG}" -f "$dockerfile" . 2>&1)
    local build_status=$?
    
    # Display filtered output
    echo "$build_output" | grep -E "^(Step|Successfully|COPY|RUN|FROM)" | while read line; do print_substep "$line"; done
    
    if [ $build_status -ne 0 ]; then
        print_error "Docker build failed"
        echo "$build_output" | tail -20  # Show last 20 lines for debugging
        exit 1
    fi
    
    ROLLBACK_DOCKER=true
    
    STEP_6_DONE=true
    print_success "Docker image built: flux_ops_center:${IMAGE_TAG}"
}

# =============================================================================
# STEP 7: PUSH TO REGISTRY
# =============================================================================

step_7_push_image() {
    print_header "7" "Push to Snowflake Registry"
    
    # First ensure image repository exists
    print_step "Ensuring image repository exists..."
    snow sql -c "$SNOWFLAKE_CONNECTION" -q "
        CREATE IMAGE REPOSITORY IF NOT EXISTS ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${IMAGE_REPO}
        COMMENT = 'Image repository for Flux Operations Center'
    " 2>/dev/null
    
    print_step "Tagging image..."
    docker tag "flux_ops_center:${IMAGE_TAG}" "$FULL_IMAGE"
    print_success "Tagged as: $FULL_IMAGE"
    
    print_step "Pushing image to Snowflake..."
    
    # Capture push output and exit code properly (pipe masks exit codes)
    local push_output
    push_output=$(docker push "$FULL_IMAGE" 2>&1)
    local push_status=$?
    
    # Display filtered output
    echo "$push_output" | grep -E "^[a-f0-9]+:|latest:|Pushed|Digest" | while read line; do print_substep "$line"; done
    
    if [ $push_status -ne 0 ]; then
        print_error "Failed to push image"
        print_warning "Push output:"
        echo "$push_output" | tail -10
        print_warning "Ensure the image repository exists and you have access"
        exit 1
    fi
    
    STEP_7_DONE=true
    print_success "Image pushed successfully"
}

# =============================================================================
# STEP 8: DEPLOY SPCS SERVICE
# =============================================================================

step_8_deploy_service() {
    print_header "8" "Deploy SPCS Service"
    
    print_step "Generating deployment SQL..."
    
    # Generate SQL file
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
    EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI)
    COMMENT = 'Flux Operations Center - Real-time Grid Visualization';

SELECT SYSTEM\$GET_SERVICE_STATUS('${SERVICE_NAME}');
EOF
    
    print_success "Generated: $SQL_FILE"
    ROLLBACK_SQL=true
    
    print_step "Creating SPCS service..."
    
    if ! snow sql -c "$SNOWFLAKE_CONNECTION" -f "$SQL_FILE" 2>&1 | while read line; do print_substep "$line"; done; then
        print_error "Failed to deploy SPCS service"
        exit 1
    fi
    
    ROLLBACK_SERVICE=true
    
    # Wait for service to start
    print_step "Waiting for service to initialize..."
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
        snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW ENDPOINTS IN SERVICE ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}" 2>/dev/null
    else
        print_warning "Service not ready after ${max_attempts} attempts - continuing anyway"
    fi
    
    STEP_8_DONE=true
    print_success "SPCS service deployment initiated"
}

# =============================================================================
# STEP 9: CREATE POSTGRES INSTANCE
# =============================================================================

step_9_create_postgres() {
    if [ "$SETUP_POSTGRES" != "true" ]; then
        print_info "Skipping Postgres setup (SETUP_POSTGRES=false)"
        STEP_9_DONE=true
        return
    fi
    
    print_header "9" "Create Postgres Instance"
    
    # Check if Postgres instance already exists
    print_step "Checking if Postgres instance exists..."
    local pg_exists=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | grep -c "${POSTGRES_INSTANCE}" || echo "0")
    
    if [ "$pg_exists" -gt 0 ]; then
        print_success "Postgres instance ${POSTGRES_INSTANCE} already exists"
        
        # Get host
        POSTGRES_HOST=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | \
            grep -oE "[a-z0-9-]+\.postgres\.snowflake\.app" | head -1)
        
        if [ -n "$POSTGRES_HOST" ]; then
            print_success "Postgres host: $POSTGRES_HOST"
        fi
    else
        echo ""
        echo -e "  ${RED}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "  ${RED}║${NC} ${BOLD}IMPORTANT: Save the Postgres credentials shown below!${NC}                   ${RED}║${NC}"
        echo -e "  ${RED}║${NC} ${DIM}They cannot be retrieved later.${NC}                                         ${RED}║${NC}"
        echo -e "  ${RED}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        # Generate Postgres SQL
        cat > "$POSTGRES_SQL_FILE" << EOF
-- Flux Operations Center - Snowflake Postgres Setup
-- Generated: $(date)

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
        
        print_step "Creating Postgres instance and network rules..."
        
        # Capture output to extract credentials and check for errors
        local pg_output
        pg_output=$(snow sql -c "$SNOWFLAKE_CONNECTION" -f "$POSTGRES_SQL_FILE" 2>&1)
        local pg_sql_status=$?
        
        # Display output, highlighting credentials
        echo "$pg_output" | while read line; do
            if [[ "$line" == *"password"* ]] || [[ "$line" == *"PASSWORD"* ]] || [[ "$line" == *"user"* ]]; then
                echo -e "    ${RED}${BOLD}>>> $line${NC}"
            else
                print_substep "$line"
            fi
        done
        
        # Check if SQL execution failed
        if [ $pg_sql_status -ne 0 ]; then
            print_error "Failed to create Postgres instance"
            print_warning "Common causes:"
            print_warning "  - Snowflake Postgres not enabled for this account"
            print_warning "  - Insufficient privileges (requires ACCOUNTADMIN)"
            print_warning "  - Network policy creation failed"
            echo ""
            print_warning "SQL output:"
            echo "$pg_output" | tail -15
            exit 1
        fi
        
        # Also check if output contains error indicators
        if echo "$pg_output" | grep -qiE "error|failed|denied|not authorized"; then
            print_error "Postgres creation may have failed - check output above"
            print_warning "If you see permission errors, ensure you have ACCOUNTADMIN role"
        fi
        
        ROLLBACK_POSTGRES=true
        
        # Wait for Postgres to be ready
        print_step "Waiting for Postgres instance to be ready..."
        local max_attempts=60
        local attempt=0
        
        while [ $attempt -lt $max_attempts ]; do
            attempt=$((attempt + 1))
            
            local pg_state=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
                "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | \
                grep -oE "RUNNING|STARTING|SUSPENDED|FAILED" | head -1)
            
            print_progress $attempt $max_attempts "State: ${pg_state:-checking...}"
            
            if [ "$pg_state" = "RUNNING" ]; then
                echo ""
                print_success "Postgres instance is RUNNING"
                break
            elif [ "$pg_state" = "FAILED" ]; then
                echo ""
                print_error "Postgres instance FAILED"
                exit 1
            fi
            
            sleep 10
        done
        echo ""
        
        # Get Postgres host
        POSTGRES_HOST=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | \
            grep -oE "[a-z0-9-]+\.postgres\.snowflake\.app" | head -1)
        
        if [ -n "$POSTGRES_HOST" ]; then
            print_success "Postgres host: $POSTGRES_HOST"
        fi
        
        # Prompt for credentials that were shown (only in interactive mode)
        if [ "$INTERACTIVE_MODE" = true ]; then
            echo ""
            print_warning "Enter the Postgres credentials that were displayed above:"
            echo -ne "  ${YELLOW}?${NC} Postgres username (usually 'application'): "
            read POSTGRES_USER
            POSTGRES_USER="${POSTGRES_USER:-application}"
            
            echo -ne "  ${YELLOW}?${NC} Postgres password: "
            read -s POSTGRES_PASSWORD
            echo ""
        else
            # Non-interactive mode: use environment variables or defaults
            POSTGRES_USER="${POSTGRES_USER:-application}"
            if [ -z "$POSTGRES_PASSWORD" ]; then
                print_warning "Non-interactive mode: POSTGRES_PASSWORD not set"
                print_warning "Set POSTGRES_PASSWORD environment variable or run interactively"
                print_warning "You can load PostGIS data later with:"
                print_info "  python backend/scripts/load_postgis_data.py --host <HOST> --user <USER> --password <PASS>"
            fi
        fi
    fi
    
    STEP_9_DONE=true
    print_success "Postgres instance setup completed"
}

# =============================================================================
# STEP 10: CONFIGURE EXTERNAL ACCESS
# =============================================================================

step_10_external_access() {
    print_header "10" "Configure External Access Integration"
    
    print_step "Creating CARTO basemap integration (required for map tiles)..."
    
    # Create CARTO network rule and integration (always needed for map)
    snow sql -c "$SNOWFLAKE_CONNECTION" -q "
        USE ROLE ACCOUNTADMIN;
        USE DATABASE ${SNOWFLAKE_DATABASE};
        USE SCHEMA ${SNOWFLAKE_SCHEMA};
        
        CREATE NETWORK RULE IF NOT EXISTS FLUX_CARTO_NETWORK_RULE
            TYPE = HOST_PORT
            VALUE_LIST = (
                'basemaps.cartocdn.com:443',
                'tiles.basemaps.cartocdn.com:443',
                'tiles-a.basemaps.cartocdn.com:443',
                'tiles-b.basemaps.cartocdn.com:443',
                'tiles-c.basemaps.cartocdn.com:443',
                'tiles-d.basemaps.cartocdn.com:443',
                'a.basemaps.cartocdn.com:443',
                'b.basemaps.cartocdn.com:443',
                'c.basemaps.cartocdn.com:443',
                'd.basemaps.cartocdn.com:443',
                'unpkg.com:443'
            )
            MODE = EGRESS
            COMMENT = 'Allows map tile loading from CARTO CDN';
        
        CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS FLUX_CARTO_INTEGRATION
            ALLOWED_NETWORK_RULES = (${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.FLUX_CARTO_NETWORK_RULE)
            ENABLED = TRUE
            COMMENT = 'External access for CARTO basemap tiles';
        
        GRANT USAGE ON INTEGRATION FLUX_CARTO_INTEGRATION TO ROLE SYSADMIN;
    " 2>/dev/null
    
    print_success "CARTO integration created"
    
    print_step "Creating Google Fonts integration..."
    
    # Create Google Fonts network rule and integration
    snow sql -c "$SNOWFLAKE_CONNECTION" -q "
        USE ROLE ACCOUNTADMIN;
        USE DATABASE ${SNOWFLAKE_DATABASE};
        USE SCHEMA ${SNOWFLAKE_SCHEMA};
        
        CREATE NETWORK RULE IF NOT EXISTS FLUX_GOOGLE_FONTS_NETWORK_RULE
            TYPE = HOST_PORT
            VALUE_LIST = (
                'fonts.googleapis.com:443',
                'fonts.gstatic.com:443'
            )
            MODE = EGRESS
            COMMENT = 'Allows Google Fonts loading';
        
        CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS GOOGLE_FONTS_EAI
            ALLOWED_NETWORK_RULES = (${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.FLUX_GOOGLE_FONTS_NETWORK_RULE)
            ENABLED = TRUE
            COMMENT = 'External access for Google Fonts';
        
        GRANT USAGE ON INTEGRATION GOOGLE_FONTS_EAI TO ROLE SYSADMIN;
    " 2>/dev/null
    
    print_success "Google Fonts integration created"
    
    # Postgres integration (only if Postgres is being set up)
    if [ "$SETUP_POSTGRES" != "true" ]; then
        print_info "Skipping Postgres external access (SETUP_POSTGRES=false)"
        STEP_10_DONE=true
        print_success "External access configuration completed (CARTO + Fonts)"
        return
    fi
    
    # Check if we have Postgres host
    if [ -z "$POSTGRES_HOST" ]; then
        print_step "Getting Postgres host..."
        POSTGRES_HOST=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | \
            grep -oE "[a-z0-9-]+\.postgres\.snowflake\.app" | head -1)
        
        if [ -z "$POSTGRES_HOST" ]; then
            print_warning "Could not get Postgres host - skipping Postgres external access"
            print_info "You can set this up later with scripts/sql/05a_external_access.sql"
            STEP_10_DONE=true
            return
        fi
    fi
    
    # Prompt for credentials if not already set (only in interactive mode)
    if [ -z "$POSTGRES_USER" ]; then
        if [ "$INTERACTIVE_MODE" = true ]; then
            echo -ne "  ${YELLOW}?${NC} Postgres username [application]: "
            read POSTGRES_USER
        fi
        POSTGRES_USER="${POSTGRES_USER:-application}"
    fi
    
    if [ -z "$POSTGRES_PASSWORD" ]; then
        if [ "$INTERACTIVE_MODE" = true ]; then
            echo -ne "  ${YELLOW}?${NC} Postgres password: "
            read -s POSTGRES_PASSWORD
            echo ""
        fi
    fi
    
    if [ -z "$POSTGRES_PASSWORD" ]; then
        print_warning "No password provided - skipping Postgres external access setup"
        print_info "You can set this up later with scripts/sql/05a_external_access.sql"
        STEP_10_DONE=true
        return
    fi
    
    print_step "Creating Postgres external access integration..."
    
    # Create network rule
    snow sql -c "$SNOWFLAKE_CONNECTION" -q "
        USE ROLE ACCOUNTADMIN;
        USE DATABASE ${SNOWFLAKE_DATABASE};
        USE SCHEMA ${SNOWFLAKE_SCHEMA};
        
        CREATE OR REPLACE NETWORK RULE FLUX_POSTGRES_EGRESS_RULE
            TYPE = HOST_PORT
            VALUE_LIST = ('${POSTGRES_HOST}:5432')
            MODE = EGRESS
            COMMENT = 'Allows Snowflake procedures to connect to Flux Ops Postgres';
    " 2>/dev/null
    
    # Create secret
    snow sql -c "$SNOWFLAKE_CONNECTION" -q "
        USE ROLE ACCOUNTADMIN;
        USE DATABASE ${SNOWFLAKE_DATABASE};
        USE SCHEMA ${SNOWFLAKE_SCHEMA};
        
        CREATE OR REPLACE SECRET POSTGRES_CREDENTIALS
            TYPE = PASSWORD
            USERNAME = '${POSTGRES_USER}'
            PASSWORD = '${POSTGRES_PASSWORD}'
            COMMENT = 'Credentials for Flux Ops Center Postgres instance';
    " 2>/dev/null
    
    # Create integration
    snow sql -c "$SNOWFLAKE_CONNECTION" -q "
        USE ROLE ACCOUNTADMIN;
        
        CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION FLUX_POSTGRES_INTEGRATION
            ALLOWED_NETWORK_RULES = (${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.FLUX_POSTGRES_EGRESS_RULE)
            ALLOWED_AUTHENTICATION_SECRETS = (${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.POSTGRES_CREDENTIALS)
            ENABLED = TRUE
            COMMENT = 'External access for Flux Ops Postgres connectivity';
        
        GRANT USAGE ON INTEGRATION FLUX_POSTGRES_INTEGRATION TO ROLE SYSADMIN;
        GRANT USAGE ON SECRET ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.POSTGRES_CREDENTIALS TO ROLE SYSADMIN;
    " 2>/dev/null
    
    ROLLBACK_EXTERNAL_ACCESS=true
    
    print_success "Postgres external access integration created"
    print_substep "Network Rule: FLUX_POSTGRES_EGRESS_RULE"
    print_substep "Secret: POSTGRES_CREDENTIALS"
    print_substep "Integration: FLUX_POSTGRES_INTEGRATION"
    
    STEP_10_DONE=true
    print_success "External access configuration completed"
}

# =============================================================================
# STEP 11: LOAD POSTGIS DATA
# =============================================================================

step_11_load_postgis_data() {
    if [ "$SETUP_POSTGRES" != "true" ]; then
        print_info "Skipping PostGIS data loading (no Postgres)"
        STEP_11_DONE=true
        return
    fi
    
    print_header "11" "Load PostGIS Data"
    
    # Check if we have Postgres connection info
    if [ -z "$POSTGRES_HOST" ]; then
        POSTGRES_HOST=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | \
            grep -oE "[a-z0-9-]+\.postgres\.snowflake\.app" | head -1)
    fi
    
    if [ -z "$POSTGRES_HOST" ] || [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ]; then
        print_warning "Missing Postgres connection details"
        print_info "You can load data later with:"
        print_substep "python backend/scripts/load_postgis_data.py --host <HOST> --user <USER> --password <PASS>"
        STEP_11_DONE=true
        return
    fi
    
    # Check if load script exists
    local load_script="$PROJECT_ROOT/backend/scripts/load_postgis_data.py"
    if [ ! -f "$load_script" ]; then
        print_warning "PostGIS load script not found at $load_script"
        STEP_11_DONE=true
        return
    fi
    
    # Check Python dependencies
    print_step "Checking Python dependencies..."
    if ! python3 -c "import psycopg2" 2>/dev/null; then
        print_step "Installing psycopg2..."
        pip3 install psycopg2-binary 2>/dev/null || true
    fi
    
    print_step "Loading PostGIS data (this may take 10-30 minutes)..."
    print_info "Data includes: buildings, water bodies, power lines, vegetation risk, etc."
    print_info "Also creates derived views: buildings_spatial, grid_assets, vegetation_risk_computed"
    echo ""
    
    if confirm "Load PostGIS data now?" "y"; then
        cd "$PROJECT_ROOT"
        
        if python3 backend/scripts/load_postgis_data.py \
            --host "$POSTGRES_HOST" \
            --user "$POSTGRES_USER" \
            --password "$POSTGRES_PASSWORD" \
            --database postgres 2>&1 | while read line; do
                if [[ "$line" == *"Loading"* ]] || [[ "$line" == *"Complete"* ]] || [[ "$line" == *"Error"* ]] || [[ "$line" == *"SUCCESS"* ]] || [[ "$line" == *"DERIVED"* ]] || [[ "$line" == *"Creating"* ]]; then
                    print_substep "$line"
                fi
            done; then
            print_success "PostGIS data and derived views created successfully"
        else
            print_warning "PostGIS data loading had some issues"
            print_info "You can retry later with the command above"
        fi
    else
        print_info "Skipped PostGIS data loading"
        print_substep "Run later: python backend/scripts/load_postgis_data.py --host $POSTGRES_HOST"
    fi
    
    STEP_11_DONE=true
    print_success "PostGIS data step completed"
}

# =============================================================================
# STEP 12: SETUP CORTEX AI
# =============================================================================

step_12_setup_cortex() {
    if [ "$SETUP_CORTEX" != "true" ]; then
        print_info "Skipping Cortex AI setup (SETUP_CORTEX=false)"
        STEP_12_DONE=true
        return
    fi
    
    print_header "12" "Setup Cortex AI (Search Services)"
    
    # Check if Cortex Search SQL exists
    local cortex_sql="$PROJECT_ROOT/scripts/sql/07_create_cortex_search.sql"
    if [ ! -f "$cortex_sql" ]; then
        print_warning "Cortex Search SQL not found at $cortex_sql"
        STEP_12_DONE=true
        return
    fi
    
    print_step "Creating Cortex Search services..."
    print_info "This enables RAG-based chat for the Grid Intelligence Assistant"
    
    # Check if source tables exist
    local tech_docs=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SELECT COUNT(*) FROM ${SNOWFLAKE_DATABASE}.PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS" 2>/dev/null | grep -E "^[0-9]+" | head -1)
    
    if [ -z "$tech_docs" ] || [ "$tech_docs" = "0" ]; then
        print_warning "Source tables for Cortex Search not found"
        print_info "You need to load technical documentation first"
        print_substep "Tables needed: PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS, ML_DEMO.COMPLIANCE_DOCS"
        STEP_12_DONE=true
        return
    fi
    
    # Run Cortex Search setup
    if snow sql -c "$SNOWFLAKE_CONNECTION" -f "$cortex_sql" \
        -D "database=${SNOWFLAKE_DATABASE}" \
        -D "warehouse=${SNOWFLAKE_WAREHOUSE}" 2>&1 | \
        grep -E "^(CREATE|SELECT|Created)" | while read line; do print_substep "$line"; done; then
        print_success "Cortex Search services created"
    else
        print_warning "Cortex Search setup had issues - check manually"
    fi
    
    # Check for agent setup
    local agent_sql="$PROJECT_ROOT/scripts/sql/08_create_cortex_agent.sql"
    if [ -f "$agent_sql" ]; then
        if confirm "Also create Cortex Agent?" "n"; then
            print_step "Creating Cortex Agent..."
            snow sql -c "$SNOWFLAKE_CONNECTION" -f "$agent_sql" \
                -D "database=${SNOWFLAKE_DATABASE}" \
                -D "warehouse=${SNOWFLAKE_WAREHOUSE}" 2>&1 | \
                grep -E "^(CREATE|SELECT)" | while read line; do print_substep "$line"; done
        fi
    fi
    
    STEP_12_DONE=true
    print_success "Cortex AI setup completed"
}

# =============================================================================
# STEP 13: HEALTH CHECK & VALIDATION
# =============================================================================

step_13_health_check() {
    print_header "13" "Health Check & Validation"
    
    local all_healthy=true
    
    # Check SPCS service
    print_subheader "SPCS Service Health"
    local service_status=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
        "SELECT SYSTEM\$GET_SERVICE_STATUS('${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}')" 2>/dev/null | \
        grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ "$service_status" = "READY" ]; then
        print_success "SPCS Service: READY"
        
        # Get and test endpoints
        print_step "Testing endpoints..."
        local app_url=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW ENDPOINTS IN SERVICE ${SNOWFLAKE_DATABASE}.${SNOWFLAKE_SCHEMA}.${SERVICE_NAME}" 2>/dev/null | \
            grep -oE "https://[a-z0-9-]+\.snowflakecomputing\.app" | head -1)
        
        if [ -n "$app_url" ]; then
            print_success "App URL: $app_url"
            
            # Test if endpoint responds
            local http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$app_url" 2>/dev/null || echo "000")
            if [ "$http_code" = "200" ] || [ "$http_code" = "302" ] || [ "$http_code" = "304" ]; then
                print_success "Frontend responding (HTTP $http_code)"
            else
                print_warning "Frontend returned HTTP $http_code"
                all_healthy=false
            fi
        fi
    else
        print_warning "SPCS Service: ${service_status:-NOT FOUND}"
        all_healthy=false
    fi
    
    # Check Postgres if enabled
    if [ "$SETUP_POSTGRES" = "true" ]; then
        print_subheader "Postgres Instance Health"
        
        local pg_state=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW POSTGRES INSTANCES LIKE '${POSTGRES_INSTANCE}'" 2>/dev/null | \
            grep -oE "RUNNING|STARTING|SUSPENDED|FAILED" | head -1)
        
        if [ "$pg_state" = "RUNNING" ]; then
            print_success "Postgres Instance: RUNNING"
            
            if [ -n "$POSTGRES_HOST" ]; then
                print_success "Postgres Host: $POSTGRES_HOST"
            fi
        else
            print_warning "Postgres Instance: ${pg_state:-NOT FOUND}"
            all_healthy=false
        fi
    fi
    
    # Check Cortex if enabled
    if [ "$SETUP_CORTEX" = "true" ]; then
        print_subheader "Cortex AI Health"
        
        local cortex_count=$(snow sql -c "$SNOWFLAKE_CONNECTION" -q \
            "SHOW CORTEX SEARCH SERVICES IN DATABASE ${SNOWFLAKE_DATABASE}" 2>/dev/null | \
            grep -c "SEARCH" || echo "0")
        
        if [ "$cortex_count" -gt 0 ]; then
            print_success "Cortex Search Services: $cortex_count found"
        else
            print_warning "Cortex Search Services: none found"
        fi
    fi
    
    # Summary
    echo ""
    if [ "$all_healthy" = true ]; then
        print_success "All health checks passed!"
    else
        print_warning "Some health checks failed - see above"
    fi
    
    STEP_13_DONE=true
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
    local step_runs=("$STEP_1_RUN" "$STEP_2_RUN" "$STEP_3_RUN" "$STEP_4_RUN" "$STEP_5_RUN" "$STEP_6_RUN" "$STEP_7_RUN" "$STEP_8_RUN" "$STEP_9_RUN" "$STEP_10_RUN" "$STEP_11_RUN" "$STEP_12_RUN" "$STEP_13_RUN")
    local step_dones=("$STEP_1_DONE" "$STEP_2_DONE" "$STEP_3_DONE" "$STEP_4_DONE" "$STEP_5_DONE" "$STEP_6_DONE" "$STEP_7_DONE" "$STEP_8_DONE" "$STEP_9_DONE" "$STEP_10_DONE" "$STEP_11_DONE" "$STEP_12_DONE" "$STEP_13_DONE")
    local i=0
    for step in "${STEP_NAMES[@]}"; do
        local num="${step%%:*}"
        local name="${step#*:}"
        if [ "${step_dones[$i]}" = true ]; then
            echo -e "  ${GREEN}${CHECK}${NC} Step $num: $name"
        elif [ "${step_runs[$i]}" = true ]; then
            echo -e "  ${YELLOW}○${NC} Step $num: $name ${DIM}(skipped/partial)${NC}"
        else
            echo -e "  ${DIM}─ Step $num: $name (not selected)${NC}"
        fi
        ((i++))
    done
    
    echo ""
    echo -e "${BOLD}Next Steps:${NC}"
    echo -e "  ${CYAN}1.${NC} Open the 'app' endpoint URL in your browser"
    
    if [ "$SETUP_POSTGRES" = "true" ]; then
        echo -e "  ${CYAN}2.${NC} Verify PostGIS data loaded correctly in the map view"
        if [ -n "$POSTGRES_HOST" ]; then
            echo -e "  ${CYAN}3.${NC} Connect to Postgres: psql -h $POSTGRES_HOST -U ${POSTGRES_USER:-application} -d postgres"
        fi
    fi
    
    echo ""
    echo -e "${BOLD}Useful Commands:${NC}"
    echo -e "  ${DIM}# Check deployment status${NC}"
    echo -e "  ./scripts/quickstart.sh --status"
    echo ""
    echo -e "  ${DIM}# Check service status${NC}"
    echo -e "  snow sql -c $SNOWFLAKE_CONNECTION -q \"SELECT SYSTEM\\\$GET_SERVICE_STATUS('${SERVICE_NAME}')\""
    echo ""
    echo -e "  ${DIM}# View service logs${NC}"
    echo -e "  snow sql -c $SNOWFLAKE_CONNECTION -q \"CALL SYSTEM\\\$GET_SERVICE_LOGS('${SERVICE_NAME}', 0, 'flux-ops-center')\""
    echo ""
    
    if [ -n "$POSTGRES_HOST" ]; then
        echo -e "  ${DIM}# Reset Postgres password (if lost)${NC}"
        echo -e "  snow sql -c $SNOWFLAKE_CONNECTION -q \"ALTER POSTGRES INSTANCE ${POSTGRES_INSTANCE} RESET CREDENTIALS\""
        echo ""
    fi
    
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
                STEP_6_RUN=true; STEP_7_RUN=true; STEP_8_RUN=true; STEP_9_RUN=true; STEP_10_RUN=true
                STEP_11_RUN=true; STEP_12_RUN=true; STEP_13_RUN=true
                ;;
            --skip-build)
                SKIP_BUILD=true
                ;;
            --skip-postgres)
                SETUP_POSTGRES=false
                ;;
            --with-cortex)
                SETUP_CORTEX=true
                ;;
            --status)
                STATUS_CHECK=true
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --all           Run all steps non-interactively"
                echo "  --skip-build    Skip frontend and Docker build steps (5-7)"
                echo "  --skip-postgres Skip Postgres setup (steps 9-11)"
                echo "  --with-cortex   Include Cortex AI setup (step 12)"
                echo "  --status        Check current deployment status and exit"
                echo "  --help          Show this help message"
                echo ""
                echo "Steps:"
                for step in "${STEP_NAMES[@]}"; do
                    local num="${step%%:*}"
                    local name="${step#*:}"
                    printf "  %2s. %s\n" "$num" "$name"
                done
                exit 0
                ;;
        esac
    done
    
    # Handle status check
    if [ "$STATUS_CHECK" = true ]; then
        check_deployment_status
    fi
    
    print_banner
    
    # Show step menu if interactive
    if [ "$INTERACTIVE_MODE" = true ]; then
        show_step_menu
    fi
    
    # Apply --skip-build if set
    if [ "$SKIP_BUILD" = true ]; then
        STEP_5_RUN=false
        STEP_6_RUN=false
        STEP_7_RUN=false
    fi
    
    # Execute selected steps
    [ "${STEP_1_RUN}" = true ] && step_1_prerequisites
    [ "${STEP_2_RUN}" = true ] && step_2_init_database
    [ "${STEP_3_RUN}" = true ] && step_3_create_compute_pool
    [ "${STEP_4_RUN}" = true ] && step_4_registry_login
    [ "${STEP_5_RUN}" = true ] && step_5_build_frontend
    [ "${STEP_6_RUN}" = true ] && step_6_build_docker
    [ "${STEP_7_RUN}" = true ] && step_7_push_image
    [ "${STEP_8_RUN}" = true ] && step_8_deploy_service
    [ "${STEP_9_RUN}" = true ] && step_9_create_postgres
    [ "${STEP_10_RUN}" = true ] && step_10_external_access
    [ "${STEP_11_RUN}" = true ] && step_11_load_postgis_data
    [ "${STEP_12_RUN}" = true ] && step_12_setup_cortex
    [ "${STEP_13_RUN}" = true ] && step_13_health_check
    
    show_completion_summary
}

# Run main
main "$@"
