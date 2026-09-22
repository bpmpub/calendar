-- Run this once in the Supabase SQL Editor. Adds the table the passkey
-- Edge Functions use to hold a WebAuthn challenge between the
-- options-request and verify steps of the ceremony.

create table if not exists webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  challenge text not null,
  purpose text not null check (purpose in ('register', 'login')),
  created_at timestamptz not null default now()
);
alter table webauthn_challenges enable row level security;
-- No policies granted on purpose — only the Edge Functions (service
-- role, which bypasses RLS) read or write this table.
