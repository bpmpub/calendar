import { startRegistration, startAuthentication } from "https://esm.sh/@simplewebauthn/browser@10.0.0";
import { supabase } from "./supabase-client.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

function functionUrl(name) {
  // Supabase Edge Functions live at <project-url>/functions/v1/<name>.
  const base = SUPABASE_URL.replace(/\/$/, "");
  return `${base}/functions/v1/${name}`;
}

async function callFunction(name, body, { authed = false } = {}) {
  // Every Edge Function needs a valid JWT in Authorization by default —
  // the anon key works for the not-signed-in-yet login calls, and the
  // user's own access token for the registration calls (so the function
  // knows which user is registering).
  let bearer = SUPABASE_ANON_KEY;
  if (authed) {
    const { data } = await supabase.auth.getSession();
    bearer = data.session?.access_token ?? SUPABASE_ANON_KEY;
  }
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${bearer}`,
  };
  const res = await fetch(functionUrl(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `${name} failed`);
  return json;
}

export async function registerPasskey() {
  const options = await callFunction("passkey-register-options", {}, { authed: true });
  // @simplewebauthn/browser@10.0.0 takes the options object directly —
  // no { optionsJSON } wrapper (that's a later-version API).
  const attestation = await startRegistration(options);
  return callFunction("passkey-register-verify", { response: attestation }, { authed: true });
}

export async function hasRegisteredPasskey(email) {
  // Reuses passkey-login-options (service role, bypasses RLS) purely as
  // an existence check — it 404s with a specific message when there's
  // no passkey for this email, and returns real WebAuthn options
  // (meaning at least one exists) otherwise. Sidesteps a client-side
  // RLS-scoped table read that was silently returning zero rows for
  // reasons not worth chasing further when this already works.
  try {
    await callFunction("passkey-login-options", { email });
    return true;
  } catch (err) {
    if (err.message?.includes("No passkey found")) return false;
    throw err;
  }
}

export async function loginWithPasskey(email) {
  const options = await callFunction("passkey-login-options", { email });
  const assertion = await startAuthentication(options);
  const result = await callFunction("passkey-login-verify", { email, response: assertion });

  const { error } = await supabase.auth.verifyOtp({
    email,
    token: result.email_otp,
    type: "email",
  });
  if (error) throw error;
}
