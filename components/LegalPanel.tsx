// components/LegalPanel.tsx
// Settings → Terms & Conditions / Privacy Policy (in-app, scrollable).
// ⚠️ Ye ek template hai. Live karne se pehle kisi lawyer se review zaroor karwa lo,
//    aur neeche ke constants (company, email, adress, date) apne hisaab se badlo.

import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, RADII } from '../constants/theme';

const APP = 'Airalance';
const COMPANY = 'AiraThink Digital Media';
const COMPANY_PLACE = 'Mumbai, Maharashtra, India';
const SUPPORT_EMAIL = 'support@airathink.com'; // ← apna support email daalo
const UPDATED = '10 November 2026';

type Section = { h: string; p: string[] };

const TERMS: Section[] = [
  {
    h: '1. Accepting these terms',
    p: [
      `By creating an account or using ${APP}, you agree to these Terms & Conditions and our Privacy Policy. If you don't agree, please don't use ${APP}.`,
      `${APP} is provided by ${COMPANY}, ${COMPANY_PLACE} ("we", "us").`,
    ],
  },
  {
    h: '2. Who can use Airalance',
    p: [
      'You must be at least 18 years old, or have the consent of a parent or legal guardian to use the app.',
      'You must give accurate information when you sign up and keep your login details safe. You are responsible for activity on your account.',
    ],
  },
  {
    h: '3. What you can do',
    p: [
      `${APP} lets you create an account, view and share status updates, play games, send connection requests, chat with your connections, and read news.`,
      'Some features (like finding friends from your contacts or local news from your location) only work if you allow the related permission, and you can change that anytime.',
    ],
  },
  {
    h: '4. Acceptable use',
    p: [
      'Do not harass, threaten, bully or impersonate others. Do not post or send illegal, hateful, sexual-exploitative, violent or misleading content.',
      'Do not spam, scrape, hack, reverse-engineer or try to disrupt the app, other users or our systems. Do not create fake or duplicate accounts to avoid a ban.',
      'Do not use the games or other features to cheat, exploit bugs, or gain an unfair advantage.',
    ],
  },
  {
    h: '5. Your content',
    p: [
      'You keep ownership of what you post (status, messages, photos and more). You give us a limited licence to store, display and deliver it so the app can work for you and the people you share it with.',
      'You are responsible for your content. We may remove content that breaks these terms or the law.',
    ],
  },
  {
    h: '6. Connections and chats',
    p: [
      'You choose who to connect with. You can block any account at any time. Blocked accounts cannot message or call you, and their name and photo are hidden in your chats.',
      'Please be respectful. We may review reported content to keep the community safe.',
    ],
  },
  {
    h: '7. News',
    p: [
      'News in the app comes from third-party sources and is for general information. We do not guarantee that it is complete, accurate or up to date.',
    ],
  },
  {
    h: '8. Verification badge',
    p: [
      'The verified badge is given at our discretion after review. We can remove it if the account breaks these terms or the information provided was false.',
    ],
  },
  {
    h: '9. Moderation, bans and appeals',
    p: [
      'If an account breaks these terms, we may warn, restrict, suspend (for a set time) or permanently ban it.',
      'A banned user can still log in to see the reason, the ban duration and a Reference ID, and can send an appeal. Our team reviews appeals and may lift or keep the ban. You can appeal again 24 hours after a declined appeal.',
    ],
  },
  {
    h: '10. Ending your account',
    p: [
      `You can stop using ${APP} at any time and ask us to delete your account at ${SUPPORT_EMAIL}. We may suspend or end accounts that break these terms or the law.`,
    ],
  },
  {
    h: '11. Disclaimers and liability',
    p: [
      `${APP} is provided "as is" and "as available". We work to keep it safe and running, but we can't promise it will always be uninterrupted or error-free.`,
      'To the extent allowed by law, we are not liable for indirect or consequential losses, or for content and conduct of other users.',
    ],
  },
  {
    h: '12. Changes to these terms',
    p: [
      'We may update these terms from time to time. If a change is important, we will tell you in the app. Continuing to use the app after a change means you accept it.',
    ],
  },
  {
    h: '13. Governing law',
    p: [
      'These terms are governed by the laws of India. Courts in Mumbai have jurisdiction, subject to any rights you have under applicable consumer law.',
    ],
  },
  {
    h: '14. Contact us',
    p: [`Questions about these terms? Write to ${SUPPORT_EMAIL}.`],
  },
];

const PRIVACY: Section[] = [
  {
    h: '1. Who we are',
    p: [
      `${COMPANY}, ${COMPANY_PLACE}, runs ${APP}. This policy explains what information we collect, why, and the choices you have.`,
    ],
  },
  {
    h: '2. Information we collect',
    p: [
      'Account and profile: email, username, display name, profile photo, bio and the settings you choose.',
      'Your activity: status updates, messages and media you send, connection requests, blocks, game activity and verification requests (including a selfie if you apply for a badge).',
      'Device and usage: device type, app version, push notification token, time-limit usage, crash and security logs, and your IP address (our servers receive it with every request).',
      'Permission choices: whether you allowed or denied permissions such as notifications, camera, microphone, photos, contacts and location.',
      'Contacts: only if you allow contacts access (we ask when you first open the app, and you can change it anytime).',
      'Location: only if you allow location access. We save your area (city, locality and postal code), not your exact coordinates.',
    ],
  },
  {
    h: '3. Contacts (if you allow)',
    p: [
      'If you allow contacts access, the app reads the email addresses and phone numbers in your contacts and converts each one into an irreversible encrypted fingerprint (a hash) on your phone. We upload only those fingerprints. We never receive your contacts\' names or readable numbers.',
      'We compare fingerprints to show you which of your contacts are already on Airalance. People who blocked you or who you blocked are not shown.',
      'The names saved in your phone stay on your phone — the app uses them only on your device to show who a contact is.',
      'You can turn this off any time in Settings → Contacts & location, which also deletes the fingerprints we hold. You can also remove the permission in your phone settings.',
    ],
  },
  {
    h: '4. Location (if you allow)',
    p: [
      'If you allow location access, the app uses your phone\'s location once in a while to work out your area — city, locality and postal code. We save only that area. We do not store your exact coordinates or a location history.',
      'We use it to show news that is relevant to your area. Turn it off any time in Settings → Contacts & location; your saved place is then deleted.',
    ],
  },
  {
    h: '5. How we use your information',
    p: [
      'To run the app: create your account, show your profile and status, deliver messages, run games, and show news.',
      'To keep the community safe: detect spam and abuse, review reports, enforce our Terms, handle bans and appeals, and prevent fake accounts.',
      'To improve and secure the service, fix bugs, and send notifications you have allowed.',
      'We do not sell your personal information.',
    ],
  },
  {
    h: '6. Who can see your information',
    p: [
      'Other users see what you choose to share (profile, status, messages sent to them). Our authorised moderation team can see account details needed to keep the app safe — for example reports, ban status, and whether permissions are allowed or denied. They cannot see your contacts\' names or your exact location.',
      'We use trusted service providers (for example cloud hosting, database and notification services) who process data for us under strict terms. We may share information if required by law or to protect people\'s safety.',
    ],
  },
  {
    h: '7. How long we keep it',
    p: [
      'We keep your information while your account is active. When you delete your account we delete or anonymise your data, except where we must keep some records for legal or safety reasons (for example to enforce a ban).',
      'Contact fingerprints and saved location are removed as soon as you turn those features off.',
    ],
  },
  {
    h: '8. Your choices and rights',
    p: [
      'You can access and correct your profile in the app, block accounts, turn off contacts and location access, and change permissions in your phone settings.',
      `You can ask us to access, correct or delete your personal data, or withdraw consent, by writing to ${SUPPORT_EMAIL}. If you are not satisfied, you may complain to the relevant data-protection authority in India.`,
    ],
  },
  {
    h: '9. Security',
    p: [
      'We use encryption in transit, access controls and monitoring to protect your data. No system is perfectly secure, so please use a strong password and keep your device safe.',
    ],
  },
  {
    h: '10. Children',
    p: [
      `${APP} is for people aged 18 and over, or younger people using it with a parent or guardian's consent. If you believe a child is using the app without consent, contact us and we will act.`,
    ],
  },
  {
    h: '11. Changes to this policy',
    p: ['We may update this policy. If the change is important, we will notify you in the app.'],
  },
  {
    h: '12. Contact / grievance',
    p: [`For privacy questions, requests or complaints: ${SUPPORT_EMAIL}.`],
  },
];

export default function LegalPanel({ kind }: { kind: 'terms' | 'privacy' }) {
  const sections = kind === 'terms' ? TERMS : PRIVACY;
  const title = kind === 'terms' ? 'Terms & Conditions' : 'Privacy Policy';
  const icon = kind === 'terms' ? 'document-text-outline' : 'lock-closed-outline';
  const tint = kind === 'terms' ? '#B79CFF' : '#4ADE9A';

  return (
    <View>
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: `${tint}29` }]}>
          <Ionicons name={icon} size={24} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroSub}>Last updated {UPDATED}</Text>
        </View>
      </View>

      {sections.map((s) => (
        <View key={s.h} style={styles.section}>
          <Text style={styles.h}>{s.h}</Text>
          {s.p.map((para, i) => (
            <Text key={i} style={styles.p}>
              {para}
            </Text>
          ))}
        </View>
      ))}

      <TouchableOpacity
        style={styles.mailBtn}
        onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {})}
        activeOpacity={0.8}
      >
        <Ionicons name="mail-outline" size={18} color="#FFFFFF" />
        <Text style={styles.mailText}>Contact {SUPPORT_EMAIL}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    marginTop: 8,
    borderRadius: RADII.xl,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
  },
  heroIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 18, fontFamily: FONTS.displayBold, color: '#FFFFFF' },
  heroSub: { fontSize: 12.5, fontFamily: FONTS.body, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  section: {
    marginTop: 12,
    padding: 16,
    borderRadius: RADII.xl,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1F1F23',
  },
  h: { fontSize: 15, fontFamily: FONTS.bodySemiBold, color: '#FFFFFF', marginBottom: 8 },
  p: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 20,
    marginBottom: 8,
  },
  mailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    height: 46,
    borderRadius: RADII.full,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  mailText: { color: '#FFFFFF', fontSize: 14, fontFamily: FONTS.bodySemiBold },
});
