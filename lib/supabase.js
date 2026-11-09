import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Realtime guard: same naam ka channel abhi exist kare to naya unique naam do.
// 'online-users' (presence) ko chhod ke, wo sabke liye ek hi topic hona chahiye.
const SHARED_TOPICS = new Set(['online-users']);
const _channel = supabase.channel.bind(supabase);

supabase.channel = (name, opts) => {
  try {
    if (typeof name === 'string' && !SHARED_TOPICS.has(name)) {
      const topic = `realtime:${name}`;
      const taken = supabase.getChannels().some((c) => c.topic === topic);
      if (taken) {
        name = `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      }
    }
  } catch {}
  return _channel(name, opts);
};
