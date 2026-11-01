// app/(tabs)/_layout.tsx
// Bottom tabs — custom SVG icons + violet active state + safe-area bottom padding
// Redesigned bar (same as demo). Switch design with TAB_VARIANT: 'pill' | 'line' | 'raised'
// ✅ 'pill' bar is now FLAT + full-width (no rounded edges, no side gaps)
// ✅ UPDATED: useUnreadCount does instant local refresh + debounced network sync
// ✅ SMOOTH: unread badge now uses lightweight COUNT queries (no row downloads),
//            chunked (long id lists no longer break the request), never overlaps,
//            pauses in background and refreshes the moment the app is opened
// ✅ WHATSAPP FEEL: badge "pops" when a new unread arrives; shorter, cleaner
//            tab-switch animation; unread count read out by screen readers

import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Keyboard,
  LayoutAnimation,
  UIManager,
  Animated,
  AppState,
} from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '../../constants/theme';
import TabIcon from '../../components/TabIcon';
import { hapticSelection } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { getCurrentUserId } from '../../lib/auth';
import { subscribeNetwork, isOnline } from '../../lib/network';
import { dbGetConversations } from '../../lib/db';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Short & soft — long animations feel laggy when switching tabs quickly
const TAB_ANIM = {
  duration: 160,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

// ───────────── CONFIG ─────────────
type TabVariant = 'pill' | 'line' | 'raised';
const TAB_VARIANT: TabVariant = 'pill';

const ACTIVE = COLORS.violetLight;
const INACTIVE = '#8E91A5';
const PILL_BG = '#14161E';
const PILL_ACTIVE_BG = 'rgba(124,92,255,0.2)';
const BAR_H = 56;
const NAV_OVERLAP = 16;
const MIN_GAP = 4;
const PILL_H = 50;
const RAISE = 26;

// ───────────── ICONS ─────────────
const homeIcon = ({ color, focused, size }: { color: string; focused: boolean; size?: number }) => (
  <TabIcon tab="home" active={focused} color={color} size={size ?? 22} />
);
const statusIcon = ({ color, focused, size }: { color: string; focused: boolean; size?: number }) => (
  <TabIcon tab="status" active={focused} color={color} size={size ?? 22} />
);
const chatsIcon = ({ color, focused, size }: { color: string; focused: boolean; size?: number }) => (
  <TabIcon tab="chats" active={focused} color={color} size={size ?? 22} />
);
const searchIcon = ({ color, focused, size }: { color: string; focused: boolean; size?: number }) => (
  <TabIcon tab="search" active={focused} color={color} size={size ?? 22} />
);
const profileIcon = ({ color, focused, size }: { color: string; focused: boolean; size?: number }) => (
  <TabIcon tab="profile" active={focused} color={color} size={size ?? 22} />
);

// ───────────── HELPERS ─────────────
function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setVisible(true));
    const b = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return visible;
}

function Badge({ count, style }: { count: number; style?: any }) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(count);

  // "Pop" when a NEW unread arrives (like WhatsApp)
  useEffect(() => {
    if (count > prev.current) {
      scale.setValue(0.6);
      Animated.spring(scale, {
        toValue: 1,
        friction: 4,
        tension: 160,
        useNativeDriver: true,
      }).start();
    }
    prev.current = count;
  }, [count, scale]);

  if (!count) return null;
  return (
    <Animated.View
      style={[styles.badge, style, { transform: [{ scale }] }]}
      pointerEvents="none"
    >
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </Animated.View>
  );
}

// Unread count for the Chats tab — cache first, then network + realtime
// Strategy:
//  1. Show cached count instantly (SQLite)
//  2. Sync from network in background (debounced) with COUNT queries only
//  3. On realtime event → local refresh first + schedule network sync
//  4. Never run two network syncs at once; skip while app is in background
const ID_CHUNK = 100; // keeps every request URL small

function useUnreadCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let channel: any = null;
    let unsubNet: (() => void) | null = null;
    let myId: string | null = null;
    let inFlight = false;
    let rerun = false;

    // ✅ Local DB read — instant, no network
    const fromCache = async () => {
      try {
        const rows = await dbGetConversations();
        if (!mounted) return;
        setCount(
          rows.reduce(
            (sum, r) => sum + (r.is_muted === 1 ? 0 : r.unread_count ?? 0),
            0
          )
        );
      } catch {}
    };

    // ✅ Network read — authoritative (COUNT only, no message rows downloaded)
    const fromNetwork = async () => {
      if (!myId || !isOnline()) return;
      if (AppState.currentState !== 'active') return;
      if (inFlight) {
        rerun = true;
        return;
      }
      inFlight = true;

      try {
        do {
          rerun = false;

          const [partsRes, settingsRes] = await Promise.all([
            supabase
              .from('conversation_participants')
              .select('conversation_id')
              .eq('user_id', myId),
            supabase
              .from('chat_settings')
              .select('conversation_id, is_muted')
              .eq('user_id', myId),
          ]);

          if (partsRes.error || settingsRes.error) return; // keep last value

          const muted = new Set(
            (settingsRes.data ?? [])
              .filter((s: any) => s.is_muted)
              .map((s: any) => s.conversation_id)
          );
          const ids: string[] = (partsRes.data ?? [])
            .map((p: any) => p.conversation_id)
            .filter((id: string) => !muted.has(id));

          if (ids.length === 0) {
            if (mounted) setCount(0);
            continue;
          }

          const chunks: string[][] = [];
          for (let i = 0; i < ids.length; i += ID_CHUNK) {
            chunks.push(ids.slice(i, i + ID_CHUNK));
          }

          const results = await Promise.all(
            chunks.map((chunk) =>
              supabase
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .in('conversation_id', chunk)
                .neq('sender_id', myId)
                .is('read_at', null)
            )
          );

          // Any failed chunk → don't show a wrong (too low) number
          if (results.some((r) => r.error)) return;

          const total = results.reduce((sum, r) => sum + (r.count ?? 0), 0);
          if (mounted) setCount(total);
        } while (rerun && mounted);
      } catch (err) {
        console.warn('[tabs] unread count error:', err);
      } finally {
        inFlight = false;
      }
    };

    // ✅ Schedule: local refresh NOW + network sync debounced
    const schedule = () => {
      fromCache();
      if (timer) clearTimeout(timer);
      timer = setTimeout(fromNetwork, 600);
    };

    (async () => {
      await fromCache();
      myId = await getCurrentUserId();
      if (!mounted || !myId) return;

      fromNetwork();

      channel = supabase
        .channel('tabs-unread-realtime')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          schedule
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          schedule
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_settings' },
          schedule
        )
        .subscribe();

      unsubNet = subscribeNetwork((on: boolean) => {
        if (on) schedule();
      });
    })();

    // Opening the app → refresh immediately (events missed in background)
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') schedule();
    });

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
      if (unsubNet) unsubNet();
      appSub.remove();
    };
  }, []);

  return count;
}

// ───────────── TAB BAR ─────────────
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const unreadCount = useUnreadCount();

  const bottomPad =
    Platform.OS === 'android' ? Math.max(insets.bottom, 10) : insets.bottom;
  const pillBottom = Math.max(insets.bottom - NAV_OVERLAP, MIN_GAP);

  if (keyboardVisible) return null;

  const items = state.routes.map((route, index) => {
    const focused = state.index === index;
    const { options } = descriptors[route.key];
    const label = typeof options.title === 'string' ? options.title : route.name;

    const icon = (color: string, size: number) =>
      options.tabBarIcon?.({ focused, color, size }) ?? null;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        hapticSelection();
        if (TAB_VARIANT === 'pill') {
          LayoutAnimation.configureNext(TAB_ANIM);
        }
        navigation.navigate(route.name, route.params);
      }
    };

    const onLongPress = () => {
      navigation.emit({ type: 'tabLongPress', target: route.key });
    };

    return {
      route,
      focused,
      label,
      icon,
      badge: route.name === 'chats' ? unreadCount : 0,
      onPress,
      onLongPress,
    };
  });

  // ── 1. FLAT FULL-WIDTH BAR ──
  if (TAB_VARIANT === 'pill') {
    return (
      <View style={[styles.pillWrap, { paddingTop: 0, paddingBottom: pillBottom }]}>
        <View style={styles.pill}>
          {items.map((it) => (
            <Pressable
              key={it.route.key}
              onPress={it.onPress}
              onLongPress={it.onLongPress}
              accessibilityRole="button"
              accessibilityLabel={it.badge ? `${it.label}, ${it.badge} unread` : it.label}
              accessibilityState={{ selected: it.focused }}
              style={[styles.pillItem, it.focused && styles.pillItemActive]}
            >
              <View>
                {it.icon(it.focused ? ACTIVE : INACTIVE, 22)}
                <Badge count={it.badge} style={{ top: -6, right: -9 }} />
              </View>
              {it.focused && <Text style={styles.pillLabel}>{it.label}</Text>}
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // ── 2. CLEAN LINE ──
  if (TAB_VARIANT === 'line') {
    return (
      <View
        style={[
          styles.lineBar,
          { height: BAR_H + bottomPad, paddingBottom: bottomPad },
        ]}
      >
        {items.map((it) => (
          <Pressable
            key={it.route.key}
            onPress={it.onPress}
            onLongPress={it.onLongPress}
            accessibilityRole="button"
            accessibilityLabel={it.badge ? `${it.label}, ${it.badge} unread` : it.label}
            accessibilityState={{ selected: it.focused }}
            style={styles.lineItem}
          >
            {it.focused && <View style={styles.lineIndicator} />}
            <View>
              {it.icon(it.focused ? ACTIVE : INACTIVE, 22)}
              <Badge count={it.badge} style={{ top: -6, right: -10 }} />
            </View>
            <Text
              style={[
                styles.lineLabel,
                { color: it.focused ? ACTIVE : INACTIVE },
              ]}
            >
              {it.label}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  // ── 3. RAISED CHATS ──
  return (
    <View style={{ height: RAISE + BAR_H + bottomPad }}>
      <View style={[styles.raisedStrip, { height: BAR_H + bottomPad }]} />
      <View style={[styles.raisedRow, { paddingBottom: bottomPad }]}>
        {items.map((it) =>
          it.route.name === 'chats' ? (
            <Pressable
              key={it.route.key}
              onPress={it.onPress}
              onLongPress={it.onLongPress}
              accessibilityRole="button"
              accessibilityLabel={it.badge ? `${it.label}, ${it.badge} unread` : it.label}
              accessibilityState={{ selected: it.focused }}
              style={styles.raisedCenterItem}
            >
              <View
                style={[
                  styles.raisedCircle,
                  it.focused && styles.raisedCircleActive,
                ]}
              >
                {it.icon('#FFFFFF', 24)}
                <Badge count={it.badge} style={styles.raisedBadge} />
              </View>
              <Text
                style={[
                  styles.lineLabel,
                  { color: it.focused ? ACTIVE : INACTIVE, marginTop: 2 },
                ]}
              >
                {it.label}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              key={it.route.key}
              onPress={it.onPress}
              onLongPress={it.onLongPress}
              accessibilityRole="button"
              accessibilityLabel={it.badge ? `${it.label}, ${it.badge} unread` : it.label}
              accessibilityState={{ selected: it.focused }}
              style={styles.raisedItem}
            >
              <View>
                {it.icon(it.focused ? ACTIVE : INACTIVE, 22)}
                <Badge count={it.badge} style={{ top: -6, right: -10 }} />
              </View>
              <Text
                style={[
                  styles.lineLabel,
                  { color: it.focused ? ACTIVE : INACTIVE },
                ]}
              >
                {it.label}
              </Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}

// ───────────── LAYOUT ─────────────
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: '#000000' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', tabBarIcon: homeIcon }}
      />
      <Tabs.Screen
        name="status"
        options={{ title: 'Status', tabBarIcon: statusIcon }}
      />
      <Tabs.Screen
        name="chats"
        options={{ title: 'Chats', tabBarIcon: chatsIcon }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Search', tabBarIcon: searchIcon }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: profileIcon }}
      />
    </Tabs>
  );
}

// ───────────── STYLES ─────────────
const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: COLORS.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#0A0C12',
    fontSize: 10,
    lineHeight: 12,
    fontFamily: FONTS.bodySemiBold,
  },

  pillWrap: {
    backgroundColor: '#000000',
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  pill: {
    height: PILL_H,
    borderRadius: 0,
    backgroundColor: PILL_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
  },
  pillItem: {
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pillItemActive: {
    backgroundColor: PILL_ACTIVE_BG,
    paddingHorizontal: 14,
  },
  pillLabel: {
    color: ACTIVE,
    fontSize: 13,
    fontFamily: FONTS.bodyMedium,
  },

  lineBar: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  lineItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  lineIndicator: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: COLORS.violet,
  },
  lineLabel: {
    fontSize: 10.5,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
  },

  raisedStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  raisedRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  raisedItem: {
    flex: 1,
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  raisedCenterItem: {
    flex: 1,
    height: RAISE + BAR_H,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  raisedCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.violet,
    borderWidth: 4,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  raisedCircleActive: {
    transform: [{ scale: 1.08 }],
  },
  raisedBadge: {
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#000000',
  },
});
