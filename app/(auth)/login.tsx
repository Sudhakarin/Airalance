// app/(auth)/login.tsx
// Login screen — matches website UI with violet/teal gradient design

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
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, RADII, GRADIENTS, SPACING, SHADOWS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    // Reset error
    setError('');

    // Validate
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }

    if (!email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }

    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password,
      });

      if (authError) {
        // Friendly error messages
        let msg = authError.message;
        if (msg.includes('Invalid login credentials')) {
          msg = 'Wrong email or password';
        } else if (msg.includes('Email not confirmed')) {
          msg = 'Please confirm your email first';
        }
        setError(msg);
        setLoading(false);
        return;
      }

      if (data.session) {
        // Success — navigate to tabs
        router.replace('/(tabs)/home');
      } else {
        setError('Login failed. Please try again.');
        setLoading(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Background glows */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={styles.brandWrap}>
            <Text style={styles.brand}>Airalance!</Text>
            <Text style={styles.tagline}>Welcome back</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Heading */}
            <Text style={styles.heading}>Log in</Text>
            <Text style={styles.subheading}>
              Enter your credentials to continue
            </Text>

            {/* Error */}
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (error) setError('');
                }}
                placeholder="you@example.com"
                placeholderTextColor={COLORS.mist}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!loading}
              />
            </View>

            {/* Password */}
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (error) setError('');
                  }}
                  placeholder="Your password"
                  placeholderTextColor={COLORS.mist}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.eyeText}>
                    {showPassword ? '🙈' : '👁'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={GRADIENTS.violet}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryBtnGradient}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Log in</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Forgot password */}
            <TouchableOpacity
              style={styles.forgotBtn}
              activeOpacity={0.7}
              onPress={() =>
                Alert.alert(
                  'Forgot password?',
                  'Password reset will be available soon.'
                )
              }
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>New here?</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Signup Button */}
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.85}>
                <Text style={styles.secondaryBtnText}>Create an account</Text>
              </TouchableOpacity>
            </Link>
          </View>

          {/* Footer */}
          <Text style={styles.footer}>
            By continuing, you agree to our Terms & Privacy Policy
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.ink900,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxxl,
    paddingBottom: SPACING.xxl,
  },

  // Background glows
  glowTop: {
    position: 'absolute',
    top: -180,
    left: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(124, 92, 255, 0.16)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -180,
    right: -120,
    width: 460,
    height: 460,
    borderRadius: 230,
    backgroundColor: 'rgba(34, 211, 184, 0.08)',
  },

  // Brand
  brandWrap: {
    alignItems: 'center',
    marginBottom: SPACING.xxxl,
  },
  brand: {
    fontSize: 36,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  tagline: {
    marginTop: 6,
    fontSize: 14,
    fontFamily: FONTS.body,
    color: COLORS.mist,
  },

  // Card
  card: {
    backgroundColor: 'rgba(16, 19, 28, 0.75)',
    borderRadius: RADII.xxl,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    padding: SPACING.xl,
    ...SHADOWS.card,
  },

  heading: {
    fontSize: 26,
    fontFamily: FONTS.displayBold,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subheading: {
    fontSize: 13,
    fontFamily: FONTS.body,
    color: COLORS.mist,
    marginBottom: SPACING.xl,
  },

  // Error
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: RADII.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: SPACING.lg,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontFamily: FONTS.bodyMedium,
  },

  // Fields
  field: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: 12,
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.mistLight,
    marginBottom: 6,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: RADII.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: FONTS.body,
    color: '#FFFFFF',
  },
  passwordWrap: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  eyeText: {
    fontSize: 16,
  },

  // Primary button
  primaryBtn: {
    borderRadius: RADII.full,
    overflow: 'hidden',
    marginTop: SPACING.sm,
    ...SHADOWS.buttonViolet,
  },
  primaryBtnGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
  },

  // Forgot
  forgotBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  forgotText: {
    color: COLORS.mist,
    fontSize: 13,
    fontFamily: FONTS.body,
  },

  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  dividerText: {
    marginHorizontal: 12,
    color: COLORS.mist,
    fontSize: 12,
    fontFamily: FONTS.body,
  },

  // Secondary button
  secondaryBtn: {
    borderRadius: RADII.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
  },

  // Footer
  footer: {
    marginTop: SPACING.xxl,
    textAlign: 'center',
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: FONTS.body,
    opacity: 0.6,
  },
});
