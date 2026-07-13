import { LegalLayout, LegalSection } from './LegalLayout';

const CONTACT_EMAIL = 'jyotishman@sentrixrobotics.com';

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="July 13, 2026">
      <LegalSection title="Acceptable use">
        <p>
          HAVNN lets you watch videos together and hold video calls. You agree to use it lawfully
          and respectfully: no harassment, no abusive or illegal content in rooms or chat, and no
          attempts to disrupt the service or other participants’ sessions.
        </p>
      </LegalSection>

      <LegalSection title="Content and fair use">
        <p>
          HAVNN does not host video content. Playback happens through the original provider
          (YouTube, Google Drive, or a direct link you supply), and you are responsible for having
          the right to watch and share anything you queue. Only share content you own, that is
          publicly available, or that you are otherwise permitted to view with others.
        </p>
      </LegalSection>

      <LegalSection title="User responsibility">
        <p>
          You are responsible for what you say and share in a room: display names, chat messages,
          camera, microphone and screen-share streams. Hosts are responsible for managing their
          rooms, including who can join and control playback.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer">
        <p>
          HAVNN is provided “as is”, without warranties of any kind. We do not guarantee
          uninterrupted availability, perfect synchronization on every network, or compatibility
          with every browser or video format. To the maximum extent permitted by law, HAVNN and
          its operators are not liable for damages arising from use of the service.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          These terms may be updated as the service evolves; the “last updated” date above always
          reflects the current version. Questions? Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
