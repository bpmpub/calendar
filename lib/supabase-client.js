import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export function requireSupabase() {
  if (!configured) {
    throw new Error(
      "Supabase isn't configured yet — fill in lib/config.js with your project URL and anon key."
    );
  }
  return supabase;
}
