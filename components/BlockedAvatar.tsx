// components/BlockedAvatar.tsx
// Instagram jaisa default avatar: halka gray/white circle + white person silhouette.

import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function BlockedAvatar({ size = 48 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#DBDBDB',
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      <Ionicons
        name="person"
        size={size * 0.84}
        color="#FFFFFF"
        style={{ marginBottom: -size * 0.07 }}
      />
    </View>
  );
}
