# Snowflake Development Learnings

## Snowflake Notebook Deployment - External Access Integration

**Problem**: `pip install` in Snowflake Notebooks shows "External access is not enabled" warning, even after configuring the integration.

**Root Cause**: Snow CLI's `notebook deploy --replace` recreates the notebook, which **wipes the `EXTERNAL_ACCESS_INTEGRATIONS` setting**. This must be re-applied after every deploy.

**Solution**: Always run ALTER NOTEBOOK after deploying:
```bash
# After snow notebook deploy ... --replace
snow sql -q "ALTER NOTEBOOK DB.SCHEMA.NOTEBOOK_NAME SET EXTERNAL_ACCESS_INTEGRATIONS = (PYPI_ACCESS_INTEGRATION)" --connection <conn>
```

**Best Practice**: Create a `deploy.sh` script that does both steps:
```bash
#!/bin/bash
set -e
CONNECTION="${1:-cpe_demo_CLI}"

# Step 1: Deploy notebook
snow notebook deploy notebook_name --database DB --schema SCHEMA --connection "$CONNECTION" --replace

# Step 2: Configure external access (REQUIRED after every deploy)
snow sql -q "ALTER NOTEBOOK DB.SCHEMA.NOTEBOOK_NAME SET EXTERNAL_ACCESS_INTEGRATIONS = (PYPI_ACCESS_INTEGRATION)" --connection "$CONNECTION"
```

**Important**: After deploying, restart the notebook session in Snowsight (Session > Restart) for external access to take effect.

**Why Snow CLI doesn't support this in YAML**: As of Jan 2025, `external_access_integrations` is not a supported property in snowflake.yml for notebooks. Must use ALTER NOTEBOOK.

## Snowflake Notebook Package Management - Container vs Warehouse Runtime

**Problem**: "Installed Packages" sidebar panel shows empty even after `!pip install` succeeds.

**Root Cause**: This is expected behavior, NOT a bug.

| Runtime | Package Manager | UI "Installed Packages" Panel |
|---------|-----------------|------------------------------|
| **Warehouse Runtime** | Anaconda (via UI) | ✅ Shows installed packages |
| **Container Runtime** | pip (via `!pip install`) | ❌ Always empty - by design |

**Documentation References**:
- Container Runtime: https://docs.snowflake.com/en/developer-guide/snowflake-ml/container-runtime-package-management
- Warehouse Runtime: https://docs.snowflake.com/en/user-guide/ui-snowsight/notebooks-import-packages

**Solution for Container Runtime**: Use `!pip freeze` or `!pip show <package>` to verify packages are installed:
```python
# Verify packages in Container Runtime notebooks
!pip show snowflake-ml-python xgboost | grep -E "^(Name|Version):"
```

**Demo Tip**: Explain to customers that the empty sidebar is expected for GPU/Container Runtime notebooks - packages ARE installed, just not shown in the UI panel.

---

# SPCS Development Learnings

## Snowflake Session Management in SPCS FastAPI Apps

**Problem**: API endpoints returning "upstream connect error" instead of JSON, causing frontend JavaScript errors like `Unexpected token 'u', 'upstream c'... is not valid JSON`.

**Root Cause**: Using global `snowflake_session` variable directly instead of `get_valid_session()` helper function. The global session can become stale/disconnected, and SPCS proxy returns raw error text instead of JSON.

**Solution**:
1. Always use `get_valid_session()` instead of `snowflake_session` directly in API endpoints
2. Return `JSONResponse` with error details on failure, not `HTTPException`
3. Add frontend JavaScript to check response content-type before parsing JSON

```python
# BAD - session may be stale
@app.get("/api/endpoint")
async def my_endpoint():
    if not snowflake_session:
        raise HTTPException(503, "Not connected")
    result = snowflake_session.sql(query).collect()

# GOOD - always get fresh valid session
@app.get("/api/endpoint")
async def my_endpoint():
    session = get_valid_session()
    if not session:
        return JSONResponse(status_code=503, content={"status": "error", "error": "Not connected"})
    result = session.sql(query).collect()
```

**Frontend JS pattern**:
```javascript
const resp = await fetch(url);
const contentType = resp.headers.get('content-type');
if (!resp.ok || !contentType || !contentType.includes('application/json')) {
    const errorText = await resp.text();
    throw new Error(errorText.substring(0, 200) || `Server error: ${resp.status}`);
}
const data = await resp.json();
```

## Snowflake Row Object Handling

**Problem**: `AttributeError: Row object has no attribute 'get'`

**Solution**: Convert Snowflake Row objects to dict before using `.get()`:
```python
row_dict = row.asDict() if hasattr(row, 'asDict') else dict(row)
value = row_dict.get('column_name', 'default')
```

## SPCS Deployment - Force Fresh Image Pull

Must DROP and CREATE service to pull latest image (ALTER SERVICE does not refresh):
```sql
DROP SERVICE IF EXISTS DB.SCHEMA.SERVICE_NAME;
CREATE SERVICE DB.SCHEMA.SERVICE_NAME ...
```

## Docker Build for SPCS on M-series Macs

Always use `--platform linux/amd64`:
```bash
docker build --platform linux/amd64 -f Dockerfile -t image:latest .
```

## SPCS Port Mismatch - "Connection Refused"

**Problem**: `upstream connect error... Connection refused` even when service status shows READY.

**Root Cause**: Service spec endpoint port doesn't match the port the app listens on.

**Diagnosis**: Check logs - look for `Uvicorn running on http://0.0.0.0:XXXX`:
```sql
SELECT SYSTEM$GET_SERVICE_LOGS('DB.SCHEMA.SERVICE', 0, 'container-name', 100)
```

**Solution**: Ensure service spec port matches uvicorn port:
```python
# In fastapi_app.py
uvicorn.run(app, host="0.0.0.0", port=8080)
```
```yaml
# In service spec
endpoints:
- name: main
  port: 8080  # Must match uvicorn port!
  public: true
```
