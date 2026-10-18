import React from 'react';
import {AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {Audio} from '@remotion/media';
import type {VideoProps, VideoTrack, VideoStyle} from './types';

export const TrackScene: React.FC<{track: VideoTrack; style: VideoStyle; fadeIn?: boolean; fadeOut?: boolean}> = ({track, style, fadeIn = false, fadeOut = false}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // One second out plus one second in at playlist boundaries; audio timing is unchanged.
  const fadeFrames = Math.min(fps, Math.floor(track.durationInFrames / 2));
  const imageOpacity = fadeFrames > 0 ? Math.max(0, Math.min(1,
    fadeIn ? frame / fadeFrames : 1,
    fadeOut ? (track.durationInFrames - 1 - frame) / fadeFrames : 1,
  )) : 1;
  const ms = frame / fps * 1000;
  const index = track.captions.findIndex(c => c.startMs <= ms && ms < c.endMs);
  const active = index >= 0 ? track.captions[index] : null;
  const next = style.nextLine && index >= 0 ? track.captions[index + 1] : null;
  // All coordinates are design-space pixels and are scaled by Player/renderer together.
  const scale = style.portrait ? 1 : style.width / 1920;
  return <AbsoluteFill style={{backgroundColor: '#080a0d', fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif'}}>
    {style.portrait && track.imageUrl && <Img src={track.imageUrl} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',filter:'blur(36px)',opacity:0.5}} />}
    {track.imageUrl && <Img src={track.imageUrl} style={{width: '100%', height: '100%', objectFit: style.fit, opacity: imageOpacity}} />}
    <AbsoluteFill style={{backgroundColor: `rgba(0,0,0,${style.dim})`}} />
    {track.audioUrl && <Audio src={track.audioUrl} trimBefore={track.audioStartFrame ?? 0} />}
    {style.showTitle && <div style={{position:'absolute', top:64 * scale, left:80 * scale, right:80 * scale, color:'#fff', fontSize:30 * scale, fontWeight:600, textShadow:'0 2px 8px #000'}}>{track.title}</div>}
    {active && <div style={{position:'absolute', left:'7%', right:style.portrait?'15%':'7%', bottom:`${style.bottomPercent}%`, textAlign:'center', color:style.color}}>
      <div style={{fontSize:style.fontSize * scale, lineHeight:style.lineHeight, fontFamily:style.fontFamily, fontWeight:style.fontWeight ?? 700, letterSpacing:style.letterSpacing ? `${style.letterSpacing}em` : undefined, whiteSpace:'pre-wrap', textWrap:'balance', wordBreak:'keep-all', overflowWrap:'anywhere', WebkitTextStroke:`${style.stroke * scale}px ${style.strokeColor ?? 'rgba(0,0,0,0.95)'}`, paintOrder:'stroke fill', textShadow:style.shadow ?? '0 3px 14px rgba(0,0,0,0.85)'}}>{active.text}</div>
      {next && <div style={{fontSize:style.fontSize * scale * 0.6, lineHeight:1.4, marginTop:16 * scale, color:'#ddd', textShadow:'0 2px 8px #000'}}>{next.text}</div>}
    </div>}
  </AbsoluteFill>;
};

export const LyricVideo: React.FC<VideoProps> = ({tracks, style}) => <AbsoluteFill style={{backgroundColor:'#080a0d'}}>
  {tracks.map((track, index) => <Sequence key={track.id} from={track.from} durationInFrames={track.durationInFrames}>
    <TrackScene track={track} style={style} fadeIn={index > 0} fadeOut={index < tracks.length - 1}/>
  </Sequence>)}
</AbsoluteFill>;
