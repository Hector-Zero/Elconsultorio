# Elconsultorio Context Docs

This folder contains living context documentation for the Elconsultorio project.
The goal is to keep a small, always-fresh set of files that fully describe the
project state. When starting a new chat (Claude.ai or Claude Code), reading
these files gives an LLM full context without re-explaining anything.

## File map

| File | Source | How to update |
|---|---|---|
| `00_README.md` | This file | Manual, rarely |
| `01_architecture.md` | Manual curation | Update when architecture decisions change |
| `02_database_schema.md` | Auto-generated | `./scripts/update-context.sh schema` |
| `03_database_functions.md` | Auto-generated | `./scripts/update-context.sh functions` |
| `04_system_prompt.md` | Copy from `agents_config.system_prompt` | After every system_prompt change in DB |
| `05_haiku_prompt.md` | Copy from Make.com modules 8 + 19 | After every Haiku prompt change |
| `06_make_blueprint.json` | Make.com export | After every scenario change |
| `07_edge_function.ts` | Copy of `supabase/functions/create-booking/index.ts` | `./scripts/update-context.sh edge` |
| `08_known_gaps.md` | Manual | Update when items are added/resolved |
| `09_session_log.md` | Manual, append-only | After every significant work session |

## Manual update commands

### Refresh the system_prompt snapshot

1. Supabase Dashboard → Table Editor → `agents_config`
2. Find the row for your test client
3. Copy the value of `system_prompt`
4. Paste into `04_system_prompt.md`

Or via SQL:

```sql
SELECT system_prompt
FROM agents_config
WHERE client_id = '6e03ed81-8c3b-47e7-82f9-3f6767de70ce';
```

### Refresh the Haiku prompts

1. Make.com → Master Agent scenario → click module 19 (Haiku, Branch 2)
2. Find the system message field, copy its content
3. Repeat for module 8 (Haiku, Branch 1) — should be the same prompt
4. Paste both into `05_haiku_prompt.md`

### Re-export the Make.com blueprint

1. Make.com → Master Agent scenario → ⋯ (three dots top right)
2. → Export Blueprint
3. Saves a `.json` file
4. Move/rename to `.claude-context/06_make_blueprint.json`

## Auto-generation reference (in case the script doesn't work)

These are the SQL queries the script runs. If you ever need to run them
manually in the Supabase SQL Editor:

### Schema dump

```sql
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
```

Copy the result, paste into `02_database_schema.md`.

### Functions dump

```sql
SELECT string_agg(
  '## ' || proname || E'\n\n```sql\n' || pg_get_functiondef(oid) || E'\n```',
  E'\n\n'
  ORDER BY proname
)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prokind = 'f';
```

Copy the result, paste into `03_database_functions.md`.

## When starting a new chat

### In Claude.ai

If you have a Claude Project set up:
- Files are pre-attached, just open the project, start chatting

If not:
- Paste content of `01_architecture.md`, `08_known_gaps.md`, and last few entries of `09_session_log.md` into the first message
- For specific work, attach `02_database_schema.md`, `03_database_functions.md`, etc. as needed

### In Claude Code

- `cd ~/Documents/Projects/Elconsultorio`
- Run `claude` (or open Claude Code from the directory)
- The `CLAUDE.md` at project root is read automatically — full context loaded

## When ending a session

Update `09_session_log.md` with a brief entry about what changed. The current
session's date and a list of changes is enough.

## Versioning

This entire folder is committed to git. To see the history of architecture
decisions or how the schema evolved:

```bash
cd ~/Documents/Projects/Elconsultorio
git log .claude-context/
```
