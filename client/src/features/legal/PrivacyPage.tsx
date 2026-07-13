import { CONTACT_EMAILS } from '@/components/Footer';
import { LegalLayout, LegalSection } from './LegalLayout';

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="July 13, 2026">
      <LegalSection title="Overview">
        <p>
          HAVNN is a watch-together platform for synchronized video playback with peer-to-peer
          video calls. It is designed to work without accounts: you do not need to register, and
          we aim to collect as little data as possible.
        </p>
      </LegalSection>

      <LegalSection title="Data we process">
        <p>
          <strong className="text-ink">Rooms are ephemeral.</strong> Room codes, display names,
          chat messages and playback state exist only in memory for the lifetime of a room and are
          discarded when everyone leaves. We do not build profiles of participants.
        </p>
        <p>
          <strong className="text-ink">Video and audio calls are peer-to-peer.</strong> Camera,
          microphone and screen-share streams travel directly between participants over WebRTC and
          are not recorded or stored by HAVNN. Signaling metadata (needed to establish the
          connection) passes through our server but is not retained.
        </p>
        <p>
          <strong className="text-ink">Video links.</strong> When you play a YouTube, Google Drive
          or direct video link, that content is fetched from the respective provider, which may
          apply its own privacy policy (see YouTube/Google policies).
        </p>
      </LegalSection>

      <LegalSection title="Analytics">
        <p>
          We use Google Analytics to understand aggregate site usage (page views, approximate
          region, device type). Google Analytics sets cookies and processes data under Google’s
          privacy policy. We use this data only to improve HAVNN and never to identify individual
          users.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <p>
          HAVNN itself stores small amounts of data in your browser (such as your chosen display
          name, theme and device preferences) so the app remembers your settings. Google Analytics
          sets cookies as described above. Embedded players (YouTube, Google Drive) may set their
          own cookies when a video loads.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this policy or your data? Email{' '}
          <a href={`mailto:${CONTACT_EMAILS[0]}`} className="text-accent hover:underline">
            {CONTACT_EMAILS[0]}
          </a>{' '}
          or{' '}
          <a href={`mailto:${CONTACT_EMAILS[1]}`} className="text-accent hover:underline">
            {CONTACT_EMAILS[1]}
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
