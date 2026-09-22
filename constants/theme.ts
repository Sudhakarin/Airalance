// constants/theme.ts
// Design system — exactly matches the website's globals.css

export const COLORS = {
  // ===== Backgrounds =====
  ink900: '#0A0C12',      // main background
  ink800: '#10131C',      // cards, sheets
  ink700: '#161A26',      // elevated surfaces
  ink600: '#1E2333',      // hover state

  // ===== Text =====
  text: '#E8E9ED',        // main text
  mist: '#8B8FA3',        // secondary text
  mistLight: '#C7C9D9',   // light/secondary emphasis

  // ===== Brand colors =====
  violet: '#7C5CFF',
  violetLight: '#9C82FF',
  violetDark: '#5B3FE0',
  teal: '#22D3B8',
  tealDark: '#16A98C',

  // ===== Status colors =====
  danger: '#EF4444',
  warning: '#F59E0B',
  success: '#10B981',
  info: '#3B82F6',

  // ===== Glass effect (from website) =====
  glassBg: 'rgba(22, 26, 38, 0.55)',
  glassBorder: 'rgba(255, 255, 255, 0.06)',
  glassBgLight: 'rgba(255, 255, 255, 0.7)',
  glassBorderLight: 'rgba(0, 0, 0, 0.07)',

  // ===== Message bubbles =====
  bubbleMine: '#171A24',      // incoming messages
  bubbleOther: '#0A0C12',     // (unused for now — see gradients)

  // ===== Status rings =====
  ringColor1: '#C9C2FF',
  ringColor2: '#A78BFA',
  ringColor3: '#D66BE0',
  ringColor4: '#F4607A',
  ringViewed1: '#5A6172',
  ringViewed2: '#3A3F4C',

  // ===== Status composer colors =====
  statusColors: ['#7C5CFF', '#22D3B8', '#EF4444', '#F59E0B', '#3B82F6', '#EC4899', '#111827'],

  // ===== Chat theme colors =====
  chatThemes: {
    default: {
      id: 'default',
      name: 'Default',
      bg: '#0A0C12',
      bubble: ['#A78BFA', '#7C5CFF', '#5B3FE0'],
      incoming: '#171A24',
      accent: '#7C5CFF',
      glass: 'rgba(11,13,20,0.85)',
      glassBorder: 'rgba(255,255,255,0.06)',
    },
    ocean: {
      id: 'ocean',
      name: 'Ocean',
      bg: '#0A1A30',
      bubble: ['#4F8DFF', '#2F6BFF', '#2050D8'],
      incoming: '#14284A',
      accent: '#4F8DFF',
      glass: 'rgba(12,36,70,0.55)',
      glassBorder: 'rgba(140,190,255,0.18)',
    },
    forest: {
      id: 'forest',
      name: 'Forest',
      bg: '#08211B',
      bubble: ['#1FBF83', '#0F9E69', '#0B7F55'],
      incoming: '#12332A',
      accent: '#1FBF83',
      glass: 'rgba(10,44,34,0.55)',
      glassBorder: 'rgba(110,231,183,0.18)',
    },
    sunset: {
      id: 'sunset',
      name: 'Sunset',
      bg: '#241026',
      bubble: ['#F2664F', '#E63E69', '#C4305F'],
      incoming: '#36192F',
      accent: '#F2664F',
      glass: 'rgba(58,20,48,0.55)',
      glassBorder: 'rgba(255,170,140,0.18)',
    },
    midnight: {
      id: 'midnight',
      name: 'Midnight',
      bg: '#050608',
      bubble: ['#4B5163', '#2C303C', '#1F2228'],
      incoming: '#14151B',
      accent: '#8B93A7',
      glass: 'rgba(14,15,20,0.6)',
      glassBorder: 'rgba(255,255,255,0.11)',
    },
  } as const,
} as const;

// ===== Fonts (matching website: Poppins, Inter, JetBrains Mono) =====
export const FONTS = {
  display: 'Poppins_600SemiBold',
  displayBold: 'Poppins_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
} as const;

// ===== Border radius =====
export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
} as const;

// ===== Spacing scale =====
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// ===== Gradient presets (for expo-linear-gradient) =====
export const GRADIENTS = {
  // Brand
  violet: ['#9C82FF', '#7C5CFF'] as const,
  violetDark: ['#7C5CFF', '#5B3FE0'] as const,
  teal: ['#22D3B8', '#16A98C'] as const,

  // Text gradient (masked view)
  text: ['#9C82FF', '#22D3B8'] as const,

  // Own message bubble
  bubbleMine: ['#A78BFA', '#7C5CFF', '#5B3FE0'] as const,

  // Status ring (unviewed)
  statusRing: ['#C9C2FF', '#A78BFA', '#D66BE0', '#F4607A'] as const,

  // Status ring (viewed)
  statusRingViewed: ['#5A6172', '#3A3F4C'] as const,

  // Subscribe / premium
  premium: ['#A78BFA', '#F4607A'] as const,

  // Aurora / background blobs
  auroraViolet: ['rgba(124,92,255,0.20)', 'rgba(124,92,255,0)'] as const,
  auroraTeal: ['rgba(34,211,184,0.10)', 'rgba(34,211,184,0)'] as const,
} as const;

// ===== Common style objects (reusable) =====
export const SHADOWS = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  bubbleMine: {
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  buttonViolet: {
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
} as const;

// ===== Constants (from ChatClient.tsx) =====
export const CONSTANTS = {
  PAGE_SIZE: 30,
  CHAT_MEDIA_BUCKET: 'chat-media',
  STATUS_MEDIA_BUCKET: 'status-media',
  NEWS_MEDIA_BUCKET: 'news-media',
  AVATARS_BUCKET: 'avatars',
  VERIFICATION_BUCKET: 'verification-docs',
  MAX_IMAGE_BYTES: 8 * 1024 * 1024,
  MAX_BIO_LENGTH: 160,
  STATUS_DURATION_MS: 15000,
  STATUS_MAX_VIDEO_MS: 30000,
  TYPING_IDLE_MS: 3000,
  TYPING_THROTTLE_MS: 2000,
  GROUPED_GAP_MS: 2 * 60 * 1000,
  POLL_INTERVAL_MS: 3000,
  EDIT_TIMEOUT_MS: 300000,
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
} as const;

// ===== Emojis & misc =====
export const QUICK_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🙏'] as const;
export const PHOTO_FILTERS = [
  { id: 'normal', label: 'Normal', css: '' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.45) contrast(1.12) brightness(1.02)' },
  { id: 'bw', label: 'B&W', css: 'grayscale(1) contrast(1.1)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.28) saturate(1.3) brightness(1.04) hue-rotate(-6deg)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.15) hue-rotate(12deg) brightness(1.02) contrast(1.05)' },
  { id: 'fade', label: 'Fade', css: 'contrast(0.88) brightness(1.1) saturate(0.78) sepia(0.14)' },
] as const;

// ===== Verified usernames (from website logic) =====
export const VERIFIED_USERNAMES = [
  'sudhakarin',
  'tanushree2251',
  'airalance',
  'shikhamishra',
  'manjumishra',
] as const;

// ===== Storage keys =====
export const STORAGE_KEYS = {
  ACTIVE_STATUS: 'airalance-active-status',
  CHAT_THEME_PREFIX: 'airalance-chat-theme:',
  STATUS_CACHE_PREFIX: 'airalance-status-cache:',
  NEWS_CACHE: 'airalance-news-cache',
  PROFILE_CACHE_PREFIX: 'ci_profile_cache_v1:',
  DISMISSED_NOTIFS_PREFIX: 'ci_dismissed_app_notifs:',
  USAGE_PREFIX: 'airalance-usage:',
  USAGE_LIMIT_PREFIX: 'airalance-timelimit:',
  USAGE_LIMIT_SHOWN_PREFIX: 'airalance-timelimit-shown:',
} as const;

// ===== Helper type exports =====
export type ChatThemeId = keyof typeof COLORS.chatThemes;
export type ChatTheme = typeof COLORS.chatThemes[ChatThemeId];
