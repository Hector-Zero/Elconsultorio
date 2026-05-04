#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT_DIR="$PROJECT_ROOT/.claude-context"

if [ -z "${PGHOST:-}" ] || [ -z "${PGUSER:-}" ] || [ -z "${PGPASSWORD:-}" ]; then
  echo "PG env vars not set. Add to ~/.zshrc:"
  echo "  export PGHOST='aws-X-XX-XX.pooler.supabase.com'"
  echo "  export PGPORT='5432'"
  echo "  export PGDATABASE='postgres'"
  echo "  export PGUSER='postgres.YOURPROJECTREF'"
  echo "  export PGPASSWORD='your-password'"
  exit 1
fi

if ! command -v psql &> /dev/null; then
  echo "psql not found. Install: brew install libpq && brew link --force libpq"
  exit 1
fi

if [ ! -d "$CONTEXT_DIR" ]; then
  echo ".claude-context dir not found at $CONTEXT_DIR"
  exit 1
fi

mode="${1:-all}"

update_schema() {
  echo "Updating 02_database_schema.md..."
  cat > "$CONTEXT_DIR/02_database_schema.md" <<EOF
# Database Schema

> Auto-generated. Run \`./scripts/update-context.sh schema\` to refresh.
> Last updated: $(date '+%Y-%m-%d %H:%M:%S %Z')

EOF

  psql -At <<'SQL' >> "$CONTEXT_DIR/02_database_schema.md"
WITH columns AS (
  SELECT
    c.table_name,
    c.column_name,
    c.ordinal_position,
    c.data_type,
    c.is_nullable,
    c.column_default,
    pgd.description AS column_comment
  FROM information_schema.columns c
  LEFT JOIN pg_catalog.pg_statio_all_tables st
    ON st.schemaname = c.table_schema AND st.relname = c.table_name
  LEFT JOIN pg_catalog.pg_description pgd
    ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
  WHERE c.table_schema = 'public'
)
SELECT string_agg(table_block, E'\n\n' ORDER BY table_name)
FROM (
  SELECT
    table_name,
    '## ' || table_name || E'\n\n' ||
    string_agg(
      '- `' || column_name || '` ' || data_type ||
      CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
      CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END ||
      CASE WHEN column_comment IS NOT NULL THEN ' — ' || column_comment ELSE '' END,
      E'\n'
      ORDER BY ordinal_position
    ) AS table_block
  FROM columns
  GROUP BY table_name
) t;
SQL

  echo "  done."
}

update_functions() {
  echo "Updating 03_database_functions.md..."
  cat > "$CONTEXT_DIR/03_database_functions.md" <<EOF
# Database Functions (RPCs)

> Auto-generated. Run \`./scripts/update-context.sh functions\` to refresh.
> Last updated: $(date '+%Y-%m-%d %H:%M:%S %Z')

EOF

  psql -At <<'SQL' >> "$CONTEXT_DIR/03_database_functions.md"
SELECT string_agg(
  '## ' || proname || E'\n\n```sql\n' || pg_get_functiondef(oid) || E'\n```',
  E'\n\n'
  ORDER BY proname
)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prokind = 'f';
SQL

  echo "  done."
}

update_edge() {
  echo "Copying create-booking Edge Function..."
  cp "$PROJECT_ROOT/supabase/functions/create-booking/index.ts" \
     "$CONTEXT_DIR/07_edge_function.ts"
  echo "  done."
}

case "$mode" in
  schema)    update_schema ;;
  functions) update_functions ;;
  edge)      update_edge ;;
  all)
    update_schema
    update_functions
    update_edge
    ;;
  *)
    echo "Unknown mode: $mode"
    echo "Usage: $0 [all|schema|functions|edge]"
    exit 1
    ;;
esac

echo ""
echo "Done. Manual updates still needed:"
echo "  - 04_system_prompt.md"
echo "  - 05_haiku_prompt.md"
echo "  - 06_make_blueprint.json"
echo "  - 09_session_log.md"
