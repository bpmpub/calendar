import { generateRegistrationOptions } from "npm:@simplewebauthn/server@10";
import { corsHeaders, json, handleOptions } from "../_shared/cors.ts";
import { adminClient, RP_ID, RP_NAME } from "../_shared/admin-client.ts";

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

  const { data: existing } = await admin
    .from("passkeys")
    .select("credential_id")
    .eq("user_id", user.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? "",
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((p) => ({
      id: p.credential_id,
      type: "public-key",
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Clear any stale challenge for this email, then store the new one.
  await admin.from("webauthn_challenges").delete().eq("email", user.email).eq("purpose", "register");
  await admin.from("webauthn_challenges").insert({
    email: user.email,
    challenge: options.challenge,
    purpose: "register",
  });

  return json(options);
});
