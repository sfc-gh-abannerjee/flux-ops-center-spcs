# Cortex Search Sample Data

This directory contains sample data files for populating the Cortex Search Services required by the Grid Intelligence Agent.

## Files

| File | Description | Target Table |
|------|-------------|--------------|
| `compliance_docs.sql` | 8 NERC/ERCOT compliance documents | `<database>.ML_DEMO.COMPLIANCE_DOCS` |
| `technical_manuals_sample.sql` | 13 technical documentation chunks | `<database>.PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS` |

## Usage

### 1. Load Sample Data

Use Snowflake CLI to execute the SQL files:

```bash
# Load compliance documents
snow sql -f data/cortex_search_data/compliance_docs.sql \
    -D "database=FLUX_DB" \
    -c your_connection_name

# Load technical manual chunks
snow sql -f data/cortex_search_data/technical_manuals_sample.sql \
    -D "database=FLUX_DB" \
    -c your_connection_name
```

Or execute directly in Snowsight/SQL worksheet after replacing `<% database %>` with your database name.

### 2. Create Cortex Search Services

After loading the data, create the search services using:

```bash
snow sql -f scripts/sql/07_create_cortex_search.sql \
    -D "database=FLUX_DB" \
    -D "warehouse=FLUX_WH" \
    -c your_connection_name
```

### 3. Verify Search Services

```sql
-- List available search services
SHOW CORTEX SEARCH SERVICES IN SCHEMA FLUX_DB.PRODUCTION;
SHOW CORTEX SEARCH SERVICES IN SCHEMA FLUX_DB.ML_DEMO;

-- Test a search query
SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
    'FLUX_DB.PRODUCTION.TECHNICAL_MANUALS_PDF_CHUNKS_SEARCH_SERVICE',
    '{"query": "transformer oil sampling", "columns": ["CHUNK_TEXT"], "limit": 3}'
);
```

## Data Schema

### COMPLIANCE_DOCS

| Column | Type | Description |
|--------|------|-------------|
| DOC_ID | NUMBER | Primary key |
| DOCUMENT_TITLE | VARCHAR | Document title |
| DOCUMENT_TEXT | VARCHAR | Full document content |
| CATEGORY | VARCHAR | Category (e.g., NERC, ERCOT) |
| EFFECTIVE_DATE | DATE | When the regulation became effective |
| DOCUMENT_TYPE | VARCHAR | Type (Standard, Regulation, etc.) |

### TECHNICAL_MANUALS_PDF_CHUNKS

| Column | Type | Description |
|--------|------|-------------|
| CHUNK_ID | NUMBER | Primary key |
| DOCUMENT_ID | VARCHAR | Parent document identifier |
| CHUNK_TEXT | VARCHAR | Text content of the chunk |
| DOCUMENT_TYPE | VARCHAR | Type (Procedure, Guide, etc.) |
| SOURCE_SYSTEM | VARCHAR | Origin system |
| LANGUAGE | VARCHAR | Language code (e.g., 'en') |

## Adding Your Own Data

To add your own documents:

1. **Compliance Documents**: Insert rows into `COMPLIANCE_DOCS` with your regulatory content
2. **Technical Manuals**: Chunk your PDF documents and insert into `TECHNICAL_MANUALS_PDF_CHUNKS`

For production use, consider:
- Using Snowflake's Document AI to extract and chunk PDF content automatically
- Implementing a data pipeline to refresh search services as new documents are added
- Setting appropriate `TARGET_LAG` values based on how frequently your data changes

## Related Files

- `scripts/sql/07_create_cortex_search.sql` - Creates the Cortex Search Services
- `scripts/sql/08_create_cortex_agent.sql` - Creates the Grid Intelligence Agent
- `README.md` (root) - Full setup instructions
