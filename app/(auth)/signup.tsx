// app/(auth)/signup.tsx
// Full signup — matches website style (compact, clean)

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, GRADIENTS, SPACING } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { requestNotificationPermission } from '../../lib/push-permissions';
import Field from '../../components/Field';
import DobPicker, { formatDob, calcAge } from '../../components/DobPicker';

const MIN_AGE = 13;

export default function SignupScreen() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState<Date | null>(null);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setError(null);

    if (!username.trim() || username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      setError('Username can only contain letters, numbers and underscores.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!dob) {
      setError('Please select your date of birth.');
      return;
    }
    const age = calcAge(dob);
    if (age < MIN_AGE) {
      setError(`You must be at least ${MIN_AGE} years old to use this app.`);
      return;
    }
    if (age > 120) {
      setError('Please enter a valid date of birth.');
      return;
    }
    if (!agreedToPolicy) {
      setError('Please agree to the Privacy Policy to create an account.');
      return;
    }

    setLoading(true);

    const dobISO = `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, '0')}-${String(dob.getDate()).padStart(2, '0')}`;

    const { data, error: signupErr } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: username.trim().toLowerCase(),
          display_name: displayName.trim() || username.trim(),
          date_of_birth: dobISO,
          privacy_accepted_at: new Date().toISOString(),
        },
      },
    });

    setLoading(false);

    if (signupErr) {
      setError(signupErr.message);
      return;
    }

    if (data.session) {
      await requestNotificationPermission();
      router.replace('/(tabs)/home');
    } else {
      setDone(true);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Link href="/" asChild>
              <Pressable style={styles.brandRow}>
                <View style={styles.brandIcon}>
                  <Ionicons name="chatbubble" size={16} color="#FFFFFF" />
                </View>
                <Text style={styles.brandText}>
                  Aira
                  <Text style={styles.brandTextGradient}>Think!</Text>
                </Text>
              </Pressable>
            </Link>

            {done ? (
              <>
                <Text style={styles.h1}>Check your inbox</Text>
                <Text style={styles.subtitle}>
                  We sent a confirmation link to{' '}
                  <Text style={{ color: '#FFFFFF', fontFamily: FONTS.bodyMedium }}>
                    {email}
                  </Text>
                  . Confirm your email, then log in.
                </Text>

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.replace('/(auth)/login')}
                  activeOpacity={0.9}
                >
                  <LinearGradient
                    colors={GRADIENTS.violet}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.primaryBtnInner}
                  >
                    <Text style={styles.primaryBtnText}>Go to login</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.h1}>Create your account</Text>
                <Text style={styles.subtitle}>Takes less than a minute.</Text>

                <View style={{ marginTop: 24 }}>
                  <Field
                    label="Username"
                    icon={
                      <Ionicons name="at-outline" size={18} color={COLORS.mist} />
                    }
                  >
                    <TextInput
                      style={[styles.input, styles.inputWithIcon]}
                      value={username}
                      onChangeText={(t) => {
                        setUsername(t);
                        if (error) setError(null);
                      }}
                      placeholder="janedoe"
                      placeholderTextColor="rgba(139,143,163,0.5)"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!loading}
                    />
                  </Field>

                  <Field
                    label="Display name"
                    icon={
                      <Ionicons
                        name="person-outline"
                        size={18}
                        color={COLORS.mist}
                      />
                    }
                  >
                    <TextInput
                      style={[styles.input, styles.inputWithIcon]}
                      value={displayName}
                      onChangeText={(t) => {
                        setDisplayName(t);
                        if (error) setError(null);
                      }}
                      placeholder="Jane Doe"
                      placeholderTextColor="rgba(139,143,163,0.5)"
                      autoCapitalize="words"
                      editable={!loading}
                    />
                  </Field>

                  <Field
                    label="Email"
                    icon={
                      <Ionicons
                        name="mail-outline"
                        size={18}
                        color={COLORS.mist}
                      />
                    }
                  >
                    <TextInput
                      style={[styles.input, styles.inputWithIcon]}
                      value={email}
                      onChangeText={(t) => {
                        setEmail(t);
                        if (error) setError(null);
                      }}
                      placeholder="you@example.com"
                      placeholderTextColor="rgba(139,143,163,0.5)"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!loading}
                    />
                  </Field>

                  <Field
                    label="Date of birth"
                    icon={
                      <Ionicons
                        name="calendar-outline"
                        size={18}
                        color={COLORS.mist}
                      />
                    }
                  >
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() => {
                        if (loading) return;
                        if (error) setError(null);
                        setShowDobPicker(true);
                      }}
                      style={[
                        styles.input,
                        styles.inputWithIcon,
                        styles.inputWithIconRight,
                        styles.dobTouchable,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dobText,
                          !dob && styles.dobTextPlaceholder,
                        ]}
                      >
                        {dob ? formatDob(dob) : 'Select date of birth'}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.dobChevron} pointerEvents="none">
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={COLORS.mist}
                      />
                    </View>
                  </Field>

                  <Field
                    label="Password"
                    icon={
                      <Ionicons
                        name="lock-closed-outline"
                        size={18}
                        color={COLORS.mist}
                      />
                    }
                  >
                    <TextInput
                      style={[
                        styles.input,
                        styles.inputWithIcon,
                        styles.inputWithIconRight,
                      ]}
                      value={password}
                      onChangeText={(t) => {
                        setPassword(t);
                        if (error) setError(null);
                      }}
                      placeholder="At least 6 characters"
                      placeholderTextColor="rgba(139,143,163,0.5)"
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!loading}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowPassword((s) => !s)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                        size={18}
                        color={COLORS.mist}
                      />
                    </TouchableOpacity>
                  </Field>

                  <Pressable
                    style={styles.checkboxRow}
                    onPress={() => setAgreedToPolicy((v) => !v)}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        agreedToPolicy && styles.checkboxChecked,
                      ]}
                    >
                      {agreedToPolicy && (
                        <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                      )}
                    </View>
                    <Text style={styles.checkboxText}>
                      I agree to the{' '}
                      <Text style={styles.linkText}>Privacy Policy</Text> and
                      consent to the collection and use of my information as
                      described.
                    </Text>
                  </Pressable>

                  {error && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (!agreedToPolicy || loading) && { opacity: 0.6 },
                    ]}
                    onPress={handleSubmit}
                    disabled={!agreedToPolicy || loading}
                    activeOpacity={0.9}
                  >
                    <LinearGradient
                      colors={GRADIENTS.violet}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.primaryBtnInner}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.primaryBtnText}>
                          Create account
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>

                  <Text style={styles.footerText}>
                    Already have an account?{' '}
                    <Link href="/(auth)/login" asChild>
                      <Text style={styles.linkTextBold}>Log in</Text>
                    </Link>
                  </Text>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <DobPicker
        visible={showDobPicker}
        value={dob}
        onClose={() => setShowDobPicker(false)}
        onConfirm={(d) => {
          setDob(d);
          setShowDobPicker(false);
        }}
        minAge={MIN_AGE}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },

  glowTop: {
    position: 'absolute',
    top: -150,
    left: -100,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(124,92,255,0.20)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -150,
    right: -100,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(34,211,184,0.12)',
  },

  card: {
    backgroundColor: 'rgba(16,19,28,0.85)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 24,
  },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    fontSize: 18,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  brandTextGradient: {
    color: COLORS.violetLight,
  },

  h1: {
    marginTop: 24,
    fontSize: 24,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    lineHeight: 20,
  },

  // ✅ COMPACT — matches website
  input: {
    width: '100%',
    backgroundColor: COLORS.ink800,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
  },
  inputWithIcon: {
    paddingLeft: 42,
  },
  inputWithIconRight: {
    paddingRight: 42,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  dobTouchable: {
    justifyContent: 'center',
  },
  dobText: {
    fontSize: 14,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
  },
  dobTextPlaceholder: {
    color: 'rgba(139,143,163,0.5)',
  },
  dobChevron: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },

  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: COLORS.ink800,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: COLORS.violet,
    borderColor: COLORS.violet,
  },
  checkboxText: {
    flex: 1,
    fontSize: 12,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    lineHeight: 18,
  },

  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontFamily: FONTS.bodyMedium,
  },

  // ✅ COMPACT button — matches website
  primaryBtn: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: COLORS.violet,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryBtnInner: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
  },

  linkText: {
    color: COLORS.violetLight,
    fontFamily: FONTS.bodyMedium,
  },
  linkTextBold: {
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.violetLight,
  },
  footerText: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },
});
