// app/(tabs)/_layout.tsx
// Bottom tabs — website-style with custom SVG icons + violet active state

import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../constants/theme';
import TabIcon from '../../components/TabIcon';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: COLORS.violetLight,
        tabBarInactiveTintColor: '#FFFFFF',
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarAllowFontScaling: false,
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: COLORS.ink900 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="home" active={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="status"
        options={{
          title: 'Status',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="status" active={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="chats" active={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="search" active={focused} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="profile" active={focused} color={color} size={22} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0A0C12',
    // No border top — clean look
    borderTopWidth: 0,
    // Slight shadow instead of a visible line
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 0,
    height: 72,
    paddingBottom: 12,
    paddingTop: 8,
  },
  tabItem: {
    paddingVertical: 4,
    gap: 3,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.2,
    marginTop: 2,
  },
});
