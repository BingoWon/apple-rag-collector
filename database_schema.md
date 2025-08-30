# Database Schema Documentation

## Database Tables

### pages

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | not null | gen_random_uuid() |
| url | text | not null | |
| content | text | nullable | ''::text |
| created_at | timestamp with time zone | nullable | now() |
| raw_json | jsonb | nullable | |
| title | text | nullable | |
| collect_count | integer | not null | 0 |
| updated_at | timestamp with time zone | nullable | |

**Indexes:**
- `pages_pkey` PRIMARY KEY, btree (id)
- `idx_pages_collect_count_url` btree (collect_count, url)
- `idx_pages_created_at` btree (created_at)
- `idx_pages_raw_json` gin (raw_json)
- `idx_pages_title` btree (title)
- `idx_pages_updated_at` btree (updated_at)
- `idx_pages_url` btree (url)
- `pages_url_key` UNIQUE CONSTRAINT, btree (url)

### chunks

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | not null | gen_random_uuid() |
| url | text | not null | |
| title | text | nullable | |
| content | text | not null | |
| created_at | timestamp with time zone | not null | now() |
| embedding | halfvec(2560) | nullable | |

**Indexes:**
- `chunks_pkey` PRIMARY KEY, btree (id)
- `idx_chunks_created_at` btree (created_at)
- `idx_chunks_embedding_hnsw` hnsw (embedding halfvec_cosine_ops) WITH (m='16', ef_construction='64')
- `idx_chunks_url` btree (url)
- `idx_chunks_title` btree (title)

