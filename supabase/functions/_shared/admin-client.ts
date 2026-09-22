import { createClient } from "npm:@supabase/supabase-js@2";

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// into every Edge Function's environment by Supabase — nothing to set
// manually for these two. RP_ID and SITE_ORIGIN (below) are the ones
// that need `supabase secrets set`, since they're specific to where
// this site is hosted.
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export const RP_ID = Deno.env.get("RP_ID") ?? "";
export const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "";
export const RP_NAME = "BPM Show Calendar";
