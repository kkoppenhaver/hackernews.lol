-- hackernews.lol — Supabase schema
--
-- Run once in your Supabase project's SQL editor.
-- Then add the following env vars to .env.local and to Vercel:
--   SUPABASE_URL=https://<project>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY=<service role key from Project Settings → API>
--
-- The service role key bypasses Row-Level Security and should never be
-- exposed to the browser. We only use it from server routes.

create table if not exists threads (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- For "recent threads" listings and analytics queries.
create index if not exists threads_created_at_idx on threads (created_at desc);

-- For querying by article URL (denormalized from the JSON for speed).
create index if not exists threads_url_idx on threads ((data ->> 'url'));

-- For querying by hostname.
create index if not exists threads_hostname_idx on threads ((data ->> 'hostname'));
