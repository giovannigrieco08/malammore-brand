// Netlify Function: salva un'iscrizione alla lista d'attesa su Resend
// (Audience + Contact) e invia una mail di conferma.
//
// Variabili d'ambiente richieste (Netlify > Site configuration > Environment variables):
//   RESEND_API_KEY      la chiave API di Resend (Settings > API Keys)
//   RESEND_AUDIENCE_ID  l'ID dell'Audience "lista d'attesa" (Audiences > crea una audience)
//   RESEND_FROM         opzionale, mittente verificato, es. "Malammore <ciao@malammore.it>"
//                       (il dominio deve essere verificato in Resend > Domains)

const MODELLI = ["Run, guagliò, run", "Miss you, but sciallà", "Rebel like 'o mare"];
const TAGLIE = ["S", "M", "L", "XL"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function json(status, body) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const nome = String(data.nome || "").trim().slice(0, 60);
  const email = String(data.email || "").trim();
  const modello = String(data.modello || "").trim();
  const taglia = String(data.taglia || "").trim();
  const consenso = !!data.consenso;
  const origine = String(data.origine || "sito").trim().slice(0, 24);

  if (!email || !EMAIL_RE.test(email)) {
    return json(400, { ok: false, error: "invalid_email" });
  }
  if (!consenso) {
    return json(400, { ok: false, error: "missing_consent" });
  }
  if (modello && !MODELLI.includes(modello)) {
    return json(400, { ok: false, error: "invalid_model" });
  }
  if (taglia && !TAGLIE.includes(taglia)) {
    return json(400, { ok: false, error: "invalid_size" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  const from = process.env.RESEND_FROM || "Malammore <ciao@malammore.it>";

  if (!apiKey || !audienceId) {
    return json(500, { ok: false, error: "not_configured" });
  }

  // MODELLO e TAGLIA sono Audience Properties custom create a mano su Resend
  // (Audience > Properties): vanno passate cosi', non nel first_name.
  const properties = {};
  if (modello) properties.MODELLO = modello;
  if (taglia) properties.TAGLIA = taglia;

  try {
    const contactRes = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        first_name: nome || undefined,
        unsubscribed: false,
        properties: Object.keys(properties).length ? properties : undefined,
      }),
    });

    if (!contactRes.ok) {
      const status = contactRes.status;
      let body = {};
      try { body = await contactRes.json(); } catch {}
      const msg = String(body?.message || "").toLowerCase();
      const alreadyExists = status === 409 || (status === 400 && msg.includes("already"));
      if (!alreadyExists) {
        console.error("resend contact error", status, body);
        if (status === 401 || status === 403) return json(500, { ok: false, error: "config" });
        return json(502, { ok: false, error: "server" });
      }
      // gia' iscritto: aggiorniamo comunque nome/proprieta' (nuovo modello/taglia scelti)
      const updateRes = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          first_name: nome || undefined,
          unsubscribed: false,
          properties: Object.keys(properties).length ? properties : undefined,
        }),
      });
      if (!updateRes.ok) {
        const updBody = await updateRes.json().catch(() => ({}));
        console.error("resend contact update error", updateRes.status, updBody);
        // il contatto esiste comunque: non blocchiamo l'utente per un aggiornamento fallito
      }
    }
  } catch (err) {
    console.error("resend contact fetch failed", err);
    return json(502, { ok: false, error: "network" });
  }

  try {
    const modelloLine = modello && taglia
      ? `Hai chiesto la <strong>${escapeHtml(taglia)}</strong> di <em>${escapeHtml(modello)}</em>.`
      : "Ti abbiamo aggiunto alla lista.";
    const greeting = nome ? `Ciao ${escapeHtml(nome)}.` : "Ciao.";
    const html = `<!doctype html>
<html><body style="margin:0;padding:32px 24px;background:#EFE6D3;font-family:Georgia,'Times New Roman',serif;color:#2A2118;">
  <div style="max-width:460px;margin:0 auto;">
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#A8481C;margin:0 0 20px;">
      Malammore Beach Club &middot; Manfredonia
    </p>
    <h1 style="font-size:30px;line-height:1.15;margin:0 0 18px;font-weight:normal;">Ci sei.</h1>
    <p style="font-size:17px;line-height:1.6;margin:0 0 14px;">${greeting}</p>
    <p style="font-size:17px;line-height:1.6;margin:0 0 14px;">${modelloLine}</p>
    <p style="font-size:17px;line-height:1.6;margin:0 0 28px;">
      La capsule Estate 2026 &egrave; esaurita. Se torniamo a stampare, lo sai prima tu &mdash;
      ti scriviamo qui, a questo indirizzo. Niente altro.
    </p>
    <p style="font-style:italic;font-size:19px;margin:0 0 32px;color:#A8481C;">
      Malammore non si racconta. Si porta.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#8A7B68;margin:0;border-top:1px solid rgba(42,33,24,.14);padding-top:16px;">
      Ricevi questa email perch&eacute; ti sei iscritto alla lista d'attesa su malammorebeach.netlify.app.
      Per essere rimosso, rispondi a questo messaggio.
    </p>
  </div>
</body></html>`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [email], subject: "Ci sei.", html }),
    });
    if (!emailRes.ok) {
      // il contatto e' comunque salvato: non far fallire la richiesta per un'email non partita
      const body = await emailRes.json().catch(() => ({}));
      console.error("resend email error", emailRes.status, body);
    }
  } catch (err) {
    console.error("resend email fetch failed", err);
  }

  return json(200, { ok: true });
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
