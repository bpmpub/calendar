// Passkey (WebAuthn) verification — FAST-FOLLOW, NOT WIRED UP YET.
//
// Per the build brief: magic link ships first; this is scaffolding for
// the "add a passkey to skip email next time" flow, added after launch.
//
// What this needs before it works:
//   1. `deno add npm:@simplewebauthn/server` (or vendor it) — this file
//      references the API shape but doesn't import it yet.
//   2. Two more Edge Functions: passkey-register-options and
//      passkey-register-verify, for the registration ceremony (this file
//      only handles the LOGIN ceremony).
//   3. A `challenges` table (or KV) to store the WebAuthn challenge
//      between the options request and this verify step — WebAuthn is a
//      two-step handshake, and Edge Functions are stateless per-request.
//   4. Deploy via `supabase functions deploy passkey-verify`, which
//      requires `supabase login` (interactive — the user does this, not
//      an agent).
//   5. On success, this function must mint a Supabase session for the
//      matched user. The clean way: use the service-role key (server-side
//      only, never in frontend code) to call
//      `supabase.auth.admin.generateLink` or sign a custom JWT with the
//      project's JWT secret, then have the client exchange it for a
//      session. Both need the service-role key set as an Edge Function
//      secret (`supabase secrets set`), never shipped to the frontend.
//
// Rough shape of the finished flow:
//
// serve(async (req) => {
//   const { credentialId, authenticatorResponse, expectedChallenge } = await req.json();
//
//   const passkey = await supabaseAdmin
//     .from("passkeys")
//     .select("*")
//     .eq("credential_id", credentialId)
//     .single();
//   if (!passkey.data) return json({ error: "Unknown credential" }, 401);
//
//   const verification = await verifyAuthenticationResponse({
//     response: authenticatorResponse,
//     expectedChallenge,
//     expectedOrigin: Deno.env.get("SITE_ORIGIN"),
//     expectedRPID: Deno.env.get("RP_ID"),
//     authenticator: {
//       credentialID: passkey.data.credential_id,
//       credentialPublicKey: passkey.data.public_key,
//       counter: passkey.data.counter,
//     },
//   });
//   if (!verification.verified) return json({ error: "Verification failed" }, 401);
//
//   await supabaseAdmin
//     .from("passkeys")
//     .update({ counter: verification.authenticationInfo.newCounter })
//     .eq("credential_id", credentialId);
//
//   const { data: link } = await supabaseAdmin.auth.admin.generateLink({
//     type: "magiclink",
//     email: passkey.data.user_email,
//   });
//   return json({ actionLink: link.properties.action_link });
// });
