// lib/music.ts
// iTunes Search API — free, no auth, no key. 30s previews.

const ITUNES_BASE = 'https://itunes.apple.com/search';

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  durationSec: number;
  streamUrl: string;
};

export async function searchMusic(
  query: string,
  limit = 25
): Promise<MusicTrack[]> {
  if (!query.trim()) return [];
  try {
    const url =
      `${ITUNES_BASE}?term=${encodeURIComponent(query)}` +
      `&media=music&entity=song&limit=${limit}&country=IN`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const results: any[] = json?.results ?? [];
    return results
      .filter((r) => r.previewUrl)
      .map((r) => ({
        id: String(r.trackId),
        title: r.trackName ?? 'Unknown',
        artist: r.artistName ?? 'Unknown artist',
        artwork: (r.artworkUrl100 ?? '').replace('100x100', '300x300'),
        durationSec: Math.round((r.trackTimeMillis ?? 0) / 1000),
        streamUrl: r.previewUrl,
      }));
  } catch (err) {
    console.warn('searchMusic error:', err);
    return [];
  }
}
