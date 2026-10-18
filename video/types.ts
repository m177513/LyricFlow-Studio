import type {Caption} from '@remotion/captions';
export type VideoStyle = {
  width: number; height: number; fps: number; fontSize: number; bottomPercent: number;
  color: string; stroke: number; lineHeight: number; dim: number; fit: 'contain' | 'cover';
  showTitle: boolean; nextLine: boolean; portrait?: boolean;
  // Optional caption look. Left out, the defaults in LyricVideo.tsx apply (Malgun Gothic 700, black outline, one soft shadow).
  fontFamily?: string; fontWeight?: number; letterSpacing?: number; strokeColor?: string; shadow?: string;
};
export type VideoTrack = {
  id: string; title: string; durationMs: number; from: number; durationInFrames: number;
  audioStartFrame?: number; audioUrl: string; imageUrl: string | null; captions: Caption[];
};
export type VideoProps = {style: VideoStyle; tracks: VideoTrack[]};
