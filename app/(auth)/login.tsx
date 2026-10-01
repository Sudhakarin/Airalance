// app/(auth)/login.tsx
// Full login flow — password, OTP, forgot password (6 modes)

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
import { requestNotificationPermission } from '../../lib/push-permissions'; // <-- ADDED IMPORT
import Field from '../../components/Field';
import OtpBoxes from '../../components/OtpBoxes';

type Mode =
  | 'password'
  | 'otp-email'
  | 'otp-verify'
  | 'forgot-email'
  | 'forgot-otp'
  | 'forgot-newpass';

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetState() {
    setOtp('');
    setError(null);
    setNewPassword('');
    setConfirmPassword('');
  }

  function goBack() {
    resetState();
    if (mode === 'otp-verify') setMode('otp-email');
    else if (mode === 'otp-email') setMode('password');
    else if (mode === 'forgot-otp') setMode('forgot-email');
    else if (mode === 'forgot-email') setMode('password');
    else if (mode === 'forgot-newpass') setMode('forgot-otp');
  }

  async function handlePasswordLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (err) {
      setError('Incorrect email or password.');
      setLoading(false);
    } else {
      await requestNotificationPermission(); // <-- ADDED
      router.replace('/(tabs)/home');
    }
  }

  async function handleSendOtp() {
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      setMode('otp-verify');
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6) return;
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp,
      type: 'email',
    });
    if (err) {
      setError('Invalid or expired code. Please try again.');
      setLoading(false);
    } else {
      await requestNotificationPermission(); // <-- ADDED
      router.replace('/(tabs)/home');
    }
  }

  async function handleForgotSendOtp() {
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    if (err) {
      setError('No account found with this email.');
      setLoading(false);
    } else {
      setMode('forgot-otp');
      setLoading(false);
    }
  }

  async function handleForgotVerifyOtp() {
    if (otp.length !== 6) return;
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp,
      type: 'email',
    });
    if (err) {
      setError('Invalid or expired code. Please try again.');
      setLoading(false);
    } else {
      setMode('forgot-newpass');
      setLoading(false);
    }
  }

  async function handleSetNewPassword() {
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      await requestNotificationPermission(); // <-- ADDED
      router.replace('/(tabs)/home');
    }
  }

  const showBrandHeader = mode === 'password';

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
            <View style={styles.headerRow}>
              {mode !== 'password' && (
                <TouchableOpacity
                  onPress={goBack}
                  style={styles.backBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="chevron-back"
                    size={22}
                    color={COLORS.mist}
                  />
                </TouchableOpacity>
              )}
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
            </View>

            {showBrandHeader && (
              <Text style={styles.brandTagline}>
                Where conversations think ahead ⚡
              </Text>
            )}

            {mode === 'password' && (
              <>
                <Text style={styles.h1}>Welcome back</Text>
                <Text style={styles.subtitle}>
                  Log in to continue chatting.
                </Text>

                <View style={{ marginTop: SPACING.lg }}>
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
                    right={
                      <TouchableOpacity
                        onPress={() => {
                          resetState();
                          setMode('forgot-email');
                        }}
                      >
                        <Text style={styles.linkSmall}>
                          Forgot password?
                        </Text>
                      </TouchableOpacity>
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
                      placeholder="Your password"
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

                  {error && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handlePasswordLogin}
                    disabled={loading}
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
                        <Text style={styles.primaryBtnText}>Log in</Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>

                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => {
                      resetState();
                      setMode('otp-email');
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="mail-outline"
                      size={18}
                      color="#FFFFFF"
                    />
                    <Text style={styles.secondaryBtnText}>
                      Log in with OTP
                    </Text>
                  </TouchableOpacity>

                  <Text style={styles.footerText}>
                    Don't have an account?{' '}
                    <Link href="/(auth)/signup" asChild>
                      <Text style={styles.linkText}>Sign up</Text>
                    </Link>
                  </Text>
                </View>
              </>
            )}

            {mode === 'otp-email' && (
              <>
                <Text style={styles.h1}>Log in with OTP</Text>
                <Text style={styles.subtitle}>
                  We'll send a 6-digit code to your email.
                </Text>

                <View style={{ marginTop: SPACING.lg }}>
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

                  {error && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleSendOtp}
                    disabled={loading}
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
                        <Text style={styles.primaryBtnText}>Send OTP</Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {mode === 'otp-verify' && (
              <>
                <Text style={styles.h1}>Enter your code</Text>
                <Text style={styles.subtitle}>
                  A 6-digit code was sent to{' '}
                  <Text style={{ color: '#FFFFFF', fontFamily: FONTS.bodyMedium }}>
                    {email}
                  </Text>
                  .
                </Text>

                <View style={{ marginTop: SPACING.lg }}>
                  <OtpBoxes value={otp} onChange={setOtp} autoFocus />

                  {error && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (loading || otp.length !== 6) && { opacity: 0.6 },
                    ]}
                    onPress={handleVerifyOtp}
                    disabled={loading || otp.length !== 6}
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
                        <Text style={styles.primaryBtnText}>Log in</Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {mode === 'forgot-email' && (
              <>
                <Text style={styles.h1}>Reset password</Text>
                <Text style={styles.subtitle}>
                  Enter your email — we'll send a verification code.
                </Text>

                <View style={{ marginTop: SPACING.lg }}>
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

                  {error && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleForgotSendOtp}
                    disabled={loading}
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
                          Send Code
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {mode === 'forgot-otp' && (
              <>
                <Text style={styles.h1}>Enter your code</Text>
                <Text style={styles.subtitle}>
                  A 6-digit code was sent to{' '}
                  <Text style={{ color: '#FFFFFF', fontFamily: FONTS.bodyMedium }}>
                    {email}
                  </Text>
                  .
                </Text>

                <View style={{ marginTop: SPACING.lg }}>
                  <OtpBoxes value={otp} onChange={setOtp} autoFocus />

                  {error && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (loading || otp.length !== 6) && { opacity: 0.6 },
                    ]}
                    onPress={handleForgotVerifyOtp}
                    disabled={loading || otp.length !== 6}
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
                          Verify Code
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {mode === 'forgot-newpass' && (
              <>
                <Text style={styles.h1}>Set new password</Text>
                <Text style={styles.subtitle}>
                  Choose a strong new password.
                </Text>

                <View style={{ marginTop: SPACING.lg }}>
                  <Field
                    label="New password"
                    icon={
                      <Ionicons
                        name="lock-closed-outline"
                        size={20}
                        color={COLORS.mist}
                      />
                    }
                  >
                    <TextInput
                      style={[styles.input, styles.inputWithIcon]}
                      value={newPassword}
                      onChangeText={(t) => {
                        setNewPassword(t);
                        if (error) setError(null);
                      }}
                      placeholder="At least 6 characters"
                      placeholderTextColor={'rgba(139,143,163,0.5)'}
                      secureTextEntry
                      autoCapitalize="none"
                      editable={!loading}
                    />
                  </Field>

                  <Field
                    label="Confirm password"
                    icon={
                      <Ionicons
                        name="lock-closed-outline"
                        size={20}
                        color={COLORS.mist}
                      />
                    }
                  >
                    <TextInput
                      style={[styles.input, styles.inputWithIcon]}
                      value={confirmPassword}
                      onChangeText={(t) => {
                        setConfirmPassword(t);
                        if (error) setError(null);
                      }}
                      placeholder="Repeat your password"
                      placeholderTextColor={'rgba(139,143,163,0.5)'}
                      secureTextEntry
                      autoCapitalize="none"
                      editable={!loading}
                    />
                  </Field>

                  {error && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleSetNewPassword}
                    disabled={loading}
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
                          Save New Password
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
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
    backgroundColor: 'rgba(156,130,255,0.15)',
  },

  card: {
    backgroundColor: 'rgba(16,19,28,0.85)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 22,
    ...SHADOWS.card,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
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
  brandTagline: {
    marginTop: 6,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: 'rgba(139,143,163,0.75)',
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
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
  },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: RADII.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: 14,
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: SPACING.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  dividerText: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },

  linkSmall: {
    fontSize: 13,
    fontFamily: FONTS.bodyMedium,
    color: COLORS.violetLight,
  },
  linkText: {
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
