export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <article className="max-w-2xl space-y-4 text-sm leading-relaxed text-neutral-300">
      <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
      <p className="text-neutral-500">Last updated: 2026-10-20. Template text: have it reviewed by a lawyer before launch.</p>

      <h2 className="pt-2 text-lg font-semibold text-white">What we collect</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>An anonymous session identifier (essential cookie) so we can match you and remember your plan. You can chat without an account.</li>
        <li>
          If you choose to sign in: your email address. We use it only to send you sign-in codes and to keep your Premium, free
          matches and invite rewards on every device. We don&apos;t send marketing email. If you pay while signed in, your email is
          also passed to PesaPal for your receipt.
        </li>
        <li>
          Signed-in devices: for each device where you are signed in we keep a session record with the browser&apos;s user agent
          (which tells us the device type and browser), when you signed in and when it was last active. We show you this list on
          your Account page so you can sign out of any device. We don&apos;t show or use location, and we don&apos;t use device
          fingerprinting to recognise you.
        </li>
        <li>
          When you sign in on a browser where you were using RandomChat anonymously, we merge that browser&apos;s data (plan time,
          matches used, invite rewards) into your account and delete the anonymous identity. We keep a short internal record of
          the merge for support.
        </li>
        <li>Counters used to limit how often sign-in codes can be requested or guessed (keyed by a one-way hash, not your raw email or IP address).</li>
        <li>Whether you confirmed you are 18+.</li>
        <li>
          Optional profile details you choose to share: gender (boy or girl) and your country. Both are used only to power matching filters, are never required, and can be set back to &quot;Prefer not to say&quot; / &quot;Not set&quot; at any time.</li>
        <li>Referral information: which invite link brought you here and how many friends you invited. A referral counts once the invited person has a chat of at least 60 seconds with someone other than the person who invited them.</li>
        <li>How long you actively use the app (used only for the referral engagement reward).</li>
        <li>Reports made against users (reason and match reference) to keep the service safe.</li>
        <li>Payment status and order records (plan, amount, currency, PesaPal tracking id). Payments are taken on PesaPal&apos;s secure page: card numbers and M-Pesa details are entered there and never touch our servers.</li>
        <li>Analytics data, only if you accept analytics cookies.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold text-white">Payment records</h2>
      <p>
        We keep records of orders and payments (product, amount, currency, date, payment provider and its transaction reference)
        for accounting and tax purposes, including after you delete your account. When you delete your account we remove your
        account link and any email or phone number from those records.
      </p>

      <h2 className="pt-2 text-lg font-semibold text-white">Deleting your account</h2>
      <p>
        Signed-in users can delete their account at any time from the Account page. This signs you out everywhere and deletes
        your email, devices list, plan time, matches and invite rewards. Payment records are kept as described above.
      </p>

      <h2 className="pt-2 text-lg font-semibold text-white">Video, audio and messages</h2>
      <p>
        Video and audio travel directly between you and your match (peer-to-peer) and are not recorded or stored by us.
        Your IP address is visible to your match unless a relay server is used. Text messages travel over the same
        peer connection. If you turn on Translate, the text being translated is sent to a third-party translation
        service (MyMemory).
      </p>

      <h2 className="pt-2 text-lg font-semibold text-white">Cookies</h2>
      <p>
        We set essential cookies to operate the site (your session, signed in or anonymous, and the invite link that referred you).
        We also keep a few small settings in your browser&apos;s storage (for example, that you dismissed a tip or banner). Analytics cookies are only loaded after you click Accept on
        the cookie banner; if you decline, no analytics run. You can change your choice by clearing this site&apos;s data.
      </p>

      <h2 className="pt-2 text-lg font-semibold text-white">Sharing</h2>
      <p>
        We share data only with service providers needed to run RandomChat (hosting, database and sign-in, email delivery for
        sign-in codes, payments, a relay server that carries the call when a direct connection isn&apos;t possible, analytics if
        consented, translation) or when required by law.
      </p>

      <h2 className="pt-2 text-lg font-semibold text-white">Your rights</h2>
      <p>Depending on where you live you may request access to, or deletion of, your data. Contact us at the address published on this site.</p>

      <h2 className="pt-2 text-lg font-semibold text-white">Age</h2>
      <p>RandomChat is for adults 18+. If you believe a minor is using the service, report them in-chat immediately.</p>
    </article>
  );
}
