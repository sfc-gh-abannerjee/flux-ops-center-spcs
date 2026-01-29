# Local Development Setup

## Authentication for Cortex Agent REST API

The Grid Intelligence Assistant uses Snowflake's Cortex Agent REST API which requires proper authentication tokens.

### SPCS (Production) vs Local Dev

| Environment | Token Type | Source |
|-------------|------------|--------|
| **SPCS** | OAuth | Automatically provided at `/snowflake/session/token` |
| **Local Dev** | PAT (Personal Access Token) | Environment variable `SNOWFLAKE_PAT` |

### Why PAT is Required for Local Development

The Snowflake Python connector session tokens (from password/key-pair auth) are **NOT valid** for REST API calls. The Cortex Agent REST API requires one of:

1. **JWT** (Key-Pair Authentication)
2. **OAuth Token** (OAuth flow)
3. **PAT** (Personal Access Token) ← **Recommended for local dev**

PAT is the simplest approach for local development and testing.

## Setup Instructions

### 1. Create a Personal Access Token (PAT)

1. Log into Snowsight UI
2. Navigate to: **Admin** → **Users & Roles** → Click your username
3. Scroll to **Personal Access Tokens** section
4. Click **+ Token**
5. Name: `local_dev_flux_ops_center`
6. Expiration: Choose appropriate duration (recommend 90 days for development)
7. Click **Create Token**
8. **IMPORTANT:** Copy the token immediately (you won't see it again)

### 2. Set Environment Variables

Add these to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
# Snowflake PAT for local development
export SNOWFLAKE_PAT='your_pat_token_here'
export SNOWFLAKE_HOST='your_account.snowflakecomputing.com'

# Example for Grid Operations demo:
# export SNOWFLAKE_HOST='gzb42423.snowflakecomputing.com'
```

**Security Note:** Never commit your PAT to git. The `.env` file and credentials are already in `.gitignore`.

### 3. Verify Setup

```bash
# Reload shell profile
source ~/.zshrc  # or ~/.bashrc

# Verify variables are set
echo $SNOWFLAKE_PAT  # Should output your token
echo $SNOWFLAKE_HOST  # Should output your account URL
```

### 4. Start Development Servers

**Backend:**
```bash
cd flux_ops_center_spcs
SNOWFLAKE_CONNECTION_NAME=cpe_demo_CLI python3 backend/server.py
```

**Frontend:**
```bash
cd flux_ops_center_spcs
npm run dev
```

**Expected Output:**
```
🔧 Local dev mode: Using PAT from SNOWFLAKE_PAT environment variable
🔐 Local dev: Host=gzb42423.snowflakecomputing.com, PAT=✅
```

## Troubleshooting

### Error: "Local dev requires SNOWFLAKE_PAT environment variable"

**Cause:** `SNOWFLAKE_PAT` not set or not accessible to Python process.

**Solution:**
1. Verify environment variable is set: `echo $SNOWFLAKE_PAT`
2. If empty, add to shell profile and reload: `source ~/.zshrc`
3. Restart terminal session if still not working

### Error: "Invalid OAuth access token"

**Cause:** PAT is expired, revoked, or incorrect.

**Solution:**
1. Check PAT expiration in Snowsight (Admin > Users & Roles > Your User > Personal Access Tokens)
2. If expired, create a new PAT following step 1 above
3. Update environment variable with new token

### Error: "Local dev requires SNOWFLAKE_HOST environment variable"

**Cause:** `SNOWFLAKE_HOST` not set.

**Solution:**
1. Find your account URL: `<account_locator>.snowflakecomputing.com`
2. Set environment variable: `export SNOWFLAKE_HOST='your_account.snowflakecomputing.com'`
3. Reload shell: `source ~/.zshrc`

### Error: Agent returns 403 Forbidden

**Cause:** User lacks privileges to access agent.

**Solution:**
```sql
-- Grant usage on agent
GRANT USAGE ON AGENT SNOWFLAKE_INTELLIGENCE.AGENTS.CENTERPOINT_ENERGY_AGENT TO USER <your_user>;

-- Grant usage on warehouse (for agent tools)
GRANT USAGE ON WAREHOUSE COMPUTE_WH TO USER <your_user>;
```

## Architecture

### SPCS Deployment (Production)

```
Browser → Streamlit (SPCS) → Agent REST API
                               ↑
                        OAuth Token
                   /snowflake/session/token
```

- OAuth token automatically provided by Snowflake SPCS environment
- No manual configuration needed
- Token auto-refreshes

### Local Development

```
Browser → React (localhost:5173) → Flask (localhost:3001) → Agent REST API
                                                              ↑
                                                         PAT Token
                                                    $SNOWFLAKE_PAT env var
```

- PAT must be manually created and configured
- Token expires based on configured duration
- Requires periodic renewal (recommend 90-day expiration)

## Security Best Practices

1. **Never commit PATs to git**
   - Already protected by `.gitignore`
   - Use environment variables only

2. **Set appropriate PAT expiration**
   - Development: 90 days
   - Testing: 30 days
   - Production: Use OAuth (SPCS) instead

3. **Rotate PATs regularly**
   - Create new PAT before old one expires
   - Update environment variable
   - Revoke old PAT in Snowsight

4. **Limit PAT permissions**
   - Only grant necessary privileges to user
   - Use dedicated service account for production

## Related Documentation

- [Snowflake Personal Access Tokens](https://docs.snowflake.com/en/user-guide/programmatic-access-tokens)
- [Cortex Agent REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-rest-api)
- [Authenticating Snowflake REST APIs](https://docs.snowflake.com/en/developer-guide/sql-api/authenticating)
- [docs/LOCAL_DEVELOPMENT_GUIDE.md](./docs/LOCAL_DEVELOPMENT_GUIDE.md) - Complete local dev startup guide
- [docs/POSTGRES_SYNC_RELIABILITY.md](./docs/POSTGRES_SYNC_RELIABILITY.md) - Snowflake→Postgres sync troubleshooting

---

*Last Updated: January 28, 2026*
