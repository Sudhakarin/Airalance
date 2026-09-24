// app/(auth)/signup.tsx
// Full signup — username, display name, email, password + privacy checkbox

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
import {
  COLORS,
  FONTS,
  RADII,
  GRADIENTS,
  SPACING,
  SHADOWS,
} from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import Field from '../../components/Field';

export default function SignupScreen() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    if (!agreedToPolicy) {
      setError('Please agree to the Privacy Policy to create an account.');
      return;
    }

    setLoading(true);

    const { data, error: signupErr } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: username.trim().toLowerCase(),
          display_name: displayName.trim() || username.trim(),
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
                  <Ionicons
                    name="chatbubble"
                    size={20}
                    color="#FFFFFF"
                  />
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
                <Text style={styles.subtitle}>
                  Takes less than a minute.
                </Text>

                <View style={{ marginTop: SPACING.lg }}>
                  <Field
                    label="Username"
                    icon={
                      <Ionicons
                        name="at-outline"
                        size={20}
                        color={COLORS.mist}
                      />
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
                      placeholderTextColor={'rgba(139,143,163,0.5)'}
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
                        size={20}
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
                      placeholderTextColor={'rgba(139,143,163,0.5)'}
                      autoCapitalize="words"
                      editable={!loading}
                    />
                  </Field>

                  <Field
                    label="Email"
                    icon={
                      <Ionicons
                        name="mail-outline"
                        size={20}
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
                      placeholderTextColor={'rgba(139,143,163,0.5)'}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!loading}
                    />
                  </Field>

                  <Field
                    label="Password"
                    icon={
                      <Ionicons
                        name="lock-closed-outline"
                        size={20}
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
                      placeholderTextColor={'rgba(139,143,163,0.5)'}
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
                        size={20}
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
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color="#FFFFFF"
                        />
                      )}
                    </View>
                    <Text style={styles.checkboxText}>
                      I agree to the{' '}
                      <Text style={styles.linkText}>Privacy Policy</Text>{' '}
                      and consent to the collection and use of my information
                      as described.
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
                        <ActivityIndicator color="#FFFFFF" />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: SPACING.xl,
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
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 22,
    ...SHADOWS.card,
  },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.violet,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.violet,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  brandText: {
    fontSize: 22,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  brandTextGradient: {
    color: COLORS.violetLight,
  },

  h1: {
    marginTop: SPACING.xl,
    fontSize: 28,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 15,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    lineHeight: 21,
  },

  input: {
    width: '100%',
    backgroundColor: COLORS.ink800,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: RADII.xl,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
  },
  inputWithIcon: {
    paddingLeft: 48,
  },
  inputWithIconRight: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },

  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: COLORS.ink800,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: COLORS.violet,
    borderColor: COLORS.violet,
  },
  checkboxText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    lineHeight: 20,
  },

  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 14,
    fontFamily: FONTS.bodyMedium,
  },

  primaryBtn: {
    borderRadius: RADII.xl,
    overflow: 'hidden',
    marginTop: SPACING.sm,
    shadowColor: COLORS.violet,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  primaryBtnInner: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
  },

  linkText: {
    color: COLORS.violetLight,
    fontFamily: FONTS.bodyMedium,
  },
  linkTextBold: {
    fontSize: 15.5,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.violetLight,
  },
  footerText: {
    marginTop: SPACING.xl,
    textAlign: 'center',
    fontSize: 14.5,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },
});
