import React, {createRef, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Player, type PlayerRef} from '@remotion/player';
import {LyricVideo} from './LyricVideo';
import type {VideoProps} from './types';

type Controller = {seek:(seconds:number)=>void; play:()=>void; pause:()=>void; update:(props:VideoProps)=>void; destroy:()=>void};

// Remotion's Player keeps media resources inside the mounted player instance.
// Force a fresh instance when any composition input changes so a newly selected
// background image is visible immediately in the preview.
function playerInputKey(props: VideoProps): string {
  return JSON.stringify(props);
}

export function mountPlayer(element: HTMLElement, initial: VideoProps, onTime: (seconds:number)=>void, onPlaying: (playing:boolean)=>void = ()=>{}): Controller {
  const root = createRoot(element);
  const ref = createRef<PlayerRef>();
  let current = initial;
  const View: React.FC<{props:VideoProps; initialFrame:number}> = ({props, initialFrame}) => {
    const durationInFrames = Math.max(1, ...props.tracks.map(t=>t.from+t.durationInFrames));
    useEffect(() => {
      const player = ref.current;
      if (!player) return;
      const callback = (event: {detail:{frame:number}}) => onTime(event.detail.frame / props.style.fps);
      const playing=()=>onPlaying(true); const paused=()=>{onPlaying(false);onTime(player.getCurrentFrame()/props.style.fps);};
      player.addEventListener('play',playing);player.addEventListener('pause',paused);player.addEventListener('ended',paused);
      player.addEventListener('frameupdate', callback);
      return () => {player.removeEventListener('frameupdate', callback);player.removeEventListener('play',playing);player.removeEventListener('pause',paused);player.removeEventListener('ended',paused);};
    }, [props]);
    return <Player key={playerInputKey(props)} ref={ref} component={LyricVideo} inputProps={props}
      initialFrame={Math.min(Math.max(0, initialFrame), durationInFrames - 1)}
      durationInFrames={durationInFrames}
      compositionWidth={props.style.width} compositionHeight={props.style.height} fps={props.style.fps}
      controls style={{width:'100%', aspectRatio:`${props.style.width}/${props.style.height}`}} acknowledgeRemotionLicense
    />;
  };
  const update = (props:VideoProps) => {
    const sameTracks = current.tracks.length===props.tracks.length && current.tracks.every((track,index)=>track.id===props.tracks[index]?.id);
    const initialFrame = sameTracks ? (ref.current?.getCurrentFrame() ?? 0) : 0;
    current=props;
    root.render(<View props={props} initialFrame={initialFrame}/>);
  };
  update(initial);
  return {seek:seconds => ref.current?.seekTo(Math.round(seconds*current.style.fps)), play:()=>{ref.current?.play();}, pause:()=>ref.current?.pause(), update, destroy:()=>root.unmount()};
}
