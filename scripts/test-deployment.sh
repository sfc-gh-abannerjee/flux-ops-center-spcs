#!/bin/bash
# =============================================================================
# Flux Operations Center - Deployment Test Harness
# =============================================================================
# This script validates that all deployment prerequisites are met before
# attempting to build and deploy. Run this locally or in CI to catch issues
# early (like the missing dist/ directory bug).
#
# Usage:
#   ./scripts/test-deployment.sh [--fix]
#
# Options:
#   --fix    Attempt to fix issues automatically (e.g., run npm ci/build)
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
# =============================================================================

# Don't use set -e - we handle failures ourselves
# set -e would make the script exit on any command failure

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track failures
FAILURES=0
WARNINGS=0
FIX_MODE=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --fix)
            FIX_MODE=true
            shift
            ;;
    esac
done

# Get project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# -----------------------------------------------------------------------------
# HELPER FUNCTIONS
# -----------------------------------------------------------------------------

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_pass() {
    echo -e "  ${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "  ${RED}✗${NC} $1"
    ((FAILURES++))
}

check_warn() {
    echo -e "  ${YELLOW}!${NC} $1"
    ((WARNINGS++))
}

check_info() {
    echo -e "  ${BLUE}ℹ${NC} $1"
}

# -----------------------------------------------------------------------------
# TEST 1: REQUIRED FILES EXIST
# -----------------------------------------------------------------------------

print_header "Test 1: Required Files"

REQUIRED_FILES=(
    "package.json"
    "package-lock.json"
    "tsconfig.json"
    "vite.config.ts"
    "Dockerfile"
    "Dockerfile.spcs"
    "backend/requirements.txt"
    "backend/server_fastapi.py"
    "scripts/quickstart.sh"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        check_pass "$file exists"
    else
        check_fail "$file is MISSING"
    fi
done

# -----------------------------------------------------------------------------
# TEST 2: DOCKERFILE REQUIREMENTS
# -----------------------------------------------------------------------------

print_header "Test 2: Dockerfile Validation"

# Check that Dockerfile.spcs expects dist/ directory
if grep -q "COPY dist/" Dockerfile.spcs 2>/dev/null; then
    check_pass "Dockerfile.spcs expects dist/ directory"
    
    # Verify quickstart.sh builds frontend before docker build
    if grep -q "npm run build" scripts/quickstart.sh 2>/dev/null; then
        check_pass "quickstart.sh builds frontend before Docker build"
    else
        check_fail "quickstart.sh does NOT build frontend before Docker build"
        check_info "This will cause 'COPY dist/ ./dist/: not found' error"
    fi
else
    check_warn "Dockerfile.spcs doesn't copy dist/ - verify build process"
fi

# Check both Dockerfiles are consistent
if [ -f "Dockerfile" ] && [ -f "Dockerfile.spcs" ]; then
    # Compare key parts
    DOCKERFILE_COPY=$(grep "COPY dist/" Dockerfile 2>/dev/null || echo "none")
    DOCKERFILE_SPCS_COPY=$(grep "COPY dist/" Dockerfile.spcs 2>/dev/null || echo "none")
    
    if [ "$DOCKERFILE_COPY" = "$DOCKERFILE_SPCS_COPY" ]; then
        check_pass "Dockerfile and Dockerfile.spcs have consistent dist/ handling"
    else
        check_warn "Dockerfile and Dockerfile.spcs have different dist/ handling"
    fi
fi

# Check Python version consistency
DOCKERFILE_PYTHON=$(grep "FROM python:" Dockerfile | head -1 | sed 's/FROM python://' | cut -d'-' -f1)
DOCKERFILE_SPCS_PYTHON=$(grep "FROM python:" Dockerfile.spcs | head -1 | sed 's/FROM python://' | cut -d'-' -f1)

if [ "$DOCKERFILE_PYTHON" = "$DOCKERFILE_SPCS_PYTHON" ]; then
    check_pass "Python version consistent: $DOCKERFILE_PYTHON"
else
    check_warn "Python versions differ: Dockerfile=$DOCKERFILE_PYTHON, Dockerfile.spcs=$DOCKERFILE_SPCS_PYTHON"
fi

# -----------------------------------------------------------------------------
# TEST 3: FRONTEND BUILD
# -----------------------------------------------------------------------------

print_header "Test 3: Frontend Build"

# Check if node_modules exists
if [ -d "node_modules" ]; then
    check_pass "node_modules/ exists"
else
    check_warn "node_modules/ missing"
    if [ "$FIX_MODE" = true ]; then
        check_info "Running npm ci..."
        npm ci
        check_pass "npm ci completed"
    else
        check_info "Run with --fix to install dependencies"
    fi
fi

# Check if dist/ exists and has content
if [ -d "dist" ] && [ "$(ls -A dist 2>/dev/null)" ]; then
    check_pass "dist/ exists and has content"
    
    # Check for required frontend files
    if [ -f "dist/index.html" ]; then
        check_pass "dist/index.html exists"
    else
        check_fail "dist/index.html is MISSING"
    fi
    
    if [ -d "dist/assets" ]; then
        check_pass "dist/assets/ directory exists"
    else
        check_warn "dist/assets/ directory missing"
    fi
else
    check_fail "dist/ directory missing or empty"
    check_info "Frontend must be built before Docker build"
    if [ "$FIX_MODE" = true ]; then
        check_info "Running npm run build..."
        npm run build
        if [ -d "dist" ] && [ -f "dist/index.html" ]; then
            check_pass "Frontend build completed successfully"
        else
            check_fail "Frontend build did not create expected output"
        fi
    else
        check_info "Run with --fix or: npm ci && npm run build"
    fi
fi

# Verify TypeScript compiles (note: strict mode may show warnings that don't block build)
if command -v npx &> /dev/null && [ -d "node_modules" ]; then
    check_info "Checking TypeScript compilation..."
    TSC_OUTPUT=$(npx tsc --noEmit 2>&1 || true)
    # grep -c returns 1 if no matches, so we need to handle that
    TSC_ERRORS=$(echo "$TSC_OUTPUT" | grep -c "error TS" 2>/dev/null) || TSC_ERRORS=0
    if [ "$TSC_ERRORS" -eq 0 ]; then
        check_pass "TypeScript compiles without errors"
    else
        check_warn "TypeScript has $TSC_ERRORS type warnings (non-blocking for Vite builds)"
        check_info "Vite uses esbuild which ignores type errors during build"
    fi
fi

# -----------------------------------------------------------------------------
# TEST 4: BACKEND VALIDATION
# -----------------------------------------------------------------------------

print_header "Test 4: Backend Validation"

# Check requirements.txt has key dependencies
REQUIRED_PACKAGES=(
    "fastapi"
    "uvicorn"
    "snowflake-connector-python"
    "psycopg2-binary"
    "asyncpg"
)

for pkg in "${REQUIRED_PACKAGES[@]}"; do
    if grep -qi "$pkg" backend/requirements.txt 2>/dev/null; then
        check_pass "backend/requirements.txt includes $pkg"
    else
        check_fail "backend/requirements.txt is MISSING $pkg"
    fi
done

# Check server_fastapi.py exists and has key endpoints
if [ -f "backend/server_fastapi.py" ]; then
    check_pass "backend/server_fastapi.py exists"
    
    # Check for critical endpoints
    CRITICAL_ENDPOINTS=(
        "/api/initial-load"
        "/api/health"
    )
    
    for endpoint in "${CRITICAL_ENDPOINTS[@]}"; do
        if grep -q "$endpoint" backend/server_fastapi.py 2>/dev/null; then
            check_pass "Endpoint $endpoint defined"
        else
            check_warn "Endpoint $endpoint not found"
        fi
    done
fi

# Python syntax check
if command -v python3 &> /dev/null; then
    check_info "Checking Python syntax..."
    if python3 -m py_compile backend/server_fastapi.py 2>/dev/null; then
        check_pass "backend/server_fastapi.py has valid syntax"
    else
        check_fail "backend/server_fastapi.py has syntax errors"
    fi
fi

# -----------------------------------------------------------------------------
# TEST 5: QUICKSTART SCRIPT VALIDATION
# -----------------------------------------------------------------------------

print_header "Test 5: Quickstart Script Validation"

if [ -f "scripts/quickstart.sh" ]; then
    # Check script is executable
    if [ -x "scripts/quickstart.sh" ]; then
        check_pass "quickstart.sh is executable"
    else
        check_warn "quickstart.sh is not executable"
        if [ "$FIX_MODE" = true ]; then
            chmod +x scripts/quickstart.sh
            check_pass "Made quickstart.sh executable"
        fi
    fi
    
    # Check for required steps in correct order
    FRONTEND_BUILD_LINE=$(grep -n "npm run build" scripts/quickstart.sh | head -1 | cut -d: -f1)
    DOCKER_BUILD_LINE=$(grep -n "docker build" scripts/quickstart.sh | head -1 | cut -d: -f1)
    
    if [ -n "$FRONTEND_BUILD_LINE" ] && [ -n "$DOCKER_BUILD_LINE" ]; then
        if [ "$FRONTEND_BUILD_LINE" -lt "$DOCKER_BUILD_LINE" ]; then
            check_pass "Frontend build (line $FRONTEND_BUILD_LINE) comes before Docker build (line $DOCKER_BUILD_LINE)"
        else
            check_fail "Docker build (line $DOCKER_BUILD_LINE) comes BEFORE frontend build (line $FRONTEND_BUILD_LINE)"
            check_info "This will cause the dist/ directory to be missing!"
        fi
    else
        if [ -z "$FRONTEND_BUILD_LINE" ]; then
            check_fail "quickstart.sh does not run 'npm run build'"
        fi
        if [ -z "$DOCKER_BUILD_LINE" ]; then
            check_warn "quickstart.sh does not run 'docker build'"
        fi
    fi
    
    # Check for npm ci before npm run build
    NPM_CI_LINE=$(grep -n "npm ci" scripts/quickstart.sh | head -1 | cut -d: -f1)
    if [ -n "$NPM_CI_LINE" ] && [ -n "$FRONTEND_BUILD_LINE" ]; then
        if [ "$NPM_CI_LINE" -lt "$FRONTEND_BUILD_LINE" ]; then
            check_pass "npm ci (line $NPM_CI_LINE) comes before npm run build"
        else
            check_warn "npm ci should come before npm run build"
        fi
    fi
    
    # Shellcheck if available
    if command -v shellcheck &> /dev/null; then
        check_info "Running shellcheck..."
        if shellcheck scripts/quickstart.sh 2>/dev/null; then
            check_pass "shellcheck passed"
        else
            check_warn "shellcheck found issues (non-blocking)"
        fi
    fi
fi

# -----------------------------------------------------------------------------
# TEST 6: GITHUB WORKFLOW VALIDATION
# -----------------------------------------------------------------------------

print_header "Test 6: CI/CD Workflow Validation"

if [ -f ".github/workflows/docker-publish.yml" ]; then
    check_pass "docker-publish.yml workflow exists"
    
    # Check workflow builds frontend before Docker
    if grep -q "build-frontend" .github/workflows/docker-publish.yml; then
        check_pass "Workflow has build-frontend job"
    else
        check_warn "Workflow may not have separate frontend build job"
    fi
    
    # Check workflow uses artifacts to pass dist/
    if grep -q "upload-artifact" .github/workflows/docker-publish.yml && \
       grep -q "download-artifact" .github/workflows/docker-publish.yml; then
        check_pass "Workflow uses artifacts to pass frontend build"
    else
        check_warn "Workflow may not properly pass frontend build between jobs"
    fi
    
    # Check for needs dependency
    if grep -q "needs: build-frontend" .github/workflows/docker-publish.yml; then
        check_pass "Docker build job depends on frontend build"
    else
        check_warn "Docker build job should depend on frontend build"
    fi
fi

if [ -f ".github/workflows/deployment-check.yml" ]; then
    check_pass "deployment-check.yml workflow exists"
else
    check_info "No deployment-check.yml workflow (recommended for PR validation)"
fi

# -----------------------------------------------------------------------------
# SUMMARY
# -----------------------------------------------------------------------------

print_header "Test Summary"

echo ""
if [ $FAILURES -eq 0 ]; then
    echo -e "  ${GREEN}All critical checks passed!${NC}"
else
    echo -e "  ${RED}$FAILURES critical check(s) FAILED${NC}"
fi

if [ $WARNINGS -gt 0 ]; then
    echo -e "  ${YELLOW}$WARNINGS warning(s)${NC}"
fi

echo ""

if [ $FAILURES -gt 0 ]; then
    echo -e "${RED}Deployment readiness: NOT READY${NC}"
    echo ""
    echo "Fix the failures above before deploying."
    echo "Run with --fix to attempt automatic fixes."
    exit 1
else
    echo -e "${GREEN}Deployment readiness: READY${NC}"
    exit 0
fi
