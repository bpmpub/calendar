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
  const attestation = await startRegistration({ optionsJSON: options });
  return callFunction("passkey-register-verify", { response: attestation }, { authed: true });
}

export async function loginWithPasskey(email) {
  const options = await callFunction("passkey-login-options", { email });
  const assertion = await startAuthentication({ optionsJSON: options });
  const result = await callFunction("passkey-login-verify", { email, response: assertion });

  const { error } = await supabase.auth.verifyOtp({
    email,
    token: result.email_otp,
    type: "email",
  });
  if (error) throw error;
}
