-- Run this once in the Supabase SQL Editor. Adds the write policy for
-- admin_emails — previously it had none at all (only public read), so
-- nobody could grant/revoke admin status from the app. Restricted to
-- Natalie specifically, matching the new People tab (dashboard ->
-- People, visible only to her).

create policy "natalie manages admin_emails" on admin_emails
  for all to authenticated
  using (auth.jwt() ->> 'email' = 'natalie@bpmpublicity.com')
  with check (auth.jwt() ->> 'email' = 'natalie@bpmpublicity.com');
