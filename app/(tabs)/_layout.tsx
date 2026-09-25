// app/(tabs)/_layout.tsx
// Bottom tabs — custom SVG icons + violet active state

import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '../../constants/theme';
import TabIcon from '../../components/TabIcon';

// Icon renderers declared outside — stable references, no re-allocation
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
            height: 50 + insets.bottom,
            paddingBottom: 4 + insets.bottom,
          },
        ],
        // ⚠️ FIXED: color removed here — otherwise it overrides the active violet
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarAllowFontScaling: false,
        tabBarHideOnKeyboard: true,
        // ✅ FIXED: sceneStyle (React Navigation v7) not sceneContainerStyle (v6)
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
    height: 44,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
    marginTop: 2,
    // ⚠️ color NOT set — let activeTintColor/inactiveTintColor control it
  },
});
