# Cortex Search Sample Data

Sample data for the Grid Intelligence Agent's RAG-based search capabilities.

---

## Overview

The Grid Intelligence Agent uses **two Cortex Search services** to answer natural language questions about grid operations:

| Search Service | Source Table | Content |
|----------------|-------------|---------|
| `TECHNICAL_DOCS_SEARCH` | `PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS` | Equipment manuals, maintenance procedures, troubleshooting guides |
| `COMPLIANCE_DOCS_SEARCH` | `ML_DEMO.COMPLIANCE_DOCS` | NERC reliability standards, regulatory protocols, internal utility policies |

The files in this directory provide realistic sample data so the agent works out of the box.

---

## Files

| File | Rows | Target Schema.Table |
|------|------|---------------------|
| `technical_manuals_sample.sql` | 23 chunks | `PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS` |
| `compliance_docs.sql` | 8 documents | `ML_DEMO.COMPLIANCE_DOCS` |

---

## Usage

### Automatic (via quickstart.sh)

Step 12 of `quickstart.sh` auto-detects empty source tables and loads this data automatically. No manual action needed if you run the full quickstart.

### Manual Loading

```bash
# Load technical documentation
snow sql -c your_connection -f data/cortex_search_data/technical_manuals_sample.sql \
    -D "database=FLUX_DB"

# Load compliance documents
snow sql -c your_connection -f data/cortex_search_data/compliance_docs.sql \
    -D "database=FLUX_DB"
```

**After loading data**, create the search services and agent:

```bash
# Create Cortex Search services (requires ACCOUNTADMIN)
snow sql -c your_connection -f scripts/sql/07_create_cortex_search.sql \
    -D "database=FLUX_DB" -D "warehouse=FLUX_WH"

# Create Grid Intelligence Agent
snow sql -c your_connection -f scripts/sql/08_create_cortex_agent.sql \
    -D "database=FLUX_DB" -D "warehouse=FLUX_WH"
```

### Verify

```sql
-- Check source data
SELECT COUNT(*) FROM FLUX_DB.PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS;  -- Should be 23
SELECT COUNT(*) FROM FLUX_DB.ML_DEMO.COMPLIANCE_DOCS;                  -- Should be 8

-- Check search services exist
SHOW CORTEX SEARCH SERVICES IN DATABASE FLUX_DB;

-- Check agent exists
SHOW AGENTS IN SCHEMA SNOWFLAKE_INTELLIGENCE.AGENTS;
```

---

## Data Schema

### TECHNICAL_MANUALS_PDF_CHUNKS

| Column | Type | Description |
|--------|------|-------------|
| `CHUNK_ID` | VARCHAR(100) | Primary key — unique chunk identifier |
| `DOCUMENT_ID` | VARCHAR(100) | Parent document ID (e.g., `DOC_1`) |
| `DOCUMENT_TYPE` | VARCHAR(200) | Type: Maintenance Procedure, Equipment Guide, etc. |
| `DOCUMENT_TITLE` | VARCHAR(500) | Full document title |
| `CHUNK_TEXT` | TEXT | Full text content of the chunk |
| `CHUNK_INDEX` | INT | Order within the parent document |
| `SOURCE_SYSTEM` | VARCHAR(100) | Default: `TECHNICAL_MANUALS_PDF` |
| `LANGUAGE` | VARCHAR(20) | Language code (default: `en`) |
| `TOKEN_COUNT` | INT | Token count for the chunk |
| `EMBEDDING` | VECTOR(FLOAT, 1024) | Vector embedding (populated by AI processing) |
| `CREATED_AT` | TIMESTAMP_NTZ | Row creation timestamp |

> **Note**: The sample data INSERT only populates `CHUNK_ID`, `DOCUMENT_ID`, `CHUNK_TEXT`, and `DOCUMENT_TYPE`. Other columns use defaults or remain NULL.

### COMPLIANCE_DOCS

| Column | Type | Description |
|--------|------|-------------|
| `DOC_ID` | VARCHAR | Standard identifier (e.g., `NERC-TPL-001-5.1`) |
| `DOC_TYPE` | VARCHAR | Type: Reliability Standard, Emergency Procedure, etc. |
| `TITLE` | VARCHAR | Full document title |
| `CONTENT` | VARCHAR | Complete document text |
| `CATEGORY` | VARCHAR | Category: Reliability Standards, Emergency Operations, etc. |
| `EFFECTIVE_DATE` | DATE | When the regulation became effective |
| `REVISION` | VARCHAR | Version number |
| `APPLICABILITY` | VARCHAR | Which organizations/roles this applies to |
| `KEYWORDS` | VARCHAR | Comma-separated search keywords |

---

## Common Issues

### `ON CONFLICT` syntax error
The SQL files use Snowflake SQL, not PostgreSQL. If you see `ON CONFLICT` errors, you have an outdated version of the files. Pull the latest from the repo.

### Cortex Search service creation fails with internal error
Use `ACCOUNTADMIN` role, not `SYSADMIN`. The `07_create_cortex_search.sql` script handles this automatically.

### Agent creation fails with "invalid property 'MODELS'"
The agent uses `FROM SPECIFICATION $$ yaml $$` syntax. The `08_create_cortex_agent.sql` script handles this correctly. Do not use the older property-based syntax (`MODELS = (...)`, `TOOLS = (...)`).

---

## Adding Your Own Data

To replace sample data with production documents:

1. **Technical Manuals**: Chunk your PDFs and insert into `TECHNICAL_MANUALS_PDF_CHUNKS`. Consider using Snowflake's Document AI (`PARSE_DOCUMENT`) for automatic extraction.

2. **Compliance Docs**: Insert regulatory documents into `COMPLIANCE_DOCS` with appropriate metadata.

3. **Refresh Search Services**: The services auto-refresh based on `TARGET_LAG` (default: 1 hour). Force refresh:
   ```sql
   ALTER CORTEX SEARCH SERVICE FLUX_DB.PRODUCTION.TECHNICAL_DOCS_SEARCH RESUME;
   ```

---

## Related Files

| File | Purpose |
|------|---------|
| `scripts/sql/07_create_cortex_search.sql` | Creates Cortex Search services from these tables |
| `scripts/sql/08_create_cortex_agent.sql` | Creates the Grid Intelligence Agent |
| `scripts/quickstart.sh` (Step 12) | Automates the full pipeline |
