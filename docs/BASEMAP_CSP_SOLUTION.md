# Basemap Tiles in SPCS: Why You Needed a Proxy (and Why You Don't)

## TL;DR

You hit a **deployment path gap** - some paths in the repo didn't include the `FLUX_CARTO_INTEGRATION` External Access Integration. Without it, SPCS blocks browser requests to CARTO. The fix is adding the integration, not a backend proxy.

---

## What Happened

SPCS adds a Content-Security-Policy (CSP) header that restricts browser requests. When you configure an External Access Integration (EAI), Snowflake **automatically adds those domains to the CSP `connect-src` directive**.

From [Snowflake docs](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/service-network-communications):

> "If you configure an External Access Integration (EAI) to allow your service to access an external site, the Snowflake proxy creates a CSP that allows your web page to access that site."

**The repo has the integration** (`FLUX_CARTO_INTEGRATION`) but only 2 of 6 deployment paths included it:

| Deployment Path | Had Integration | Basemap Works |
|-----------------|-----------------|---------------|
| `00_standalone_quickstart.sql` | Yes | Yes |
| `03_create_service.sql` (CLI) | Yes | Yes |
| `git_deploy/deploy_from_git.sql` | **No** | No |
| `quickstart.sh` | **No** | No |
| `terraform/main.tf` | **No** | No |
| `notebooks/` | **No** | No |

---

## Why EAI > Backend Proxy

| Factor | EAI Approach | Backend Proxy |
|--------|-------------|---------------|
| Latency | Direct browser→CARTO | browser→backend→CARTO→backend→browser |
| Scalability | CARTO CDN handles load | Backend is bottleneck |
| Code | Zero additional code | ~100 lines + caching logic |
| Maintenance | Snowflake-managed | You maintain it |

---

## The Fix

I've updated all deployment paths to include:

```sql
EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_POSTGRES_INTEGRATION, FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI)
```

If you already deployed without it, run:

```sql
ALTER SERVICE your_service_name SET 
    EXTERNAL_ACCESS_INTEGRATIONS = (FLUX_POSTGRES_INTEGRATION, FLUX_CARTO_INTEGRATION, GOOGLE_FONTS_EAI);
```

Then restart: `ALTER SERVICE your_service_name SUSPEND; ALTER SERVICE your_service_name RESUME;`

---

## Summary

Your proxy workaround was valid, but unnecessary. The native Snowflake solution (EAI) is faster, simpler, and now works across all deployment paths.
