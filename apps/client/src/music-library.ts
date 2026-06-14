export type MusicTrack = {
  id: string;
  storageItemId: string;
  name: string;
  dataUrl: string;
  createdAt: string;
};

function playlistKey(userId: string) {
  return `notoc.music-playlist.${encodeURIComponent(userId)}`;
}

export async function getMusicTracks(userId: string) {
  const raw = localStorage.getItem(playlistKey(userId));
  if (!raw) return [];

  try {
    return JSON.parse(raw) as MusicTrack[];
  } catch {
    return [];
  }
}

export async function addMusicTrack(userId: string, track: Omit<MusicTrack, 'id' | 'createdAt'>) {
  const current = await getMusicTracks(userId);
  const nextTrack: MusicTrack = {
    ...track,
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString()
  };
  const next = [...current.filter((item) => item.storageItemId !== track.storageItemId), nextTrack];
  localStorage.setItem(playlistKey(userId), JSON.stringify(next));
  return nextTrack;
}

export async function deleteMusicTrack(userId: string, id: string) {
  const current = await getMusicTracks(userId);
  localStorage.setItem(playlistKey(userId), JSON.stringify(current.filter((track) => track.id !== id)));
}

export async function saveMusicTracksOrder(userId: string, tracks: MusicTrack[]) {
  localStorage.setItem(playlistKey(userId), JSON.stringify(tracks));
}
