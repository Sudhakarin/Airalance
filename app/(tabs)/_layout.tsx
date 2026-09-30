// app/(tabs)/_layout.tsx
// Bottom tabs — custom SVG icons + violet active state + safe-area bottom padding

import { Tabs } from 'expo-router';
import { StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '../../constants/theme';
import TabIcon from '../../components/TabIcon';

const homeIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <TabIcon tab="home" active={focused} color={color} size={22} />
);
const statusIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <TabIcon tab="status" active={focused} color={color} size={22} />
);
const chatsIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <TabIcon tab="chats" active={focused} color={color} size={22} />
);
const searchIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <TabIcon tab="search" active={focused} color={color} size={22} />
);
const profileIcon = ({ color, focused }: { color: string; focused: boolean }) => (
  <TabIcon tab="profile" active={focused} color={color} size={22} />
);

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  // ✅ FIXED: ensure minimum bottom padding so tab bar never mixes
  // with the phone's system navigation buttons (Realme UI, MIUI, etc.)
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: COLORS.violetLight,
        tabBarInactiveTintColor: '#FFFFFF',
        tabBarStyle: [
          styles.tabBar,
          {
            // Height = base content (52) + safe-area bottom (+ 4 buffer)
            height: 52 + bottomInset + 4,
            paddingBottom: bottomInset + 4,
          },
        ],
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarAllowFontScaling: false,
        tabBarHideOnKeyboard: true,
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

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#000000',
    borderTopWidth: 0,
    borderTopColor: 'transparent',
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    paddingTop: 4,
  },
  tabItem: {
    paddingVertical: 2,
    // Don't force fixed height — let parent control spacing
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
    marginTop: 2,
  },
});
