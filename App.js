import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from './lib/supabase';

export default function App() {
  const [status, setStatus] = useState('Testing...');

  useEffect(() => {
    async function testConnection() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          setStatus('❌ Error: ' + error.message);
        } else {
          setStatus('✅ Supabase Connected!');
        }
      } catch (err) {
        setStatus('❌ Crash: ' + err.message);
      }
    }
    testConnection();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 20,
    fontWeight: 'bold',
  },
});

