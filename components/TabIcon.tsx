// components/TabIcon.tsx
// Custom SVG tab icons — matches website exactly

import Svg, { Path, Circle } from 'react-native-svg';

type TabName = 'home' | 'status' | 'chats' | 'search' | 'profile';

type Props = {
  tab: TabName;
  active?: boolean;
  color?: string;
  size?: number;
};

export default function TabIcon({
  tab,
  active = false,
  color = '#FFFFFF',
  size = 28,
}: Props) {
  if (tab === 'home') {
    return active ? (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M12 2.6 2.4 10.8a1 1 0 0 0 .65 1.76H4.5V20a1.5 1.5 0 0 0 1.5 1.5h4a1 1 0 0 0 1-1V15h2v5.5a1 1 0 0 0 1 1h4a1.5 1.5 0 0 0 1.5-1.5v-7.44h1.45a1 1 0 0 0 .65-1.76L12 2.6Z"
          fill={color}
        />
      </Svg>
    ) : (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 11l8-7 8 7"
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (tab === 'status') {
    return active ? (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="12" r="9" fill={color} opacity={0.18} />
        <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2.4" />
        <Circle cx="12" cy="12" r="4" fill={color} />
      </Svg>
    ) : (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle
          cx="12"
          cy="12"
          r="9"
          stroke={color}
          strokeWidth="2.6"
          strokeDasharray="3 3"
        />
        <Circle cx="12" cy="12" r="4" fill={color} />
      </Svg>
    );
  }

  if (tab === 'chats') {
    return active ? (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.35 0-2.62-.32-3.75-.9L3 21l1.9-5.75A8.47 8.47 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z"
          fill={color}
        />
      </Svg>
    ) : (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.35 0-2.62-.32-3.75-.9L3 21l1.9-5.75A8.47 8.47 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z"
          stroke={color}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (tab === 'search') {
    return active ? (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="11" cy="11" r="7" fill={color} opacity={0.18} />
        <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth="2.5" />
        <Path
          d="M21 21l-4.3-4.3"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </Svg>
    ) : (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth="2.6" />
        <Path
          d="M21 21l-4.3-4.3"
          stroke={color}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  // profile
  return active ? (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="8" r="4" fill={color} />
      <Path
        d="M4 20c0-4 4-6 8-6s8 2 8 6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"
        fill={color}
      />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth="2.6" />
      <Path
        d="M4 20c0-4 4-6 8-6s8 2 8 6"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </Svg>
  );
}
