import { generateAuthenticationOptions } from "npm:@simplewebauthn/server@10";
import { json, handleOptions } from "../_shared/cors.ts";
import { adminClient, RP_ID } from "../_shared/admin-client.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const { email } = await req.json();
  if (!email) return json({ error: "Email required" }, 400);

  const admin = adminClient();
  const { data: passkeys } = await admin
    .from("passkeys")
    .select("credential_id")
    .eq("user_email", email);

  if (!passkeys || passkeys.length === 0) {
    // Deliberately vague — don't reveal whether the email exists.
    return json({ error: "No passkey found for that email. Use the magic link instead." }, 404);
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials: passkeys.map((p) => ({ id: p.credential_id, type: "public-key" })),
  });

  await admin.from("webauthn_challenges").delete().eq("email", email).eq("purpose", "login");
  await admin.from("webauthn_challenges").insert({
    email,
    challenge: options.challenge,
    purpose: "login",
  });

  return json(options);
});
