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
const UPDATED = '11 November 2026';
const GRIEVANCE_OFFICER = 'Your Name, Grievance Officer'; // ← apna naam daalo
const RESPONSE_TIME = '30 days';

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
      'Some features (like finding friends from your contacts or local news from your location) only work if you allow the related permission and give us your consent, and you can withdraw it anytime. See our Privacy Policy for exactly what we collect and why.',
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
      'To investigate abuse and keep the community safe, our authorised team may review account information, including data you allowed us to collect (such as location or contacts). We may share information with government or law-enforcement authorities when the law or a valid legal order requires it, or to prevent serious harm.',
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
      `${COMPANY}, ${COMPANY_PLACE}, runs ${APP} and is the "Data Fiduciary" for your personal data under India's Digital Personal Data Protection Act, 2023 (DPDP Act). This policy explains what we collect, why, who can see it, and your rights.`,
    ],
  },
  {
    h: '2. Information we collect',
    p: [
      'Account and profile: email, username, display name, profile photo, bio and the settings you choose.',
      'Your activity: status updates, messages and media you send, connection requests, blocks, game activity and verification requests (including a selfie if you apply for a badge).',
      'Device and network: IP address, device brand and model, operating system and version, app version, network type (Wi-Fi or mobile data) and carrier, language, time zone, and an app-install ID. We also keep push notification token, time-limit usage, crash and security logs.',
      'Permission choices: whether you allowed or denied notifications, camera, microphone, photos, contacts and location.',
      'Contacts (only with your consent): the names, phone numbers and email addresses saved in your phone.',
      'Precise location (only with your consent): your GPS location (latitude, longitude and accuracy) and the area worked out from it (city, locality, postal code).',
    ],
  },
  {
    h: '3. Contacts — what we do and why',
    p: [
      'If you allow contacts access and give consent in the app, we upload the names, phone numbers and email addresses in your phone contacts to our servers. We also create encrypted fingerprints (hashes) of numbers and emails for matching.',
      'Purposes: (a) show you which of your contacts are on Airalance and suggest people you may know; (b) improve our recommendation and matching algorithms; (c) prevent abuse, fake accounts and fraud, and investigate reports; (d) comply with legal obligations.',
      'Your contacts are other people who have not used Airalance. We do not message them, do not sell their details and use them only for the purposes above. A person whose details we hold can ask us to delete them by writing to us.',
      'You can withdraw consent any time in Settings → Contacts & location. We then delete your uploaded contact details and fingerprints. You can also remove the permission in your phone settings.',
    ],
  },
  {
    h: '4. Precise location — what we do and why',
    p: [
      'If you allow location access and give consent in the app, we collect your precise location while you use the app and refresh it from time to time. We keep only your latest location, not a history.',
      'Purposes: (a) show news relevant to your city and neighbourhood; (b) improve relevance and recommendations; (c) keep the community safe and investigate abuse or misuse; (d) comply with legal obligations.',
      'You can withdraw consent any time in Settings → Contacts & location. We then delete your saved precise location and area.',
    ],
  },
  {
    h: '5. How we use your information',
    p: [
      'To run the app: create your account, show your profile and status, deliver messages, run games, and show news.',
      'To keep the community safe: detect spam and abuse, review reports, enforce our Terms, handle bans and appeals, and prevent fake accounts.',
      'To improve and secure the service, fix bugs, and send notifications you have allowed.',
      'We do not sell your personal information. We use your data only for the purposes stated in this policy.',
    ],
  },
  {
    h: '6. Who can see your information',
    p: [
      'Other users see what you choose to share (profile, status, messages sent to them). They do not see your contacts list or your precise location.',
      'Our authorised staff (admins and owners) can view account details and, if you gave consent, your precise location and contact details. Staff must give a reason, and every access is recorded in an audit log. Moderators cannot see this data.',
      'We use trusted service providers (cloud hosting, database and notification services) who process data for us under strict terms.',
      'Government and law enforcement: we share information with government or law-enforcement authorities only when the law or a valid legal order requires it, or when needed to prevent serious harm to a person.',
    ],
  },
  {
    h: '7. How long we keep it',
    p: [
      'We keep your information while your account is active. When you delete your account we delete or anonymise your data, except where we must keep some records for legal or safety reasons (for example to enforce a ban or comply with a legal order).',
      'Contact details, fingerprints and precise location are deleted when you withdraw consent or delete your account.',
      'IP address and device logs are kept for 180 days from last use, or longer if the law or a legal order requires.',
      'You can request deletion of your account in Settings → Delete account. We delete your account and personal data within 24 hours of your request. We may keep a limited record (such as your email, username and IP or device logs) for up to 180 days after deletion, or longer if the law or a legal order requires.',
    ],
  },
  {
    h: '8. Your rights and choices',
    p: [
      'You can access and correct your profile in the app, block accounts, turn contacts and location off, and change permissions in your phone settings.',
      `Under the DPDP Act you can ask for a summary of your personal data and how we use it, ask us to correct or erase it, withdraw consent at any time, nominate someone to exercise your rights if you cannot, and complain about a grievance. Write to ${SUPPORT_EMAIL}. We aim to respond within ${RESPONSE_TIME}.`,
      'If you are not satisfied with our response, you may complain to the Data Protection Board of India.',
    ],
  },
  {
    h: '9. Security',
    p: [
      'We use encryption in transit, access controls, audit logging and monitoring to protect your data. In case of a personal data breach, we will inform affected users and the authorities as the law requires. No system is perfectly secure, so please use a strong password and keep your device safe.',
    ],
  },
  {
    h: '10. Children',
    p: [
      `${APP} is for people aged 18 and over. We do not knowingly collect personal data of children without verifiable parental consent, and we do not track or target children. If you believe a child is using the app, contact us and we will act.`,
    ],
  },
  {
    h: '11. Changes to this policy',
    p: ['We may update this policy. If the change is important (for example a new kind of data or purpose), we will ask for your consent again in the app.'],
  },
  {
    h: '12. Grievance officer',
    p: [`${GRIEVANCE_OFFICER}, ${COMPANY}, ${COMPANY_PLACE}. Email: ${SUPPORT_EMAIL}.`],
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
