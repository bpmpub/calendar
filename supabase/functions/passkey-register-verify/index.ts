import { verifyRegistrationResponse } from "npm:@simplewebauthn/server@10";
import { json, handleOptions } from "../_shared/cors.ts";
import { adminClient, RP_ID, SITE_ORIGIN } from "../_shared/admin-client.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = adminClient();
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) {
    return json({ error: "Not signed in" }, 401);
  }
  const user = userData.user;

  const { response } = await req.json();

  const { data: challengeRow } = await admin
    .from("webauthn_challenges")
    .select("*")
    .eq("email", user.email)
    .eq("purpose", "register")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challengeRow) {
    return json({ error: "No registration in progress — try again." }, 400);
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: SITE_ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    return json({ error: `Verification failed: ${err.message}` }, 400);
  }

  await admin.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: "Passkey verification failed." }, 400);
  }

  // @simplewebauthn/server v10 nests these under `.credential`
  // (earlier versions had credentialID/credentialPublicKey/counter flat
  // on registrationInfo — if this throws after a version bump, that's
  // the first place to check against the installed version's types).
  const { credential } = verification.registrationInfo;

  const { error: insertErr } = await admin.from("passkeys").insert({
    user_id: user.id,
    user_email: user.email,
    credential_id: credential.id,
    public_key: btoa(String.fromCharCode(...credential.publicKey)),
    counter: credential.counter,
  });
  if (insertErr) {
    return json({ error: insertErr.message }, 400);
  }

  return json({ verified: true });
});
