// components/PrivacyPolicyModal.tsx
// Privacy Policy popup — blurred backdrop, scrollable content, close button
// Matches the airalance.com/privacy-policy page content

import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADII, SPACING } from '../constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. Information We Collect',
    body: [
      'Information you provide:',
      '• Account details (name, email, phone number) when you sign up',
      '• Profile information you choose to add',
      '• Messages and content you send through chat',
      '• Comments, reactions, and posts you make on the news feed',
      '• Any feedback or support requests',
      '',
      'Information automatically collected:',
      '• Device information (model, OS version, unique identifiers, IP address)',
      '• Usage data (features accessed, time spent, interactions)',
      '• Log data (app crashes, system activity, clickstream)',
      '• Approximate location (for local news relevance, only with your permission)',
      '',
      'Information from third parties:',
      'If you log in via social media platforms, we may access your name, email, and profile picture as per your authorization settings.',
    ],
  },
  {
    title: '2. How We Use Your Information',
    body: [
      '• To create and manage your account',
      '• To enable chat and messaging features',
      '• To deliver personalized news feed content',
      '• To improve app performance and user experience',
      '• To send important updates, security alerts, and support messages',
      '• To maintain platform safety and prevent fraud/abuse',
      '• To respond to your queries and support requests',
    ],
  },
  {
    title: '3. News Feed Content',
    body: [
      'Airalance displays news and content aggregated from various sources. We do not control the content, privacy policies, or practices of third-party publishers whose content appears in your feed. If you are a publisher and wish to opt out, please contact us.',
    ],
  },
  {
    title: '4. Data Sharing',
    body: [
      'We do not sell your personal data. We may share information with:',
      '• Service providers (analytics, hosting, push notifications) who process data on our behalf',
      '• Legal authorities if required by law or to protect our rights',
      '',
      'Your messages and posts are visible to recipients as per your privacy settings within the app.',
    ],
  },
  {
    title: '5. Data Storage & Retention',
    body: [
      'Your data is stored on secure servers. We retain your information only as long as necessary to provide our services or as required by law. Once a message is delivered successfully, it may be deleted from our servers per your preferences.',
    ],
  },
  {
    title: '6. Your Rights & Choices',
    body: [
      'You have the right to:',
      '• Access the personal data we hold about you',
      '• Correct inaccurate or incomplete information',
      '• Delete your account and personal data (via "Delete Account" in settings or by contacting us)',
      '• Withdraw consent for data processing at any time',
      '• Opt-out of marketing communications',
      '• Nominate someone to exercise your rights in case of incapacity',
      '',
      'To exercise these rights, contact us at the details below.',
    ],
  },
  {
    title: "7. Children's Privacy",
    body: [
      'Airalance is not intended for users under 18 years of age. We do not knowingly collect data from children without verifiable parental consent, as required under applicable laws.',
    ],
  },
  {
    title: '8. Security',
    body: [
      'We implement reasonable security measures to protect your data from unauthorized access, disclosure, or destruction.',
    ],
  },
  {
    title: '9. Data Breach Notification',
    body: [
      'In case of a personal data breach that may pose a risk to your rights, we will notify you and the relevant authorities as required by law.',
    ],
  },
  {
    title: '10. Grievance Redressal',
    body: [
      'If you have privacy concerns or complaints, please contact our Grievance Officer:',
      'Email: help@airalance.com',
      'Phone: 7055520186',
      '',
      'Response Time: We aim to respond within 30 days.',
    ],
  },
  {
    title: '11. Updates to This Policy',
    body: [
      'We may update this policy periodically. Changes will be posted here with a revised "Last Updated" date. Significant changes may be notified via email or in-app alerts.',
    ],
  },
  {
    title: '12. Contact Us',
    body: [
      'For any privacy-related questions:',
      'Email: help@airalance.com',
      'Phone: 7055520186',
      '',
      'Airalance is an application under AiraThink. This policy applies to all services provided.',
    ],
  },
];

export default function PrivacyPolicyModal({ visible, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <BlurView
        intensity={60}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={styles.backdrop}
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Privacy Policy</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.updated}>Last Updated: August 21, 2026</Text>
            <Text style={styles.intro}>
              Airalance (referred to as "we," "our," or "us") is an application
              under AiraThink. We are committed to protecting your privacy.
              This policy explains how we collect, use, and safeguard your
              information when you use our chat and news feed platform.
            </Text>

            {SECTIONS.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.body.map((line, i) => (
                  <Text
                    key={i}
                    style={
                      line === ''
                        ? styles.spacer
                        : line.startsWith('•') ||
                          line.startsWith('Email:') ||
                          line.startsWith('Phone:') ||
                          line.startsWith('Response')
                        ? styles.bullet
                        : styles.paragraph
                    }
                  >
                    {line}
                  </Text>
                ))}
              </View>
            ))}

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.gotItBtn}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={styles.gotItText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  updated: {
    fontSize: 12,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.violetLight,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  intro: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    lineHeight: 21,
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15.5,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    lineHeight: 20,
    marginBottom: 4,
  },
  bullet: {
    fontSize: 13.5,
    fontFamily: FONTS.body,
    color: COLORS.mistLight,
    lineHeight: 20,
    marginBottom: 2,
    paddingLeft: 4,
  },
  spacer: {
    height: 6,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  gotItBtn: {
    backgroundColor: COLORS.violet,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gotItText: {
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    color: '#FFFFFF',
  },
});
