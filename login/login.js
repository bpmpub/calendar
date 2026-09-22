import { supabase, configured } from "../lib/supabase-client.js";

const form = document.getElementById("magic-link-form");
const emailInput = document.getElementById("email");
const magicLinkBtn = document.getElementById("magic-link-btn");
const passkeyBtn = document.getElementById("passkey-btn");
const messageEl = document.getElementById("auth-message");

function showMessage(text, kind) {
  messageEl.innerHTML = `<p class="auth-message ${kind}">${text}</p>`;
}

async function isAllowlisted(email) {
  const lower = email.trim().toLowerCase();
  const [artistsRes, adminsRes] = await Promise.all([
    supabase.from("artists").select("publicist_email"),
    supabase.from("admin_emails").select("email"),
  ]);
  const artistEmails = (artistsRes.data || []).map((a) => a.publicist_email.toLowerCase());
  const adminEmails = (adminsRes.data || []).map((a) => a.email.toLowerCase());
  return artistEmails.includes(lower) || adminEmails.includes(lower);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!configured) {
    showMessage("Supabase isn't configured yet — see lib/config.js.", "error");
    return;
  }
  const email = emailInput.value.trim();
  magicLinkBtn.disabled = true;
  magicLinkBtn.textContent = "Checking…";

  try {
    const allowed = await isAllowlisted(email);
    if (!allowed) {
      showMessage("That email isn't on the BPM publicist list. Contact Becky if this is a mistake.", "error");
      return;
    }
    magicLinkBtn.textContent = "Sending…";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: new URL("../dashboard/", window.location.href).toString(),
      },
    });
    if (error) throw error;
    showMessage("Check your email for a sign-in link.", "success");
    form.reset();
  } catch (err) {
    showMessage(err.message || "Something went wrong. Try again.", "error");
  } finally {
    magicLinkBtn.disabled = false;
    magicLinkBtn.textContent = "Send magic link";
  }
});

// Passkey sign-in is a fast-follow (see supabase/functions/passkey-verify).
// Until that Edge Function is deployed, this button explains the state
// rather than silently failing.
passkeyBtn.addEventListener("click", () => {
  showMessage("Passkey sign-in isn't set up yet — use the magic link above for now.", "error");
});

// If already signed in, skip straight to the dashboard.
if (configured) {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      window.location.href = new URL("../dashboard/", window.location.href).toString();
    }
  });
}
