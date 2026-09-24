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
        sceneStyle: { backgroundColor: '#000000' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="home" active={focused} color={color} size={28} />
          ),
        }}
      />
      <Tabs.Screen
        name="status"
        options={{
          title: 'Status',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="status" active={focused} color={color} size={28} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="chats" active={focused} color={color} size={28} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="search" active={focused} color={color} size={28} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon tab="profile" active={focused} color={color} size={28} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#000000',
    // ✅ No white line, no shadow — clean black merge with content
    borderTopWidth: 0,
    borderTopColor: 'transparent',
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    // Bigger height for bigger icons + bold labels
    height: 96,
    paddingBottom: 14,
    paddingTop: 12,
  },
  tabItem: {
    paddingVertical: 6,
    height: 72,
  },
  // Tab label — 14px bold
  tabLabel: {
    fontSize: 14,
    fontFamily: FONTS.bodySemiBold,
    letterSpacing: 0.3,
    marginTop: 6,
    color: '#FFFFFF',
  },
});
