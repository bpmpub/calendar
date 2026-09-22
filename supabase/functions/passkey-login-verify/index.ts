import { verifyAuthenticationResponse } from "npm:@simplewebauthn/server@10";
import { json, handleOptions } from "../_shared/cors.ts";
import { adminClient, RP_ID, SITE_ORIGIN } from "../_shared/admin-client.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const { email, response } = await req.json();
  if (!email || !response) return json({ error: "Missing email or response" }, 400);

  const admin = adminClient();

  const { data: challengeRow } = await admin
    .from("webauthn_challenges")
    .select("*")
    .eq("email", email)
    .eq("purpose", "login")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!challengeRow) {
    return json({ error: "Login attempt expired — try again." }, 400);
  }

  const { data: passkey } = await admin
    .from("passkeys")
    .select("*")
    .eq("credential_id", response.id)
    .eq("user_email", email)
    .maybeSingle();
  if (!passkey) {
    return json({ error: "Unknown passkey." }, 401);
  }

  let verification;
  try {
    // v10 takes the stored credential as `credential`, not the older
    // flat `authenticator` shape — check this against the installed
    // version's types if it throws after a version bump.
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: SITE_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey: Uint8Array.from(atob(passkey.public_key), (c) => c.charCodeAt(0)),
        counter: passkey.counter,
      },
    });
  } catch (err) {
    return json({ error: `Verification failed: ${err.message}` }, 400);
  }

  await admin.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  if (!verification.verified) {
    return json({ error: "Passkey verification failed." }, 401);
  }

  await admin
    .from("passkeys")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("id", passkey.id);

  // Mint a one-time login token the client can exchange for a real
  // session via supabase.auth.verifyOtp — no email round-trip needed.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData) {
    return json({ error: linkErr?.message ?? "Could not create session." }, 500);
  }

  return json({
    verified: true,
    email_otp: linkData.properties.email_otp,
  });
});
