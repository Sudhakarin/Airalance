// app/(tabs)/search.tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../constants/theme';

export default function SearchScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Search — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.ink900, alignItems: 'center', justifyContent: 'center' },
  text: { color: COLORS.text, fontSize: 16, fontFamily: FONTS.body },
});
